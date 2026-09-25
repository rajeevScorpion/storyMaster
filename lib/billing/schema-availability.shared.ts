/**
 * Payments Phase 4, Unit B: the shared classifier for "this Postgres/PostgREST error means a
 * migration hasn't run on this database yet" vs. a genuine query failure that should still surface.
 *
 * Extracted from lib/billing/ledger.ts's isMissingLedgerSchemaError, which had the same code list --
 * a second caller (the admin billing panel) needed it too, and the instruction was to extract rather
 * than copy-paste a third time (lib/billing/tax-rules.ts's isMissingBillingTaxSchemaError is the
 * existing second copy this was meant to stop growing). Pure and isomorphic: no server-only, no
 * Supabase import, so it can be unit-tested directly and imported from either side.
 *
 * 42P01 = Postgres undefined_table. 42703 = undefined_column (a partially-applied migration can
 * leave a table in place but missing a column an ALTER would have added). PGRST205/PGRST200/
 * PGRST204 are PostgREST's schema-cache equivalents of the same two things. 42883/PGRST202 cover an
 * RPC function itself being absent.
 *
 * Never classify by error message text -- only by these structural codes (see GOTCHAS.md, "Column-
 * availability latches are per migration group": classify by which query failed, not by the error
 * shape, since the codes here are identical across unrelated migration groups).
 */
const MISSING_SCHEMA_ERROR_CODES = [
  '42P01',
  'PGRST205',
  '42703',
  'PGRST200',
  'PGRST204',
  '42883',
  'PGRST202',
] as const;

export function isMissingBillingSchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error?.code) return false;
  return (MISSING_SCHEMA_ERROR_CODES as readonly string[]).includes(error.code);
}
