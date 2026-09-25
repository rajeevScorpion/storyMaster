import { describe, it, expect } from 'vitest';

import { describeCheckoutFailure } from './checkout-errors.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, defect 4): raw Razorpay failure text
 * (`error.description`, or any other provider-authored string) must never reach a customer-visible
 * string. describeCheckoutFailure only ever reads the fixed `reason` enum.
 */

const MAPPED_REASONS = [
  'payment_cancelled',
  'payment_dismissed',
  'insufficient_funds',
  'card_declined',
  'incorrect_card_details',
  'incorrect_otp',
  'payment_timed_out',
  'authentication_failed',
] as const;

describe('describeCheckoutFailure', () => {
  it('returns the default sentence for null/undefined', () => {
    expect(describeCheckoutFailure(null)).toMatch(/try again/i);
    expect(describeCheckoutFailure(undefined)).toMatch(/try again/i);
  });

  it('returns the default sentence for an unmapped reason', () => {
    expect(describeCheckoutFailure({ reason: 'gateway_error' })).toBe(
      "That payment didn't go through, and you haven't been charged for it. You can try again."
    );
  });

  it.each(MAPPED_REASONS)('maps %s to its own non-default sentence', (reason) => {
    const message = describeCheckoutFailure({ reason });
    expect(message).toBeTruthy();
    expect(message).not.toBe(
      "That payment didn't go through, and you haven't been charged for it. You can try again."
    );
  });

  it('shares one sentence across incorrect_card_details, incorrect_otp and payment_timed_out', () => {
    const a = describeCheckoutFailure({ reason: 'incorrect_card_details' });
    const b = describeCheckoutFailure({ reason: 'incorrect_otp' });
    const c = describeCheckoutFailure({ reason: 'payment_timed_out' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('never interpolates a provider-authored description, even one shaped like a known reason', () => {
    const message = describeCheckoutFailure({
      reason: 'gateway_error',
      // @ts-expect-error -- description is deliberately not part of RazorpayCheckoutFailure
      description: 'insufficient_funds: card ending 4242 declined by issuing bank ref #12345',
    });
    expect(message).not.toContain('4242');
    expect(message).not.toContain('#12345');
  });
});
