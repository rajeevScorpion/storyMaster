// Pure identity-binding helper for reference images. No I/O, no server-only
// deps — safe to import from the client runtime, the server worker, and tests.

/**
 * Reference Personalization: map each attached reference image (in provider
 * order) to the character it depicts, so the model binds identity to the right
 * image instead of guessing. Only character refs with a name emit a line; scene/
 * world refs occupy an index but carry no identity to bind. `refs` MUST be the
 * surviving, in-order list actually sent to the provider (post-resolution), so
 * the 1-based index matches the image order the model receives.
 */
export function buildReferenceBindingLines(
  refs: Array<{ type: string; name?: string }>,
  options?: { compact?: boolean }
): string {
  const lines: string[] = [];
  refs.forEach((ref, index) => {
    if (ref.type === 'character' && ref.name?.trim()) {
      // Compact form is used when the prompt compiler already carries the full
      // identity + style-lock language in its characters section, so the binding
      // line only needs to map the image index to the character (no duplication).
      lines.push(
        options?.compact
          ? `Attached reference image ${index + 1} depicts ${ref.name.trim()}.`
          : `Attached reference image ${index + 1} depicts ${ref.name.trim()} — match this exact identity (face, hair, build, distinguishing features). Render fully in the story's locked visual style; the reference defines identity, never rendering style.`
      );
    }
  });
  return lines.join('\n');
}

/**
 * Upper-bound character cost of the binding lines a reference list will
 * produce, using the compact form (the form the compiled engine sends — see
 * `buildReferenceBindingLines`'s `compact` option). Callers reserve this many
 * characters from the compiler's budget (Unit 4b) so the assembled prompt
 * plus its binding lines never exceed `PROMPT_HARD_MAX_CHARS`. Safe as an
 * upper bound even before reference resolution: the surviving, in-order list
 * actually sent is always a subset of the planned list passed here (dropped
 * references only shorten the real lines), and the compact form this counts
 * is always the shorter of the two forms `buildReferenceBindingLines` can
 * produce.
 */
export function estimateReferenceBindingChars(refs: Array<{ type: string; name?: string }>): number {
  return buildReferenceBindingLines(refs, { compact: true }).length;
}
