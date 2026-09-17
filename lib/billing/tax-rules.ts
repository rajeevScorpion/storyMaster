import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { TaxRuleInput } from '@/lib/billing/tax.shared';
import type { DbBillingTaxRule } from '@/lib/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * True when a Postgres/PostgREST error means "migration 125 hasn't run on this database yet"
 * (billing_tax_rules absent), as opposed to any other failure that should still surface as a real
 * error. 42P01 is Postgres's undefined_table; PGRST205 is PostgREST's schema-cache variant of the
 * same thing (see lib/ai/text-models.shared.ts's isMissingTextModelRegistrySchemaError). 42703/
 * PGRST200/PGRST204 are included too in case a partially-applied 125 leaves the table present but a
 * column missing -- every query in this module selects only billing_tax_rules columns, so any of
 * these codes from here unambiguously means 125 is not (fully) applied.
 */
export function isMissingBillingTaxSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    error.code === 'PGRST200' ||
    error.code === 'PGRST204'
  );
}

export type TaxRuleLookupResult =
  | { status: 'ok'; rule: TaxRuleInput }
  | { status: 'unavailable' } // migration 125 absent -- caller must charge the net, unchanged (plan §4/§7)
  | { status: 'not_found' }; // table exists but no published rule -- caller must refuse checkout (plan §4/§7)

// Own 60s TTL cache (positive results only, mirroring getFeatureFlag: an absent rule is never
// cached, so publishing a new one takes effect on the very next lookup) plus a permanent per-process
// latch once the table is known missing -- re-querying a missing table every 60s is pure waste, and
// restarting the process is already required to pick up a hand-applied migration (see
// lib/ai/text-models.ts's identical latch-vs-cache split).
const CACHE_TTL_MS = 60_000;
let cache: Map<string, { rule: TaxRuleInput; ts: number }> = new Map();
let schemaUnavailable = false;

export function invalidateTaxRuleCache(): void {
  cache.clear();
}

/** Test-only escape hatch -- the schema latch is otherwise permanent for the process, matching
 * every other missing-schema latch in this codebase (a hand-applied migration needs a restart). */
export function resetTaxRuleSchemaLatchForTests(): void {
  schemaUnavailable = false;
}

function cacheKey(marketKey: string, appliesTo: string): string {
  return `${marketKey}:${appliesTo}`;
}

/**
 * The currently published tax rule for a market and product kind, preferring an exact
 * `applies_to` match over the 'all' fallback row. Fails closed in two distinguishable ways (plan
 * §4/§7): 'unavailable' when migration 125 itself is absent (checkout should charge the net,
 * exactly as before 125), 'not_found' when the table exists but nothing is published for this
 * market/kind (checkout should refuse rather than under-charge).
 */
export async function getPublishedTaxRule(marketKey: string, appliesTo: 'subscription' | 'topup'): Promise<TaxRuleLookupResult> {
  if (schemaUnavailable) return { status: 'unavailable' };

  const cached = cache.get(cacheKey(marketKey, appliesTo));
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return { status: 'ok', rule: cached.rule };

  try {
    const supabase: AdminClient = createAdminClient();
    const { data, error } = await supabase
      .from('billing_tax_rules')
      .select('*')
      .eq('market_key', marketKey)
      .in('applies_to', [appliesTo, 'all'])
      .eq('status', 'published')
      .is('effective_to', null)
      .lte('effective_from', new Date().toISOString());

    if (error) {
      if (isMissingBillingTaxSchemaError(error)) {
        schemaUnavailable = true;
        return { status: 'unavailable' };
      }
      // Deliberately the fail-closed answer, not 'unavailable': a database error must stop checkout
      // rather than quietly charge the net and lose the tax.
      console.error('tax-rules: getPublishedTaxRule failed; refusing checkout for this call:', error);
      return { status: 'not_found' };
    }

    const rows = (data ?? []) as DbBillingTaxRule[];
    const best = rows.find((row) => row.applies_to === appliesTo) ?? rows.find((row) => row.applies_to === 'all') ?? null;
    if (!best) return { status: 'not_found' };

    const rule = mapTaxRuleRow(best);
    cache.set(cacheKey(marketKey, appliesTo), { rule, ts: Date.now() });
    return { status: 'ok', rule };
  } catch (err) {
    console.error('tax-rules: getPublishedTaxRule threw; refusing checkout for this call:', err);
    return { status: 'not_found' };
  }
}

function mapTaxRuleRow(row: DbBillingTaxRule): TaxRuleInput {
  return {
    id: row.id,
    marketKey: row.market_key,
    appliesTo: row.applies_to,
    taxRegime: row.tax_regime,
    ratePercent: Number(row.rate_percent),
    sacCode: row.sac_code,
  };
}
