/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): maps Razorpay's own failure
 * vocabulary to a Kissago sentence. Defect 4 -- the raw provider failure text (`error.description`,
 * or any other API error message) must never reach a customer-visible string -- so this only ever
 * reads `error.reason`, a fixed enum Razorpay documents, and never `error.description`, which is
 * free text Razorpay writes for the merchant's own debugging.
 */

export interface RazorpayCheckoutFailure {
  code?: string | null;
  reason?: string | null;
  source?: string | null;
  step?: string | null;
}

const DEFAULT_FAILURE_MESSAGE =
  "That payment didn't go through, and you haven't been charged for it. You can try again.";

const CANCELLED_MESSAGE = "You cancelled the payment. You haven't been charged.";

/** Shared by incorrect_card_details, incorrect_otp and payment_timed_out -- distinct reasons at
 * Razorpay, but the same actionable advice to the customer. */
const RETRY_DETAILS_MESSAGE =
  "That didn't go through -- please check your details and try again. You haven't been charged.";

const REASON_MESSAGES: Record<string, string> = {
  payment_cancelled: CANCELLED_MESSAGE,
  payment_dismissed: CANCELLED_MESSAGE,
  insufficient_funds: "Your bank reported insufficient funds. You haven't been charged.",
  card_declined: "Your card was declined by your bank. You haven't been charged.",
  incorrect_card_details: RETRY_DETAILS_MESSAGE,
  incorrect_otp: RETRY_DETAILS_MESSAGE,
  payment_timed_out: RETRY_DETAILS_MESSAGE,
  authentication_failed: "Your bank couldn't verify this payment. You haven't been charged.",
};

/** Never pass Razorpay's `error.description` in here -- only the fixed `reason` enum. Anything
 * unmapped (including a missing/unknown reason) gets the plan's own default sentence. */
export function describeCheckoutFailure(error: RazorpayCheckoutFailure | null | undefined): string {
  const reason = error?.reason?.trim();
  if (reason && Object.prototype.hasOwnProperty.call(REASON_MESSAGES, reason)) {
    return REASON_MESSAGES[reason];
  }
  return DEFAULT_FAILURE_MESSAGE;
}
