/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the Indian financial year (1 April
 * to 31 March), formatted "2026-27" -- the shape billing_documents.financial_year and
 * billing_next_document_number() (125_billing_ledger_and_retention.sql) both expect. Pure and
 * isomorphic. Document issuing itself stays off until Phase 6 (plan §1 answer 5); this module only
 * supplies the FY string a future issuer -- or today's backfill (Unit B) -- needs to stamp on a row.
 *
 * The Indian financial year is a calendar concept anchored to India Standard Time, not to whatever
 * timezone the server happens to run in. A timestamp is converted to IST before its month/year are
 * read, so a payment captured just after midnight IST on 1 April lands in the new FY even though
 * its UTC timestamp is still 31 March.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const FY_START_MONTH_INDEX = 3; // April, 0-indexed

/** The financial year containing `date`, computed in IST. Format: "YYYY-YY", e.g. "2026-27" for
 * any date from 2026-04-01T00:00:00+05:30 up to (but not including) 2027-04-01T00:00:00+05:30. */
export function financialYearForDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('financialYearForDate: invalid date');
  }

  const istMs = date.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
  const ist = new Date(istMs);
  const istYear = ist.getUTCFullYear();
  const istMonth = ist.getUTCMonth();

  const fyStartYear = istMonth >= FY_START_MONTH_INDEX ? istYear : istYear - 1;
  const fyEndYearShort = String((fyStartYear + 1) % 100).padStart(2, '0');
  return `${fyStartYear}-${fyEndYearShort}`;
}

/** Convenience wrapper for "the FY as of right now" -- takes an explicit `now` so callers (and
 * tests) never depend on the system clock implicitly. Defaults to `new Date()`. */
export function currentFinancialYear(now: Date = new Date()): string {
  return financialYearForDate(now);
}
