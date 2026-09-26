import { describe, expect, it } from 'vitest';
import {
  formatMoneyMinorForConfirmation,
  matchTopupGrantForRefund,
  unwrapAdminBillingActionResult,
  type WalletActivityGrantLookup,
} from './billing-admin-ui.shared';

describe('formatMoneyMinorForConfirmation', () => {
  it('shows two decimal places for a round INR amount', () => {
    expect(formatMoneyMinorForConfirmation('INR', 53_100)).toBe('₹531.00');
  });

  it('shows two decimal places for a fractional INR amount', () => {
    expect(formatMoneyMinorForConfirmation('INR', 53_150)).toBe('₹531.50');
  });

  it('falls back to en-US formatting for a non-INR currency', () => {
    expect(formatMoneyMinorForConfirmation('USD', 1_000)).toBe('$10.00');
  });
});

describe('matchTopupGrantForRefund', () => {
  const walletActivity: WalletActivityGrantLookup[] = [
    {
      kind: 'grant',
      source: 'topup',
      sourceRefId: 'order-1',
      coinsDelta: 500,
      remainingCoins: 320,
    },
    {
      kind: 'spend',
      source: 'beat_generation',
      sourceRefId: null,
      coinsDelta: -50,
      remainingCoins: null,
    },
  ];

  it('matches a top-up payment to its grant by billing_order_id', () => {
    expect(matchTopupGrantForRefund({ kind: 'topup', billingOrderId: 'order-1' }, walletActivity)).toEqual({
      remainingCoins: 320,
      totalCoins: 500,
    });
  });

  it('returns null when no grant carries a matching source_ref_id', () => {
    expect(
      matchTopupGrantForRefund({ kind: 'topup', billingOrderId: 'order-does-not-exist' }, walletActivity)
    ).toBeNull();
  });

  it('returns null for a subscription payment -- deliberately not attempted', () => {
    expect(
      matchTopupGrantForRefund({ kind: 'subscription_renewal', billingOrderId: null }, walletActivity)
    ).toBeNull();
  });

  it('returns null when the payment has no billing_order_id', () => {
    expect(matchTopupGrantForRefund({ kind: 'topup', billingOrderId: null }, walletActivity)).toBeNull();
  });

  it('returns null when a spend row is the only match candidate', () => {
    const spendOnly: WalletActivityGrantLookup[] = [
      { kind: 'spend', source: 'topup', sourceRefId: 'order-1', coinsDelta: -10, remainingCoins: null },
    ];
    expect(matchTopupGrantForRefund({ kind: 'topup', billingOrderId: 'order-1' }, spendOnly)).toBeNull();
  });
});

describe('unwrapAdminBillingActionResult', () => {
  it('returns the result of a settled success', () => {
    expect(unwrapAdminBillingActionResult({ ok: true, result: { grantedCoins: 120 } })).toEqual({ grantedCoins: 120 });
  });

  it('rethrows the server-side reason verbatim, so production builds still show it', () => {
    expect(() => unwrapAdminBillingActionResult({ ok: false, error: 'Refund cap reached for this account.' })).toThrow(
      'Refund cap reached for this account.'
    );
  });
});
