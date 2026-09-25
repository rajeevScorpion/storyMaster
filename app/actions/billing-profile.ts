'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { loadBillingProfile, saveBillingProfile, toBillingProfileDTO } from '@/lib/billing/billing-profile';
import { getInternationalCheckoutCountries } from '@/lib/billing/international';
import { INDIA_COUNTRY_CODE, type SupportedBillingCountryCode } from '@/lib/billing/international.shared';
import type { BillingProfileInput, GetBillingProfileResult, SaveBillingProfileResult } from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the two actions Unit B2's wallet
 * billing-details form calls. Kept thin -- all DB access and validation live in
 * lib/billing/billing-profile.ts so app/actions/pricing-checkout.ts can reuse the exact same code
 * path when it loads the profile at checkout time.
 *
 * Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): getBillingCountryOptions is the
 * dialog's one read of which countries are open today -- India always, plus whatever
 * getInternationalCheckoutCountries returns (empty while `billing_international_countries` is off).
 */

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Please sign in to manage billing details');
  }

  return user.id;
}

export async function getMyBillingProfile(): Promise<GetBillingProfileResult> {
  const userId = await getAuthenticatedUserId();
  const supabase = createAdminClient();

  const result = await loadBillingProfile(supabase, userId);
  if (result.status === 'unavailable') {
    return { status: 'unavailable' };
  }

  return { status: 'ok', profile: result.profile ? toBillingProfileDTO(result.profile) : null };
}

export async function saveMyBillingProfile(input: BillingProfileInput): Promise<SaveBillingProfileResult> {
  const userId = await getAuthenticatedUserId();
  const supabase = createAdminClient();

  const result = await saveBillingProfile(supabase, userId, input);
  if (result.status !== 'ok') {
    return result;
  }

  return { status: 'ok', profile: toBillingProfileDTO(result.profile) };
}

/** No sign-in required -- this only says which countries the billing dialog should offer, not
 * anything about the caller's own profile. */
export async function getBillingCountryOptions(): Promise<SupportedBillingCountryCode[]> {
  return [INDIA_COUNTRY_CODE, ...(await getInternationalCheckoutCountries())];
}
