/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): what `getMyCheckoutStatus`
 * (app/actions/billing-account.ts) reports back to the client's dismiss/confirm poll, derived purely
 * from the billing_orders row the webhook and verify already converge -- no provider call here.
 *
 * Defect 10: a top-up order goes `failed` on Razorpay's `payment.failed` webhook and back to `paid` on
 * an in-window retry (`lib/billing/razorpay-webhook.ts`'s `processTopupFailureEvent`,
 * `lib/billing/razorpay-sync.ts`'s `settleTopupOrder`) -- so a top-up's `failed` status here is
 * reported as `'failed'` but the caller (useRazorpayCheckout's dismiss poll) must keep polling rather
 * than stop on it, since the same order can still turn `paid`.
 */

export type CheckoutOrderState = 'open' | 'confirming' | 'paid' | 'failed' | 'abandoned';

export interface CheckoutOrderStatusInput {
  orderType: 'subscription_checkout' | 'topup_checkout';
  status: string;
  /** billing_subscriptions.first_charge_confirmed_at for the order's subscription -- null for a
   * top-up, or a subscription whose first charge hasn't landed yet. */
  firstChargeConfirmedAt: string | null;
}

const TOPUP_PAID_STATUSES = new Set(['paid', 'refunded', 'partially_refunded', 'disputed']);
const TOPUP_ABANDONED_STATUSES = new Set(['abandoned', 'superseded']);

const SUBSCRIPTION_CONFIRMING_STATUSES = new Set(['authenticated', 'active', 'pending']);
const SUBSCRIPTION_FAILED_STATUSES = new Set(['failed', 'halted', 'cancelled']);
const SUBSCRIPTION_ABANDONED_STATUSES = new Set(['abandoned', 'superseded', 'expired']);

export function checkoutStateFromOrder(input: CheckoutOrderStatusInput): CheckoutOrderState {
  if (input.orderType === 'topup_checkout') {
    if (TOPUP_PAID_STATUSES.has(input.status)) return 'paid';
    if (input.status === 'failed') return 'failed';
    if (TOPUP_ABANDONED_STATUSES.has(input.status)) return 'abandoned';
    return 'open';
  }

  // subscription_checkout: "paid" means the subscription's own first charge is confirmed, not the
  // checkout order's own status -- a subscription order's status tracks the provider subscription
  // (created -> authenticated -> active), not a single payment.
  if (input.firstChargeConfirmedAt) return 'paid';
  if (SUBSCRIPTION_CONFIRMING_STATUSES.has(input.status)) return 'confirming';
  if (SUBSCRIPTION_FAILED_STATUSES.has(input.status)) return 'failed';
  if (SUBSCRIPTION_ABANDONED_STATUSES.has(input.status)) return 'abandoned';
  return 'open'; // preparing, created, or anything unrecognised
}

/** The dismiss poll stops early only on these. A top-up's `failed` is not one (defect 10). */
export function endsDismissPoll(state: CheckoutOrderState): boolean {
  return state === 'paid' || state === 'confirming';
}

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the rule `pollUntilPaid`
 * (useRazorpayCheckout.ts) polls against once verify or the dismiss poll has already said
 * "confirming" -- every state except `paid` keeps polling, including a top-up's non-final `failed`
 * (defect 10) and a subscription retrying under `authenticated`/`pending`. `pollUntilPaid` never
 * returns `'failed'`; on a timeout it reports `'still_confirming'` instead, so this predicate is the
 * whole rule that makes that true.
 */
export function isCheckoutPaid(state: CheckoutOrderState): boolean {
  return state === 'paid';
}

/**
 * What the dismiss poll reports when it times out without reaching `paid` or `confirming`.
 * `lastState` is null when every poll failed to read.
 */
export function dismissOutcomeAtTimeout(input: {
  lastState: CheckoutOrderState | null;
  failureRecorded: boolean;
}): 'failed' | 'dismissed' | 'confirming' {
  if (input.failureRecorded) return 'failed';
  if (input.lastState === null || input.lastState === 'open' || input.lastState === 'abandoned') return 'dismissed';
  return 'confirming';
}
