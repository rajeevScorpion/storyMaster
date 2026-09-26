import 'server-only';

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { parseInternationalCountries, type SupportedBillingCountryCode } from '@/lib/billing/international.shared';

/**
 * Payments Phase 8 (docs/payments/phase-8-plan.md): the countries open for international checkout
 * right now. Empty when `billing_international_countries` is off, missing (migration 138 absent) or
 * unreadable: `getFeatureFlag` falls back to false on any error, so this fails closed.
 *
 * This is not the master switch. `pricing_india_only_beta_enabled` still refuses every non-IN item
 * while it is on (assertBetaMarketAllowed in app/actions/pricing-checkout.ts).
 */
export async function getInternationalCheckoutCountries(): Promise<SupportedBillingCountryCode[]> {
  if (!(await getFeatureFlag('billing_international_countries', false))) return [];
  return parseInternationalCountries(await getFeatureFlagValue('billing_international_countries'));
}
