import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isSubscriptionEntitled, isSubscriptionInGracePeriod } from './snapshot';
import type { DbBillingSubscription } from '@/lib/types/database';

const NOW = new Date('2026-09-17T00:00:00.000Z');
const FUTURE = '2026-10-17T00:00:00.000Z';

function fakeSubscription(overrides: Partial<DbBillingSubscription> = {}): DbBillingSubscription {
  return {
    id: 'sub-row-1',
    user_id: 'user-1',
    plan_version_id: 'plan-version-1',
    provider: 'razorpay',
    provider_subscription_id: 'sub_razorpay_1',
    provider_customer_id: 'cust_1',
    status: 'active',
    billing_interval: 'monthly',
    currency_code: 'INR',
    current_period_start: null,
    current_period_end: FUTURE,
    cancel_at_period_end: false,
    grace_period_ends_at: null,
    last_webhook_at: null,
    raw_provider_state_json: {},
    provider_mode: 'test',
    first_charge_confirmed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isSubscriptionEntitled', () => {
  it('treats "active" as entitled regardless of first_charge_confirmed_at (unchanged by Phase 1)', () => {
    const subscription = fakeSubscription({ status: 'active', first_charge_confirmed_at: null });
    expect(isSubscriptionEntitled(subscription, NOW)).toBe(true);
  });

  it('does not entitle "authenticated" until a first charge is confirmed', () => {
    const subscription = fakeSubscription({ status: 'authenticated', first_charge_confirmed_at: null });
    expect(isSubscriptionEntitled(subscription, NOW)).toBe(false);
  });

  it('entitles "authenticated" once a first charge is confirmed', () => {
    const subscription = fakeSubscription({
      status: 'authenticated',
      first_charge_confirmed_at: '2026-09-01T00:00:00.000Z',
    });
    expect(isSubscriptionEntitled(subscription, NOW)).toBe(true);
  });

  it('is not entitled once current_period_end has passed', () => {
    const subscription = fakeSubscription({
      status: 'active',
      current_period_end: '2026-01-01T00:00:00.000Z',
    });
    expect(isSubscriptionEntitled(subscription, NOW)).toBe(false);
  });
});

describe('isSubscriptionInGracePeriod', () => {
  it('ignores grace for "pending" without a confirmed first charge', () => {
    const subscription = fakeSubscription({
      status: 'pending',
      first_charge_confirmed_at: null,
      grace_period_ends_at: FUTURE,
    });
    expect(isSubscriptionInGracePeriod(subscription, NOW)).toBe(false);
  });

  it('ignores grace for "halted" without a confirmed first charge', () => {
    const subscription = fakeSubscription({
      status: 'halted',
      first_charge_confirmed_at: null,
      grace_period_ends_at: FUTURE,
    });
    expect(isSubscriptionInGracePeriod(subscription, NOW)).toBe(false);
  });

  it('applies grace for "pending" once a first charge is confirmed and the window has not lapsed', () => {
    const subscription = fakeSubscription({
      status: 'pending',
      first_charge_confirmed_at: '2026-09-01T00:00:00.000Z',
      grace_period_ends_at: FUTURE,
    });
    expect(isSubscriptionInGracePeriod(subscription, NOW)).toBe(true);
    expect(isSubscriptionEntitled(subscription, NOW)).toBe(true);
  });

  it('does not apply grace once grace_period_ends_at has passed, even when confirmed', () => {
    const subscription = fakeSubscription({
      status: 'halted',
      first_charge_confirmed_at: '2026-01-01T00:00:00.000Z',
      grace_period_ends_at: '2026-02-01T00:00:00.000Z',
    });
    expect(isSubscriptionInGracePeriod(subscription, NOW)).toBe(false);
  });
});
