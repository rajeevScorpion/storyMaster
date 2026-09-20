import { describe, it, expect } from 'vitest';
import {
  MIN_AGE_MS,
  CHECKOUT_MAX_AGE_MS,
  TOPUP_MAX_AGE_MS,
  STALE_SUBSCRIPTION_WEBHOOK_MS,
  STALE_WEBHOOK_EVENT_MS,
  WEBHOOK_MAX_FAILED_ATTEMPTS,
  webhookIncidentOrFilter,
  subscriptionBoundaryOrFilter,
  isFailedWebhookIncident,
  isStuckSubscriptionCheckoutIncident,
  isStuckTopupIncident,
  isSubscriptionPastBoundaryIncident,
  hasUnconfirmedFirstCharge,
  isPastCurrentPeriodEnd,
  hasStaleWebhook,
  formatIncidentAge,
} from './billing-incidents.shared';

// Payments Phase 4, Unit F: these predicates are what pins the daily reconcile cron
// (lib/billing/razorpay-reconcile.ts) and the admin incident dashboard to one definition of
// "incident". razorpay-reconcile.test.ts already proves the cron's Supabase queries carry these
// same thresholds; this file proves the predicate logic itself, independent of any database.

const NOW = new Date('2026-09-20T12:00:00.000Z').getTime();

