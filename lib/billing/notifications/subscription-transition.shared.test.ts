import { describe, it, expect } from 'vitest';
import { subscriptionTransitionJobs } from './subscription-transition.shared';

describe('subscriptionTransitionJobs', () => {
  it('fires subscription_payment_failed on a transition into pending', () => {
    expect(subscriptionTransitionJobs('active', 'pending')).toBe('subscription_payment_failed');
  });

  it('fires subscription_payment_failed on a transition into halted', () => {
    expect(subscriptionTransitionJobs('active', 'halted')).toBe('subscription_payment_failed');
  });

  it('fires nothing when already pending/halted (no new transition)', () => {
    expect(subscriptionTransitionJobs('pending', 'pending')).toBeNull();
    expect(subscriptionTransitionJobs('halted', 'halted')).toBeNull();
    expect(subscriptionTransitionJobs('pending', 'halted')).toBeNull();
  });

  it('fires subscription_payment_failed on a brand-new subscription already pending (prev null)', () => {
    // Literal reading of the plan's rule: "prev not in (pending, halted)" is true for null too --
    // there is no earlier live state, but the wording does not carve that case out.
    expect(subscriptionTransitionJobs(null, 'pending')).toBe('subscription_payment_failed');
  });

  it('fires subscription_ended on a transition into a terminal status from a live one', () => {
    expect(subscriptionTransitionJobs('active', 'cancelled')).toBe('subscription_ended');
    expect(subscriptionTransitionJobs('active', 'completed')).toBe('subscription_ended');
    expect(subscriptionTransitionJobs('authenticated', 'expired')).toBe('subscription_ended');
  });

  it('fires subscription_ended on a transition between the retrying states and a terminal one', () => {
    expect(subscriptionTransitionJobs('halted', 'cancelled')).toBe('subscription_ended');
  });

  it('never fires subscription_ended when prev is already terminal (no new transition)', () => {
    expect(subscriptionTransitionJobs('cancelled', 'cancelled')).toBeNull();
    expect(subscriptionTransitionJobs('expired', 'completed')).toBeNull();
  });

  it('never fires subscription_ended for a brand-new subscription inserted directly as terminal', () => {
    // The deliberate asymmetry: unlike the failed rule, this requires prev non-null -- nobody should
    // get "your plan has ended" for a plan that was never seen live.
    expect(subscriptionTransitionJobs(null, 'cancelled')).toBeNull();
  });

  it('fires nothing for an ordinary live-to-live transition', () => {
    expect(subscriptionTransitionJobs('authenticated', 'active')).toBeNull();
    expect(subscriptionTransitionJobs('active', 'active')).toBeNull();
  });
});
