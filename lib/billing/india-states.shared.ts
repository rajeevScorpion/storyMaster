/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the Indian GST state/UT code list
 * used to validate a billing profile's declared state (the checkout place-of-supply) and to
 * populate Unit B2's state picker, plus the GSTIN shape check. Pure and isomorphic -- no
 * server-only, no DB types -- so both the server action and the client-side form can import it.
 *
 * Codes match the GSTIN's own first two digits (CBIC's state code list). Two historical codes are
 * deliberately absent: 25 (Daman and Diu) and 28 (undivided Andhra Pradesh) were retired when
 * Daman & Diu merged into Dadra and Nagar Haveli (code 26, 2020) and Andhra Pradesh was
 * reorganised (code 37, 2014). An old GSTIN can still carry them, but a NEW billing profile must
 * never be able to select a retired code -- this list is "what a customer can declare today", not
 * "every code that has ever existed".
 */

export interface IndiaGstStateOption {
  code: string;
  name: string;
}

export const INDIA_GST_STATE_CODES: readonly IndiaGstStateOption[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
] as const;

const INDIA_GST_STATE_CODE_SET: ReadonlySet<string> = new Set(INDIA_GST_STATE_CODES.map((entry) => entry.code));

export function isValidIndiaStateCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && INDIA_GST_STATE_CODE_SET.has(code);
}

export function indiaStateName(code: string): string | null {
  return INDIA_GST_STATE_CODES.find((entry) => entry.code === code)?.name ?? null;
}

/** Identical to the CHECK constraint on billing_profiles.gstin (125_billing_ledger_and_retention.sql) --
 * keep the two in sync if either changes. 15 characters: 2-digit state code, 10-character PAN,
 * 1-digit entity code, the literal 'Z', and a checksum character. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: string | null | undefined): value is string {
  return typeof value === 'string' && GSTIN_REGEX.test(value);
}
