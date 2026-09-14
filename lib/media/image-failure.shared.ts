// Pure, isomorphic. Reader-safe image generation failure text -- never a raw provider
// name, model name, or provider error body. See docs/text-model-thinking-plan.md Phase A
// item 6. There is no single image gateway (unlike text -- see text-gateway/types.shared.ts),
// so this is applied where readers receive the text rather than at the point of failure.
// Job and batch tables keep the raw provider text for ops; this constant is what a reader
// (and `beats.image_error`) ever sees.

export const IMAGE_FAILURE_MESSAGE = 'Image generation failed. Please try again.';

/** `raw` present (non-null, non-undefined) becomes the generic constant; absent stays absent. */
export function readerSafeImageError(raw: string | null | undefined): string | undefined {
  return raw != null ? IMAGE_FAILURE_MESSAGE : undefined;
}