describe('isFailedWebhookIncident', () => {
  it('flags a failed event under the max attempt count', () => {
    expect(isFailedWebhookIncident({ status: 'failed', attempt_count: 3, received_at: new Date(NOW).toISOString() }, NOW)).toBe(true);
  });

  it('does not flag a failed event that has exhausted its attempts', () => {
    expect(
      isFailedWebhookIncident(
        { status: 'failed', attempt_count: WEBHOOK_MAX_FAILED_ATTEMPTS, received_at: new Date(NOW).toISOString() },
        NOW
      )
    ).toBe(false);
  });

  it('flags a received event stuck past the stale threshold', () => {
    const receivedAt = new Date(NOW - STALE_WEBHOOK_EVENT_MS - 1).toISOString();
    expect(isFailedWebhookIncident({ status: 'received', attempt_count: 0, received_at: receivedAt }, NOW)).toBe(true);
  });

  it('does not flag a received event still inside the grace window', () => {
    const receivedAt = new Date(NOW - STALE_WEBHOOK_EVENT_MS + 1).toISOString();
    expect(isFailedWebhookIncident({ status: 'received', attempt_count: 0, received_at: receivedAt }, NOW)).toBe(false);
  });

  it('does not flag a processed or ignored event', () => {
    expect(isFailedWebhookIncident({ status: 'processed', attempt_count: 0, received_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
    expect(isFailedWebhookIncident({ status: 'ignored', attempt_count: 0, received_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it('generates the same filter string on repeat calls with the same clock', () => {
    expect(webhookIncidentOrFilter(NOW)).toBe(webhookIncidentOrFilter(NOW));
    expect(webhookIncidentOrFilter(NOW)).toContain(`attempt_count.lt.${WEBHOOK_MAX_FAILED_ATTEMPTS}`);
  });
});

describe('isStuckSubscriptionCheckoutIncident', () => {
  const base = {
    order_type: 'subscription_checkout',
    status: 'abandoned',
    provider_checkout_session_id: 'sub_123',
    created_at: new Date(NOW - MIN_AGE_MS - 1000).toISOString(),
  };

  it('flags a stuck checkout inside the age window', () => {
    expect(isStuckSubscriptionCheckoutIncident(base, NOW)).toBe(true);
  });

  it('does not flag a top-up order', () => {
    expect(isStuckSubscriptionCheckoutIncident({ ...base, order_type: 'topup_checkout' }, NOW)).toBe(false);
  });

  it('does not flag a status outside the stuck set', () => {
    expect(isStuckSubscriptionCheckoutIncident({ ...base, status: 'paid' }, NOW)).toBe(false);
  });

  it('does not flag a checkout with no provider session id', () => {
    expect(isStuckSubscriptionCheckoutIncident({ ...base, provider_checkout_session_id: null }, NOW)).toBe(false);
  });

  it('does not flag a checkout younger than the minimum age', () => {
    expect(isStuckSubscriptionCheckoutIncident({ ...base, created_at: new Date(NOW - 1000).toISOString() }, NOW)).toBe(false);
  });

  it('does not flag a checkout older than the maximum age', () => {
    expect(
      isStuckSubscriptionCheckoutIncident({ ...base, created_at: new Date(NOW - CHECKOUT_MAX_AGE_MS - 1000).toISOString() }, NOW)
    ).toBe(false);
  });
});

describe('isStuckTopupIncident', () => {
  const base = {
    order_type: 'topup_checkout',
    status: 'failed',
    created_at: new Date(NOW - MIN_AGE_MS - 1000).toISOString(),
  };

  it('flags a stuck top-up inside the age window', () => {
    expect(isStuckTopupIncident(base, NOW)).toBe(true);
  });

  it('does not flag a subscription checkout order', () => {
    expect(isStuckTopupIncident({ ...base, order_type: 'subscription_checkout' }, NOW)).toBe(false);
  });

  it('does not flag a status outside the stuck set', () => {
    expect(isStuckTopupIncident({ ...base, status: 'refunded' }, NOW)).toBe(false);
  });

  it('does not flag a top-up older than the maximum age (already abandoned by the cron)', () => {
    expect(isStuckTopupIncident({ ...base, created_at: new Date(NOW - TOPUP_MAX_AGE_MS - 1000).toISOString() }, NOW)).toBe(false);
  });
});

describe('isSubscriptionPastBoundaryIncident', () => {
  const healthy = {
    status: 'active',
    first_charge_confirmed_at: new Date(NOW - 1000).toISOString(),
    current_period_end: new Date(NOW + 1000 * 60 * 60 * 24).toISOString(),
    last_webhook_at: new Date(NOW - 1000).toISOString(),
  };

  it('does not flag a healthy, current subscription', () => {
    expect(isSubscriptionPastBoundaryIncident(healthy, NOW)).toBe(false);
  });

  it('flags an unconfirmed first charge', () => {
    expect(isSubscriptionPastBoundaryIncident({ ...healthy, first_charge_confirmed_at: null }, NOW)).toBe(true);
    expect(hasUnconfirmedFirstCharge({ first_charge_confirmed_at: null })).toBe(true);
  });

  it('flags a subscription past its current period end', () => {
    const pastEnd = new Date(NOW - 1000).toISOString();
    expect(isSubscriptionPastBoundaryIncident({ ...healthy, current_period_end: pastEnd }, NOW)).toBe(true);
    expect(isPastCurrentPeriodEnd({ current_period_end: pastEnd }, NOW)).toBe(true);
  });

  it('flags a subscription with a stale last webhook', () => {
    const staleWebhook = new Date(NOW - STALE_SUBSCRIPTION_WEBHOOK_MS - 1000).toISOString();
    expect(isSubscriptionPastBoundaryIncident({ ...healthy, last_webhook_at: staleWebhook }, NOW)).toBe(true);
    expect(hasStaleWebhook({ last_webhook_at: staleWebhook }, NOW)).toBe(true);
  });

  it('never flags a subscription outside the reconcilable status set, even past boundary', () => {
    expect(isSubscriptionPastBoundaryIncident({ ...healthy, status: 'cancelled', first_charge_confirmed_at: null }, NOW)).toBe(false);
  });

  it('generates the same OR filter string on repeat calls with the same clock', () => {
    expect(subscriptionBoundaryOrFilter(NOW)).toBe(subscriptionBoundaryOrFilter(NOW));
    expect(subscriptionBoundaryOrFilter(NOW)).toContain('first_charge_confirmed_at.is.null');
  });
});

describe('formatIncidentAge', () => {
  it('reports very recent timestamps as "just now"', () => {
    expect(formatIncidentAge(NOW, new Date(NOW - 5000).toISOString())).toBe('just now');
  });

  it('reports minutes for sub-hour ages', () => {
    expect(formatIncidentAge(NOW, new Date(NOW - 42 * 60 * 1000).toISOString())).toBe('42m');
  });

  it('reports hours and minutes for sub-day ages', () => {
    expect(formatIncidentAge(NOW, new Date(NOW - (3 * 60 + 5) * 60 * 1000).toISOString())).toBe('3h 5m');
  });

  it('reports days and hours for multi-day ages', () => {
    expect(formatIncidentAge(NOW, new Date(NOW - (9 * 24 + 2) * 60 * 60 * 1000).toISOString())).toBe('9d 2h');
  });

  it('never reports a negative age for a clock-skewed timestamp in the future', () => {
    expect(formatIncidentAge(NOW, new Date(NOW + 60000).toISOString())).toBe('just now');
  });
});
