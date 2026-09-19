/**
 * Payments Phase 3, Unit B (docs/payments/phase-3-plan.md §5, B2): the pure half of the daily free
 * watch quota. Pure and isomorphic -- both the server enforcement path
 * (lib/pricing/watch-quota.ts, via consumeWatchSlot) and any future client-side "N of 3 left
 * today" display (Unit D, not built here) must agree on what "today" means, which is exactly why
 * this lives in a .shared.ts file rather than inside the server-only module.
 *
 * The day is always IST (owner decision 11: IST for everyone, no per-user timezone), computed with
 * the same fixed-offset technique as lib/billing/financial-year.shared.ts -- IST has no DST, so a
 * constant offset is correct year-round.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The IST calendar day containing `date`, formatted "YYYY-MM-DD". This is the `local_day` value
 * passed to the `consume_watch_slot` RPC (migration 129) -- deliberately computed by the caller,
 * never by the database's own `now()`, so the server process's timezone can never silently
 * redefine a user's day (see migration 129's header comment). */
export function istLocalDay(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('istLocalDay: invalid date');
  }

  const istMs = date.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
