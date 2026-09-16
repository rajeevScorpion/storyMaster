// Pure identity-binding helper for reference images. No I/O, no server-only
// deps — safe to import from the client runtime, the server worker, and tests.

/**
 * Reference Personalization: map each attached reference image (in provider
 * order) to what it depicts, so the model binds identity to the right image
 * instead of guessing. `refs` MUST be the surviving, in-order list actually
 * sent to the provider (post-resolution), so the 1-based index matches the
 * image order the model receives.
 *
 * Character refs (with a name) bind identity only -- face, skin tone, build
 * and distinguishing features. Hair, clothing, age and pose come from the
 * prompt, not the reference (framework §30/§48: a reference image should
 * never freeze surface attributes a time/context change is meant to update).
 *
 * An unnamed scene ref (the previous beat's storyboard, attached per
 * shouldAttachPreviousStoryboardReference, or a refine-mode current-image
 * anchor) gets its own line so the model doesn't treat it as a full-scene
 * template: world and identity continuity only, never composition/camera/
 * pose/clothing/location. A NAMED scene ref is a world reference
 * (lib/references/direct-routing.ts's selectDirectWorldReference sets
 * `{ type: 'scene', name: world.label }`) -- it carries no per-beat
 * composition to disclaim and keeps emitting no line, exactly as before Unit
 * 5, so it is never mislabelled "the previous storyboard".
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
          : `Attached reference image ${index + 1} depicts ${ref.name.trim()} — match this exact identity: face, skin tone, build and distinguishing features. Hair, clothing, age and pose come from the prompt; style from the story.`
      );
    } else if (ref.type === 'scene' && !ref.name?.trim()) {
      // Same text in both compact and full form -- there is no compiled-prompt
      // section already covering this the way CHARACTERS covers identity.
      lines.push(
        `Attached reference image ${index + 1} is the previous storyboard: use it only for world and identity continuity; do not copy its composition, camera, poses, clothing or location.`
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
 * is never longer than the full form `buildReferenceBindingLines` can produce
 * for the same refs (character lines: compact is shorter; the scene line is
 * identical in both forms).
 */
export function estimateReferenceBindingChars(refs: Array<{ type: string; name?: string }>): number {
  return buildReferenceBindingLines(refs, { compact: true }).length;
}
