'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { loadBillingProfile, saveBillingProfile } from '@/lib/billing/billing-profile';
import type { DbBillingProfile } from '@/lib/types/database';
import type { BillingProfileDTO, BillingProfileInput, GetBillingProfileResult, SaveBillingProfileResult } from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the two actions Unit B2's wallet
 * billing-details form calls. Kept thin -- all DB access and validation live in
 * lib/billing/billing-profile.ts so app/actions/pricing-checkout.ts can reuse the exact same code
 * path when it loads the profile at checkout time.
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

function toBillingProfileDTO(row: DbBillingProfile): BillingProfileDTO {
  return {
    id: row.id,
    legalName: row.legal_name ?? '',
    billingEmail: row.billing_email,
    phone: row.phone,
    companyName: row.company_name,
    gstin: row.gstin,
    stateCode: row.state_code,
    countryCode: row.country_code,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    city: row.city,
    postalCode: row.postal_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
