import { describe, it, expect } from 'vitest';

import { assertCheckoutAllowed, CheckoutRefusalError } from './checkout-guard.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): owner decision P6's kids/attestation
 * gate, plus the one error class whose message may reach a customer.
 */

describe('assertCheckoutAllowed', () => {
  it('allows an attested, non-kids checkout', () => {
    expect(assertCheckoutAllowed({ audienceMode: 'all', adultAttested: true })).toBeNull();
  });

  it('refuses a kids profile even when attested', () => {
    const refusal = assertCheckoutAllowed({ audienceMode: 'kids', adultAttested: true });
    expect(refusal).toEqual({ code: 'kids_profile', message: 'Switch to an adult profile to buy.' });
  });

  it('refuses an unattested adult profile', () => {
    const refusal = assertCheckoutAllowed({ audienceMode: 'all', adultAttested: false });
    expect(refusal).toEqual({
      code: 'not_attested',
      message: "Please confirm you're 18 or older and the one paying.",
    });
  });

  it('reports kids_profile, not not_attested, for an unattested kids profile', () => {
    const refusal = assertCheckoutAllowed({ audienceMode: 'kids', adultAttested: false });
    expect(refusal?.code).toBe('kids_profile');
  });
});

describe('CheckoutRefusalError', () => {
  it('carries its code and httpStatus alongside the customer-visible message', () => {
    const error = new CheckoutRefusalError('Switch to an adult profile to buy.', 'kids_profile', 403);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Switch to an adult profile to buy.');
    expect(error.code).toBe('kids_profile');
    expect(error.httpStatus).toBe(403);
    expect(error.name).toBe('CheckoutRefusalError');
  });
});
