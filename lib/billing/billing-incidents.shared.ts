import type { BillingOrderType } from '@/lib/types/pricing';

/**
 * Payments Phase 4, Unit F (docs/payments/phase-4-plan.md §9 "Unit F"): the incident predicates
 * that lib/billing/razorpay-reconcile.ts's daily cron already enforces, pulled out of that file's
 * private functions so the admin incident dashboard (app/actions/billing-incidents.ts) reads
 * against the exact same definition instead of a second, driftable one. A dashboard that counts
 * "failed webhooks" differently from the job that fixes them is worse than no dashboard.
 *
 * Pure and isomorphic -- no `server-only`, no Supabase import -- per the repo's `*.shared.ts`
 * convention. razorpay-reconcile.ts imports the constants and `.or()` filter-string builders below
 * instead of redefining them; its queries, thresholds and ordering are otherwise unchanged.
 */

// ── Thresholds (unchanged values, moved out of razorpay-reconcile.ts) ──────────────────────────
export const MIN_AGE_MS = 10 * 60 * 1000;
export const CHECKOUT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TOPUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_SUBSCRIPTION_WEBHOOK_MS = 2 * 24 * 60 * 60 * 1000;
export const STALE_WEBHOOK_EVENT_MS = 15 * 60 * 1000;
/** Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, "Phase 6 health"): a billing
 * notification job (migration 135) sitting in `pending` this long is stuck -- the worker kicks
 * itself after every enqueue and the daily cron is a backstop, so an hour with neither having
 * claimed it points at a worker that isn't running. */
export const PENDING_BILLING_JOB_STALE_MS = 60 * 60 * 1000;
/** A refund Razorpay hasn't confirmed within a day is worth a human look; the provider's own refund
 * webhook or the daily reconcile should have settled it well before then. */
export const PENDING_REFUND_STALE_MS = 24 * 60 * 60 * 1000;
/** Was an inline `10` in razorpay-reconcile.ts's webhook `.or()` filter; named here so the
 * dashboard cites the same number instead of a second hardcoded `10`. */
export const WEBHOOK_MAX_FAILED_ATTEMPTS = 10;

// ── Status / kind sets ──────────────────────────────────────────────────────────────────────────
export const SUBSCRIPTION_CHECKOUT_ORDER_TYPE: BillingOrderType = 'subscription_checkout';
export const TOPUP_CHECKOUT_ORDER_TYPE: BillingOrderType = 'topup_checkout';

export const STUCK_SUBSCRIPTION_CHECKOUT_STATUSES: string[] = ['created', 'abandoned', 'superseded'];
export const STUCK_TOPUP_STATUSES: string[] = ['created', 'attempted', 'failed'];
/** The subscription statuses reconcile ever revisits; a subscription outside these (cancelled,
 * expired, ...) is done and is never an incident no matter how stale its columns look. */
export const RECONCILABLE_SUBSCRIPTION_STATUSES: string[] = ['authenticated', 'active', 'pending', 'halted'];

export type BillingIncidentKind =
  | 'failed_webhook'
  | 'stuck_subscription_checkout'
  | 'subscription_past_boundary'
  | 'stuck_topup';

export const BILLING_INCIDENT_LABELS: Record<BillingIncidentKind, string> = {
  failed_webhook: 'Failed webhooks',
  stuck_subscription_checkout: 'Stuck subscription checkouts',
  subscription_past_boundary: 'Subscriptions past their boundary',
  stuck_topup: 'Stuck top-ups',
};

// ── PostgREST `.or()` filter builders ──────────────────────────────────────────────────────────
// The exact strings razorpay-reconcile.ts's `.or()` calls need, generated once here so a second
// caller (the dashboard) builds the identical filter instead of hand-retyping it.

/** Mirrors razorpay-reconcile.ts's reconcileWebhooks `.or()` clause. */
export function webhookIncidentOrFilter(nowMs: number): string {
  const staleReceivedIso = new Date(nowMs - STALE_WEBHOOK_EVENT_MS).toISOString();
  return `and(status.eq.failed,attempt_count.lt.${WEBHOOK_MAX_FAILED_ATTEMPTS}),and(status.eq.received,received_at.lt.${staleReceivedIso})`;
}

