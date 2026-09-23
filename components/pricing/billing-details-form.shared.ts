import { indiaStateName } from '@/lib/billing/india-states.shared';
import { isValidGstinWithChecksum, stateCodeFromGstin } from '@/lib/billing/billing-profile.shared';
import type { BillingProfileDTO, BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit D): the pure form logic behind the
 * redesigned billing-details dialog, split out of the component so it can be unit tested without a
 * DOM. The repo has no @testing-library/react or jsdom/happy-dom environment (checked
 * package.json and vitest.config.ts), so BillingDetailsDialog.tsx stays a thin consumer of these
 * functions rather than carrying this logic inline.
 */

export type BillingProfileType = 'personal' | 'business';

export interface BillingDetailsFormState {
  profileType: BillingProfileType;
  legalName: string;
  billingEmail: string;
  phone: string;
  companyName: string;
  gstin: string;
  stateCode: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
}

export function emptyBillingDetailsForm(): BillingDetailsFormState {
  return {
    profileType: 'personal',
    legalName: '',
    billingEmail: '',
    phone: '',
    companyName: '',
    gstin: '',
    stateCode: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    postalCode: '',
  };
}

/**
 * The form's starting values whenever the dialog opens: mirrors the saved profile, or an empty
 * Personal form for a first-time saver. `fallbackEmail` is the signed-in user's account email
 * (from the client auth context) -- used only when the profile itself has no billing email yet, so
 * the field isn't blank for someone who has never filled it in.
 */
export function billingDetailsFormFromProfile(
  profile: BillingProfileDTO | null,
  fallbackEmail?: string | null
): BillingDetailsFormState {
  if (!profile) {
    return { ...emptyBillingDetailsForm(), billingEmail: fallbackEmail?.trim() ?? '' };
  }

  return {
    profileType: profile.profileType,
    legalName: profile.legalName ?? '',
    billingEmail: profile.billingEmail ?? fallbackEmail?.trim() ?? '',
    phone: profile.phone ?? '',
    companyName: profile.companyName ?? '',
    gstin: profile.gstin ?? '',
    stateCode: profile.stateCode ?? '',
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city ?? '',
    postalCode: profile.postalCode ?? '',
  };
}

/** Whether the Business-only section (company legal name, GSTIN) should render. A named function
 * rather than an inline `profileType === 'business'` check in the component, so the toggle's effect
 * is covered by a unit test in the absence of a DOM-rendering test setup. */
export function isBusinessProfileType(profileType: BillingProfileType): boolean {
  return profileType === 'business';
}

export interface BusinessStateResult {
  stateCode: string | null;
  stateName: string | null;
}

/** The state a Business profile's GSTIN determines, once it passes the checksum -- both null while
 * the GSTIN is incomplete, malformed, or carries a retired state code (stateCodeFromGstin already
 * excludes those). The dialog shows this as a locked field with a "From your GSTIN" caption; until
 * it resolves, the field shows no value rather than a stale or guessed one. */
export function resolveBusinessState(gstin: string): BusinessStateResult {
  const trimmed = gstin.trim().toUpperCase();
  if (!isValidGstinWithChecksum(trimmed)) return { stateCode: null, stateName: null };
  const stateCode = stateCodeFromGstin(trimmed);
  return { stateCode, stateName: stateCode ? indiaStateName(stateCode) : null };
}

/**
 * Builds the server payload from the form's raw strings. Under Personal, companyName and gstin are
 * always sent null -- never whatever a prior Business session left sitting in those fields -- per
 * Unit B's review: a stale company name surviving the switch fails validateBillingProfile's
 * Personal rules ("Switch to Business to add a GSTIN") and keeps isBillingProfileComplete false
 * forever. Under Business, stateCode is the GSTIN-derived code (or '' while it hasn't resolved yet),
 * never whatever the locked, display-only state field shows -- the server would ignore a client
 * stateCode for a business profile anyway, but sending the derived value keeps the request honest.
 */
export function buildBillingProfileInput(form: BillingDetailsFormState): BillingProfileInput {
  const isBusiness = isBusinessProfileType(form.profileType);
  const trimmedGstin = form.gstin.trim().toUpperCase();
  const derivedStateCode = isBusiness ? resolveBusinessState(trimmedGstin).stateCode : null;

  return {
    legalName: form.legalName.trim(),
    billingEmail: form.billingEmail.trim() || null,
    phone: form.phone.trim() || null,
    companyName: isBusiness ? form.companyName.trim() || null : null,
    gstin: isBusiness ? trimmedGstin || null : null,
    profileType: form.profileType,
    stateCode: isBusiness ? derivedStateCode ?? '' : form.stateCode.trim(),
    addressLine1: form.addressLine1.trim() || null,
    addressLine2: form.addressLine2.trim() || null,
    city: form.city.trim() || null,
    postalCode: form.postalCode.trim() || null,
  };
}
