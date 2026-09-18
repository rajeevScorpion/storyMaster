import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingBillingTaxSchemaError } from '@/lib/billing/tax-rules';
import { isValidIndiaStateCode } from '@/lib/billing/india-states.shared';
import type { DbBillingTaxRule } from '@/lib/types/database';
import {
  BILLING_TAX_REGIMES,
  BILLING_TAX_RULE_APPLIES_TO,
  PRICING_MARKET_KEYS,
  type PricingMarketKey,
  type TaxRuleAdminListResult,
  type TaxRuleAdminMutationResult,
  type TaxRuleAdminRecord,
  type TaxRuleDraftInput,
} from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-unit-b2-plan.md §4, Unit B2b): admin CRUD over
 * billing_tax_rules (migration 125) for the /admin/pricing/tax-rules panel. Every exported function
 * takes the admin Supabase client as a parameter (not `createAdminClient()` internally) so tests can
 * pass a mocked client, matching lib/billing/billing-profile.ts and lib/billing/razorpay-sync.ts.
 *
 * publishTaxRule/archiveTaxRule audit through pricing_publish_audit directly (not
 * app/actions/pricing-admin.ts's insertPricingAudit, whose entity_type union and hard-throw-on-error
 * behaviour serve five entity types that predate this one) -- see recordTaxRuleAudit below. Migration
 * 128 (unapplied as of this writing) is what lets entity_type 'tax_rule' past
 * pricing_publish_audit's CHECK (015_pricing_catalog.sql:88); until then the audit write raises 23514
 * on every call, which recordTaxRuleAudit swallows on purpose. Publish/archive ordering below still
 * protects uq_billing_tax_rules_live regardless of whether the audit row lands.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

let schemaUnavailable = false;

/**
 * Records a publish/archive audit row for a tax rule -- fail-soft on purpose, unlike every other
 * pricing entity's audit write. On a database without migration 128, entity_type 'tax_rule' raises
 * 23514 against pricing_publish_audit's CHECK; a rate change must still go through unaudited rather
 * than be blocked by a table it doesn't yet know about. Any other error (including the audit table
 * itself being absent) is swallowed the same way, for the same reason -- a broken audit trail must
 * never block a tax-rule publish/archive. Once 128 is applied, the insert simply starts succeeding;
 * no further code change is needed.
 */
async function recordTaxRuleAudit(
  supabase: AdminClient,
  input: {
    entityId: string;
    actionType: 'publish' | 'archive';
    performedBy: string;
    beforeJson: unknown;
    afterJson: unknown;
  }
): Promise<void> {
  const { error } = await supabase.from('pricing_publish_audit').insert({
    entity_type: 'tax_rule',
    entity_id: input.entityId,
    action_type: input.actionType,
    performed_by: input.performedBy,
    before_json: (input.beforeJson ?? null) as Record<string, unknown> | null,
    after_json: (input.afterJson ?? null) as Record<string, unknown> | null,
  });

  if (error) {
    console.error('[tax-rules-admin] audit write skipped', {
      actionType: input.actionType,
      entityId: input.entityId,
      code: error.code,
      message: error.message,
    });
  }
}

/** Test-only escape hatch -- mirrors every other missing-schema latch in this codebase (a
 * hand-applied migration needs a process restart, so the latch is otherwise permanent). */
export function resetTaxRuleAdminSchemaLatchForTests(): void {
  schemaUnavailable = false;
}

function isTaxRuleUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