/** Mirrors reconcileSubscriptions' `.or()` clause. The row must also be in
 * RECONCILABLE_SUBSCRIPTION_STATUSES -- that is a separate `.in()`, not part of this string. */
export function subscriptionBoundaryOrFilter(nowMs: number): string {
  const nowIso = new Date(nowMs).toISOString();
  const staleWebhookIso = new Date(nowMs - STALE_SUBSCRIPTION_WEBHOOK_MS).toISOString();
  return `first_charge_confirmed_at.is.null,current_period_end.lt.${nowIso},last_webhook_at.lt.${staleWebhookIso}`;
}

// ── Pure boolean predicates ─────────────────────────────────────────────────────────────────────
// Same logic as the filter strings above, expressed as ordinary functions over a row shape, so it
// can be pinned with a unit test that needs no database.

export interface FailedWebhookIncidentRowShape {
  status: string;
  attempt_count: number;
  received_at: string;
}

export function isFailedWebhookIncident(row: FailedWebhookIncidentRowShape, nowMs: number): boolean {
  if (row.status === 'failed' && row.attempt_count < WEBHOOK_MAX_FAILED_ATTEMPTS) {
    return true;
  }
  if (row.status === 'received') {
    return new Date(row.received_at).getTime() < nowMs - STALE_WEBHOOK_EVENT_MS;
  }
  return false;
}

export interface StuckSubscriptionCheckoutRowShape {
  order_type: string;
  status: string;
  provider_checkout_session_id?: string | null;
  created_at: string;
}

export function isStuckSubscriptionCheckoutIncident(row: StuckSubscriptionCheckoutRowShape, nowMs: number): boolean {
  if (row.order_type !== SUBSCRIPTION_CHECKOUT_ORDER_TYPE) return false;
  if (!STUCK_SUBSCRIPTION_CHECKOUT_STATUSES.includes(row.status)) return false;
  if (!row.provider_checkout_session_id) return false;

  const createdAtMs = new Date(row.created_at).getTime();
  return createdAtMs <= nowMs - MIN_AGE_MS && createdAtMs >= nowMs - CHECKOUT_MAX_AGE_MS;
}

export interface StuckTopupRowShape {
  order_type: string;
  status: string;
  created_at: string;
}

export function isStuckTopupIncident(row: StuckTopupRowShape, nowMs: number): boolean {
  if (row.order_type !== TOPUP_CHECKOUT_ORDER_TYPE) return false;
  if (!STUCK_TOPUP_STATUSES.includes(row.status)) return false;

  const createdAtMs = new Date(row.created_at).getTime();
  return createdAtMs >= nowMs - TOPUP_MAX_AGE_MS && createdAtMs <= nowMs - MIN_AGE_MS;
}

export interface SubscriptionBoundaryRowShape {
  status: string;
  first_charge_confirmed_at: string | null;
  current_period_end: string | null;
  last_webhook_at: string | null;
}

/** One of three boundary conditions composing isSubscriptionPastBoundaryIncident; exported
 * individually so the dashboard can show *which* condition tripped, not just that one did. */
export function hasUnconfirmedFirstCharge(row: Pick<SubscriptionBoundaryRowShape, 'first_charge_confirmed_at'>): boolean {
  return row.first_charge_confirmed_at == null;
}

export function isPastCurrentPeriodEnd(row: Pick<SubscriptionBoundaryRowShape, 'current_period_end'>, nowMs: number): boolean {
  return row.current_period_end != null && new Date(row.current_period_end).getTime() < nowMs;
}

export function hasStaleWebhook(row: Pick<SubscriptionBoundaryRowShape, 'last_webhook_at'>, nowMs: number): boolean {
  return row.last_webhook_at != null && new Date(row.last_webhook_at).getTime() < nowMs - STALE_SUBSCRIPTION_WEBHOOK_MS;
}

