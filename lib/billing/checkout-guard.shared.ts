/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): owner decision P6 -- checkout refuses
 * a kids viewer profile outright, and every purchase requires the adult-payer attestation checkbox.
 * Pure and isomorphic so the server action, its route and a future client summary sheet (E2) all read
 * the same codes and wording. The gate lives here, and is called from inside
 * `prepareRazorpayCheckoutInternal` itself -- not only from the route -- because every `'use server'`
 * export is a public POST endpoint (defect 8: the now-deleted `prepareRazorpayCheckout` wrapper had no
 * caller in the repo, so a route-only gate would have been bypassable through it).
 */

export type CheckoutRefusalCode = 'kids_profile' | 'not_attested';

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
