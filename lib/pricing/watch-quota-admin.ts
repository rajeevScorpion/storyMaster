import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUserId, resolveWatchQuotaPolicyForUserStrict } from '@/lib/pricing/enforcement';
import { istLocalDay } from '@/lib/pricing/watch-quota.shared';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import {
  RECENT_WATCH_QUOTA_DAY_COUNT,
  buildAdminWatchQuotaView,
  buildUnavailableAdminWatchQuotaView,
  recentIstLocalDays,
  type AdminWatchQuotaTodaySlot,
  type AdminWatchQuotaView,
} from '@/lib/pricing/watch-quota-admin.shared';

/**
 * Payments Phase 4, Unit D (docs/payments/phase-4-plan.md §9, "Unit D"): "why did this Free user
 * hit the daily watch limit", for the admin user record. Extracts the policy resolution
 * `peekWatchQuota` already uses (lib/pricing/watch-quota.ts) via
 * `resolveWatchQuotaPolicyForUserStrict` -- which, unlike every reader-facing caller of that policy,
 * does not fail open -- rather than re-deriving it, then reads `user_daily_watch_slots` (migration
 * 129) directly, since that table is scoped to (user, day), not (user, day, storyline) the way a
 * reader's question is.
 *
 * Never throws for a missing migration 129: that degrades the whole section to 'unavailable', per
 * WORKING_AGREEMENTS' fail-closed rule and the CRITICAL note in the unit's own spec. A genuine
 * error (not a missing-schema shape) still propagates, same as every other read in
 * getAdminUserDetailInternal -- this section does not need to be more defensive than the rest of
 * that page about an actual bug, only about an environment that hasn't run 129 yet.
 */
export async function inspectWatchQuotaForAdmin(userId: string): Promise<AdminWatchQuotaView> {
  const now = new Date();
  const admin = createAdminClient();
  const isAdmin = isAdminUserId(userId);

  // Cheapest and most permissive check first, mirroring consumeWatchSlot/peekWatchQuota: an admin
  // account is never metered, so there is no reason to load the pricing state at all to know that.
  let unlimited = true;
  let planKey = 'free';
  let dailyLimit = 0;
  if (!isAdmin) {
    const policy = await resolveWatchQuotaPolicyForUserStrict(userId);
    unlimited = policy.unlimited;
    planKey = policy.planKey;
    dailyLimit = policy.dailyQuota;
  }

  const localDay = istLocalDay(now);
  const recentDays = recentIstLocalDays(now, RECENT_WATCH_QUOTA_DAY_COUNT);
  const earliestDay = recentDays[0];

  const [todayResult, historyResult] = await Promise.all([
    admin
      .from('user_daily_watch_slots')
      .select('storyline_id, created_at')
      .eq('user_id', userId)
      .eq('local_day', localDay)
      .order('created_at', { ascending: true }),
    // Counts only, per the spec -- not full rows -- so this stays one small grouped read on the
    // existing (user_id, local_day) index even for an account with a long history.
    admin
      .from('user_daily_watch_slots')
      .select('local_day')
      .eq('user_id', userId)
      .gte('local_day', earliestDay),
  ]);

  if (todayResult.error && !isMissingBillingSchemaError(todayResult.error)) {
    throw new Error(`Unable to load today's watch slots: ${todayResult.error.message}`);
  }
  if (historyResult.error && !isMissingBillingSchemaError(historyResult.error)) {
    throw new Error(`Unable to load recent watch-slot history: ${historyResult.error.message}`);
  }
  if (todayResult.error || historyResult.error) {
    // Both queries hit the same table, so either one failing this way means migration 129 has not
    // run here -- degrade the whole section rather than render half of it.
    return buildUnavailableAdminWatchQuotaView(now);
  }

  const todayRows = (todayResult.data ?? []) as { storyline_id: string; created_at: string }[];
  const titleByStorylineId = await loadStorylineTitles(
    admin,
    Array.from(new Set(todayRows.map((row) => row.storyline_id)))
  );
  const todaySlots: AdminWatchQuotaTodaySlot[] = todayRows.map((row) => ({
    storylineId: row.storyline_id,
    storylineTitle: titleByStorylineId.get(row.storyline_id) ?? null,
    createdAt: row.created_at,
  }));

  const historyRows = (historyResult.data ?? []) as { local_day: string }[];

  return buildAdminWatchQuotaView({
    now,
    isAdmin,
    unlimited,
    planKey,
    dailyLimit,
    todaySlots,
    recentDays,
    recentRawLocalDays: historyRows.map((row) => row.local_day),
  });
}

/**
 * Best-effort title enrichment, mirroring loadBillingSubscriptionPlanKeys's shape
 * (app/actions/admin-users.ts): a title lookup failure must not fail the whole quota section, which
 * already has the data that actually answers "why" -- an unresolved title just renders as null.
 */
async function loadStorylineTitles(
  admin: ReturnType<typeof createAdminClient>,
  storylineIds: string[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (storylineIds.length === 0) return titles;

  const { data, error } = await admin
    .from('storylines')
    .select('id, title')
    .in('id', storylineIds);

  if (error) {
    console.error('[watch-quota-admin] failed to resolve storyline titles:', error.message);
    return titles;
  }

  for (const row of (data ?? []) as { id: string; title: string | null }[]) {
    if (row.title) titles.set(row.id, row.title);
  }
  return titles;
}
