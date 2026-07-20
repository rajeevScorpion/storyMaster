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
