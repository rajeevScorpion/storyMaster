/**
 * Payments Phase 8 (docs/payments/phase-8-plan.md): the US on Razorpay International. Pure and
 * isomorphic, shared by checkout (the country gate), the billing-details form and the wallet.
 *
 * Two lists, on purpose:
 * - SUPPORTED_BILLING_COUNTRIES is what the code can handle at all (validation, tax, documents).
 *   Adding a country here is a code change.
 * - The `billing_international_countries` flag's value is what is open for sale today. It can only
 *   narrow this list, never widen it (see parseInternationalCountries).
 */

export const INDIA_COUNTRY_CODE = 'IN';

/** GST's place-of-supply code for a supply to a customer outside India ("96 - Foreign Country").
 * A foreign billing profile stores this in billing_profiles.state_code (NOT NULL). */
export const FOREIGN_PLACE_OF_SUPPLY_CODE = '96';

export const SUPPORTED_BILLING_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
] as const;

export type SupportedBillingCountryCode = (typeof SUPPORTED_BILLING_COUNTRIES)[number]['code'];

export function isSupportedBillingCountry(code: string | null | undefined): code is SupportedBillingCountryCode {
  return SUPPORTED_BILLING_COUNTRIES.some((country) => country.code === code);
}

export function billingCountryName(code: string | null | undefined): string | null {
  return SUPPORTED_BILLING_COUNTRIES.find((country) => country.code === code)?.name ?? null;
}

/** True for any supported country other than India: the customer is billed as an export. */
export function isForeignBillingCountry(code: string | null | undefined): boolean {
  return isSupportedBillingCountry(code) && code !== INDIA_COUNTRY_CODE;
}

/**
 * The flag's value as a list of ISO codes open for international checkout. Upper-cased, split on
 * commas and whitespace, and filtered to supported foreign countries: 'IN' is never "international",
 * and a code the code can't handle is dropped rather than trusted.
 */
export function parseInternationalCountries(value: string | null | undefined): SupportedBillingCountryCode[] {
  if (!value) return [];
  const codes = value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0);
  return [...new Set(codes)].filter(
    (code): code is SupportedBillingCountryCode => isForeignBillingCountry(code)
  );
}
