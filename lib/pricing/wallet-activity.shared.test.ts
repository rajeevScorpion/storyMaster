import { describe, expect, it } from 'vitest';
import {
  buildWalletActivityItems,
  cursorUpperBoundIso,
  getSpendTitle,
  isWalletActivityCursor,
  pageWalletActivity,
  sourceFetchLimit,
  type ActivitySources,
} from './wallet-activity.shared';
import { PRICING_ACTION_KEYS, type PricingWalletActivityItem } from '@/lib/types/pricing';

function sources(overrides: Partial<ActivitySources>): ActivitySources {
  return {
    grants: [],
    expiredGrants: [],
    spends: [],
    payments: [],
    refunds: [],
    subscriptions: [],
    planNamesByVersionId: { pv_aud: 'Audience' },
    ...overrides,
  };
}

const payment = {
  id: 'pay1',
  kind: 'subscription_first',
  status: 'refunded',
  gross_minor: 23600,
  currency_code: 'INR',
  plan_version_id: 'pv_aud',
  purchase_snapshot_json: null,
  captured_at: '2026-09-25T19:25:00.000Z',
  created_at: '2026-09-25T19:24:00.000Z',
};

describe('buildWalletActivityItems', () => {
  it('shows a refund that took coins back as a coin removal', () => {
    const items = buildWalletActivityItems(sources({
      payments: [payment],
      refunds: [{
        id: 'r1',
        payment_id: 'pay1',
        amount_minor: 23600,
        currency_code: 'INR',
        status: 'processed',
        coin_adjustment_json: { grantId: 'g1', beatsClawedBack: 300 },
        processed_at: '2026-09-26T10:00:00.000Z',
        created_at: '2026-09-26T09:59:00.000Z',
      }],
    }));

    const refund = items.find((item) => item.kind === 'refund');
    expect(refund).toMatchObject({
      title: 'Refund issued',
      coinsDelta: -3000,
      occurredAt: '2026-09-26T10:00:00.000Z',
    });
    expect(refund?.subtitle).toContain('₹236 refunded for the Audience plan');
    expect(refund?.subtitle).toContain('Coins from it were removed');
  });

  it('shows a refund with no coins taken back without a coin amount, and skips failed refunds', () => {
    const items = buildWalletActivityItems(sources({
      payments: [payment],
      refunds: [
        { id: 'r1', payment_id: 'pay1', amount_minor: 23600, currency_code: 'INR', status: 'processed', coin_adjustment_json: null, processed_at: '2026-09-26T10:00:00.000Z', created_at: '2026-09-26T10:00:00.000Z' },
        { id: 'r2', payment_id: 'pay1', amount_minor: 23600, currency_code: 'INR', status: 'failed', coin_adjustment_json: null, processed_at: null, created_at: '2026-09-26T11:00:00.000Z' },
      ],
    }));
    const refunds = items.filter((item) => item.kind === 'refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].coinsDelta).toBeNull();
  });

  it('turns unused coins on an expired grant into an expiry at the expiry time', () => {
    const items = buildWalletActivityItems(sources({
      expiredGrants: [{
        id: 'g1', source_type: 'subscription', beats_total: 300, beats_remaining: 12,
        granted_at: '2026-08-25T00:00:00.000Z', expires_at: '2026-09-25T18:30:00.000Z',
      }],
    }));
    expect(items).toEqual([expect.objectContaining({
      kind: 'expiry', title: 'Coins expired', coinsDelta: -120, occurredAt: '2026-09-25T18:30:00.000Z',
    })]);
  });

  it('records plan start, a scheduled cancel and the end, and ignores never-activated subscriptions', () => {
    const items = buildWalletActivityItems(sources({
      payments: [{ ...payment, status: 'captured' }],
      subscriptions: [
        {
          id: 's1', plan_version_id: 'pv_aud', status: 'cancelled',
          cancel_requested_at: '2026-09-25T19:26:45.000Z',
          current_period_end: '2026-10-25T18:30:00.000Z',
          first_charge_confirmed_at: '2026-09-25T19:25:00.000Z',
          updated_at: '2026-10-25T18:31:10.000Z',
        },
        {
          id: 's2', plan_version_id: 'pv_aud', status: 'expired', cancel_requested_at: null,
          current_period_end: null, first_charge_confirmed_at: null, updated_at: '2026-09-25T02:44:32.000Z',
        },
      ],
    }));

    expect(items.map((item) => [item.id, item.title])).toEqual([
      ['payment:pay1', 'Audience plan started'],
      ['cancel:s1', 'Cancellation scheduled'],
      ['ended:s1', 'Audience plan ended'],
    ]);
    expect(items.find((item) => item.id === 'cancel:s1')?.subtitle).toBe('The Audience plan stays active until 26 Oct 2026');
    // A cycle-end cancel ends at the period boundary, not at the later sync.
    expect(items.find((item) => item.id === 'ended:s1')?.occurredAt).toBe('2026-10-25T18:30:00.000Z');
    expect(items.every((item) => item.coinsDelta === null)).toBe(true);
  });

  it('dates an immediate end (a refund) at the last update, before the period end', () => {
    const [ended] = buildWalletActivityItems(sources({
      subscriptions: [{
        id: 's1', plan_version_id: 'pv_aud', status: 'cancelled', cancel_requested_at: null,
        current_period_end: '2026-10-25T18:30:00.000Z', first_charge_confirmed_at: '2026-09-25T19:25:00.000Z',
        updated_at: '2026-09-26T10:00:00.000Z',
      }],
    }));
    expect(ended.occurredAt).toBe('2026-09-26T10:00:00.000Z');
  });

  it('shows a failed renewal but not a failed first charge, and never a top-up payment', () => {
    const items = buildWalletActivityItems(sources({
      payments: [
        { ...payment, id: 'p1', kind: 'subscription_renewal', status: 'failed' },
        { ...payment, id: 'p2', kind: 'subscription_first', status: 'failed' },
        { ...payment, id: 'p3', kind: 'topup', status: 'captured' },
      ],
    }));
    expect(items.map((item) => item.title)).toEqual(['Renewal payment failed']);
  });
});

function item(id: string, occurredAt: string): PricingWalletActivityItem {
  return { id, kind: 'spend', title: id, subtitle: '', coinsDelta: -10, occurredAt };
}

describe('getSpendTitle', () => {
  it('names every billable action rather than falling back to the generic line', () => {
    for (const key of PRICING_ACTION_KEYS) {
      expect(getSpendTitle(key), key).not.toBe('Used coins in Kissago');
    }
  });
});

describe('pageWalletActivity', () => {
  const at = (minute: number) => `2026-09-26T10:${String(minute).padStart(2, '0')}:00.000Z`;

  it('walks every item exactly once, newest first, five at a time', () => {
    const all = Array.from({ length: 12 }, (_, index) => item(`i${String(index).padStart(2, '0')}`, at(index)));
    const seen: string[] = [];
    let cursor = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = pageWalletActivity(all, cursor);
      seen.push(...page.items.map((entry) => entry.id));
      expect(page.items.length).toBeLessThanOrEqual(5);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.map((entry) => entry.id).reverse());
  });

  it('never loses or repeats rows that share a timestamp across a page boundary', () => {
    const same = at(5);
    const all = [
      ...Array.from({ length: 7 }, (_, index) => item(`same${index}`, same)),
      item('older', at(1)),
    ];
    const first = pageWalletActivity(all, null);
    const second = pageWalletActivity(all, first.nextCursor);
    const ids = [...first.items, ...second.items].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(8);
    expect(second.nextCursor).toBeNull();
  });

  it('returns no cursor when the page holds the rest', () => {
    expect(pageWalletActivity([item('a', at(1))], null).nextCursor).toBeNull();
  });
});

describe('cursor helpers', () => {
  it('fetches enough per source and bounds the query just past the cursor millisecond', () => {
    const cursor = { beforeMs: Date.parse('2026-09-26T10:00:00.000Z'), seenIds: ['a', 'b'] };
    expect(sourceFetchLimit(null)).toBe(6);
    expect(sourceFetchLimit(cursor)).toBe(8);
    expect(cursorUpperBoundIso(cursor)).toBe('2026-09-26T10:00:00.001Z');
  });

  it('rejects malformed cursors from the client', () => {
    expect(isWalletActivityCursor({ beforeMs: 1, seenIds: [] })).toBe(true);
    expect(isWalletActivityCursor({ beforeMs: 'x', seenIds: [] })).toBe(false);
    expect(isWalletActivityCursor({ beforeMs: 1, seenIds: [1] })).toBe(false);
    expect(isWalletActivityCursor(null)).toBe(false);
  });
});
