import { describe, it, expect } from 'vitest';

import { checkoutStateFromOrder } from './checkout-status.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, defect 10): a top-up's `failed` status
 * is not final while a retry can still land in the same window -- the caller (useRazorpayCheckout's
 * dismiss poll) is the one that must not stop on it, but this table is what tells `failed` apart from
 * every genuinely terminal state in the first place.
 */

describe('checkoutStateFromOrder — top-up', () => {
  const orderType = 'topup_checkout' as const;

  it.each(['paid', 'refunded', 'partially_refunded', 'disputed'])('reports %s as paid', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('paid');
  });

  it('reports failed as failed', () => {
    expect(checkoutStateFromOrder({ orderType, status: 'failed', firstChargeConfirmedAt: null })).toBe('failed');
  });

  it.each(['abandoned', 'superseded'])('reports %s as abandoned', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('abandoned');
  });

  it.each(['created', 'preparing'])('reports %s as open', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('open');
  });
});

describe('checkoutStateFromOrder — subscription', () => {
  const orderType = 'subscription_checkout' as const;

  it('reports paid once first_charge_confirmed_at is set, regardless of status', () => {
    expect(
      checkoutStateFromOrder({ orderType, status: 'active', firstChargeConfirmedAt: '2026-01-01T00:00:00.000Z' })
    ).toBe('paid');
  });

  it.each(['authenticated', 'active', 'pending'])('reports %s as confirming before the first charge lands', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('confirming');
  });

  it.each(['failed', 'halted', 'cancelled'])('reports %s as failed', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('failed');
  });

  it.each(['abandoned', 'superseded', 'expired'])('reports %s as abandoned', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('abandoned');
  });

  it.each(['preparing', 'created'])('reports %s as open', (status) => {
    expect(checkoutStateFromOrder({ orderType, status, firstChargeConfirmedAt: null })).toBe('open');
  });
});
