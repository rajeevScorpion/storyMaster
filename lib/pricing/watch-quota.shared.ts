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

/**
 * Payments Phase 4, Unit D: the IST calendar day containing `date`, as a window a support reader
 * can act on -- "which day is being reported" (`localDay`, same value `istLocalDay` would give)
 * plus the two UTC instants that bound it, so "hit the limit" can be answered without anyone
 * having to derive the +05:30 offset by hand (owner decision 11: IST for everyone).
 */
export interface IstDayWindow {
  /** "YYYY-MM-DD", the IST calendar day containing `date`. */
  localDay: string;
  /** ISO UTC instant this IST day began (inclusive). */
  startsAtUtc: string;
  /** ISO UTC instant this IST day ends and the next one begins (exclusive). */
  rollsOverAtUtc: string;
}

export function istDayWindow(date: Date): IstDayWindow {
  const localDay = istLocalDay(date);
  const istMs = date.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
  const ist = new Date(istMs);
  // Midnight of the shifted calendar day, expressed back in real UTC by undoing the shift -- IST
  // has no DST, so a constant offset is correct year-round (see file header).
  const dayStartIstAsUtcMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const dayStartUtcMs = dayStartIstAsUtcMs - IST_OFFSET_MINUTES * 60 * 1000;
  const dayEndUtcMs = dayStartUtcMs + 24 * 60 * 60 * 1000;
  return {
    localDay,
    startsAtUtc: new Date(dayStartUtcMs).toISOString(),
    rollsOverAtUtc: new Date(dayEndUtcMs).toISOString(),
  };
}

/**
 * Payments Phase 3, Unit D: the quota as a reader sees it, plus where to go to lift it.
 *
 * Lives here rather than in the `'use server'` action so a client component can import the type
 * (CLAUDE.md, "Put shared constants and types in a plain module").
 */
export interface WatchQuotaView {
  /** No limit applies -- an admin, an exempt plan, or a database without migration 129. */
  unlimited: boolean;
  /** Distinct storylines opened today. */
  used: number;
  /** Today's allowance. */
  limit: number;
  /** This storyline was already opened today, so opening it again is free (owner decision 3). */
  isReplay: boolean;
  /** The cheapest plan that actually grants unlimited watching, resolved from the catalogue rather
   * than named as a literal. Null when the reader is exempt, or when no published plan grants it. */
  upsell: { planKey: string; name: string } | null;
}

/** Opens left today. Never negative: a limit lowered by an admin below what someone has already
 * spent would otherwise read as a negative allowance. */
export function watchSlotsRemaining(view: Pick<WatchQuotaView, 'unlimited' | 'used' | 'limit'>): number {
  if (view.unlimited) return Number.POSITIVE_INFINITY;
  return Math.max(0, view.limit - view.used);
}

/**
 * Whether opening this storyline would spend the reader's LAST slot, which is the only moment
 * decision 2 asks for a confirmation. A replay never warns (decision 3): it spends nothing, so
 * there is nothing to confirm.
 */
export function isLastWatchSlot(view: WatchQuotaView): boolean {
  if (view.unlimited || view.isReplay) return false;
  return watchSlotsRemaining(view) === 1;
}
