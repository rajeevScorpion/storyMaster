/**
 * Payments Phase 4, owner decision 15 (2026-09-23, docs/payments/audit-progress.md): a full refund of
 * a subscription payment for the CURRENT cycle ends the subscription now, rather than decision 13's
 * "keep access to period end" -- that rule is for cancelling WITHOUT a refund, and once the money is
 * back there is no chargeback risk in ending access immediately.
 *
 * Pure decision logic only (no Supabase, no server-only) so both the admin refund action and the
 * refund.processed webhook path can share one answer to "should this refund end the subscription?",
 * and so it is directly unit-testable. The orchestration (loading the local row, calling Razorpay,
 * writing the update) lives in the server-only sibling, subscription-refund-end.ts.
 */

const SUBSCRIPTION_PAYMENT_KINDS = new Set(['subscription_first', 'subscription_renewal']);

/** Statuses that mean "already ended" -- ending it again would be a no-op, not a second cancel. */
const ALREADY_ENDED_STATUSES = new Set(['cancelled', 'completed']);

/**
 * "Current cycle" (decision 15): the payment's own `cycle_end` is still in the future. A refund of an
 * OLDER cycle's renewal does not end the subscription -- the reader already consumed that cycle and a
 * newer one may already be underway. A payment kind outside the two subscription kinds, or a missing/
 * unparsable cycle_end, fails closed to "not current" -- this function must never be the reason a
 * subscription ends on incomplete information.
 */
export function isCurrentCycleSubscriptionPayment(input: {
  kind: string;
  cycleEnd: string | null;
  now?: Date;
}): boolean {
  if (!SUBSCRIPTION_PAYMENT_KINDS.has(input.kind)) return false;
  if (!input.cycleEnd) return false;

  const cycleEndMs = new Date(input.cycleEnd).getTime();
  if (!Number.isFinite(cycleEndMs)) return false;

  const nowMs = (input.now ?? new Date()).getTime();
  return cycleEndMs > nowMs;
}

/**
 * Whether a refund should end the subscription right now. All of:
 *  - a subscription_first/subscription_renewal payment (never a top-up -- those have no subscription);
 *  - refunded IN FULL -- Razorpay never refunds more than it captured, so "at least the gross" is the
 *    same fact as "the whole payment", without demanding a byte-exact match;
 *  - for the CURRENT cycle (see isCurrentCycleSubscriptionPayment);
 *  - the local subscription row is not already cancelled/completed -- ending an already-ended
 *    subscription a second time is a no-op, not a re-cancel, and idempotency depends on saying so.
 *
 * `localSubscriptionStatus` is null when no local billing_subscriptions row is known at all (should
 * not normally happen for a payment that has one, but the orchestration layer treats that the same
 * way -- nothing to end).
 */
export function shouldEndSubscriptionAfterFullRefund(input: {
  kind: string;
  refundAmountMinor: number;
  paymentGrossMinor: number;
  cycleEnd: string | null;
  localSubscriptionStatus: string | null;
  now?: Date;
}): boolean {
  if (input.paymentGrossMinor <= 0) return false;
  if (input.refundAmountMinor < input.paymentGrossMinor) return false;
  if (!isCurrentCycleSubscriptionPayment({ kind: input.kind, cycleEnd: input.cycleEnd, now: input.now })) return false;
  if (input.localSubscriptionStatus !== null && ALREADY_ENDED_STATUSES.has(input.localSubscriptionStatus)) return false;

  return true;
}
