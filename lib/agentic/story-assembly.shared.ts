// Pure half of the headless seed-story assembly (Phase 6).
//
// The server half (story-assembly.ts) needs a live Supabase client and paid model
// calls, so it cannot be unit tested in this repo. Everything that can be decided
// without I/O lives here instead, for one specific reason: the node linking below
// is what publish extraction walks (lib/utils/storyline.ts follows parentId and
// selectedOptionId to pull a linear path out of the branch tree). A wrong link does
// not throw -- it produces a draft that reads correctly in the editor and then
// publishes as the wrong sequence, or as nothing at all. That failure is silent,
// which is exactly why this logic is pure and tested rather than buried in the
// server module.
//
// Node construction deliberately reuses createStoryMap/addChildNode from
// lib/utils/story-map.ts rather than building StoryNode literals here, so an agent
// story is assembled by the same code the browser store uses. If the shape of a
// node ever changes, this module inherits the change instead of drifting from it.

import type { SeedBeatOutline, SeedPlan, SourceFidelity, StoryBeat, StoryMap } from '@/lib/types/story';
import { addChildNode, createStoryMap } from '@/lib/utils/story-map';

// ── Source fidelity ──────────────────────────────────────────────────────

/**
 * The agentic pipeline always generates at strict fidelity: every seeded run
 * is built with sourceFidelity 'strictly_follow' (buildSeededStoryConfig and
 * the generateSeedPlanPreview call, both in story-assembly.ts), which makes
 * beat storyText verbatim source prose copied segment-for-segment rather than
 * model-authored text -- see lib/ai/seed-authoring.ts, where
 * strictSourceSegments is spliced straight into the plan's storyText and
 * validatePlan deliberately skips its own word-count check in this mode,
 * because there is nothing to validate: the text is the author's, not the
 * model's, to fit a band.
 *
 * It is one constant rather than two literals so that the story config and
 * the seed-plan call cannot drift from each other: they must describe the
 * same generation, and seed-authoring.ts branches on this value twice (the
 * strictSourceSegments split, and validatePlan's skip).
 *
 * evaluation.shared.ts also exempts strictly-followed prose from its
 * beat-length band, but it deliberately does NOT read this constant -- it
 * compares against the 'strictly_follow' literal directly. That exemption is
 * a property of the fidelity mode, not of whatever mode this pipeline
 * happens to use, so changing THIS value must not reach in and switch a
 * grader's check off. See the comment on that check for the failure it
 * avoids.
 */
export const AGENTIC_SOURCE_FIDELITY: SourceFidelity = 'strictly_follow';

/** Raised when the materialized beats cannot form a valid canonical chain. */
export class SeededStoryMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeededStoryMapError';
  }
}

/**
 * Link materialized canonical beats into a StoryMap.
 *
 * A seeded story is a single canonical path: beat N hangs off beat N-1 via the
 * option beat N-1 marked canonical. materializeSeededBeat() sets that as
 * `canonicalOptionId` (falling back to the first option, and leaving it undefined
 * on an ending beat), so a missing id on a non-final beat means the beat came back
 * malformed -- with no options at all, or flagged as an ending mid-story.
 *
 * We throw rather than guessing a link. Guessing produces a story that looks fine
 * in the editor and is wrong at publish time; throwing fails the run loudly with
 * the beat number attached, and the caller's checkpoint means a retry does not
 * re-pay for the beats already generated.
 */
export function buildSeededStoryMap(beats: StoryBeat[]): StoryMap {
  if (beats.length === 0) {
    throw new SeededStoryMapError('Cannot build a story map from zero beats.');
  }

  let map = createStoryMap(beats[0]);
  let parentId = map.rootNodeId;

  for (let index = 1; index < beats.length; index += 1) {
    const parent = beats[index - 1];
    const optionId = parent.canonicalOptionId;

    if (!optionId) {
      throw new SeededStoryMapError(
        parent.isEnding
          ? `Beat ${parent.beatNumber} is marked as an ending but ${beats.length - index} beat(s) follow it.`
          : `Beat ${parent.beatNumber} has no canonical option to link beat ${beats[index].beatNumber} to.`
      );
    }

    map = addChildNode(map, parentId, optionId, beats[index]);
    parentId = map.currentNodeId;
  }

  return map;
}

/** The seed beat for a 1-based beat index, or undefined when the plan does not cover it. */
export function getSeedBeatByIndex(seedPlan: SeedPlan | undefined, beatIndex: number): SeedBeatOutline | undefined {
  return seedPlan?.beats.find((beat) => beat.beatIndex === beatIndex);
}

// ── Novelty re-brief: what to avoid on the next attempt ─────────────────
//
// A pre-generation novelty 'block' (story-assembly.ts's runNoveltyStage) clears
// the run's cached brief and re-generates one rather than replaying a verdict
// that cannot change (see that file's header). Each re-brief needs to know
// what already collided -- its OWN just-rejected title, plus the prior
// stories it collided with -- so the model has an actual chance of writing
// something different next time, and that list must ACCUMULATE across
// attempts: attempt 3 must avoid what attempts 1 *and* 2 produced, not just
// the most recent one.

/**
 * Cap on the accumulated avoid-list carried in a run's checkpoint across its
 * re-brief attempts. MAX_RUN_ATTEMPTS (3) means at most two re-briefs, each
 * contributing its own rejected title plus however many colliding priors
 * scoreNovelty's topCandidates reported (that array is already capped at 5) --
 * so two attempts could in principle offer up to 12 titles. This bound exists
 * purely so the list actually handed to a prompt stays small and predictable
 * regardless of that, rather than trusting an upstream cap never to change.
 */
export const NOVELTY_AVOID_LIST_MAX_ENTRIES = 8;

/**
 * Merges newly-rejected titles into an accumulated avoid-list: dedupes
 * case-insensitively (the same story should not be named twice because its
 * title was reported with different casing on two attempts) and caps the
 * result at NOVELTY_AVOID_LIST_MAX_ENTRIES.
 *
 * `additions` are placed BEFORE `existing` -- the freshest collision is the
 * most specific, most actionable signal for the very next brief, so if the
 * cap ever has to drop something, it drops the oldest entry first rather than
 * the one just learned. Blank/whitespace-only titles are filtered out rather
 * than surfaced as empty avoid-list entries.
 */
export function mergeNoveltyAvoidTitles(existing: string[], additions: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const title of [...additions, ...existing]) {
    const trimmed = typeof title === 'string' ? title.trim() : '';
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged.slice(0, NOVELTY_AVOID_LIST_MAX_ENTRIES);
}

/**
 * Intra-stage progress for the story_generated stage, persisted into
 * agent_runs.checkpoint after every completed beat.
 *
 * story_generated makes roughly 2N+2 paid model calls for an N-beat story (one
 * prose write, one seed plan, then a materialize and a storyboard plan per beat).
 * Without this, a crash at beat 5 of 8 makes a retry re-pay for beats 1-4. The
 * completed beats are carried here so a resumed run rebuilds the map from them and
 * only generates what is genuinely missing.
 */
export interface SeedGenerationProgress {
  sourceText?: string;
  seedPlan?: SeedPlan;
  /** Completed beats in canonical order. Its length is the resume point. */
  completedBeats?: StoryBeat[];
}

/**
 * The 1-based index of the next beat to generate, given saved progress.
 * Returns `undefined` once every planned beat is done.
 */
export function nextBeatIndexToGenerate(
  progress: SeedGenerationProgress | undefined,
  targetBeatCount: number
): number | undefined {
  const done = progress?.completedBeats?.length ?? 0;
  return done >= targetBeatCount ? undefined : done + 1;
}
