import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUserId, resolveWatchQuotaPolicyForUser } from '@/lib/pricing/enforcement';
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
 *    the resolved snapshot, never derived from the tier rank. The same load supplies the limit
 *    (`pricing_free_daily_watch_quota`, Unit E), so the policy costs one lookup, not two.
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

  const policy = await resolveWatchQuotaPolicyForUser(userId);
  if (policy.unlimited) {
    return { allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true };
  }

  const limit = policy.dailyQuota;

  // A limit of zero would mean "no watching at all", which no admin setting this number is asking
  // for -- it is what a misconfigured or unparseable row looks like. Treat it as unrestricted
  // rather than locking every non-exempt reader out of the product, the same way an absent
  // migration does below.
  if (!Number.isInteger(limit) || limit <= 0) {
    console.warn(
      `[watch-quota] pricing_free_daily_watch_quota resolved to ${String(limit)}; allowing the ` +
      'watch rather than refusing every reader. Set a positive integer in the pricing studio.'
    );
    return { allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true };
  }

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

export interface WatchQuotaStatus {
  /** No quota applies: an admin account, or a plan carrying `unlimitedWatching`. */
  unlimited: boolean;
  /** Distinct storylines already opened today. 0 when `unlimited`. */
  used: number;
  /** Today's allowance. 0 when `unlimited`. */
  limit: number;
  /** This storyline was already opened today, so watching it again costs nothing. Decision 3 says
   * a replay must never warn, which is the whole reason this is reported separately from `used`. */
  isReplay: boolean;
}

/**
 * Payments Phase 3, Unit D: what the reader has left, WITHOUT spending anything.
 *
 * Deliberately separate from `consumeWatchSlot` rather than a flag on it. The UI needs to know
 * before it commits the reader -- to show "2 of 3 left today", and to ask before the last slot
 * goes -- and a call that answers by spending could not be used for either. Every branch here is
 * a read.
 *
 * Fails open in the same three places `consumeWatchSlot` does (admin, capability, absent
 * migration), so a database without 129 reports "unlimited" rather than an alarming zero.
 */
export async function peekWatchQuota(input: ConsumeWatchSlotInput): Promise<WatchQuotaStatus> {
  const { userId, storylineId } = input;

  if (isAdminUserId(userId)) {
    return { unlimited: true, used: 0, limit: 0, isReplay: false };
  }

  const policy = await resolveWatchQuotaPolicyForUser(userId);
  if (policy.unlimited || !Number.isInteger(policy.dailyQuota) || policy.dailyQuota <= 0) {
    return { unlimited: true, used: 0, limit: 0, isReplay: false };
  }

  const supabase = createAdminClient();
  const localDay = istLocalDay(new Date());

  const { data, error } = await supabase
    .from('user_daily_watch_slots')
    .select('storyline_id')
    .eq('user_id', userId)
    .eq('local_day', localDay);

  if (error) {
    // 42P01 is the table itself being absent -- migration 129 has not run. Same inverted rule as
    // the RPC probe below: report unrestricted rather than showing a reader a limit that is not
    // being enforced. Any other error is reported the same way for the same reason; this is a
    // display path, and a wrong number here is worse than no number.
    console.warn(
      '[watch-quota] peekWatchQuota could not read the slots for today, reporting unlimited:',
      error.message
    );
    return { unlimited: true, used: 0, limit: 0, isReplay: false };
  }

  const rows = (data as { storyline_id: string }[] | null) ?? [];
  return {
    unlimited: false,
    used: rows.length,
    limit: policy.dailyQuota,
    isReplay: rows.some((row) => row.storyline_id === storylineId),
  };
}
