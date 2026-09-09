export const DEFAULT_STORY_AUTHORING_WORD_CAP = 500;
// Caps the SEED SOURCE TEXT a human pastes into the composer (seed mode).
//
// NOT the same limit as the `story_authoring_word_cap` feature flag (migration
// 024, editable in Global Settings), which caps the PROMPT in prompt mode.
// LandingScreen picks between the two at its `isOverWordCap`: seed mode reads
// this constant, prompt mode reads that flag. They are separate limits on
// separate inputs that happened to share the value 500 until this change, and
// the admin setting's generic "authoring" label makes them easy to confuse --
// raising the flag does nothing to seed source, and raising this does nothing
// to the prompt.
//
// Agent personas are not subject to this at all: their source prose is machine
// generated to the persona's own beat-length range, and a fixed ceiling on top
// of a per-scene word target is a contradiction. See
// SeedPlanPreviewInput.enforceSourceWordCap in lib/ai/seed-authoring.ts.
export const SEED_SOURCE_WORD_CAP = 800;
export const SEED_GUIDANCE_WORD_CAP = 150;

export function countAuthoringWords(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}
