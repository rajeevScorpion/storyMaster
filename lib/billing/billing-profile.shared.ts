import { GSTIN_REGEX, isValidIndiaStateCode } from '@/lib/billing/india-states.shared';
import type { BillingProfileDTO, BillingProfileInput } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit B): the one validation authority for a
 * billing profile, imported by both the client dialog (Unit D) and the server
 * (lib/billing/billing-profile.ts). Pure and isomorphic -- no server-only, no DB import -- so a
 * 'use client' component can import it directly. Before this unit, the rules lived only in
 * lib/billing/billing-profile.ts's validateBillingProfileInput and were far looser (legal name and a
 * state code were the only requirements, and the GSTIN check was shape-only). That function is now a
 * thin wrapper over validateBillingProfile below, kept for existing callers' sake.
 */

const GSTIN_CHECKSUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Accepts an Indian mobile number in any of the forms a customer is likely to type or paste --
 * spaces, dashes and parentheses are stripped first -- and returns it normalised to
 * '+91XXXXXXXXXX', or null when it doesn't parse as one. A bare 10-digit number, one with a leading
 * '0' (11 digits total), a leading '91' (12 digits total) or a leading '+91' are all accepted; the
 * remaining 10 digits must start with 6-9, matching Indian mobile numbering.
 */
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let digits: string;
  if (cleaned.startsWith('+91')) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    return null; // a non-'+91' country code
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    digits = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    digits = cleaned.slice(1);
  } else {
    digits = cleaned;
  }

  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** A 6-digit Indian postal code: first digit 1-9 (no PIN region starts with 0). */
export function isValidPin(pin: string | null | undefined): boolean {
  if (!pin) return false;
  return /^[1-9][0-9]{5}$/.test(pin.trim());
}

/** A pragmatic single-'@' check -- not RFC 5322. Rejects whitespace, more or fewer than one '@', an
 * empty local part, and a domain with no '.' or one at either end. */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;

  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local) return false;
  if (!domain || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;

  return true;
}

/** The GSTIN's 15th character: a mod-36 checksum over the first 14. Verified against Kissago's own
 * LEGAL_GSTIN (lib/legal/business-config.ts) and a second known-good GSTIN -- see
 * billing-profile.shared.test.ts. `first14` is assumed to already match GSTIN_REGEX's shape; this is
 * only ever called after that check. */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHECKSUM_CHARSET.indexOf(first14[i]);
    const p = value * (i % 2 === 1 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHECKSUM_CHARSET[(36 - (sum % 36)) % 36];
}

/** GSTIN_REGEX (india-states.shared.ts) only checks the shape and accepts a typo in the checksum
 * character; this also verifies it, so a single mistyped digit is caught before it reaches the DB. */
export function isValidGstinWithChecksum(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const normalized = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(normalized)) return false;
  return normalized[14] === gstinCheckDigit(normalized.slice(0, 14));
}

/** The state code a GSTIN declares, i.e. its first two characters, if that code is one a NEW profile
 * may declare today (india-states.shared.ts's INDIA_GST_STATE_CODES). Retired codes (25, 28) and
 * anything else unrecognised return null -- the caller shows "This GSTIN's state code isn't a
 * current one. Please contact support." This only reads the first two characters; it does not itself
 * require the whole GSTIN to pass its checksum. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const code = gstin.trim().toUpperCase().slice(0, 2);
  return isValidIndiaStateCode(code) ? code : null;
}

/**
 * A soft PIN-code <-> state hint: 'ok', 'mismatch' or 'unknown', never blocking. Deliberately ships
 * returning 'unknown' for every input. A conservative PIN-prefix -> state table (grouping prefixes
 * that legitimately span more than one state, so it only warns on a clear mismatch) needs sourcing
 * reliably from India Post's circle list, which this unit does not attempt -- an invented table risks
 * a false "mismatch" on a real address, which is worse than no hint. Revisit once a reliable source
 * is confirmed; do not hardcode a guessed table here.
 */
export function pinStateHint(
  _pin: string | null | undefined,
  _stateCode: string | null | undefined
): 'ok' | 'mismatch' | 'unknown' {
  return 'unknown';
}

export interface BillingProfileFieldError {
  field: keyof BillingProfileInput;
  message: string;
}

const SWITCH_TO_BUSINESS_MESSAGE = 'Switch to Business to add a GSTIN.';

/** `profileType` defaults to 'business' iff a GSTIN is present, so an old client that never sends the
 * field still validates (and saves) correctly. Shared by validateBillingProfile and
 * lib/billing/billing-profile.ts's saveBillingProfile so the two never disagree on which type an
 * input resolves to. */
