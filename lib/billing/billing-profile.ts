import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { GSTIN_REGEX, isValidIndiaStateCode } from '@/lib/billing/india-states.shared';
import type { DbBillingProfile } from '@/lib/types/database';
import type { BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): reads and writes billing_profiles
 * (migration 125). Shared between app/actions/billing-profile.ts (the customer's own profile) and
 * app/actions/pricing-checkout.ts (place of supply at checkout) so both read the exact same row
 * shape and fail closed the same way. Mirrors lib/billing/tax-rules.ts's missing-schema latch.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

function isMissingBillingProfileSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    error.code === 'PGRST200' ||
    error.code === 'PGRST204'
  );
}

let billingProfileSchemaUnavailable = false;

/** Test-only escape hatch -- the latch above is otherwise permanent for the process, matching every
 * other missing-schema latch in this codebase (a hand-applied migration needs a restart). */
export function resetBillingProfileSchemaLatchForTests(): void {
  billingProfileSchemaUnavailable = false;
}

export type BillingProfileLookupResult =
  | { status: 'ok'; profile: DbBillingProfile | null }
  | { status: 'unavailable' }; // migration 125 absent

/** Loads the caller's own billing profile, or null if they have never filled one in. */
export async function loadBillingProfile(supabase: AdminClient, userId: string): Promise<BillingProfileLookupResult> {
  if (billingProfileSchemaUnavailable) return { status: 'unavailable' };

  const result = await supabase.from('billing_profiles').select('*').eq('user_id', userId).maybeSingle();

  if (result.error) {
    if (isMissingBillingProfileSchemaError(result.error)) {
      billingProfileSchemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to load billing profile: ${result.error.message}`);
  }

  return { status: 'ok', profile: (result.data ?? null) as DbBillingProfile | null };
}

/** Returns a user-facing validation message, or null when the input is acceptable. Exported
 * separately from saveBillingProfile so a caller (or a test) can validate without a DB round trip. */
export function validateBillingProfileInput(input: BillingProfileInput): string | null {
  if (!input.legalName || !input.legalName.trim()) {
    return 'Legal name is required.';
  }
  if (!isValidIndiaStateCode(input.stateCode)) {
    return 'Please select a valid Indian state or union territory.';
  }
  if (input.gstin && !GSTIN_REGEX.test(input.gstin.trim().toUpperCase())) {
    return 'That GSTIN does not look right. It should be 15 characters, e.g. 24ACLFA8196N1ZN.';
  }
  return null;
}

export type SaveBillingProfileResult =
  | { status: 'ok'; profile: DbBillingProfile }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string };

/** Upserts the caller's billing profile (one row per user_id, per the migration's UNIQUE constraint). */
export async function saveBillingProfile(
  supabase: AdminClient,
  userId: string,
  input: BillingProfileInput
): Promise<SaveBillingProfileResult> {
  if (billingProfileSchemaUnavailable) return { status: 'unavailable' };

  const validationError = validateBillingProfileInput(input);
  if (validationError) return { status: 'invalid', message: validationError };

  const row = {
    user_id: userId,
    legal_name: input.legalName.trim(),
    billing_email: input.billingEmail?.trim() || null,
    phone: input.phone?.trim() || null,
    company_name: input.companyName?.trim() || null,
    gstin: input.gstin ? input.gstin.trim().toUpperCase() : null,
    state_code: input.stateCode,
    country_code: 'IN',
    address_line_1: input.addressLine1?.trim() || null,
    address_line_2: input.addressLine2?.trim() || null,
    city: input.city?.trim() || null,
    postal_code: input.postalCode?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const upsertResult = await supabase
    .from('billing_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (upsertResult.error) {
    if (isMissingBillingProfileSchemaError(upsertResult.error)) {
      billingProfileSchemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to save billing profile: ${upsertResult.error.message}`);
  }

  return { status: 'ok', profile: upsertResult.data as DbBillingProfile };
}
