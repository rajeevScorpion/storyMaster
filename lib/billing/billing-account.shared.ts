import type { BillingInterval, BillingMethodCategory, BillingPaymentKind } from '@/lib/types/pricing';
import type { CheckoutQuoteTaxLine } from '@/lib/billing/checkout-quote.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit F): pure DTOs and formatting/selection
 * logic for Settings -> Billing (app/actions/billing-account.ts,
 * components/billing/BillingAccountPage.tsx). Split out per CLAUDE.md's *.shared.ts convention so
 * the banner copy, method labels and payment descriptions are unit-tested without mounting the page
 * or mocking Supabase.
 */

export interface BillingSubscriptionOverview {
  planKey: string | null;
  planName: string;
  /** The subscription's own version price (net), not today's catalogue price. */
  priceMinor: number | null;
  currencyCode: string | null;
  interval: BillingInterval;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingPaymentOverview {
  id: string;
  date: string;
  description: string;
  methodLabel: string;
  grossMinor: number;
  currencyCode: string;
  taxLines: CheckoutQuoteTaxLine[];
  refund: { amountMinor: number; processed: boolean; date: string | null } | null;
}

export interface BillingDocumentOverview {
  id: string;
  documentType: string;
  documentNumber: string;
  issuedAt: string;
  totalMinor: number;
  currencyCode: string;
}

/** "Invoice" / "Credit note" for the billing page's document list (Payments Phase 6, Unit B6).
 * Anything else (a legacy 'receipt' row, or an unrecognised future type) falls back to "Document"
 * rather than printing the raw snake_case value. */
export function documentTypeLabel(documentType: string): string {
  if (documentType === 'tax_invoice') return 'Invoice';
  if (documentType === 'credit_note') return 'Credit note';
  return 'Document';
}

export interface BillingOverviewSections {
  subscription: 'ok' | 'unavailable';
  payments: 'ok' | 'unavailable';
  documents: 'ok' | 'unavailable';
}

export interface GetMyBillingOverviewResult {
  subscription: BillingSubscriptionOverview | null;
  payments: { items: BillingPaymentOverview[]; hasMore: boolean };
  documents: BillingDocumentOverview[];
  sections: BillingOverviewSections;
}

const LIVE_SUBSCRIPTION_STATUSES = new Set(['authenticated', 'active', 'pending', 'halted']);

export interface SubscriptionRowForPick {
  status: string;
  provider_mode: string;
  created_at: string;
}

/**
 * The subscription the billing page should show: the newest row still "live" (authenticated,
 * active, pending or halted), or failing that the newest row that has ended -- in the caller's
 * current Razorpay mode only. Null when the user has no row in that mode at all.
 */
export function pickCurrentSubscription<T extends SubscriptionRowForPick>(rows: T[], mode: string): T | null {
  const inMode = rows.filter((row) => row.provider_mode === mode);
  if (inMode.length === 0) return null;

  const byNewest = (a: T, b: T) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const live = inMode.filter((row) => LIVE_SUBSCRIPTION_STATUSES.has(row.status)).sort(byNewest);
  if (live.length > 0) return live[0];

  return [...inMode].sort(byNewest)[0];
}

export interface SubscriptionBanner {
  tone: 'renewing' | 'cancelling' | 'pending' | 'halted' | 'ended';
  text: string;
  action?: 'restart';
}

function formatBannerDate(value: string | null): string {
  if (!value) return 'an unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Owner-approved copy (phase-5-plan.md §5, Unit F execution spec). `cancelAtPeriodEnd` takes
 * priority over the plain renewal line, since Razorpay keeps a cycle-end cancellation "active" right
 * up to the date it's cancelling into. `now` guards the same case once that date has actually
 * passed but the row hasn't synced to a terminal status yet -- "Cancels on/Renews on <past date>"
 * would be a stale and confusing thing to show, so both fall through to "Ended on <date>" instead.
 */
export function subscriptionBanner(
  dto: Pick<BillingSubscriptionOverview, 'status' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'>,
  now: Date
): SubscriptionBanner {
  const periodEndPassed = dto.currentPeriodEnd !== null && new Date(dto.currentPeriodEnd).getTime() <= now.getTime();

  if (dto.cancelAtPeriodEnd && !periodEndPassed) {
    return {
      tone: 'cancelling',
      text: `Cancels on ${formatBannerDate(dto.currentPeriodEnd)}. You keep everything until then. You can subscribe again after that.`,
    };
  }
  if (dto.status === 'pending') {
    return { tone: 'pending', text: "We couldn't take this month's payment. Razorpay will retry daily for 3 days." };
  }
  if (dto.status === 'halted') {
    return { tone: 'halted', text: "Your last payment didn't go through, so your plan is paused.", action: 'restart' };
  }
  if (!periodEndPassed && (dto.status === 'active' || dto.status === 'authenticated')) {
    return { tone: 'renewing', text: `Renews on ${formatBannerDate(dto.currentPeriodEnd)}.` };
  }
  // An immediate end (a refund, decision 15) leaves current_period_end in the future; don't print it.
  return periodEndPassed
    ? { tone: 'ended', text: `Ended on ${formatBannerDate(dto.currentPeriodEnd)}.` }
    : { tone: 'ended', text: 'This plan has ended.' };
}

const METHOD_LABELS: Record<BillingMethodCategory, string> = {
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Netbanking',
  wallet: 'Wallet',
  emi: 'EMI',
  paylater: 'Pay later',
  other: 'Other',
  unknown: '—',
};

export function methodLabel(category: BillingMethodCategory | null): string {
  if (!category) return '—';
  return METHOD_LABELS[category] ?? '—';
}

export interface PaymentDescriptionRow {
  kind: BillingPaymentKind;
  planVersionId: string | null;
  topupPackId: string | null;
  snapshotPlanName: string | null;
  snapshotPackName: string | null;
}

export interface PaymentDescriptionNames {
  planNames: Record<string, string>;
  topupNames: Record<string, string>;
}

/** The plan name, plus "renewal" when the payment is a renewal, or the pack name -- falling back to
 * a resolved catalogue name when the payment's own snapshot didn't freeze one (razorpay-sync.ts only
 * snapshots a subscription's first charge, never a renewal). */
export function paymentDescription(row: PaymentDescriptionRow, names: PaymentDescriptionNames): string {
  if (row.kind === 'topup') {
    return row.snapshotPackName ?? (row.topupPackId ? names.topupNames[row.topupPackId] : null) ?? 'Coin pack';
  }
  const planName = row.snapshotPlanName ?? (row.planVersionId ? names.planNames[row.planVersionId] : null) ?? 'Plan';
  return row.kind === 'subscription_renewal' ? `${planName} renewal` : planName;
}
