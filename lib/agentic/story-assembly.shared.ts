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
 * This must be a SHARED constant, not two independently-typed literals, for
 * exactly one reason: evaluation.shared.ts's beat-length bounds check is
 * keyed to this same value to decide whether that check applies at all. If
 * the generator's literal ever drifted from the evaluator's, the evaluator
 * would silently start grading verbatim source prose against a word band
 * again -- the false positive this constant exists to prevent.
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
