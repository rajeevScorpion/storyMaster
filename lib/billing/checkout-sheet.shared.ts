/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the checkout summary sheet's state
 * machine, pulled out of CheckoutSummarySheet.tsx so its transitions are unit-tested without React or
 * a DOM. Pure: an event in, the next state out -- an event that doesn't apply to the current state is
 * simply ignored (the state is returned unchanged), so a stray or duplicated callback can never jump
 * the sheet somewhere it shouldn't be.
 *
 * The transition table is also the proof for the review focus "no path shows failed after confirming"
 * (plan §5): 'failed' is only reachable from 'verifying' and 'checking', never from 'confirming' or
 * 'still_confirming' -- see checkout-sheet.shared.test.ts.
 */

export type CheckoutSheetState =
  | 'quoting'
  | 'summary'
  | 'needs_details'
  | 'quote_error'
  | 'opening'
  | 'window'
  | 'verifying'
  | 'checking'
  | 'success'
  | 'confirming'
  | 'still_confirming'
  | 'failed';

export type CheckoutSheetEvent =
  | 'quote_ok'
  | 'quote_needs_details'
  | 'quote_error'
  | 'continue'
  | 'window_opened'
  | 'prepare_failed'
  | 'verifying'
  | 'checking'
  | 'success'
  | 'confirming'
  | 'still_confirming'
  | 'failed'
  | 'dismissed'
  | 'retry';

export function nextCheckoutSheetState(state: CheckoutSheetState, event: CheckoutSheetEvent): CheckoutSheetState {
  switch (event) {
    case 'quote_ok':
      return state === 'quoting' ? 'summary' : state;
    case 'quote_needs_details':
      return state === 'quoting' ? 'needs_details' : state;
    case 'quote_error':
      return state === 'quoting' ? 'quote_error' : state;
    case 'continue':
      return state === 'summary' ? 'opening' : state;
    // A prepare rejection (the fetch to /api/billing/razorpay/prepare itself failing or refusing)
    // returns to summary with its message shown inline, rather than a separate error screen.
    case 'prepare_failed':
      return state === 'opening' ? 'summary' : state;
    case 'window_opened':
      return state === 'opening' ? 'window' : state;
    case 'verifying':
      return state === 'window' ? 'verifying' : state;
    case 'checking':
      return state === 'window' ? 'checking' : state;
    // success and confirming both end the handler/dismiss-poll leg; a poll that later confirms
    // "confirming" is paid also raises 'success' from here, so it's included alongside verifying/checking.
    case 'success':
      return state === 'verifying' || state === 'checking' || state === 'confirming' ? 'success' : state;
    case 'confirming':
      return state === 'verifying' || state === 'checking' ? 'confirming' : state;
    case 'still_confirming':
      return state === 'confirming' ? 'still_confirming' : state;
    // 'failed' is reachable only from verifying/checking -- never from confirming or still_confirming,
    // per pollUntilPaid's own rule (checkout-status.shared.ts's isCheckoutPaid) that a pending payment
    // can only resolve to paid or still-confirming, never failed.
    case 'failed':
      return state === 'verifying' || state === 'checking' ? 'failed' : state;
    // Dismissed here means the dismiss poll timed out with no failure recorded and nothing pending --
    // the checkbox stays ticked, so the customer can just press Continue again.
    case 'dismissed':
      return state === 'checking' ? 'summary' : state;
    case 'retry':
      return state === 'failed' ? 'summary' : state;
    default:
      return state;
  }
}

/** False only while the Razorpay window (or its immediate open/verify/dismiss-check step) is live --
 * closing then would either abandon a payment mid-flight or leave the sheet unable to tell the
 * customer what happened to money that may already have moved. */
export function canCloseCheckoutSheet(state: CheckoutSheetState): boolean {
  return state !== 'opening' && state !== 'verifying' && state !== 'checking';
}
