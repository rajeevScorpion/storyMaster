import { describe, it, expect } from 'vitest';
import {
  RECENT_WATCH_QUOTA_DAY_COUNT,
  buildAdminWatchQuotaView,
  buildRecentDayCounts,
  buildUnavailableAdminWatchQuotaView,
  deriveAdminWatchQuotaWhy,
  recentIstLocalDays,
} from './watch-quota-admin.shared';

describe('deriveAdminWatchQuotaWhy', () => {
  it('is admin_account whenever isAdmin is true, regardless of the resolved policy', () => {
    // The admin short-circuit must win even if a stale/incorrect policy read came back "limited" --
    // an admin account is never metered, full stop.
    expect(
      deriveAdminWatchQuotaWhy({ isAdmin: true, unlimited: false, planKey: 'free', limit: 3, used: 5 })
    ).toEqual({ reason: 'admin_account' });
  });

  it('is unlimited_plan with the resolved plan key when the plan grants unlimitedWatching', () => {
    expect(
      deriveAdminWatchQuotaWhy({ isAdmin: false, unlimited: true, planKey: 'studio', limit: 3, used: 0 })
    ).toEqual({ reason: 'unlimited_plan', planKey: 'studio' });
  });

  it('is limited with used/limit/remaining folded in when a real quota applies', () => {
    expect(
      deriveAdminWatchQuotaWhy({ isAdmin: false, unlimited: false, planKey: 'free', limit: 3, used: 2 })
    ).toEqual({ reason: 'limited', limit: 3, used: 2, remaining: 1 });
  });

  it('never reports a negative remaining when an admin lowered the limit below what was spent', () => {
    // Same real case watchSlotsRemaining itself guards against (lib/pricing/watch-quota.shared.ts):
    // someone used 5 slots under yesterday's limit, then the setting dropped to 3.
    const why = deriveAdminWatchQuotaWhy({
      isAdmin: false,
      unlimited: false,
      planKey: 'free',
      limit: 3,
      used: 5,
    });
    expect(why).toEqual({ reason: 'limited', limit: 3, used: 5, remaining: 0 });
  });

  it('reports the full limit remaining when nothing has been used yet', () => {
    const why = deriveAdminWatchQuotaWhy({
      isAdmin: false,
      unlimited: false,
      planKey: 'free',
      limit: 3,
      used: 0,
    });
    expect(why).toEqual({ reason: 'limited', limit: 3, used: 0, remaining: 3 });
  });
});

describe('recentIstLocalDays', () => {
  it('returns `count` consecutive IST days, oldest first and today last', () => {
    const days = recentIstLocalDays(new Date('2026-09-20T10:00:00.000Z'), 3);
    expect(days).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
  });

  it('defaults to the spec-sized window', () => {
    const days = recentIstLocalDays(new Date('2026-09-20T10:00:00.000Z'), RECENT_WATCH_QUOTA_DAY_COUNT);
    expect(days).toHaveLength(7);
    expect(days[days.length - 1]).toBe('2026-09-20');
    expect(days[0]).toBe('2026-09-14');
  });

  it('returns an empty list for a non-positive count', () => {
    expect(recentIstLocalDays(new Date(), 0)).toEqual([]);
    expect(recentIstLocalDays(new Date(), -1)).toEqual([]);
  });
});

describe('buildRecentDayCounts', () => {
  const days = ['2026-09-18', '2026-09-19', '2026-09-20'];

  it('zero-fills days with no ledger rows rather than omitting them', () => {
    expect(buildRecentDayCounts(days, [])).toEqual([
      { localDay: '2026-09-18', count: 0 },
      { localDay: '2026-09-19', count: 0 },
      { localDay: '2026-09-20', count: 0 },
    ]);
  });

  it('counts multiple rows on the same day, in the given day order', () => {
    const rawLocalDays = ['2026-09-19', '2026-09-20', '2026-09-19', '2026-09-20', '2026-09-20'];
    expect(buildRecentDayCounts(days, rawLocalDays)).toEqual([
      { localDay: '2026-09-18', count: 0 },
      { localDay: '2026-09-19', count: 2 },
      { localDay: '2026-09-20', count: 3 },
    ]);
  });
});

describe('buildUnavailableAdminWatchQuotaView', () => {
  it('is a distinct state from every "why" -- unavailable, not a guessed reason', () => {
    const view = buildUnavailableAdminWatchQuotaView(new Date('2026-09-20T10:00:00.000Z'));
    expect(view.status).toBe('unavailable');
    expect(view.why).toBeNull();
    expect(view.todaySlots).toEqual([]);
    expect(view.recentDayCounts).toEqual([]);
  });

  it('still reports which IST day would be in question, even though the ledger is unreadable', () => {
    const view = buildUnavailableAdminWatchQuotaView(new Date('2026-09-20T10:00:00.000Z'));
    expect(view.istDay.localDay).toBe('2026-09-20');
  });
});

describe('buildAdminWatchQuotaView', () => {
  const now = new Date('2026-09-20T10:00:00.000Z');

  it('assembles an admin_account view independent of the ledger contents', () => {
    const view = buildAdminWatchQuotaView({
      now,
      isAdmin: true,
      unlimited: false,
      planKey: 'free',
      dailyLimit: 3,
      todaySlots: [],
      recentDays: ['2026-09-20'],
      recentRawLocalDays: [],
    });
    expect(view.status).toBe('ok');
    expect(view.why).toEqual({ reason: 'admin_account' });
    expect(view.istDay.localDay).toBe('2026-09-20');
  });

  it('derives "limited" from the actual number of today slots passed in, not a separate count', () => {
    const todaySlots = [
      { storylineId: 's1', storylineTitle: 'A Tale', createdAt: '2026-09-20T05:00:00.000Z' },
      { storylineId: 's2', storylineTitle: null, createdAt: '2026-09-20T06:00:00.000Z' },
    ];
    const view = buildAdminWatchQuotaView({
      now,
      isAdmin: false,
      unlimited: false,
      planKey: 'free',
      dailyLimit: 3,
      todaySlots,
      recentDays: ['2026-09-19', '2026-09-20'],
      recentRawLocalDays: ['2026-09-19'],
    });
    expect(view.why).toEqual({ reason: 'limited', limit: 3, used: 2, remaining: 1 });
    expect(view.todaySlots).toBe(todaySlots);
    expect(view.recentDayCounts).toEqual([
      { localDay: '2026-09-19', count: 1 },
      { localDay: '2026-09-20', count: 0 },
    ]);
  });
});
