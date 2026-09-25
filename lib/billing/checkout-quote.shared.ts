import type { TaxBreakdown } from '@/lib/billing/tax.shared';
import type { BillingInterval } from '@/lib/types/pricing';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import { addBillingMonths, billingDayOfMonth, formatBillingDateLong } from '@/lib/billing/billing-dates.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): what `quoteCheckout`
 * (app/actions/billing-account.ts) returns to price a checkout before any Razorpay order or
 * subscription exists -- the same net/tax/gross arithmetic prepare uses, read-only. Pure and
 * isomorphic so the checkout summary sheet's copy (renewal date, tax lines) is unit-tested directly,
 * without mocking the DB or Razorpay.
 */

export interface CheckoutQuoteTaxLine {
  label: 'IGST' | 'CGST' | 'SGST';
  amountMinor: number;
}

export interface CheckoutQuote {
  kind: 'subscription' | 'topup';
  title: string;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  ratePercent: number | null;
  taxLines: CheckoutQuoteTaxLine[];
  coins: number;
  interval: BillingInterval | null;
  /** ISO date string, today plus one interval. Subscriptions only -- null for a top-up. */
  nextChargeDate: string | null;
}

/** `inter_state` gives IGST; `intra_state` gives CGST + SGST; `none`, `export` (Payments Phase 8,
 * docs/payments/phase-8-plan.md §9, Unit D: a zero-rated LUT export has no tax line to show, unlike
 * the invoice's own explicit "IGST @ 0%" row) or no breakdown gives no tax lines at all (a database
 * without migration 125, or a published zero-rate/'none' rule). */
export function taxLinesFromBreakdown(breakdown: TaxBreakdown | null): CheckoutQuoteTaxLine[] {
  if (!breakdown) return [];
  if (breakdown.supplyType === 'inter_state') {
    return [{ label: 'IGST', amountMinor: breakdown.igstMinor }];
  }
  if (breakdown.supplyType === 'intra_state') {
    return [
      { label: 'CGST', amountMinor: breakdown.cgstMinor },
      { label: 'SGST', amountMinor: breakdown.sgstMinor },
    ];
  }
  return [];
}

/** One month or one year later on the IST calendar, clamped to the target month's last day -- see
 * billing-dates.shared.ts for why billing dates are IST. */
export function addBillingInterval(date: Date, interval: BillingInterval): Date {
  return addBillingMonths(date, interval === 'annual' ? 12 : 1);
}

/** Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): formatRenewalLine's own amount --
 * always two decimals for a non-INR currency ("$29.00"), matching the wallet-tax.shared.ts naming
 * convention but not its conditional-decimals behaviour, which would otherwise drop a whole dollar's
 * cents ("$29") on this legal-adjacent disclosure line. INR keeps formatCurrencyMinor's existing
 * (decimals-only-when-present) behaviour, unchanged. */
function formatRenewalAmount(currencyCode: string, grossMinor: number): string {
  if (currencyCode === 'INR') return formatCurrencyMinor(currencyCode, grossMinor);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(grossMinor / 100);
}

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** "Renews monthly on the 24th at ₹531." for a monthly plan; annual shows the full date, since "the
 * 24th" alone would drop the year a customer actually cares about for a once-a-year charge. Payments
 * Phase 7 (docs/payments/phase-7-plan.md §8, B1): the amount that renews is part of the disclosure --
 * the line never states a date without the price attached to it. Returns '' when there is no interval
 * or date to show (a top-up), so a caller can render `{line && <p>{line}</p>}`. */
export function formatRenewalLine(
  interval: BillingInterval | null,
  nextChargeDate: string | null,
  grossMinor: number,
  currencyCode: string
): string {
  if (!interval || !nextChargeDate) return '';
  const date = new Date(nextChargeDate);
  if (Number.isNaN(date.getTime())) return '';
  const amount = formatRenewalAmount(currencyCode, grossMinor);

  if (interval === 'annual') {
    return `Renews yearly on ${formatBillingDateLong(date)} at ${amount}.`;
  }

  return `Renews monthly on the ${ordinal(billingDayOfMonth(date)!)} at ${amount}.`;
}