export function isSubscriptionPastBoundaryIncident(row: SubscriptionBoundaryRowShape, nowMs: number): boolean {
  if (!RECONCILABLE_SUBSCRIPTION_STATUSES.includes(row.status)) return false;
  return hasUnconfirmedFirstCharge(row) || isPastCurrentPeriodEnd(row, nowMs) || hasStaleWebhook(row, nowMs);
}

// ── Phase 6 health (Payments Phase 7, docs/payments/phase-7-plan.md §8, Unit B2) ───────────────────
// Four more count cards on the same dashboard, reading the notification queue and document-issuing
// tables migration 135 added: a failed job, a pending job stuck past the worker's own retry window,
// a refund Razorpay hasn't confirmed in a day, and a captured payment with no issued invoice. Same
// pure-predicate style as the Phase 4 section above -- billing-incidents.ts builds the equivalent
// `.eq()`/`.lt()` query for each and these pin the logic without a database.

export interface BillingJobRowShape {
  status: string;
  created_at: string;
}

export function isFailedBillingJobIncident(row: Pick<BillingJobRowShape, 'status'>): boolean {
  return row.status === 'failed';
}

export function isStalePendingBillingJobIncident(row: BillingJobRowShape, nowMs: number): boolean {
  if (row.status !== 'pending') return false;
  return new Date(row.created_at).getTime() < nowMs - PENDING_BILLING_JOB_STALE_MS;
}

export interface BillingRefundRowShape {
  status: string;
  created_at: string;
}

export function isStalePendingRefundIncident(row: BillingRefundRowShape, nowMs: number): boolean {
  if (row.status !== 'pending') return false;
  return new Date(row.created_at).getTime() < nowMs - PENDING_REFUND_STALE_MS;
}

// ── Export sale on a domestic card (Payments Phase 8, docs/payments/phase-8-plan.md §8, Unit AC) ──
// A payment sold at the zero-rated ROW price should be paid with an international (foreign-issued)
// card -- lib/billing/razorpay-sync.ts records the payment entity's own `international` flag
// into billing_payments.purchase_snapshot_json as cardInternational at capture time
// (step 6). A `false` here may mean an India-resident customer claimed a US billing address to reach
// the zero-rated price.

export interface ExportSaleOnDomesticCardRowShape {
  tax_breakdown_json: Record<string, unknown> | null;
  purchase_snapshot_json: Record<string, unknown> | null;
}

/** Missing evidence (cardInternational absent -- e.g. a payment captured before this unit, or a card
 * fetch that failed) is never flagged, only a captured `false` -- the same "don't manufacture a
 * defect from a gap" rule as isFailedWebhookIncident and friends above. */
export function isExportSaleOnDomesticCardIncident(row: ExportSaleOnDomesticCardRowShape): boolean {
  const supplyType = (row.tax_breakdown_json as { supplyType?: string } | null)?.supplyType;
  if (supplyType !== 'export') return false;

  const cardInternational = (row.purchase_snapshot_json as { cardInternational?: boolean | null } | null)
    ?.cardInternational;
  return cardInternational === false;
}

/** The set-difference at the heart of the "no issued invoice" card: which of a batch of captured
 * payment ids has no matching row in `issuedPaymentIds` (payment ids with an `issued` `tax_invoice`
 * document). Pure so the join -- done as two separate PostgREST queries, since PostgREST has no
 * `NOT EXISTS` -- is tested without either query actually running. */
export function paymentIdsMissingInvoice(paymentIds: readonly string[], issuedPaymentIds: Iterable<string>): string[] {
  const issued = new Set(issuedPaymentIds);
  return paymentIds.filter((id) => !issued.has(id));
}

// ── Display helpers ─────────────────────────────────────────────────────────────────────────────

/** "42m", "3h 5m", "9d 2h" -- short relative age for an incident row, given the same `nowMs` the
 * dashboard used to decide it was an incident (never `Date.now()` re-read per row). */
export function formatIncidentAge(nowMs: number, iso: string): string {
  const thenMs = new Date(iso).getTime();
  if (!Number.isFinite(thenMs)) return 'unknown';

  const diffMs = Math.max(0, nowMs - thenMs);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
