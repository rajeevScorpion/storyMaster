/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §10, Unit C2, hook 3): the pure status-transition
 * rule razorpay-sync.ts's syncSubscriptionFromProvider calls after its update/insert block, on every
 * sync (verify, webhook, reconcile) -- so this decides which billing_notification_jobs kind (if any)
 * a status change earns, with the actual enqueue call (dedupe key, payload) left to the caller, which
 * has the live `currentPeriodEnd`/`gracePeriodEndsAt`/`subscription.short_url` this function never sees.
 *
 * Pure and isomorphic on purpose: two plain strings in, one of two literal kinds (or null) out --
 * exercised directly in subscription-transition.shared.test.ts without a database or a mock queue.
 *
 * `prev` is `existing?.status ?? null`: null for a brand-new subscription (the insert branch), the
 * previously-recorded status otherwise. Both rules below are literal readings of the plan's own
 * wording -- "prev not in (pending, halted)" is true when prev is null, so a subscription created
 * already `pending`/`halted` DOES earn a `subscription_payment_failed` job on its very first sync (there
 * is no earlier live state to have transitioned FROM, but the wording doesn't carve that out). The
 * ended rule is the deliberate asymmetry: it requires `prev` non-null, so a subscription inserted
 * directly as cancelled/completed/expired never fires "your plan has ended" for a plan nobody saw start.
 */

const RETRYING_STATUSES = new Set(['pending', 'halted']);
const TERMINAL_STATUSES = new Set(['cancelled', 'completed', 'expired']);

export type SubscriptionTransitionJob = 'subscription_payment_failed' | 'subscription_ended' | null;

export function subscriptionTransitionJobs(prev: string | null, next: string): SubscriptionTransitionJob {
  const prevIsRetrying = prev !== null && RETRYING_STATUSES.has(prev);
  if (RETRYING_STATUSES.has(next) && !prevIsRetrying) {
    return 'subscription_payment_failed';
  }

  const prevIsTerminal = prev !== null && TERMINAL_STATUSES.has(prev);
  if (TERMINAL_STATUSES.has(next) && prev !== null && !prevIsTerminal) {
    return 'subscription_ended';
  }

  return null;
}
