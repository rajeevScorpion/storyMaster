import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUserId, resolveUnlimitedWatchingForUser } from '@/lib/pricing/enforcement';
import { istLocalDay } from '@/lib/pricing/watch-quota.shared';

/**
 * Payments Phase 3, Unit B (docs/payments/phase-3-plan.md §5, B3): the server-side enforcement
 * point for the Free daily watch quota. The one caller is `loadStorylineWithBeats`
 * (app/actions/exploration.ts), the choke point every watch entry point in the app funnels
 * through (docs/payments/phase-3-hardcoding-audit.md, watch-path appendix).
 */

export interface WatchSlotResult {
  allowed: boolean;
  /** Slots used today, including this one if it was just consumed. 0 when `unlimited`. */
  used: number;
  /** The limit this result was evaluated against. 0 when `unlimited`. */
  limit: number;
  /** True when this watch was already counted today (re-watching a story already seen today is
   * always free and never re-consumes a slot -- owner decision 3). */
  isReplay: boolean;
  /** True for an admin account or a plan carrying the `unlimitedWatching` capability -- no ledger
   * row is written and `used`/`limit` are not meaningful. */
  unlimited: boolean;
}

interface ConsumeWatchSlotInput {
  userId: string;
  storylineId: string;
}

interface ConsumeWatchSlotRpcRow {
  allowed: boolean;
  used: number;
  is_replay: boolean;
}

/**
 * Unit E (docs/payments/phase-3-plan.md §6, deferred -- not built by this unit) is where the
 * quota number becomes an admin-editable runtime setting (`pricing_free_daily_watch_quota` on
 * `PricingRuntimeControls`, default '3'). That field does not exist yet, so this constant stands
 * in with the same default Unit E's own plan text records. Replace this with
 * `controls.freeDailyWatchQuota` when Unit E lands -- do not let it linger once that field exists.
 */
const FALLBACK_FREE_DAILY_WATCH_QUOTA = 3;

let missingRpcLatched = false;

/** Test-only escape hatch, mirroring lib/billing/ledger.ts's resetLedgerSchemaLatchForTests --
 * the latch below is otherwise permanent for the process, matching every other missing-schema
 * latch in this codebase (a hand-applied migration needs a restart to be noticed). */
export function resetWatchQuotaMissingRpcLatchForTests(): void {
  missingRpcLatched = false;
}

/** 42883 (Postgres: function does not exist) and PGRST202 (PostgREST: function not found in the
 * schema cache) are what `consume_watch_slot` itself being absent looks like -- i.e. migration 129
 * has not run on this database. Structural probe on the error code, never on message text
 * (WORKING_AGREEMENTS.md), mirroring lib/billing/ledger.ts's isMissingLedgerSchemaError. */
function isMissingConsumeWatchSlotRpcError(error: { code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42883' || error.code === 'PGRST202';
}

/**
 * Spends (or replays) one of today's free watch slots for `userId` on `storylineId`.
 *
 * Order of checks, cheapest and most permissive first (§5, B3):
 * 1. Admin accounts are never metered and never write to the ledger (Phase 0 decision 7).
 * 2. A plan carrying the `unlimitedWatching` capability is treated the same way. This is read off
 *    the resolved snapshot, never derived from the tier rank.
 * 3. Otherwise, `consume_watch_slot` (migration 129) is the source of truth: it is race-safe
 *    across devices and free-on-replay by construction (see the migration's own comments).
 *
 * The one deliberately inverted rule: if migration 129 has not been applied to this database, the
 * RPC call fails structurally (not by a missing table it depends on) and this function ALLOWS the
 * watch rather than blocking it, logging once. Every other RPC failure is a real error and
 * propagates -- an absent migration must never make the product unusable
 * (WORKING_AGREEMENTS.md, and the migration-069 production outage that motivated the rule), but a
 * genuine database problem is not the same thing as "not shipped yet" and must not be papered over.
 */
export async function consumeWatchSlot(input: ConsumeWatchSlotInput): Promise<WatchSlotResult> {
  const { userId, storylineId } = input;

  if (isAdminUserId(userId)) {
    return { allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true };
  }

  const unlimited = await resolveUnlimitedWatchingForUser(userId);
  if (unlimited) {
    return { allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true };
  }

  const limit = FALLBACK_FREE_DAILY_WATCH_QUOTA;

  if (missingRpcLatched) {
    return { allowed: true, used: 0, limit, isReplay: false, unlimited: false };
  }

  const supabase = createAdminClient();
  const localDay = istLocalDay(new Date());

  const { data, error } = await supabase.rpc('consume_watch_slot', {
    p_user_id: userId,
    p_local_day: localDay,
    p_storyline_id: storylineId,
    p_limit: limit,
  });

  if (error) {
    if (isMissingConsumeWatchSlotRpcError(error)) {
      missingRpcLatched = true;
      console.warn(
        '[watch-quota] consume_watch_slot is missing on this database (migration 129 not applied) -- ' +
        'allowing the watch rather than blocking every reader. This is deliberate; see ' +
        'WORKING_AGREEMENTS.md and lib/pricing/watch-quota.ts.'
      );
      return { allowed: true, used: 0, limit, isReplay: false, unlimited: false };
    }
    throw new Error(`consume_watch_slot failed: ${error.message}`);
  }

  const row = ((data as ConsumeWatchSlotRpcRow[] | null) ?? [])[0] ?? null;
  if (!row) {
    throw new Error('consume_watch_slot did not return a result');
  }

  return {
    allowed: row.allowed,
    used: row.used,
    limit,
    isReplay: row.is_replay,
    unlimited: false,
  };
}
