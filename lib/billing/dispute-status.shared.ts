/**
 * Payments Phase 3: what a `payment.dispute.*` webhook actually says about the money.
 *
 * Every dispute event used to be treated identically -- order `disputed`, payment `disputed`, a
 * `billing_refunds` row `pending` -- so a dispute the merchant WON stayed marked disputed and
 * pending for good, in a record kept eight years. Razorpay debits the merchant **only if the
 * dispute is lost** (docs/payments/research/06-razorpay-capabilities.md §4), so "disputed" is a
 * state a payment must be able to leave in both directions.
 *
 * Razorpay's five dispute statuses are `open`, `under_review`, `won`, `lost` and `closed`. Only
 * `won` and `lost` carry a money outcome; `closed` is terminal but says nothing about which way it
 * went (it is used for fraud cases, after either a refund or an evidence submission), and it
 * normally ARRIVES AFTER the `won`/`lost` event that did carry the outcome.
 */

export const RAZORPAY_DISPUTE_STATUSES = ['open', 'under_review', 'won', 'lost', 'closed'] as const;
export type RazorpayDisputeStatus = (typeof RAZORPAY_DISPUTE_STATUSES)[number];

/**
 * - `open` — still being contested. Funds are not debited yet; the payment stays `disputed`.
 * - `won` — the merchant keeps the money. The reversal never happened.
 * - `lost` — the funds are debited. This is the only outcome that actually moves money.
 * - `closed` — terminal, outcome unknowable from this event alone. Deliberately NOT collapsed into
 *   `won` or `lost`: guessing would write a wrong money fact into an eight-year record. The caller
 *   leaves everything as the preceding `won`/`lost` event left it.
 */
export type DisputeResolution = 'open' | 'won' | 'lost' | 'closed';

function normalizeStatus(value: string | null | undefined): RazorpayDisputeStatus | null {
  if (!value) return null;
  const lowered = value.toLowerCase().trim();
  return (RAZORPAY_DISPUTE_STATUSES as readonly string[]).includes(lowered)
    ? (lowered as RazorpayDisputeStatus)
    : null;
}

/** `payment.dispute.lost` -> `lost`. Anything after the third segment is kept whole, so an event
 * name this codebase has never seen simply fails to normalize rather than being half-read. */
function statusFromEventName(eventName: string): RazorpayDisputeStatus | null {
  const prefix = 'payment.dispute.';
  if (!eventName.startsWith(prefix)) return null;
  const suffix = eventName.slice(prefix.length);
  // `created` is not one of the five entity statuses -- it is the event that announces an open one.
  if (suffix === 'created') return 'open';
  return normalizeStatus(suffix);
}

/**
 * Reads the dispute's outcome from the event, preferring the dispute entity's own `status` field
 * (the provider's authoritative value) and falling back to the event name.
 *
 * The two are read together rather than one overriding the other, because they can disagree in a
 * way that loses information: Razorpay may send `payment.dispute.lost` while the entity has
 * already moved to `closed`. `won`/`lost` is the informative answer in any such pair, so it wins
 * over `closed`, and `closed` in turn wins over `open` -- a dispute never re-opens. When both
 * sources somehow claim different money outcomes, the entity's own status is taken.
 *
 * Anything unrecognised reads as `open`: it keeps the payment marked disputed, which is the
 * conservative state, and never asserts a settlement that did not happen.
 */
export function resolveDisputeOutcome(
  eventName: string,
  entityStatus?: string | null
): DisputeResolution {
  const fromEntity = normalizeStatus(entityStatus);
  const fromName = statusFromEventName(eventName);

  for (const candidate of [fromEntity, fromName]) {
    if (candidate === 'won' || candidate === 'lost') return candidate;
  }
  if (fromEntity === 'closed' || fromName === 'closed') return 'closed';
  return 'open';
}
