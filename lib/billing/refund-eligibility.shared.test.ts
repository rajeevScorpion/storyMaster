import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFUND_CAP_PER_ACCOUNT,
  REFUND_CLAWBACK_MAX_USED_FRACTION,
  evaluateRefundClawbackEligibility,
  isRefundCapReached,
  resolvePurchaseGrantSourceRef,
  resolveRefundAttemptOutcome,
  resolveRefundCapPerAccount,
} from './refund-eligibility.shared';

describe('evaluateRefundClawbackEligibility', () => {
  it('is eligible and claws back everything when nothing has been used', () => {
    const result = evaluateRefundClawbackEligibility({ beatsTotal: 100, beatsRemaining: 100 });
    expect(result).toEqual({ eligible: true, usedFraction: 0, beatsToClaw: 100, reason: null });
  });

  it('is eligible exactly at the 20% boundary', () => {
    const result = evaluateRefundClawbackEligibility({ beatsTotal: 100, beatsRemaining: 80 });
    expect(result.eligible).toBe(true);
    expect(result.usedFraction).toBeCloseTo(REFUND_CLAWBACK_MAX_USED_FRACTION);
    expect(result.beatsToClaw).toBe(80);
  });

  it('refuses just past the 20% boundary', () => {
    const result = evaluateRefundClawbackEligibility({ beatsTotal: 100, beatsRemaining: 79 });
    expect(result.eligible).toBe(false);
    expect(result.beatsToClaw).toBe(0);
    expect(result.reason).toMatch(/20%/);
  });

  it('treats a zero-coin grant as eligible rather than dividing by zero', () => {
    const result = evaluateRefundClawbackEligibility({ beatsTotal: 0, beatsRemaining: 0 });
    expect(result).toEqual({ eligible: true, usedFraction: 0, beatsToClaw: 0, reason: null });
  });

  it('refuses a grant that has already been fully spent', () => {
    const result = evaluateRefundClawbackEligibility({ beatsTotal: 50, beatsRemaining: 0 });
    expect(result.eligible).toBe(false);
    expect(result.usedFraction).toBe(1);
  });

  it('clamps an inconsistent remaining value rather than trusting it blindly', () => {
    const result = evaluateRefundClawbackEligibility({ beatsTotal: 10, beatsRemaining: 999 });
    expect(result.beatsToClaw).toBe(10);
    expect(result.usedFraction).toBe(0);
  });
});

describe('isRefundCapReached', () => {
  it('is not reached below the cap', () => {
    expect(isRefundCapReached(1, 2)).toBe(false);
  });

  it('is reached exactly at the cap', () => {
    expect(isRefundCapReached(2, 2)).toBe(true);
  });

  it('is reached beyond the cap', () => {
    expect(isRefundCapReached(3, 2)).toBe(true);
  });
});

describe('resolveRefundCapPerAccount', () => {
  it('falls back to the default when the flag is absent', () => {
    expect(resolveRefundCapPerAccount(null)).toBe(DEFAULT_REFUND_CAP_PER_ACCOUNT);
    expect(resolveRefundCapPerAccount(undefined)).toBe(DEFAULT_REFUND_CAP_PER_ACCOUNT);
  });

  it('falls back to the default for a non-numeric, zero, negative, or fractional value', () => {
    expect(resolveRefundCapPerAccount('not-a-number')).toBe(DEFAULT_REFUND_CAP_PER_ACCOUNT);
    expect(resolveRefundCapPerAccount('0')).toBe(DEFAULT_REFUND_CAP_PER_ACCOUNT);
    expect(resolveRefundCapPerAccount('-1')).toBe(DEFAULT_REFUND_CAP_PER_ACCOUNT);
    expect(resolveRefundCapPerAccount('1.5')).toBe(DEFAULT_REFUND_CAP_PER_ACCOUNT);
  });

  it('uses an admin-configured positive integer', () => {
    expect(resolveRefundCapPerAccount('5')).toBe(5);
  });
});

