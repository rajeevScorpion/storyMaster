import { describe, expect, it } from 'vitest';
import {
  isCurrentCycleSubscriptionPayment,
  shouldEndSubscriptionAfterFullRefund,
} from './subscription-refund-end.shared';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const FUTURE_CYCLE_END = '2026-10-01T00:00:00.000Z';
const PAST_CYCLE_END = '2026-08-01T00:00:00.000Z';

describe('isCurrentCycleSubscriptionPayment', () => {
  it('is current when cycle_end is still in the future', () => {
    expect(
      isCurrentCycleSubscriptionPayment({ kind: 'subscription_renewal', cycleEnd: FUTURE_CYCLE_END, now: NOW })
    ).toBe(true);
  });

  it('is not current once cycle_end has passed -- refunding an older cycle does not end it', () => {
    expect(
      isCurrentCycleSubscriptionPayment({ kind: 'subscription_renewal', cycleEnd: PAST_CYCLE_END, now: NOW })
    ).toBe(false);
  });

  it('treats a subscription_first payment the same as a renewal', () => {
    expect(
      isCurrentCycleSubscriptionPayment({ kind: 'subscription_first', cycleEnd: FUTURE_CYCLE_END, now: NOW })
    ).toBe(true);
  });

  it('is never current for a top-up -- there is no subscription to end', () => {
    expect(isCurrentCycleSubscriptionPayment({ kind: 'topup', cycleEnd: FUTURE_CYCLE_END, now: NOW })).toBe(false);
  });

  it('fails closed when cycle_end is missing or unparsable', () => {
    expect(isCurrentCycleSubscriptionPayment({ kind: 'subscription_renewal', cycleEnd: null, now: NOW })).toBe(false);
    expect(
      isCurrentCycleSubscriptionPayment({ kind: 'subscription_renewal', cycleEnd: 'not-a-date', now: NOW })
    ).toBe(false);
  });
});

function fullRefundInput(overrides: Partial<Parameters<typeof shouldEndSubscriptionAfterFullRefund>[0]> = {}) {
  return {
    kind: 'subscription_renewal',
    refundAmountMinor: 1180,
    paymentGrossMinor: 1180,
    cycleEnd: FUTURE_CYCLE_END,
    localSubscriptionStatus: 'active',
    now: NOW,
    ...overrides,
  };
}

describe('shouldEndSubscriptionAfterFullRefund', () => {
  it('ends it: a full refund of a current-cycle subscription payment on a live subscription', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput())).toBe(true);
  });

  it('a partial refund does not end it', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ refundAmountMinor: 590 }))).toBe(false);
  });

  it('treats a refund larger than the gross as still full -- Razorpay never over-refunds', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ refundAmountMinor: 1181 }))).toBe(true);
  });

  it('a refund of a PAST cycle does not end it', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ cycleEnd: PAST_CYCLE_END }))).toBe(false);
  });

  it('a top-up refund never ends anything', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ kind: 'topup' }))).toBe(false);
  });

  it('is a no-op when the local row is already cancelled -- idempotent on replay', () => {
    expect(
      shouldEndSubscriptionAfterFullRefund(fullRefundInput({ localSubscriptionStatus: 'cancelled' }))
    ).toBe(false);
  });

  it('is a no-op when the local row is already completed', () => {
    expect(
      shouldEndSubscriptionAfterFullRefund(fullRefundInput({ localSubscriptionStatus: 'completed' }))
    ).toBe(false);
  });

  it('still ends it when the local row is halted or pending -- those are live, not ended', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ localSubscriptionStatus: 'halted' }))).toBe(true);
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ localSubscriptionStatus: 'pending' }))).toBe(true);
  });

  it('a zero-gross payment never ends anything -- nothing to prove "full" against', () => {
    expect(shouldEndSubscriptionAfterFullRefund(fullRefundInput({ paymentGrossMinor: 0, refundAmountMinor: 0 }))).toBe(
      false
    );
  });
});