export function resolveBillingProfileType(
  input: Pick<BillingProfileInput, 'profileType' | 'gstin'>
): 'personal' | 'business' {
  const gstinTrimmed = input.gstin?.trim() ?? '';
  return input.profileType ?? (gstinTrimmed ? 'business' : 'personal');
}

/**
 * The required-field set per owner decision P1 (phase-5-owner-requirements.md §1c, confirmed in
 * phase-5-plan.md §3). Returns one entry per failing field -- empty when the profile is complete and
 * consistent for its type.
 *
 * Business's stateCode is derived from the GSTIN and is never itself validated here: the server
 * overrides whatever the client sent (lib/billing/billing-profile.ts's saveBillingProfile), so a
 * stale or mismatched client-side stateCode is not an error.
 */
export function validateBillingProfile(input: BillingProfileInput): BillingProfileFieldError[] {
  const errors: BillingProfileFieldError[] = [];

  const gstinTrimmed = input.gstin?.trim() ?? '';
  const companyNameTrimmed = input.companyName?.trim() ?? '';
  const profileType = resolveBillingProfileType(input);

  if (!input.legalName || !input.legalName.trim()) {
    errors.push({ field: 'legalName', message: 'Full name is required.' });
  }

  if (!input.billingEmail || !input.billingEmail.trim()) {
    errors.push({ field: 'billingEmail', message: 'Billing email is required.' });
  } else if (!isValidEmail(input.billingEmail)) {
    errors.push({ field: 'billingEmail', message: "That email address doesn't look right." });
  }

  if (!input.phone || !input.phone.trim()) {
    errors.push({ field: 'phone', message: 'Phone number is required.' });
  } else if (!normalizeIndianPhone(input.phone)) {
    errors.push({ field: 'phone', message: 'Enter a valid 10-digit Indian mobile number.' });
  }

  if (!input.city || !input.city.trim()) {
    errors.push({ field: 'city', message: 'City is required.' });
  }

  if (!input.postalCode || !input.postalCode.trim()) {
    errors.push({ field: 'postalCode', message: 'Postal code is required.' });
  } else if (!isValidPin(input.postalCode)) {
    errors.push({ field: 'postalCode', message: 'Enter a valid 6-digit PIN code.' });
  }

  if (profileType === 'business') {
    if (!input.addressLine1 || !input.addressLine1.trim()) {
      errors.push({ field: 'addressLine1', message: 'Address line 1 is required for a business profile.' });
    }
    if (!companyNameTrimmed) {
      errors.push({ field: 'companyName', message: 'Company legal name is required for a business profile.' });
    }
    if (!gstinTrimmed) {
      errors.push({ field: 'gstin', message: 'GSTIN is required for a business profile.' });
    } else if (!isValidGstinWithChecksum(gstinTrimmed)) {
      errors.push({
        field: 'gstin',
        message: 'That GSTIN does not look right. It should be 15 characters, e.g. 24ACLFA8196N1ZN.',
      });
    } else if (!stateCodeFromGstin(gstinTrimmed)) {
      errors.push({ field: 'gstin', message: "This GSTIN's state code isn't a current one. Please contact support." });
    }
  } else {
    if (!isValidIndiaStateCode(input.stateCode)) {
      errors.push({ field: 'stateCode', message: 'Please select a valid Indian state or union territory.' });
    }
    if (gstinTrimmed) {
      errors.push({ field: 'gstin', message: SWITCH_TO_BUSINESS_MESSAGE });
    }
    if (companyNameTrimmed) {
      errors.push({ field: 'companyName', message: SWITCH_TO_BUSINESS_MESSAGE });
    }
  }

  return errors;
}

function billingProfileDtoToInput(profile: BillingProfileDTO): BillingProfileInput {
  return {
    legalName: profile.legalName,
    billingEmail: profile.billingEmail,
    phone: profile.phone,
    companyName: profile.companyName,
    gstin: profile.gstin,
    profileType: profile.profileType,
    stateCode: profile.stateCode,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    postalCode: profile.postalCode,
  };
}

/** The P7 gate: a saved profile is "complete" only once it satisfies validateBillingProfile for its
 * own type, not merely "has a state" (the old rule). Used by the wallet and by checkout to decide
 * whether the billing dialog must reopen before payment. */
export function isBillingProfileComplete(profile: BillingProfileDTO | null): boolean {
  if (!profile) return false;
  return validateBillingProfile(billingProfileDtoToInput(profile)).length === 0;
}
