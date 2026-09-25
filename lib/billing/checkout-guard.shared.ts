/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): owner decision P6 -- checkout refuses
 * a kids viewer profile outright, and every purchase requires the adult-payer attestation checkbox.
 * Pure and isomorphic so the server action, its route and a future client summary sheet (E2) all read
 * the same codes and wording. The gate lives here, and is called from inside
 * `prepareRazorpayCheckoutInternal` itself -- not only from the route -- because every `'use server'`
 * export is a public POST endpoint (defect 8: the now-deleted `prepareRazorpayCheckout` wrapper had no
 * caller in the repo, so a route-only gate would have been bypassable through it).
 */

export type CheckoutRefusalCode = 'kids_profile' | 'not_attested' | 'not_in_rollout';

export interface CheckoutRefusal {
  code: CheckoutRefusalCode;
  message: string;
}

export interface CheckoutAllowedInput {
  audienceMode: 'all' | 'kids';
  adultAttested: boolean;
}

/** Kids is checked first: an unattested kids profile should read "switch profiles", not "confirm
 * you're an adult", since the second is unreachable for that profile anyway. */
export function assertCheckoutAllowed(input: CheckoutAllowedInput): CheckoutRefusal | null {
  if (input.audienceMode === 'kids') {
    return { code: 'kids_profile', message: 'Switch to an adult profile to buy.' };
  }

  if (!input.adultAttested) {
    return { code: 'not_attested', message: "Please confirm you're 18 or older and the one paying." };
  }

  return null;
}

/**
 * The only error type whose `message` may render as a customer-visible string. Defect 4 (a Razorpay
 * API error or any other raw internal message must never reach a customer) means every other throw
 * inside `prepareRazorpayCheckoutInternal` is either converted to one of these at the point it is
 * raised, or left as a plain `Error` and shown only as the route's generic sentence -- never its own
 * `.message`.
 */
/**
 * Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): turns the
 * `billing_checkout_allowlist` flag's `value` column into a normalized list of user ids for
 * membership checks. The column is a plain comma-separated list, but tolerates whitespace too (a
 * newline-separated paste from a spreadsheet, stray spaces after a comma); ids are lowercased since
 * Postgres uuids compare case-insensitively by convention and this is a plain string `.includes()`,
 * not a database comparison. A blank, missing, or all-separator value parses to `[]` -- exactly what
 * migration 137 seeds (`value = ''`), which must mean "no one listed", not "everyone".
 */
export function parseCheckoutAllowlist(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export class CheckoutRefusalError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = 'CheckoutRefusalError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
