/**
 * Admin-wide payments list (`/admin/pricing/payments`). Built after the owner made a real test
 * payment and could not find it anywhere in admin except the Billing section at the bottom of one
 * user's record -- there was no way to start from "a payment ID from Razorpay" or "someone's
 * email" and find the row. Pure and isomorphic: search-term classification and the totals-by-mode
 * arithmetic are exercised directly in admin-payments-list.shared.test.ts, with no Supabase client
 * involved. app/actions/admin-payments-list.ts is the server half that actually queries.
 *
 * Row shape deliberately builds on lib/admin/user-management.shared.ts's AdminBillingPayment /
 * mapAdminBillingPayment / RawBillingPaymentRow rather than redefining them -- the per-user Billing
 * panel (app/actions/admin-users.ts) already maps billing_payments this exact way, and a second,
 * slightly different mapper here is exactly the kind of drift GOTCHAS.md warns about.
 */

import {
  mapAdminBillingPayment,
  type AdminBillingPayment,
  type RawBillingPaymentRow,
} from './user-management.shared';

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

export type PaymentSearchKind = 'empty' | 'payment_id' | 'order_id' | 'subscription_id' | 'user_id' | 'directory';

export interface PaymentSearchClassification {
  kind: PaymentSearchKind;
  /** Normalized value to actually query with -- trimmed, and lowercased only for a user id (a
   * Razorpay id and an email/name search stay exactly as typed). */
  value: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * What a free-text term in the payments search box should be matched against. Razorpay ids are
 * matched by their own fixed prefix (`pay_`, `order_`, `sub_`) with an exact match -- these are
 * opaque tokens a support person pastes in full from the Razorpay dashboard, never a partial
 * search. A bare UUID is a user id. Everything else is treated as an email or display-name search
 * against the admin user directory -- see app/actions/admin-payments-list.ts for how each kind is
 * actually queried (it reuses the same admin_list_users RPC the user directory itself calls).
 */
export function classifyPaymentSearchTerm(raw: string): PaymentSearchClassification {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty', value: '' };
  if (trimmed.startsWith('pay_')) return { kind: 'payment_id', value: trimmed };
  if (trimmed.startsWith('order_')) return { kind: 'order_id', value: trimmed };
  if (trimmed.startsWith('sub_')) return { kind: 'subscription_id', value: trimmed };
  if (UUID_RE.test(trimmed)) return { kind: 'user_id', value: trimmed.toLowerCase() };
  return { kind: 'directory', value: trimmed };
}

// ── Filters ─────────────────────────────────────────────────────────────────────────────────────

export type PaymentStatusFilter = 'all' | 'captured' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed';
export type PaymentKindFilter = 'all' | 'topup' | 'subscription';
export type ProviderModeFilter = 'all' | 'test' | 'live';

export const PAYMENT_STATUS_FILTER_OPTIONS: { value: PaymentStatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'captured', label: 'Captured' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partially refunded' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'failed', label: 'Failed' },
];

export const PAYMENT_KIND_FILTER_OPTIONS: { value: PaymentKindFilter; label: string }[] = [
  { value: 'all', label: 'All kinds' },
  { value: 'topup', label: 'Top-up' },
  { value: 'subscription', label: 'Subscription' },
];

export const PROVIDER_MODE_FILTER_OPTIONS: { value: ProviderModeFilter; label: string }[] = [
  { value: 'all', label: 'Test + live' },
  { value: 'test', label: 'Test' },
  { value: 'live', label: 'Live' },
];

const VALID_STATUS_FILTERS = new Set<PaymentStatusFilter>(PAYMENT_STATUS_FILTER_OPTIONS.map((o) => o.value));
const VALID_KIND_FILTERS = new Set<PaymentKindFilter>(PAYMENT_KIND_FILTER_OPTIONS.map((o) => o.value));
const VALID_MODE_FILTERS = new Set<ProviderModeFilter>(PROVIDER_MODE_FILTER_OPTIONS.map((o) => o.value));

/** billing_payments.kind is finer-grained than the filter ('subscription_first' vs.
 * 'subscription_renewal') -- both read as "subscription" to a support person, so the UI offers one
 * bucket and this expands it back to the real column values a query needs. */
export function paymentKindDbValues(filter: PaymentKindFilter): string[] | null {
  if (filter === 'topup') return ['topup'];
  if (filter === 'subscription') return ['subscription_first', 'subscription_renewal'];
  return null;
}

export const ADMIN_PAYMENTS_PAGE_SIZE = 50;

/** Totals are computed over up to this many matching rows (newest first), not the whole table --
 * the same bounded-dashboard pattern lib/billing/billing-incidents.shared.ts's DASHBOARD_ROW_LIMIT
 * uses. At today's volume (payments just launched) this will not truncate for a very long time;
 * when it does, AdminPaymentsListData.totalsCapped says so rather than showing a silently wrong
 * total. The paged row list itself is never affected -- its count comes from a separate
 * `count: 'exact'` query with no limit. */
export const ADMIN_PAYMENTS_TOTALS_ROW_LIMIT = 5000;

export interface AdminPaymentsListInput {
  page?: number;
  search?: string;
  status?: PaymentStatusFilter;
  kind?: PaymentKindFilter;
  providerMode?: ProviderModeFilter;
}

export interface NormalizedAdminPaymentsListInput {
  page: number;
  search: string;
  status: PaymentStatusFilter;
  kind: PaymentKindFilter;
  providerMode: ProviderModeFilter;
}

export function normalizeAdminPaymentsListInput(input: AdminPaymentsListInput): NormalizedAdminPaymentsListInput {
  const rawPage = input.page;
  const page = typeof rawPage === 'number' && Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const status = input.status && VALID_STATUS_FILTERS.has(input.status) ? input.status : 'all';
  const kind = input.kind && VALID_KIND_FILTERS.has(input.kind) ? input.kind : 'all';
  const providerMode = input.providerMode && VALID_MODE_FILTERS.has(input.providerMode) ? input.providerMode : 'all';
  return { page, search: (input.search ?? '').trim(), status, kind, providerMode };
}

// ── Totals ──────────────────────────────────────────────────────────────────────────────────────

/** billing_payments.status values that mean money was actually captured at some point -- every
 * status except 'failed'. A later refund is tracked separately via the refunds sum below, never by
 * dropping the payment out of "gross captured": the capture happened even if it was later
 * reversed, and a support person reconciling against Razorpay needs both numbers, not their net. */
const CAPTURED_LIKE_STATUSES = new Set(['captured', 'refunded', 'partially_refunded', 'disputed']);

export interface PaymentTotalsPaymentRow {
  providerMode: string | null;
  status: string;
  grossMinor: number;
  currencyCode: string;
}

export interface PaymentTotalsRefundRow {
  providerMode: string | null;
  status: string;
  amountMinor: number;
}

export interface AdminPaymentsModeTotals {
  mode: string;
  currencyCode: string;
  count: number;
  grossCapturedMinor: number;
  refundedMinor: number;
}

/**
 * Test and live money must never be summed together (GOTCHAS.md: "Every billing lookup that
 * reaches across a user's rows must be scoped by provider_mode" -- test and live Razorpay data
 * share the same tables). This groups by provider_mode instead of returning one number, so a
 * caller showing every mode at once is structurally unable to add them together. Sorted with
 * 'live' first, since that is the number that is actually real money.
 */
export function computePaymentModeTotals(
  payments: PaymentTotalsPaymentRow[],
  refunds: PaymentTotalsRefundRow[]
): AdminPaymentsModeTotals[] {
  const totals = new Map<string, AdminPaymentsModeTotals>();
  const ensure = (mode: string, currencyCode: string): AdminPaymentsModeTotals => {
    let entry = totals.get(mode);
    if (!entry) {
      entry = { mode, currencyCode, count: 0, grossCapturedMinor: 0, refundedMinor: 0 };
      totals.set(mode, entry);
    }
    return entry;
  };

  for (const payment of payments) {
    const mode = payment.providerMode ?? 'unknown';
    const entry = ensure(mode, payment.currencyCode);
    entry.count += 1;
    if (CAPTURED_LIKE_STATUSES.has(payment.status)) {
      entry.grossCapturedMinor += payment.grossMinor;
    }
  }
  for (const refund of refunds) {
    if (refund.status !== 'processed') continue;
    const mode = refund.providerMode ?? 'unknown';
    const entry = ensure(mode, totals.get(mode)?.currencyCode ?? 'INR');
    entry.refundedMinor += refund.amountMinor;
  }

  return Array.from(totals.values()).sort((a, b) => {
    if (a.mode === b.mode) return 0;
    if (a.mode === 'live') return -1;
    if (b.mode === 'live') return 1;
    return a.mode.localeCompare(b.mode);
  });
}

// ── Row mapping ─────────────────────────────────────────────────────────────────────────────────

export interface RawAdminPaymentListRow extends RawBillingPaymentRow {
  user_id: string | null;
  subject_ref: string;
}

export interface AdminPaymentListRow extends AdminBillingPayment {
  userId: string | null;
  subjectRef: string;
  userEmail: string | null;
  userDisplayName: string | null;
  refundedMinor: number;
  hasPendingRefund: boolean;
}

export interface AdminPaymentDirectoryLookup {
  email: string | null;
  displayName: string | null;
}

export function mapAdminPaymentListRow(
  row: RawAdminPaymentListRow,
  refundSummary: { refundedMinor: number; hasPendingRefund: boolean },
  directory: AdminPaymentDirectoryLookup | null
): AdminPaymentListRow {
  return {
    ...mapAdminBillingPayment(row),
    userId: row.user_id,
    subjectRef: row.subject_ref,
    userEmail: directory?.email ?? null,
    userDisplayName: directory?.displayName ?? null,
    refundedMinor: refundSummary.refundedMinor,
    hasPendingRefund: refundSummary.hasPendingRefund,
  };
}

export interface AdminPaymentsListData {
  status: 'ok' | 'unavailable';
  rows: AdminPaymentListRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  totals: AdminPaymentsModeTotals[];
  /** True when the totals scope hit ADMIN_PAYMENTS_TOTALS_ROW_LIMIT -- see that constant. */
  totalsCapped: boolean;
}
