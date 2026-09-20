import { describe, expect, it } from 'vitest';
import {
  beatsToCoins,
  deriveBillingPlanKeyCheck,
  describeBillingSectionState,
  mapAdminBillingDocument,
  mapAdminBillingOrder,
  mapAdminBillingPayment,
  mapAdminBillingProfile,
  mapAdminBillingRefund,
  mapAdminBillingSubscription,
  mapAdminBillingWebhookEvent,
  normalizeAdminUserListInput,
  normalizeCoinGrantInput,
  normalizePromotionalCohortInput,
  resolveEffectiveModerationState,
  selectActiveBillingSubscriptionForPlanKey,
  type AdminBillingSubscription,
} from './user-management.shared';

function buildSubscription(overrides: Partial<AdminBillingSubscription> = {}): AdminBillingSubscription {
  return {
    id: 'sub_1',
    planVersionId: 'version_1',
    planKey: 'plus',
    provider: 'razorpay',
    providerSubscriptionId: 'sub_provider_1',
    providerCustomerId: 'cust_1',
    status: 'active',
    billingInterval: 'monthly',
    currencyCode: 'INR',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    gracePeriodEndsAt: null,
    lastWebhookAt: null,
    providerMode: 'live',
    firstChargeConfirmedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('admin user management helpers', () => {
  it('normalizes unsafe directory paging and filters', () => {
    expect(normalizeAdminUserListInput({
      search: '  USER@Example.com  ',
      status: 'unknown' as 'all',
      page: -3,
      pageSize: 999,
    })).toEqual({
      search: 'USER@Example.com',
      status: 'all',
      page: 1,
      pageSize: 25,
    });
  });

  it('treats an expired suspension as active', () => {
    expect(resolveEffectiveModerationState({
      status: 'suspended',
      suspended_until: '2026-01-01T00:00:00.000Z',
      reason: 'Temporary review',
    }, new Date('2026-02-01T00:00:00.000Z'))).toEqual({
      status: 'active',
      suspendedUntil: null,
      reason: 'Temporary review',
    });
  });

  it('keeps a future suspension effective', () => {
    expect(resolveEffectiveModerationState({
      status: 'suspended',
      suspended_until: '2026-03-01T00:00:00.000Z',
      reason: 'Temporary review',
    }, new Date('2026-02-01T00:00:00.000Z'))).toEqual({
      status: 'suspended',
      suspendedUntil: '2026-03-01T00:00:00.000Z',
      reason: 'Temporary review',
    });
  });

  it('converts whole coins to the fractional beat ledger unit', () => {
    expect(normalizeCoinGrantInput({
      coins: 125,
      reason: 'Support compensation',
    })).toMatchObject({
      coins: 125,
      beats: 12.5,
      reason: 'Support compensation',
      expiresAt: null,
    });
    expect(beatsToCoins('12.50')).toBe(125);
  });

  it('rejects fractional or non-positive coin grants', () => {
    expect(() => normalizeCoinGrantInput({ coins: 0, reason: 'No grant' })).toThrow();
    expect(() => normalizeCoinGrantInput({ coins: 1.5, reason: 'Fractional grant' })).toThrow();
  });

  it('normalizes transparent promotional cohort rules', () => {
    expect(normalizePromotionalCohortInput({
      name: 'Engaged creators',
      activeWithinDays: 30,
      minFinishedStories: 3,
      minPublishedStories: 1,
      minLifetimeConsumedCoins: 250,
      planKey: 'all',
      coinsPerUser: 500,
    })).toMatchObject({
      name: 'Engaged creators',
      activeWithinDays: 30,
      minFinishedStories: 3,
      minPublishedStories: 1,
      minLifetimeConsumedCoins: 250,
      minLifetimeConsumedBeats: 25,
      planKey: 'all',
      coinsPerUser: 500,
      beatsPerUser: 50,
    });
  });
});

describe('admin billing panel: raw row mappers', () => {
  it('maps a subscription row and resolves its plan key from the version map', () => {
    const mapped = mapAdminBillingSubscription({
      id: 'sub_1',
      plan_version_id: 'version_1',
      provider: 'razorpay',
      provider_subscription_id: 'sub_provider_1',
      provider_customer_id: 'cust_1',
      status: 'active',
      billing_interval: 'monthly',
      currency_code: 'INR',
      current_period_start: '2026-01-01T00:00:00.000Z',
      current_period_end: '2026-02-01T00:00:00.000Z',
      cancel_at_period_end: false,
      grace_period_ends_at: null,
      last_webhook_at: null,
      provider_mode: 'live',
      first_charge_confirmed_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }, new Map([['version_1', 'plus']]));

    expect(mapped.planKey).toBe('plus');
    expect(mapped.cancelAtPeriodEnd).toBe(false);
  });

  it('leaves a subscription plan key null when the version does not resolve', () => {
    const mapped = mapAdminBillingSubscription({
      id: 'sub_1',
      plan_version_id: 'version_missing',
      provider: 'razorpay',
      provider_subscription_id: null,
      provider_customer_id: null,
      status: 'active',
      billing_interval: 'monthly',
      currency_code: 'INR',
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: null,
      grace_period_ends_at: null,
      last_webhook_at: null,
      provider_mode: null,
      first_charge_confirmed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }, new Map());

    expect(mapped.planKey).toBeNull();
    expect(mapped.cancelAtPeriodEnd).toBe(false);
  });

  it('coerces order and payment minor amounts to numbers', () => {
    const order = mapAdminBillingOrder({
      id: 'order_1',
      provider: 'razorpay',
      order_type: 'topup_checkout',
      provider_order_id: 'order_provider_1',
      provider_payment_id: null,
      currency_code: 'INR',
      amount_minor: '19900',
      status: 'paid',
      plan_version_id: null,
      topup_pack_id: 'pack_1',
      provider_mode: 'live',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(order.amountMinor).toBe(19900);

    const payment = mapAdminBillingPayment({
      id: 'payment_1',
      provider: 'razorpay',
      provider_mode: 'live',
      provider_payment_id: 'pay_1',
      provider_order_id: null,
      provider_subscription_id: null,
      provider_invoice_id: null,
      billing_order_id: null,
      billing_subscription_id: null,
      plan_version_id: null,
      topup_pack_id: null,
      kind: 'topup',
      status: 'captured',
      currency_code: 'INR',
      net_minor: '16864',
      tax_minor: '3036',
      gross_minor: '19900',
      method_category: 'upi',
      provider_fee_minor: null,
      provider_tax_minor: null,
      cycle_start: null,
      cycle_end: null,
      captured_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(payment).toMatchObject({ netMinor: 16864, taxMinor: 3036, grossMinor: 19900 });
  });

  it('flags a refund with initiated_by "dispute" as a dispute', () => {
    const refund = mapAdminBillingRefund({
      id: 'refund_1',
      payment_id: 'payment_1',
      provider: 'razorpay',
      provider_mode: 'live',
      provider_refund_id: 'rfnd_1',
      provider_payment_id: 'pay_1',
      amount_minor: 19900,
      net_minor: null,
      tax_minor: null,
      currency_code: 'INR',
      status: 'pending',
      reason: null,
      initiated_by: 'dispute',
      processed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(refund.isDispute).toBe(true);

    const plainRefund = mapAdminBillingRefund({
      id: 'refund_2',
      payment_id: 'payment_1',
      provider: 'razorpay',
      provider_mode: 'live',
      provider_refund_id: 'rfnd_2',
      provider_payment_id: 'pay_1',
      amount_minor: 19900,
      net_minor: null,
      tax_minor: null,
      currency_code: 'INR',
      status: 'processed',
      reason: 'Customer request',
      initiated_by: 'admin',
      processed_at: '2026-01-02T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(plainRefund.isDispute).toBe(false);
  });

  it('maps documents, profile and webhook events with numeric coercion', () => {
    const document = mapAdminBillingDocument({
      id: 'doc_1',
      document_type: 'tax_invoice',
      document_number: 'INV/2026-27/000001',
      financial_year: '2026-27',
      issued_at: '2026-01-01T00:00:00.000Z',
      payment_id: 'payment_1',
      refund_id: null,
      currency_code: 'INR',
      net_minor: '16864',
      tax_minor: '3036',
      gross_minor: '19900',
      status: 'issued',
      void_reason: null,
      storage_ref: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(document.grossMinor).toBe(19900);

    const profile = mapAdminBillingProfile({
      id: 'profile_1',
      legal_name: 'Jane Doe',
      billing_email: 'jane@example.com',
      phone: null,
      company_name: null,
      gstin: null,
      state_code: '24',
      country_code: 'IN',
      address_line_1: null,
      address_line_2: null,
      city: null,
      postal_code: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(profile.legalName).toBe('Jane Doe');

    const webhookEvent = mapAdminBillingWebhookEvent({
      id: 'evt_1',
      provider: 'razorpay',
      event_type: 'refund.processed',
      provider_event_id: 'evt_provider_1',
      status: 'failed',
      related_subscription_id: null,
      received_at: '2026-01-01T00:00:00.000Z',
      processed_at: null,
      error_message: 'timeout',
      attempt_count: '3',
      last_attempt_at: '2026-01-01T00:05:00.000Z',
      outcome: null,
    });
    expect(webhookEvent.attemptCount).toBe(3);
  });
});

describe('selectActiveBillingSubscriptionForPlanKey', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('picks an active subscription with an unexpired period end', () => {
    const active = buildSubscription({ status: 'active', currentPeriodEnd: '2026-07-01T00:00:00.000Z' });
    expect(selectActiveBillingSubscriptionForPlanKey([active], now)).toBe(active);
  });

  it('excludes an active subscription whose period has already ended', () => {
    const expired = buildSubscription({ status: 'active', currentPeriodEnd: '2026-01-01T00:00:00.000Z' });
    expect(selectActiveBillingSubscriptionForPlanKey([expired], now)).toBeNull();
  });

  it('treats a null period end on an active subscription as never-expiring', () => {
    const openEnded = buildSubscription({ status: 'active', currentPeriodEnd: null });
    expect(selectActiveBillingSubscriptionForPlanKey([openEnded], now)).toBe(openEnded);
  });

  it('includes a pending subscription only inside its grace period', () => {
    const withinGrace = buildSubscription({
      status: 'pending',
      currentPeriodEnd: null,
      gracePeriodEndsAt: '2026-07-01T00:00:00.000Z',
    });
    expect(selectActiveBillingSubscriptionForPlanKey([withinGrace], now)).toBe(withinGrace);

    const pastGrace = buildSubscription({
      status: 'halted',
      currentPeriodEnd: null,
      gracePeriodEndsAt: '2026-01-01T00:00:00.000Z',
    });
    expect(selectActiveBillingSubscriptionForPlanKey([pastGrace], now)).toBeNull();

    const noGrace = buildSubscription({ status: 'pending', currentPeriodEnd: null, gracePeriodEndsAt: null });
    expect(selectActiveBillingSubscriptionForPlanKey([noGrace], now)).toBeNull();
  });

  it('excludes a cancelled or completed subscription regardless of dates', () => {
    const cancelled = buildSubscription({ status: 'cancelled', currentPeriodEnd: '2026-12-01T00:00:00.000Z' });
    expect(selectActiveBillingSubscriptionForPlanKey([cancelled], now)).toBeNull();
  });

  it('returns null when there are no candidates', () => {
    expect(selectActiveBillingSubscriptionForPlanKey([], now)).toBeNull();
  });

  it('breaks ties by current_period_end desc, nulls last, then updated_at desc', () => {
    const soonerEnd = buildSubscription({
      id: 'sub_sooner',
      status: 'active',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    const laterEnd = buildSubscription({
      id: 'sub_later',
      status: 'active',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(selectActiveBillingSubscriptionForPlanKey([soonerEnd, laterEnd], now)?.id).toBe('sub_later');

    const olderUpdate = buildSubscription({
      id: 'sub_older_update',
      status: 'active',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    const newerUpdate = buildSubscription({
      id: 'sub_newer_update',
      status: 'active',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(selectActiveBillingSubscriptionForPlanKey([olderUpdate, newerUpdate], now)?.id).toBe('sub_newer_update');
  });
});

describe('deriveBillingPlanKeyCheck', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('never reports a mismatch when the subscriptions section could not be read', () => {
    expect(deriveBillingPlanKeyCheck('plus', false, [
      buildSubscription({ planKey: 'free' }),
    ], now)).toEqual({ rpcPlanKey: 'plus', subscriptionPlanKey: null, mismatched: false });
  });

  it('agrees when no active-looking subscription exists and the RPC says free', () => {
    expect(deriveBillingPlanKeyCheck('free', true, [], now)).toEqual({
      rpcPlanKey: 'free',
      subscriptionPlanKey: 'free',
      mismatched: false,
    });
  });

  it('flags a disagreement when the RPC reports a paid plan but no subscription backs it', () => {
    expect(deriveBillingPlanKeyCheck('plus', true, [], now)).toEqual({
      rpcPlanKey: 'plus',
      subscriptionPlanKey: 'free',
      mismatched: true,
    });
  });

  it('agrees when the active subscription resolves to the same plan the RPC reports', () => {
    const active = buildSubscription({ planKey: 'plus', status: 'active', currentPeriodEnd: '2026-07-01T00:00:00.000Z' });
    expect(deriveBillingPlanKeyCheck('plus', true, [active], now)).toEqual({
      rpcPlanKey: 'plus',
      subscriptionPlanKey: 'plus',
      mismatched: false,
    });
  });

  it('flags a disagreement when the active subscription resolves to a different plan', () => {
    const active = buildSubscription({ planKey: 'audience', status: 'active', currentPeriodEnd: '2026-07-01T00:00:00.000Z' });
    expect(deriveBillingPlanKeyCheck('plus', true, [active], now)).toEqual({
      rpcPlanKey: 'plus',
      subscriptionPlanKey: 'audience',
      mismatched: true,
    });
  });

  it('never flags a mismatch off an unresolved plan key', () => {
    const active = buildSubscription({ planKey: null, status: 'active', currentPeriodEnd: '2026-07-01T00:00:00.000Z' });
    expect(deriveBillingPlanKeyCheck('plus', true, [active], now)).toEqual({
      rpcPlanKey: 'plus',
      subscriptionPlanKey: null,
      mismatched: false,
    });
  });
});

describe('describeBillingSectionState', () => {
  it('reports unavailable regardless of item count', () => {
    expect(describeBillingSectionState('payments', 'unavailable', 0)).toEqual({
      kind: 'unavailable',
      message: expect.stringContaining('migration'),
    });
    expect(describeBillingSectionState('payments', 'unavailable', 5)).toMatchObject({ kind: 'unavailable' });
  });

  it('reports a per-section empty message when ok but empty', () => {
    expect(describeBillingSectionState('refunds', 'ok', 0)).toMatchObject({ kind: 'empty' });
    // Documents are empty on every account until Phase 6 turns on issuing (phase-4-plan.md §0) --
    // the message must say so, not read like something is broken.
    expect(describeBillingSectionState('documents', 'ok', 0).message).toMatch(/later phase/);
  });

  it('reports has_data with no message once there is at least one row', () => {
    expect(describeBillingSectionState('orders', 'ok', 17)).toEqual({ kind: 'has_data', message: null });
  });
});
