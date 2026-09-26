import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  normalizeBillingPhone,
  resolveBillingCountryCode,
  resolveBillingProfileType,
  stateCodeFromGstin,
  validateBillingProfile,
} from '@/lib/billing/billing-profile.shared';
import { indiaStateName } from '@/lib/billing/india-states.shared';
import { usStateName } from '@/lib/billing/us-states.shared';
import {
  FOREIGN_PLACE_OF_SUPPLY_CODE,
  billingCountryName,
  isForeignBillingCountry,
} from '@/lib/billing/international.shared';
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
    // Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): `row.region` is simply absent
    // (undefined) on a database predating migration 138 -- select('*') doesn't error on a missing
    // column the way an explicit column list would, so this never needs the schema latch below.
    region: row.region ?? null,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    city: row.city,
    postalCode: row.postal_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BillingCustomerSnapshot {
  profileType: 'personal' | 'business';
  legalName: string | null;
  companyName: string | null;
  gstin: string | null;
  billingEmail: string | null;
  phone: string | null;
  stateCode: string;
  stateName: string | null;
  countryCode: string;
  /** Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): billingCountryName(countryCode). */
  countryName: string | null;
  /** A foreign customer's state/province, e.g. a US state code. Always null for an Indian profile. */
  region: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  /** The profile row's own updated_at, so a snapshot can be told apart from a later edit. */
  profileUpdatedAt: string;
  /** When this snapshot was taken (payment time), separate from profileUpdatedAt above. */
  capturedAt: string;
}

/** Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): a frozen copy of the billing profile
 * at the moment a payment is recorded -- who was actually billed, not who the profile says today.
 * Stored inside billing_payments.customer_snapshot_json (checkout writes it into
 * purchase_snapshot_json.customer first; the ledger's recordPayment then fills it in, once, via its
 * write-once guard -- see ledger.ts). `profileType` is derived the same way toBillingProfileDTO
 * derives it: 'business' iff a GSTIN is present.
 *
 * Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): stateName is the US state's name for a
 * foreign profile (its GST place-of-supply state_code is the fixed '96', which names nothing). */
export function buildCustomerSnapshot(profile: DbBillingProfile | null): BillingCustomerSnapshot | null {
  if (!profile) return null;

  const region = profile.region ?? null;
  const isForeign = isForeignBillingCountry(profile.country_code);

  return {
    profileType: profile.gstin ? 'business' : 'personal',
    legalName: profile.legal_name,
    companyName: profile.company_name,
    gstin: profile.gstin,
    billingEmail: profile.billing_email,
    phone: profile.phone,
    stateCode: profile.state_code,
    stateName: isForeign ? usStateName(region) : indiaStateName(profile.state_code),
    countryCode: profile.country_code,
    countryName: billingCountryName(profile.country_code),
    region,
    addressLine1: profile.address_line_1,
    addressLine2: profile.address_line_2,
    city: profile.city,
    postalCode: profile.postal_code,
    profileUpdatedAt: profile.updated_at,
    capturedAt: new Date().toISOString(),
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

/** Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): true once a save has proven
 * billing_profiles.region doesn't exist (migration 138 absent). Separate from the latch above on
 * purpose -- 42703/PGRST200/PGRST204 can't tell "the whole table is missing" from "one new column is
 * missing" (GOTCHAS.md "classify by the query, not by the error"), and conflating the two would mark
 * every Indian save unavailable on a database that has 125 but not yet 138. saveBillingProfile tells
 * them apart by retrying without region and seeing which one actually fails. */
let regionColumnUnavailable = false;

/** Test-only escape hatch -- the latches above are otherwise permanent for the process, matching
 * every other missing-schema latch in this codebase (a hand-applied migration needs a restart). */
export function resetBillingProfileSchemaLatchForTests(): void {
  billingProfileSchemaUnavailable = false;
  regionColumnUnavailable = false;
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
 * even if the client still echoed stale values back.
 *
 * Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): country_code and region now come from
 * the (validated) input instead of the old hardcoded 'IN'. A foreign profile is never business
 * (validateBillingProfile already refuses a GSTIN/company name outside India) and stores GST's fixed
 * place-of-supply code '96' rather than a state. */
export async function saveBillingProfile(
  supabase: AdminClient,
  userId: string,
  input: BillingProfileInput
): Promise<SaveBillingProfileResult> {
  if (billingProfileSchemaUnavailable) return { status: 'unavailable' };

  const validationErrors = validateBillingProfile(input);
  if (validationErrors.length > 0) return { status: 'invalid', message: validationErrors[0].message };

  const countryCode = resolveBillingCountryCode(input.countryCode);
  const isForeign = isForeignBillingCountry(countryCode);

  const gstinTrimmed = input.gstin?.trim().toUpperCase() || null;
  const isBusiness = !isForeign && resolveBillingProfileType(input) === 'business';
  const normalizedPhone = normalizeBillingPhone(input.phone, countryCode);
  const region = isForeign ? input.region?.trim().toUpperCase() || null : null;

  const baseRow = {
    user_id: userId,
    legal_name: input.legalName.trim(),
    billing_email: input.billingEmail?.trim() || null,
    phone: normalizedPhone,
    company_name: isBusiness ? input.companyName?.trim() || null : null,
    gstin: isBusiness ? gstinTrimmed : null,
    state_code: isForeign
      ? FOREIGN_PLACE_OF_SUPPLY_CODE
      : isBusiness
        ? stateCodeFromGstin(gstinTrimmed) ?? input.stateCode
        : input.stateCode,
    country_code: countryCode,
    address_line_1: input.addressLine1?.trim() || null,
    address_line_2: input.addressLine2?.trim() || null,
    city: input.city?.trim() || null,
    postal_code: input.postalCode?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const runUpsert = (includeRegion: boolean) =>
    supabase
      .from('billing_profiles')
      .upsert(includeRegion ? { ...baseRow, region } : baseRow, { onConflict: 'user_id' })
      .select('*')
      .single();

  let upsertResult = await runUpsert(!regionColumnUnavailable);

  if (upsertResult.error && !regionColumnUnavailable && isMissingBillingProfileSchemaError(upsertResult.error)) {
    // Could be the whole table (125 absent) or just the region column (138 absent) -- retry without
    // region before concluding the whole table is unavailable, per the latch comment above.
    const retryResult = await runUpsert(false);
    if (!retryResult.error) regionColumnUnavailable = true;
    upsertResult = retryResult;
  }

  if (upsertResult.error) {
    if (isMissingBillingProfileSchemaError(upsertResult.error)) {
      billingProfileSchemaUnavailable = true;
      return { status: 'unavailable' };
    }
    throw new Error(`Failed to save billing profile: ${upsertResult.error.message}`);
  }

  return { status: 'ok', profile: upsertResult.data as DbBillingProfile };
}
