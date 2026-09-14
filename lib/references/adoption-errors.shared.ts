// Pure, isomorphic. Reader-safe reference adoption error text -- never a raw provider or
// storage error string. See docs/text-model-thinking-plan.md Phase A item 5.

export const REFERENCE_ADOPTION_FAILURE_MESSAGE = "We couldn't prepare this reference. Please try again.";

/** Reader-safe reference messages deliberately written for the reader (never raw
 * error text) -- kept verbatim; anything else collapses to the generic constant. */
const READER_SAFE_ADOPTION_MESSAGES: ReadonlySet<string> = new Set([
  'This upload is no longer available.',
  'Could not read the uploaded image.',
  REFERENCE_ADOPTION_FAILURE_MESSAGE,
]);

/** `raw` is returned unchanged only when it is one of the deliberate reader-safe messages
 * above; `null` stays `null`; anything else (raw provider/storage error text, including
 * historical rows) becomes the generic constant. */
export function readerSafeAdoptionError(raw: string | null): string | null {
  if (raw === null) return null;
  return READER_SAFE_ADOPTION_MESSAGES.has(raw) ? raw : REFERENCE_ADOPTION_FAILURE_MESSAGE;
}
