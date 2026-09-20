/**
 * Payments Phase 4, Unit D (docs/payments/phase-4-plan.md §9, "Unit D"): the pure half of the admin
 * quota-inspection panel -- "why did this Free user hit the daily watch limit", answerable without
 * SQL. Pure and isomorphic, mirroring watch-quota.shared.ts's own split, so every branch here is
 * unit-testable without a database.
 *
 * `peekWatchQuota` (lib/pricing/watch-quota.ts) answers the equivalent question for a reader about
 * one (user, storyline) pair and fails OPEN on any read error -- correct for a reader, wrong for an
 * admin, who must be told "we could not read this" rather than a false "this account is unmetered".
 * This module extracts the parts of that shape an admin view can reuse (the IST day math, the
 * never-negative remaining-slots arithmetic) without inheriting the fail-open behaviour, and adds
 * the one thing a reader's view never needs: an honest, distinct "unavailable" state for a database
 * that hasn't run migration 129 yet.
 */

import { watchSlotsRemaining, istDayWindow, type IstDayWindow } from '@/lib/pricing/watch-quota.shared';

/** How many trailing IST days the "recent history" table covers, today included. A deliberate,
 * small extension of the spec's "today" -- "did they hit it yesterday too" is the immediate
 * follow-up support question, and it costs one grouped read on the existing (user_id, local_day)
 * index (docs/payments/phase-4-plan.md, Unit D). */
export const RECENT_WATCH_QUOTA_DAY_COUNT = 7;

/**
 * The three distinguishable answers to "why", per the spec: this is the one admin account and is
 * never metered (no ledger row is ever written for it); the account's plan carries
 * `unlimitedWatching` (say which plan key, resolved from the snapshot, never the tier rank); or a
 * limit of N genuinely applies, in which case `used`/`remaining` travel with the reason rather than
 * sitting unqualified at the top level, since they mean nothing for the first two reasons.
 */
export type AdminWatchQuotaWhy =
  | { reason: 'admin_account' }
  | { reason: 'unlimited_plan'; planKey: string }
  | { reason: 'limited'; limit: number; used: number; remaining: number };

/**
 * The three/four-way derivation itself. `used` is the count of distinct storylines opened on the
 * IST day being reported (today), computed by the caller from the ledger -- this function only
 * decides which reason applies and, for `limited`, folds in `watchSlotsRemaining`'s never-negative
 * arithmetic (an admin lowering the limit below what someone already spent is a real case, not a
 * bug to hide).
 */
export function deriveAdminWatchQuotaWhy(input: {
  isAdmin: boolean;
  unlimited: boolean;
  planKey: string;
  limit: number;
  used: number;
}): AdminWatchQuotaWhy {
  if (input.isAdmin) {
    return { reason: 'admin_account' };
  }
  if (input.unlimited) {
    return { reason: 'unlimited_plan', planKey: input.planKey };
  }
  return {
    reason: 'limited',
    limit: input.limit,
    used: input.used,
    remaining: watchSlotsRemaining({ unlimited: false, used: input.used, limit: input.limit }),
  };
}

export interface AdminWatchQuotaTodaySlot {
  storylineId: string;
  /** Resolved from `storylines.title`; null when the join couldn't resolve it (deleted storyline,
   * or the title lookup itself failed) -- never guessed. */
  storylineTitle: string | null;
  createdAt: string;
}

export interface AdminWatchQuotaDayCount {
  /** "YYYY-MM-DD", IST. */
  localDay: string;
  count: number;
}

export type AdminWatchQuotaSectionStatus = 'ok' | 'unavailable';

export interface AdminWatchQuotaView {
  /** 'unavailable' means `user_daily_watch_slots` (migration 129) could not be read on this
   * environment -- never a throw, per WORKING_AGREEMENTS' fail-closed rule. `why` and the two
   * ledger-derived lists are only meaningful when this is 'ok'. */
  status: AdminWatchQuotaSectionStatus;
  why: AdminWatchQuotaWhy | null;
  istDay: IstDayWindow;
  todaySlots: AdminWatchQuotaTodaySlot[];
  recentDayCounts: AdminWatchQuotaDayCount[];
}

/** The last `count` IST calendar days containing `now`, oldest first, today last. Pure function of
 * wall-clock time: each day is `now` shifted back by whole 24h steps and re-derived through
 * `istLocalDay`, which is exact because IST carries no DST. */
export function recentIstLocalDays(now: Date, count: number): string[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(istDayWindow(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)).localDay);
  }
  return days;
}

/** Zero-fills `days` (as `recentIstLocalDays` returns them) against the raw `local_day` values a
 * ledger read returned, so a day with no activity shows as an explicit 0 rather than being absent
 * from the table -- "did they hit it yesterday too" needs the absence of a spike to be visible too. */
export function buildRecentDayCounts(
  days: readonly string[],
  rawLocalDays: readonly string[]
): AdminWatchQuotaDayCount[] {
  const counts = new Map<string, number>();
  for (const day of rawLocalDays) {
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return days.map((localDay) => ({ localDay, count: counts.get(localDay) ?? 0 }));
}

/** The "unreadable" state (CRITICAL section, migration 129 absent): distinct from every "why", and
 * never a throw. Still reports the IST day window -- knowing which day *would* be reported is not
 * itself dependent on the ledger table being present. */
export function buildUnavailableAdminWatchQuotaView(now: Date): AdminWatchQuotaView {
  return {
    status: 'unavailable',
    why: null,
    istDay: istDayWindow(now),
    todaySlots: [],
    recentDayCounts: [],
  };
}

/** Assembles the 'ok' view from already-fetched raw inputs -- the one place the three-way `why`,
 * the day-count zero-fill and the IST window come together, kept pure so all three are covered by
 * one direct unit test without touching Supabase. */
export function buildAdminWatchQuotaView(input: {
  now: Date;
  isAdmin: boolean;
  unlimited: boolean;
  planKey: string;
  dailyLimit: number;
  todaySlots: AdminWatchQuotaTodaySlot[];
  recentDays: readonly string[];
  recentRawLocalDays: readonly string[];
}): AdminWatchQuotaView {
  return {
    status: 'ok',
    why: deriveAdminWatchQuotaWhy({
      isAdmin: input.isAdmin,
      unlimited: input.unlimited,
      planKey: input.planKey,
      limit: input.dailyLimit,
      used: input.todaySlots.length,
    }),
    istDay: istDayWindow(input.now),
    todaySlots: input.todaySlots,
    recentDayCounts: buildRecentDayCounts(input.recentDays, input.recentRawLocalDays),
  };
}
