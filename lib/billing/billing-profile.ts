import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  normalizeIndianPhone,
  resolveBillingProfileType,
  stateCodeFromGstin,
  validateBillingProfile,
} from '@/lib/billing/billing-profile.shared';
import type { DbBillingProfile } from '@/lib/types/database';
import type { BillingProfileDTO, BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): reads and writes billing_profiles
 * (migration 125). Shared between app/actions/billing-profile.ts (the customer's own profile) and
 * app/actions/pricing-checkout.ts (place of supply at checkout) so both read the exact same row
 * shape and fail closed the same way. Mirrors lib/billing/tax-rules.ts's missing-schema latch.
 *
 * toBillingProfileDTO also lives here (not duplicated in the two 'use server' action files that
 * need it) because a 'use server' file may only export async functions -- this plain mapper has to
 * live in a plain server-only module either way, so both callers share one definition.
 *
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit B): validation itself moved to
 * lib/billing/billing-profile.shared.ts, the one authority both this file and the client dialog
 * import, so the two sides can never drift.
 */

export function toBillingProfileDTO(row: DbBillingProfile): BillingProfileDTO {
  return {
    id: row.id,
    legalName: row.legal_name ?? '',
    billingEmail: row.billing_email,
    phone: row.phone,
    companyName: row.company_name,
    gstin: row.gstin,
    profileType: row.gstin ? 'business' : 'personal',
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

/** Returns a user-facing validation message, or null when the input is acceptable. A thin wrapper
 * over lib/billing/billing-profile.shared.ts's validateBillingProfile, returning only the first of
 * its (possibly several) field errors -- kept so existing callers and tests need only a single
 * message, not the full field-level list the dialog (Unit D) will want. Exported separately from
 * saveBillingProfile so a caller (or a test) can validate without a DB round trip. */
export function validateBillingProfileInput(input: BillingProfileInput): string | null {
  const errors = validateBillingProfile(input);
  return errors.length > 0 ? errors[0].message : null;
}

export type SaveBillingProfileResult =
  | { status: 'ok'; profile: DbBillingProfile }
  | { status: 'unavailable' }
  | { status: 'invalid'; message: string };

/** Upserts the caller's billing profile (one row per user_id, per the migration's UNIQUE constraint).
 *
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit B): the row stores the normalised phone
 * (+91XXXXXXXXXX) and the upper-cased GSTIN. For a business profile the state is derived from the
 * GSTIN, not taken from the client -- validateBillingProfile already guarantees a business GSTIN's
 * state code is current, so the client's stateCode is only a fallback that should never be reached.
 * Switching to personal (or never having been business) always writes company_name/gstin as null,
 * even if the client still echoed stale values back. */
export async function saveBillingProfile(
  supabase: AdminClient,
  userId: string,
  input: BillingProfileInput
): Promise<SaveBillingProfileResult> {
  if (billingProfileSchemaUnavailable) return { status: 'unavailable' };

  const validationErrors = validateBillingProfile(input);
  if (validationErrors.length > 0) return { status: 'invalid', message: validationErrors[0].message };

  const gstinTrimmed = input.gstin?.trim().toUpperCase() || null;
  const isBusiness = resolveBillingProfileType(input) === 'business';
  const normalizedPhone = normalizeIndianPhone(input.phone);

  const row = {
    user_id: userId,
    legal_name: input.legalName.trim(),
    billing_email: input.billingEmail?.trim() || null,
    phone: normalizedPhone,
    company_name: isBusiness ? input.companyName?.trim() || null : null,
    gstin: isBusiness ? gstinTrimmed : null,
    state_code: isBusiness ? stateCodeFromGstin(gstinTrimmed) ?? input.stateCode : input.stateCode,
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
