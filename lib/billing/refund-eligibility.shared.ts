/**
 * Payments Phase 4, Unit C (docs/payments/phase-4-plan.md, owner decision 12): the pure parts of the
 * refund-clawback decision -- no Supabase import, no server-only, so both the admin action and its
 * unit tests import the same arithmetic. Deliberately isomorphic per CLAUDE.md's *.shared.ts split.
 *
 * The eligibility test is exact, not an estimate: beat_grants.beats_remaining is decremented by
 * beat_usage_allocations on every spend, so `used = beats_total - beats_remaining` already reflects
 * precisely what this purchase's grant has paid for (docs/payments/phase-4-plan.md, "Computing the
 * D12 eligibility, precisely").
 */

/** Decision 12: refuse outright once more than ~20% of the purchase's own grant has been used. */
export const REFUND_CLAWBACK_MAX_USED_FRACTION = 0.2;

/**
 * Decision 12's per-account cap, closing the repeat-refund loophole (audit-progress.md, "The
 * repeat-refund loophole"). Admin-configurable via the `billing_refund_cap_per_account` feature-flag
 * value (read with getFeatureFlagValue, no UI built for it in this unit -- see the Unit C report);
 * this is the fallback when that row is absent or unparsable.
 */
export const DEFAULT_REFUND_CAP_PER_ACCOUNT = 2;

export interface RefundClawbackEligibility {
  eligible: boolean;
  usedFraction: number;
  beatsToClaw: number;
  reason: string | null;
}

/**
 * Whether a purchase's own grant may be clawed back, and by how much. A zero-coin grant
 * (beats_total === 0) is trivially eligible -- there is nothing to use and nothing to claw, so
 * dividing by zero must not read as "fully used". A grant already fully spent
 * (beats_remaining === 0, beats_total > 0) is a 100% usedFraction and is refused, matching the >20%
 * rule rather than being treated as a special case.
 */
export function evaluateRefundClawbackEligibility(grant: {
  beatsTotal: number;
  beatsRemaining: number;
}): RefundClawbackEligibility {
  const beatsTotal = Math.max(0, grant.beatsTotal);
  const beatsRemaining = Math.min(Math.max(0, grant.beatsRemaining), beatsTotal);
  const usedFraction = beatsTotal === 0 ? 0 : (beatsTotal - beatsRemaining) / beatsTotal;

  if (usedFraction > REFUND_CLAWBACK_MAX_USED_FRACTION) {
    return {
      eligible: false,
      usedFraction,
      beatsToClaw: 0,
      reason: `More than ${Math.round(REFUND_CLAWBACK_MAX_USED_FRACTION * 100)}% of this purchase's coins have already been used (${Math.round(usedFraction * 100)}%), so it is not eligible for a refund.`,
    };
  }

  return {
    eligible: true,
    usedFraction,
    beatsToClaw: beatsRemaining,
    reason: null,
  };
}

/** True once the account has already reached its lifetime refund cap and a further refund must be refused. */
export function isRefundCapReached(priorSuccessfulRefundCount: number, cap: number): boolean {
  return priorSuccessfulRefundCount >= cap;
}

/**
 * Resolves a positive cap from an admin-configured flag value, falling back to
 * DEFAULT_REFUND_CAP_PER_ACCOUNT for anything absent, non-numeric, non-integer, or non-positive --
 * a misconfigured flag must never silently disable the cap by resolving to 0 or a negative number.
 */
export function resolveRefundCapPerAccount(rawFlagValue: string | null | undefined): number {
  const parsed = Number(rawFlagValue);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return DEFAULT_REFUND_CAP_PER_ACCOUNT;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Decision R1 (docs/payments/phase-7-plan.md §1, §8 B1): the 7-day refund window is warn-and-
 * override, not a hard refusal -- past 7 days from capture, the admin dialog must show the warning
 * and require a ticked confirmation, and the server refuses without it (see refundBillingPayment).
 * A null or unparsable capturedAt counts as outside the window: with no known capture time there is
 * nothing to prove the payment is still inside one, so the confirmation is required rather than
 * assumed. Exactly `days` days out is still inside the window -- only strictly past it is outside,
 * matching the refund policy's "within 7 days" wording.
 */
export function isOutsideRefundWindow(capturedAt: string | null, now: Date, days = 7): boolean {
  if (!capturedAt) return true;
  const capturedMs = new Date(capturedAt).getTime();
  if (!Number.isFinite(capturedMs)) return true;
  return now.getTime() - capturedMs > days * MS_PER_DAY;
}

export type PurchaseGrantSourceType = 'topup' | 'subscription';

export interface PurchaseGrantSourceRef {
  sourceType: PurchaseGrantSourceType;
  sourceRefId: string;
}

/**
 * Reproduces, in reverse, exactly how lib/billing/razorpay-sync.ts sets beat_grants.source_ref_id at
 * grant time -- topup: the billing_orders.id; subscription: `${providerSubscriptionId}:${currentStartUnix}`.
 * Migration 124's uq_beat_grants_purchase_source is unique on (source_type, source_ref_id), so this
 * pair is exactly the lookup key, not an approximation. Returns null when the payment does not carry
 * enough information to reconstruct the key (a malformed or non-purchase payment row) -- callers must
 * refuse the refund rather than guess.
 */
export function resolvePurchaseGrantSourceRef(payment: {
  kind: string;
  billingOrderId: string | null;
  providerSubscriptionId: string | null;
  cycleStart: string | null;
}): PurchaseGrantSourceRef | null {
  if (payment.kind === 'topup') {
    if (!payment.billingOrderId) return null;
    return { sourceType: 'topup', sourceRefId: payment.billingOrderId };
  }

  if (payment.kind === 'subscription_first' || payment.kind === 'subscription_renewal') {
    if (!payment.providerSubscriptionId || !payment.cycleStart) return null;
    const cycleStartMs = new Date(payment.cycleStart).getTime();
    if (!Number.isFinite(cycleStartMs)) return null;
    const cycleStartUnix = Math.round(cycleStartMs / 1000);
    return { sourceType: 'subscription', sourceRefId: `${payment.providerSubscriptionId}:${cycleStartUnix}` };
  }

  return null;
}

export type RefundAttemptOutcome =
  | 'refunded'
  | 'clawback_failed'
  | 'provider_call_failed_compensated'
  | 'provider_call_failed_compensation_failed';

/**
 * The compensating-restore decision: pure state-transition logic kept separate from the I/O that
 * drives it, so the four branches (decision 12's "claw back first, then call Razorpay", and what
 * follows a failure at each step) are directly testable. clawbackSucceeded false means the flow never
 * reached Razorpay at all -- nothing to compensate. providerCallSucceeded false with
 * compensateSucceeded true is the ordinary "refund failed, coins restored, no money moved" case this
 * decision exists to guarantee; compensateSucceeded false is the one genuinely alarming outcome this
 * unit can produce and must be surfaced loudly, never swallowed.
 */
export function resolveRefundAttemptOutcome(input: {
  clawbackSucceeded: boolean;
  providerCallSucceeded: boolean;
  compensateSucceeded?: boolean;
}): RefundAttemptOutcome {
  if (!input.clawbackSucceeded) return 'clawback_failed';
  if (input.providerCallSucceeded) return 'refunded';
  return input.compensateSucceeded ? 'provider_call_failed_compensated' : 'provider_call_failed_compensation_failed';
}
