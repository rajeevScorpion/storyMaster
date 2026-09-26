import { describe, it, expect } from 'vitest';
import {
  documentTypeLabel,
  methodLabel,
  paymentDescription,
  pickCurrentSubscription,
  subscriptionBanner,
  type SubscriptionRowForPick,
} from './billing-account.shared';

const NOW = new Date('2026-09-24T00:00:00.000Z');

describe('pickCurrentSubscription', () => {
  function row(overrides: Partial<SubscriptionRowForPick> = {}): SubscriptionRowForPick {
    return { status: 'active', provider_mode: 'test', created_at: '2026-01-01T00:00:00.000Z', ...overrides };
  }

  it('returns null when there are no rows in the requested mode', () => {
    expect(pickCurrentSubscription([row({ provider_mode: 'live' })], 'test')).toBeNull();
  });

  it('prefers a live row over a newer ended one', () => {
    const live = row({ status: 'active', created_at: '2026-01-01T00:00:00.000Z' });
    const endedNewer = row({ status: 'cancelled', created_at: '2026-06-01T00:00:00.000Z' });
    expect(pickCurrentSubscription([endedNewer, live], 'test')).toBe(live);
  });

  it('picks the newest live row among several', () => {
    const older = row({ status: 'pending', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = row({ status: 'halted', created_at: '2026-03-01T00:00:00.000Z' });
    expect(pickCurrentSubscription([older, newer], 'test')).toBe(newer);
  });

  it('falls back to the newest ended row when nothing is live', () => {
    const older = row({ status: 'expired', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = row({ status: 'cancelled', created_at: '2026-03-01T00:00:00.000Z' });
    expect(pickCurrentSubscription([older, newer], 'test')).toBe(newer);
  });

  it('ignores rows from the other provider mode', () => {
    const liveWrongMode = row({ status: 'active', provider_mode: 'live', created_at: '2026-05-01T00:00:00.000Z' });
    const endedRightMode = row({ status: 'cancelled', provider_mode: 'test', created_at: '2026-01-01T00:00:00.000Z' });
    expect(pickCurrentSubscription([liveWrongMode, endedRightMode], 'test')).toBe(endedRightMode);
  });
});

describe('subscriptionBanner', () => {
  it('renewing: active with no scheduled cancel', () => {
    const banner = subscriptionBanner(
      { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-24T00:00:00.000Z' },
      NOW
    );
    expect(banner).toEqual({ tone: 'renewing', text: 'Renews on 24 Oct 2026.' });
  });

  it('renewing: authenticated behaves the same as active', () => {
    const banner = subscriptionBanner(
      { status: 'authenticated', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-24T00:00:00.000Z' },
      NOW
    );
    expect(banner.tone).toBe('renewing');
  });

  it('cancelling takes priority over the renewal line when both could apply', () => {
    const banner = subscriptionBanner(
      { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-10-24T00:00:00.000Z' },
      NOW
    );
    expect(banner).toEqual({
      tone: 'cancelling',
      text: 'Cancels on 24 Oct 2026. You keep everything until then. You can subscribe again after that.',
    });
  });

  it('pending', () => {
    const banner = subscriptionBanner(
      { status: 'pending', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-24T00:00:00.000Z' },
      NOW
    );
    expect(banner).toEqual({
      tone: 'pending',
      text: "We couldn't take this month's payment. Razorpay will retry daily for 3 days.",
    });
  });

  it('halted carries the restart action', () => {
    const banner = subscriptionBanner(
      { status: 'halted', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-24T00:00:00.000Z' },
      NOW
    );
    expect(banner).toEqual({
      tone: 'halted',
      text: "Your last payment didn't go through, so your plan is paused.",
      action: 'restart',
    });
  });

  it('ended: cancelled/expired/completed', () => {
    for (const status of ['cancelled', 'expired', 'completed']) {
      const banner = subscriptionBanner(
        { status, cancelAtPeriodEnd: false, currentPeriodEnd: '2026-08-01T00:00:00.000Z' },
        NOW
      );
      expect(banner).toEqual({ tone: 'ended', text: 'Ended on 1 Aug 2026.' });
    }
  });

  it('an immediate end (period end still in the future) gives no date', () => {
    const banner = subscriptionBanner(
      { status: 'cancelled', cancelAtPeriodEnd: false, currentPeriodEnd: '2099-01-01T00:00:00.000Z' },
      NOW
    );
    expect(banner).toEqual({ tone: 'ended', text: 'This plan has ended.' });
  });

  it('a scheduled cancel whose date has already passed reads as ended, not a stale "Cancels on"', () => {
    const banner = subscriptionBanner(
      { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-01-01T00:00:00.000Z' },
      NOW
    );
    expect(banner.tone).toBe('ended');
  });

  it('an active row whose period end has already passed reads as ended, not a stale "Renews on"', () => {
    const banner = subscriptionBanner(
      { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-01-01T00:00:00.000Z' },
      NOW
    );
    expect(banner.tone).toBe('ended');
  });
});

describe('methodLabel', () => {
  it('labels every known category', () => {
    expect(methodLabel('card')).toBe('Card');
    expect(methodLabel('upi')).toBe('UPI');
    expect(methodLabel('netbanking')).toBe('Netbanking');
    expect(methodLabel('wallet')).toBe('Wallet');
    expect(methodLabel('emi')).toBe('EMI');
    expect(methodLabel('paylater')).toBe('Pay later');
    expect(methodLabel('other')).toBe('Other');
  });

  it('gives an em dash for unknown or missing', () => {
    expect(methodLabel('unknown')).toBe('—');
    expect(methodLabel(null)).toBe('—');
  });
});

describe('paymentDescription', () => {
  it('uses the snapshot plan name for a first charge', () => {
    const text = paymentDescription(
      { kind: 'subscription_first', planVersionId: 'pv-1', topupPackId: null, snapshotPlanName: 'Plus', snapshotPackName: null },
      { planNames: {}, topupNames: {} }
    );
    expect(text).toBe('Plus');
  });

  it('appends "renewal" for a renewal, falling back to the resolved catalogue name', () => {
    const text = paymentDescription(
      { kind: 'subscription_renewal', planVersionId: 'pv-1', topupPackId: null, snapshotPlanName: null, snapshotPackName: null },
      { planNames: { 'pv-1': 'Plus' }, topupNames: {} }
    );
    expect(text).toBe('Plus renewal');
  });

  it('uses the snapshot pack name for a top-up', () => {
    const text = paymentDescription(
      { kind: 'topup', planVersionId: null, topupPackId: 'pack-1', snapshotPlanName: null, snapshotPackName: '500 coins' },
      { planNames: {}, topupNames: {} }
    );
    expect(text).toBe('500 coins');
  });

  it('falls back to the resolved topup pack name, then a generic label', () => {
    const resolved = paymentDescription(
      { kind: 'topup', planVersionId: null, topupPackId: 'pack-1', snapshotPlanName: null, snapshotPackName: null },
      { planNames: {}, topupNames: { 'pack-1': '1000 coins' } }
    );
    expect(resolved).toBe('1000 coins');

    const generic = paymentDescription(
      { kind: 'topup', planVersionId: null, topupPackId: null, snapshotPlanName: null, snapshotPackName: null },
      { planNames: {}, topupNames: {} }
    );
    expect(generic).toBe('Coin pack');
  });

  it('falls back to a generic plan label when nothing resolves', () => {
    const text = paymentDescription(
      { kind: 'subscription_first', planVersionId: null, topupPackId: null, snapshotPlanName: null, snapshotPackName: null },
      { planNames: {}, topupNames: {} }
    );
    expect(text).toBe('Plan');
  });
});

describe('documentTypeLabel', () => {
  it('labels a tax invoice', () => {
    expect(documentTypeLabel('tax_invoice')).toBe('Invoice');
  });

  it('labels a credit note', () => {
    expect(documentTypeLabel('credit_note')).toBe('Credit note');
  });

  it('falls back to a generic label for anything else', () => {
    expect(documentTypeLabel('receipt')).toBe('Document');
    expect(documentTypeLabel('something_new')).toBe('Document');
  });
});
