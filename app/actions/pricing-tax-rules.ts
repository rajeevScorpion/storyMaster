'use server';

import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import {
  archiveTaxRule,
  listBillingTaxRules,
  publishTaxRule,
  saveTaxRuleDraft,
} from '@/lib/billing/tax-rules-admin';
import type {
  PricingMarketKey,
  TaxRuleAdminListResult,
  TaxRuleAdminMutationResult,
  TaxRuleDraftInput,
} from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-unit-b2-plan.md §4, Unit B2b): thin admin-guarded
 * wrappers around lib/billing/tax-rules-admin.ts for the /admin/pricing/tax-rules panel. Kept thin
 * (verify admin, get a client, delegate) so the DB access and validation stay unit-testable without a
 * Next.js server-action context, mirroring app/actions/billing-profile.ts.
 */

export async function getPricingTaxRules(marketKey: PricingMarketKey): Promise<TaxRuleAdminListResult> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return listBillingTaxRules(supabase, marketKey);
}

export async function savePricingTaxRuleDraft(input: TaxRuleDraftInput): Promise<TaxRuleAdminMutationResult> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return saveTaxRuleDraft(supabase, input);
}

export async function publishPricingTaxRule(id: string): Promise<TaxRuleAdminMutationResult> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return publishTaxRule(supabase, id);
}

export async function archivePricingTaxRule(id: string): Promise<TaxRuleAdminMutationResult> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return archiveTaxRule(supabase, id);
}
