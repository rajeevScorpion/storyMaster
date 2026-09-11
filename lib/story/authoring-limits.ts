// Two hardcoded word caps bound the two different things a human can type into
// the composer: SEED_SOURCE_WORD_CAP caps the pasted story (seed mode),
// STORY_PROMPT_WORD_CAP caps the typed prompt (prompt mode, and reel prompts).
// LandingScreen picks between them at its `isOverSourceWordCap`.
//
// Both are 800 today, but they are kept as separate constants deliberately --
// they bound different inputs and may need to diverge again, and one of them
// being admin-editable is exactly what made them look like a single knob in
// the first place. There is no admin control for either, by decision: a limit
// changed once a year does not need a settings panel.
//
// The `story_authoring_word_cap` feature flag (migration 024) still has a row
// in `feature_flags` on both environments -- deliberately not deleted, since
// removing it needs a migration and buys nothing -- but nothing reads it
// anymore. A value in that row has no effect; don't "fix" the prompt cap by
// editing it.
//
// Agent personas are exempt from SEED_SOURCE_WORD_CAP entirely: their source
// prose is machine generated to the persona's own beat-length range, and a
// fixed ceiling on top of a per-scene word target is a contradiction. See
// SeedPlanPreviewInput.enforceSourceWordCap in lib/ai/seed-authoring.ts.
export const SEED_SOURCE_WORD_CAP = 800;
export const STORY_PROMPT_WORD_CAP = 800;
export const SEED_GUIDANCE_WORD_CAP = 150;

export function countAuthoringWords(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}