function normalizeText(value?: string | null): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function mapTaxRuleAdminRow(row: DbBillingTaxRule): TaxRuleAdminRecord {
  return {
    id: row.id,
    marketKey: row.market_key,
    appliesTo: row.applies_to,
    taxRegime: row.tax_regime,
    ratePercent: Number(row.rate_percent),
    sacCode: row.sac_code,
    supplierStateCode: row.supplier_state_code,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Returns a user-facing validation message, or null when the input is acceptable. Exported
 * separately so a test can validate without a DB round trip, mirroring validateBillingProfileInput. */
export function validateTaxRuleDraftInput(input: TaxRuleDraftInput): string | null {
  if (!PRICING_MARKET_KEYS.includes(input.marketKey)) {
    return 'Market is invalid.';
  }
  if (!BILLING_TAX_RULE_APPLIES_TO.includes(input.appliesTo)) {
    return 'Applies-to is invalid.';
  }
  if (!BILLING_TAX_REGIMES.includes(input.taxRegime)) {
    return 'Tax regime is invalid.';
  }
  if (!Number.isFinite(input.ratePercent) || input.ratePercent < 0 || input.ratePercent > 100) {
    return 'Rate must be a number between 0 and 100.';
  }
  if (!isValidIndiaStateCode(input.supplierStateCode)) {
    return 'Supplier state must be a valid Indian state or union territory code.';
  }
  return null;
}

async function getTaxRuleById(
  supabase: AdminClient,
  id: string
): Promise<{ status: 'ok'; rule: DbBillingTaxRule | null } | { status: 'unavailable' }> {
  if (schemaUnavailable) return { status: 'unavailable' };

  const { data, error } = await supabase.from('billing_tax_rules').select('*').eq('id', id).limit(1);

  if (error) {
    if (isMissingBillingTaxSchemaError(error)) {
      schemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to load tax rule: ${error.message}`);
  }

  return { status: 'ok', rule: ((data ?? []) as DbBillingTaxRule[])[0] ?? null };
}

/** Every rule for a market, all statuses, newest first within each (applies_to, status) bucket --
 * the panel groups drafts/published/archived by applies_to itself. */
export async function listBillingTaxRules(
  supabase: AdminClient,
  marketKey: PricingMarketKey
): Promise<TaxRuleAdminListResult> {
  if (schemaUnavailable) return { status: 'unavailable' };

  const { data, error } = await supabase
    .from('billing_tax_rules')
    .select('*')
    .eq('market_key', marketKey)
    .order('applies_to', { ascending: true })
    .order('status', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingBillingTaxSchemaError(error)) {
      schemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to load tax rules: ${error.message}`);
  }

  return { status: 'ok', rules: ((data ?? []) as DbBillingTaxRule[]).map(mapTaxRuleAdminRow) };
}

/** Creates a new draft (`input.id` absent) or updates an existing one (`input.id` present -- must
 * already be a draft; a published or archived row cannot be edited in place). */
export async function saveTaxRuleDraft(
  supabase: AdminClient,
  input: TaxRuleDraftInput
): Promise<TaxRuleAdminMutationResult> {
  if (schemaUnavailable) return { status: 'unavailable' };

  const validationError = validateTaxRuleDraftInput(input);
  if (validationError) return { status: 'invalid', message: validationError };

  const timestamp = new Date().toISOString();
  const payload = {
    market_key: input.marketKey,
    applies_to: input.appliesTo,
    tax_regime: input.taxRegime,
    rate_percent: input.ratePercent,
    sac_code: normalizeText(input.sacCode),
    supplier_state_code: input.supplierStateCode,
    notes: normalizeText(input.notes),
    status: 'draft' as const,
    updated_at: timestamp,
  };

  let result: { data: unknown; error: { code?: string; message: string } | null };

  if (input.id) {
    const existing = await getTaxRuleById(supabase, input.id);
    if (existing.status === 'unavailable') return { status: 'unavailable' };
    if (!existing.rule) return { status: 'invalid', message: 'Tax rule draft not found.' };
    if (existing.rule.status !== 'draft') {
      return {
        status: 'invalid',
        message: 'Only a draft can be edited. Archive the published rule and start a new draft instead.',
      };
    }

    result = await supabase.from('billing_tax_rules').update(payload).eq('id', input.id).select('*').single();
  } else {
    result = await supabase.from('billing_tax_rules').insert(payload).select('*').single();
  }

  if (result.error || !result.data) {
    if (isMissingBillingTaxSchemaError(result.error)) {
      schemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to save tax rule draft: ${result.error?.message || 'unknown error'}`);
  }

  const rulesResult = await listBillingTaxRules(supabase, input.marketKey);
  return {
    status: 'ok',
    rule: mapTaxRuleAdminRow(result.data as DbBillingTaxRule),
    rules: rulesResult.status === 'ok' ? rulesResult.rules : [],
  };
}

/**
 * Publishes a draft. Mirrors publishPricingTopupPack (app/actions/pricing-admin.ts): refuses a
 * non-draft, then -- if a rule is already published for the same (market_key, applies_to) with no
 * effective_to -- archives that incumbent FIRST, because uq_billing_tax_rules_live only allows one
 * such row at a time and raises 23505 if the archive happens second or not at all.
 */
export async function publishTaxRule(
  supabase: AdminClient,
  id: string,
  performedBy: string
): Promise<TaxRuleAdminMutationResult> {
  const draftResult = await getTaxRuleById(supabase, id);
  if (draftResult.status === 'unavailable') return { status: 'unavailable' };

  const draft = draftResult.rule;
  if (!draft) return { status: 'invalid', message: 'Tax rule not found.' };
  if (draft.status !== 'draft') return { status: 'invalid', message: 'Only a draft tax rule can be published.' };

  const { data: incumbentRows, error: incumbentError } = await supabase
    .from('billing_tax_rules')
    .select('*')
    .eq('market_key', draft.market_key)
    .eq('applies_to', draft.applies_to)
    .eq('status', 'published')
    .is('effective_to', null);

  if (incumbentError) {
    if (isMissingBillingTaxSchemaError(incumbentError)) {
      schemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to check for an existing published tax rule: ${incumbentError.message}`);
  }

  const incumbent = ((incumbentRows ?? []) as DbBillingTaxRule[])[0] ?? null;
  const timestamp = new Date().toISOString();

  if (incumbent && incumbent.id !== draft.id) {
    const { error: archiveError } = await supabase
      .from('billing_tax_rules')
      .update({ status: 'archived', effective_to: timestamp, updated_at: timestamp })
      .eq('id', incumbent.id);

    if (archiveError) {
      throw new Error(`Failed to archive the current published tax rule: ${archiveError.message}`);
    }

    await recordTaxRuleAudit(supabase, {
      entityId: incumbent.id,
      actionType: 'archive',
      performedBy,
      beforeJson: incumbent,
      afterJson: { ...incumbent, status: 'archived', effective_to: timestamp, updated_at: timestamp },
    });
  }

  const { data: publishedData, error: publishError } = await supabase
    .from('billing_tax_rules')
    .update({ status: 'published', updated_at: timestamp })
    .eq('id', draft.id)
    .select('*')
    .single();

  if (publishError || !publishedData) {
    if (isTaxRuleUniqueViolation(publishError)) {
      return {
        status: 'conflict',
        message: 'Another rule was just published for this market and kind. Refresh and try again.',
      };
    }
    if (isMissingBillingTaxSchemaError(publishError)) {
      schemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to publish tax rule: ${publishError?.message || 'unknown error'}`);
  }

  await recordTaxRuleAudit(supabase, {
    entityId: draft.id,
    actionType: 'publish',
    performedBy,
    beforeJson: draft,
    afterJson: publishedData,
  });

  const rulesResult = await listBillingTaxRules(supabase, draft.market_key as PricingMarketKey);
  return {
    status: 'ok',
    rule: mapTaxRuleAdminRow(publishedData as DbBillingTaxRule),
    rules: rulesResult.status === 'ok' ? rulesResult.rules : [],
  };
}

/** Archives a rule (draft or published). A no-op success when it is already archived, matching
 * archivePricingTopupPack. Leaving the last published rule for a (market_key, applies_to) archived
 * is deliberate -- getPublishedTaxRule then returns 'not_found' and checkout refuses rather than
 * silently charging the net (plan §4). */
export async function archiveTaxRule(
  supabase: AdminClient,
  id: string,
  performedBy: string
): Promise<TaxRuleAdminMutationResult> {
  const existingResult = await getTaxRuleById(supabase, id);
  if (existingResult.status === 'unavailable') return { status: 'unavailable' };

  const existing = existingResult.rule;
  if (!existing) return { status: 'invalid', message: 'Tax rule not found.' };

  if (existing.status === 'archived') {
    const rulesResult = await listBillingTaxRules(supabase, existing.market_key as PricingMarketKey);
    return {
      status: 'ok',
      rule: mapTaxRuleAdminRow(existing),
      rules: rulesResult.status === 'ok' ? rulesResult.rules : [],
    };
  }

  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from('billing_tax_rules')
    .update({ status: 'archived', effective_to: existing.effective_to ?? timestamp, updated_at: timestamp })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    if (isMissingBillingTaxSchemaError(error)) {
      schemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to archive tax rule: ${error?.message || 'unknown error'}`);
  }

  await recordTaxRuleAudit(supabase, {
    entityId: id,
    actionType: 'archive',
    performedBy,
    beforeJson: existing,
    afterJson: data,
  });

  const rulesResult = await listBillingTaxRules(supabase, existing.market_key as PricingMarketKey);
  return {
    status: 'ok',
    rule: mapTaxRuleAdminRow(data as DbBillingTaxRule),
    rules: rulesResult.status === 'ok' ? rulesResult.rules : [],
  };
}
