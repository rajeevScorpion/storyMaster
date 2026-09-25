import { describe, it, expect } from 'vitest';

import { assertCheckoutAllowed, CheckoutRefusalError, parseCheckoutAllowlist } from './checkout-guard.shared';

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

// Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the pure parser behind
// the named-account rollout -- isCheckoutOpenForUser (lib/billing/checkout-allowlist.ts) trusts this
// for every membership check, so its edge cases (blank, mixed separators, casing) are pinned here.
describe('parseCheckoutAllowlist', () => {
  it('splits a comma-separated value and lowercases each id', () => {
    expect(parseCheckoutAllowlist('User-1,User-2')).toEqual(['user-1', 'user-2']);
  });

  it('also splits on whitespace, and trims stray spaces around commas', () => {
    expect(parseCheckoutAllowlist('user-1, user-2 ,  user-3\nuser-4')).toEqual([
      'user-1',
      'user-2',
      'user-3',
      'user-4',
    ]);
  });

  it('drops empty entries from doubled separators', () => {
    expect(parseCheckoutAllowlist('user-1,,  ,user-2')).toEqual(['user-1', 'user-2']);
  });

  it('parses migration 137\'s seeded empty value to an empty list', () => {
    expect(parseCheckoutAllowlist('')).toEqual([]);
  });

  it('parses null and undefined to an empty list', () => {
    expect(parseCheckoutAllowlist(null)).toEqual([]);
    expect(parseCheckoutAllowlist(undefined)).toEqual([]);
  });

  it('parses a value that is only whitespace/commas to an empty list', () => {
    expect(parseCheckoutAllowlist('  ,  ,\n')).toEqual([]);
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