describe('resolvePurchaseGrantSourceRef', () => {
  it('resolves a topup purchase to its billing order id', () => {
    const ref = resolvePurchaseGrantSourceRef({
      kind: 'topup',
      billingOrderId: 'order-123',
      providerSubscriptionId: null,
      cycleStart: null,
    });
    expect(ref).toEqual({ sourceType: 'topup', sourceRefId: 'order-123' });
  });

  it('refuses a topup with no billing order id', () => {
    expect(
      resolvePurchaseGrantSourceRef({
        kind: 'topup',
        billingOrderId: null,
        providerSubscriptionId: null,
        cycleStart: null,
      })
    ).toBeNull();
  });

  it('resolves a subscription charge to subscriptionId:cycleStartUnix, matching razorpay-sync.ts', () => {
    const ref = resolvePurchaseGrantSourceRef({
      kind: 'subscription_first',
      billingOrderId: null,
      providerSubscriptionId: 'sub_abc123',
      cycleStart: '2026-01-15T00:00:00.000Z',
    });
    const expectedUnix = Math.round(new Date('2026-01-15T00:00:00.000Z').getTime() / 1000);
    expect(ref).toEqual({ sourceType: 'subscription', sourceRefId: `sub_abc123:${expectedUnix}` });
  });

  it('resolves a subscription renewal the same way as a first charge', () => {
    const ref = resolvePurchaseGrantSourceRef({
      kind: 'subscription_renewal',
      billingOrderId: null,
      providerSubscriptionId: 'sub_xyz',
      cycleStart: '2026-03-01T00:00:00.000Z',
    });
    expect(ref?.sourceType).toBe('subscription');
    expect(ref?.sourceRefId).toContain('sub_xyz:');
  });

  it('refuses a subscription payment missing its provider id or cycle start', () => {
    expect(
      resolvePurchaseGrantSourceRef({
        kind: 'subscription_first',
        billingOrderId: null,
        providerSubscriptionId: null,
        cycleStart: '2026-01-15T00:00:00.000Z',
      })
    ).toBeNull();
    expect(
      resolvePurchaseGrantSourceRef({
        kind: 'subscription_first',
        billingOrderId: null,
        providerSubscriptionId: 'sub_abc',
        cycleStart: null,
      })
    ).toBeNull();
  });

  it('refuses an unrecognized payment kind', () => {
    expect(
      resolvePurchaseGrantSourceRef({
        kind: 'something_else',
        billingOrderId: 'order-1',
        providerSubscriptionId: null,
        cycleStart: null,
      })
    ).toBeNull();
  });
});

describe('resolveRefundAttemptOutcome', () => {
  it('is clawback_failed when the clawback itself never succeeded', () => {
    expect(
      resolveRefundAttemptOutcome({ clawbackSucceeded: false, providerCallSucceeded: false })
    ).toBe('clawback_failed');
    // Whatever providerCallSucceeded says is moot if the clawback never happened.
    expect(
      resolveRefundAttemptOutcome({ clawbackSucceeded: false, providerCallSucceeded: true })
    ).toBe('clawback_failed');
  });

  it('is refunded when both the clawback and the provider call succeeded', () => {
    expect(
      resolveRefundAttemptOutcome({ clawbackSucceeded: true, providerCallSucceeded: true })
    ).toBe('refunded');
  });

  it('is provider_call_failed_compensated when the compensating restore succeeded', () => {
    expect(
      resolveRefundAttemptOutcome({
        clawbackSucceeded: true,
        providerCallSucceeded: false,
        compensateSucceeded: true,
      })
    ).toBe('provider_call_failed_compensated');
  });

  it('is provider_call_failed_compensation_failed -- the alarming case -- when the restore also failed', () => {
    expect(
      resolveRefundAttemptOutcome({
        clawbackSucceeded: true,
        providerCallSucceeded: false,
        compensateSucceeded: false,
      })
    ).toBe('provider_call_failed_compensation_failed');
  });
});
