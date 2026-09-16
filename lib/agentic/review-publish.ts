import 'server-only';

// ── Agentic Creator System: Phase 9 reviewer publish (Unit 9e-ii, D15) ────────
//
// The one export here, publishReviewedStoryline, builds a `storylines` row for a reviewer's
// approved agent draft. It is the storyline-writing half only -- it knows nothing about
// agent_runs, agent_tasks or agent_review_decisions. app/actions/agentic-review.ts's
// publishRunAction is what gates a run's stage, calls this, and then records the
// 'published' decision (lib/agentic/review-decisions.ts's recordReviewDecision) with the
// storyline_id this function returns.
//
// D15 (docs/agentic-creator-decisions.md): the storyline is owned by the AGENTIC SYSTEM
// USER -- the story's own owner -- and authored under the PERSONA's display_name, never the
// reviewer who pressed the button. Both existing publish paths in app/actions/persistence.ts
// (publishStoryline, autoPublishStoryline) stamp the caller instead, which is wrong here for
// the same reason D13 was wrong for narration one layer down: the caller silently becomes
// the record of who did the work.
//
// WHY THIS RUNS ON THE ADMIN CLIENT, NOT autoPublishStoryline DIRECTLY. autoPublishStoryline
// is the right shape to imitate -- it derives node_path, beats and choices server-side by
// walking parent_node_id, unlike publishStoryline, which takes them as parameters an admin
// review queue has no client session to build. But autoPublishStoryline runs on
// createClient() (the session client), so its `storylines` insert is subject to RLS as
// whoever is signed in. Authenticating as the reviewer and asking that insert to land under
// AGENTIC_SYSTEM_USER_ID would be refused by the owner predicate. D14 already established the
// fix for every other reviewer write: run on the service-role client, with requireReviewer()
// (called by publishRunAction, not here) as the entire access-control boundary. This file
// never calls requireReviewer() itself -- see the header note on that in publishRunAction.
//
// THE STORYLINE FIELDS THAT MATTER FOR DISCOVERY -- age_group, genre, moderation_status,
// path_hash, and (via the is_public -> visibility trigger from migration 073) visibility --
// are built the same way publishStoryline builds them, not the way autoPublishStoryline
// does, because autoPublishStoryline predates the admin publishing switches entirely: it
// sets is_public: true unconditionally and never reads getMediaPipelineSettings() or writes
// moderation_status at all (confirmed by reading its body -- MEDIA_PIPELINE_FINAL_REVIEW.md
// even names this as a known gap: "autoPublishStoryline untouched"). A reviewer publish must
// not bypass an admin's global publishing switch just because the caller is staff, so this
// function reads getMediaPipelineSettings() itself rather than inheriting autoPublishStoryline's
// silence on it.
//
// publicPublishingEnabled is the flag that gates this function; unlistedSharingEnabled is
// publishStoryline's per-request 'unlisted' visibility option and has no bearing here -- a
// reviewer publish always targets 'public' (there is no "publish this agent draft unlisted"
// concept in the plan or in D15), so it is deliberately never read.
//
// COVER IMAGE (GOTCHAS: every beat image is a 2x2 storyboard grid, and the grid must never
// reach a viewer). This function does NOT crop anything itself. It passes `beats` -- and
// `coverImageUrl: null`, since there is no client-side copy-to-public-bucket step to run it
// through -- to finalizeStorylineShareAssets (app/actions/storyline-covers.ts), the exact
// function both existing publish paths already call, unmodified, to produce share_cover_url.
// That function's own fallback (resolveFallbackBeatImageUrl) already reads beats[1]'s (or
// beats[0]'s) raw image_url, flags it isStoryboard via isStoryboardBeat, and crops to panel 0
// via getStoryboardSharePanelSourceCrop(0) before uploading -- verified by reading its body,
// not assumed. storylines.cover_image_url itself is left null; per GOTCHAS's own account of
// this field ("every other cover source is beat artwork -- always crop") and
// app/actions/gallery.ts's getPreferredStorylineCoverUrl / resolveCurrentBeatCoverUrls, a
// missing cover_image_url is resolved live from the same beats[1]-or-beats[0] convention at
// read time, and whatever the gallery does resolve there is signed and treated as croppable
// beat artwork, never as an already-composed poster. Reusing the existing pipeline here means
// this function carries no cropping logic of its own to drift from GOTCHAS's rule.
//
// saved_storylines (Trap #3 in the Phase 9 brief): autoPublishStoryline auto-saves the newly
// published storyline to the CALLER's saved_storylines row. This function deliberately does
// NOT insert one for anybody. Not for the reviewer -- Trap #3 is explicit that a reviewer
// publishing someone else's draft must not have it silently land in their own saved list.
// Not for the system user either: saved_storylines only gates a per-viewer bookmark icon
// (app/storyline/[id]/page.tsx reads it filtered to the CURRENT session's own user_id), and
// nothing ever signs in as AGENTIC_SYSTEM_USER_ID to view that icon, so a row there would be
// write-only dead data with no reader. Skipping it is a correctness choice, not an oversight.
//
// SERIES FIELDS (series_id/episode_number/series_title). autoPublishStoryline resolves these
// from stories.episode_branch_id via resolveStorylineSeriesFields, a helper that reads
// episode_branches -- owner-only RLS, GOTCHAS notes it is read here only because publishing is
// an authorized write-time context. Verified by grep across lib/agentic/: nothing under it
// ever sets stories.episode_branch_id -- that column belongs entirely to the human "continue
// as a new episode" flow in app/actions/episodes.ts, which the agentic pipeline never calls.
// An agent-owned story's series fields are therefore always the NO_SERIES shape, and this
// function hardcodes that instead of importing a helper typed for the session client to
// resolve a case that cannot occur on this path.
//
// PATH_HASH COLLISION (Trap #5). A 23505 on the storylines insert is handled exactly like
// both existing paths: treated as a concurrent-publish race, not a crash -- the existing row
// is looked up by path_hash and its id returned. The same shape also covers a reviewer
// double-clicking Publish, or the network retrying a slow request.
//
// ENDING BEAT (Trap #4). Unlike autoPublishStoryline, which takes endingNodeId as a
// parameter from a client that already knows the reader's current node, there is no reader
// session here -- the ending must be derived from the story's own beats. findEndingNodeId
// below is STRUCTURAL (a leaf in the parent_node_id graph: a beat nothing else points at as
// its parent), not a filter on beats.is_ending. That is deliberate: D9 established that the
// 'evaluated' stage never blocks a run, so a run can reach 'awaiting_review' with an
// 'ending_missing' verdict and no beat marked is_ending at all -- a reviewer publishing such a
// draft anyway is their call to make, not this function's to silently override by refusing to
// find an ending. More than one leaf (an actual branch) is genuinely ambiguous and fails
// loudly, per Trap #4 -- current agent-generated stories are linear chains by construction
// (every evaluation.shared.ts check assumes exactly one is_ending beat at the end of a single
// sequence), so this is defensive, not a case verified to occur today.

import { createAdminClient } from '@/lib/supabase/admin';
import { finalizeStorylineShareAssets } from '@/app/actions/storyline-covers';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { normalizeStoredAgeGroup } from '@/lib/ai/story-audience';
import { normalizeStoredGenre } from '@/lib/story/genres';
import { normalizeStoryEffectConfig } from '@/lib/story-effects/settings';
import { getStorylinePublishModes } from '@/lib/story/publish-modes';
import { readerSafeImageError } from '@/lib/media/image-failure.shared';
import {
  getStoryOrientation,
  isMissingAdditiveColumnError,
  withoutAdditiveColumns,
  ADDITIVE_STORYLINE_COLUMNS,
  computePathHash,
  walkPathToRoot,
} from '@/lib/story/save-story';
import type { DbBeat } from '@/lib/types/database';
import type { StoryBeat } from '@/lib/types/story';
import type { StorylineChoice } from '@/lib/utils/storyline';

export interface PublishReviewedStorylineResult {
  storylineId: string;
  alreadyPublished: boolean;
}

/**
 * Structural ending-beat detection: a leaf is a beat no other beat names as its
 * parent_node_id. See this file's header (ENDING BEAT) for why this is structural rather
 * than an is_ending filter, and why more than one leaf must fail rather than guess.
 */
function findEndingNodeId(beats: DbBeat[]): string {
  if (beats.length === 0) {
    throw new Error('This story has no beats yet; there is nothing to publish.');
  }

  const parentIds = new Set(
    beats.map((beat) => beat.parent_node_id).filter((id): id is string => Boolean(id))
  );
  const leaves = beats.filter((beat) => !parentIds.has(beat.node_id));

  if (leaves.length === 0) {
    // Only reachable with a cycle in parent_node_id, which nothing in this codebase can
    // produce (beats are appended one at a time, each pointing at an already-existing
    // parent) -- fail loudly rather than let walkPathToRoot spin.
    throw new Error(
      `Could not find an ending beat for story ${beats[0]?.story_id ?? '(unknown)'}: every beat has a child, which should be impossible.`
    );
  }
  if (leaves.length > 1) {
    throw new Error(
      `This story has ${leaves.length} possible endings (nodes: ${leaves.map((beat) => beat.node_id).join(', ')}). ` +
        'Publish cannot guess which branch to use -- resolve the ambiguity before publishing.'
    );
  }

  return leaves[0].node_id;
}

function resolveAgenticSystemUserId(): string {
  const systemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
  if (!systemUserId) {
    throw new Error(
      'AGENTIC_SYSTEM_USER_ID is not set; there is no system account to own the published storyline.'
    );
  }
  return systemUserId;
}

/**
 * Field-for-field the same StoryBeat shape autoPublishStoryline/publishStoryline write into
 * storylines.beats (the legacy JSONB snapshot kept for backward compatibility). Duplicated
 * rather than shared: it is a pure data reshape with no business logic to drift, and it is
 * already duplicated once between those two 'use server' functions in persistence.ts, which
 * cannot export it for a third caller to import (house rule: a 'use server' file may only
 * export async functions).
 */
function toLegacyBeat(
  beat: DbBeat,
  storyConfig: ReturnType<typeof normalizeStoryConfig>
): Record<string, unknown> {
  return {
    title: beat.title,
    beatNumber: beat.beat_number,
    isEnding: beat.is_ending,
    storyText: beat.story_text,
    sceneSummary: beat.scene_summary,
    options: beat.options,
    characters: beat.characters,
    continuityNotes: beat.continuity_notes,
    imagePrompt: beat.image_prompt,
    clues: beat.clues,
    nextBeatGoal: beat.next_beat_goal,
    endingForecast: beat.ending_forecast,
    imageUrl: beat.image_url,
    imageStatus: beat.image_status,
    imageError: readerSafeImageError(beat.image_error),
    audioUrl: beat.audio_url,
    audioStatus: beat.audio_status,
    audioError: beat.audio_error || undefined,
    narrationVoiceId: beat.narration_voice_id || undefined,
    narrationMetadata: beat.narration_metadata as StoryBeat['narrationMetadata'] | undefined,
    activeNarrationPreviewId: beat.active_narration_preview_id || undefined,
    isStoryboard: beat.is_storyboard || undefined,
    reelCaptions: Array.isArray(beat.reel_captions) ? (beat.reel_captions as StoryBeat['reelCaptions']) : undefined,
    storyboardNarrationTiming: beat.storyboard_narration_timing || undefined,
    storyTextOverlayEnabled: typeof beat.story_text_overlay_enabled === 'boolean'
      ? beat.story_text_overlay_enabled
      : storyConfig.storyTextOverlay.enabled,
    storyTextOverlayMode: beat.story_text_overlay_mode || storyConfig.storyTextOverlay.mode,
    storyTextOverlayStyle: beat.story_text_overlay_style || storyConfig.storyTextOverlay.style,
    storyTextOverlayCaptions: Array.isArray(beat.story_text_overlay_captions)
      ? (beat.story_text_overlay_captions as StoryBeat['storyTextOverlayCaptions'])
      : undefined,
    storyTextOverlayAlignment: beat.story_text_overlay_alignment || undefined,
    storyEffects: beat.story_effects ? normalizeStoryEffectConfig(beat.story_effects) : undefined,
    reelTextOverlayEnabled: storyConfig.reel.textOverlayEnabled,
    reelTextOverlayStyle: storyConfig.reel.textOverlayStyle,
    originKind: (beat.origin_kind as StoryBeat['originKind'] | null) || undefined,
    seedPlanBeatIndex: beat.seed_plan_beat_index || undefined,
    canonicalOptionId: beat.canonical_option_id || undefined,
  };
}

/**
 * Builds (or reuses, per Trap #5) the `storylines` row for a reviewer's approved agent
 * draft, owned by AGENTIC_SYSTEM_USER_ID and authored under the persona's display_name.
 * Does NOT check requireReviewer()/canPublish(), does NOT check the run's stage, and does
 * NOT record an agent_review_decisions row -- all three are publishRunAction's job
 * (app/actions/agentic-review.ts), which calls this only after both are satisfied and
 * records the 'published' decision (with this function's returned storylineId) afterward.
 * See this file's header for the full set of decisions embedded here (D15, Traps #1-#5).
 */
export async function publishReviewedStoryline(storyId: string): Promise<PublishReviewedStorylineResult> {
  const systemUserId = resolveAgenticSystemUserId();

  // Admin gating (Trap #2): respect the same global switch publishStoryline respects,
  // before touching anything else. unlistedSharingEnabled is deliberately not read -- see
  // this file's header.
  const pipelineSettings = await getMediaPipelineSettings();
  if (!pipelineSettings.publicPublishingEnabled) {
    throw new Error('Public publishing is currently disabled by the admin.');
  }

  const admin = createAdminClient();

  const { data: story, error: storyError } = await admin
    .from('stories')
    .select('id, title, story_config, story_kind, is_vertical_story, aspect_ratio, genre, agent_persona_id')
    .eq('id', storyId)
    .maybeSingle();
  if (storyError) throw new Error(`Failed to fetch story ${storyId}: ${storyError.message}`);
  if (!story) throw new Error(`Story ${storyId} was not found.`);
  if (!story.agent_persona_id) {
    throw new Error(`Story ${storyId} is not agent-owned (agent_persona_id is null); refusing to publish it as an agent draft.`);
  }

  const { data: personaRow, error: personaError } = await admin
    .from('agent_personas')
    .select('display_name')
    .eq('id', story.agent_persona_id as string)
    .maybeSingle();
  if (personaError) throw new Error(`Failed to fetch persona ${story.agent_persona_id}: ${personaError.message}`);
  const authorName = (personaRow?.display_name as string | undefined)?.trim();
  if (!authorName) {
    throw new Error(`Persona ${story.agent_persona_id} has no display_name; refusing to publish with no author name.`);
  }

  const { data: beatRows, error: beatsError } = await admin
    .from('beats')
    .select('*')
    .eq('story_id', storyId);
  if (beatsError) throw new Error(`Failed to fetch beats for story ${storyId}: ${beatsError.message}`);
  const beats = (beatRows ?? []) as DbBeat[];

  const endingNodeId = findEndingNodeId(beats);
  const nodePath = walkPathToRoot(beats, endingNodeId);
  if (nodePath.length === 0) {
    throw new Error(`Could not walk story ${storyId}'s ending beat back to its root.`);
  }

  const pathHash = await computePathHash(nodePath);

  // Trap #5: a path already published for this story is a normal, expected outcome (a
  // race between two reviewers, a double-click, or a retried request) -- reuse it rather
  // than erroring. Unlike autoPublishStoryline's own "already published" branch, this does
  // NOT refresh the existing row's content: that branch exists there to keep a human
  // author's re-publish of an edited story current, but nothing on the reviewer path lets
  // a story be edited and re-approved under the SAME run, so there is nothing to refresh
  // from -- a second publish attempt here is only ever the race described above, not a
  // deliberate re-publish of changed content.
  const { data: existing } = await admin
    .from('storylines')
    .select('id')
    .eq('story_id', storyId)
    .eq('path_hash', pathHash)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { storylineId: existing.id, alreadyPublished: true };
  }

  const beatsMap = new Map<string, DbBeat>();
  for (const beat of beats) beatsMap.set(beat.node_id, beat);

  const choices: StorylineChoice[] = [];
  for (let i = 1; i < nodePath.length; i++) {
    const currentBeat = beatsMap.get(nodePath[i]);
    const parentBeat = beatsMap.get(nodePath[i - 1]);
    if (currentBeat?.selected_option_id && parentBeat?.options) {
      const options = parentBeat.options as unknown as { id: string; label: string }[];
      const option = options.find((o) => o.id === currentBeat.selected_option_id);
      if (option) {
        choices.push({ fromBeat: parentBeat.beat_number, optionLabel: option.label });
      }
    }
  }

  const storyConfig = normalizeStoryConfig({
    ...((story.story_config as Record<string, unknown> | null) ?? {}),
    story_kind: story.story_kind,
    isVerticalStory: story.is_vertical_story,
    aspectRatio: story.aspect_ratio,
  });
  const orientation = getStoryOrientation(storyConfig);

  const pathBeats = nodePath.map((nodeId) => beatsMap.get(nodeId)).filter((beat): beat is DbBeat => Boolean(beat));
  const legacyBeats = pathBeats.map((beat) => toLegacyBeat(beat, storyConfig));
  const publishModes = getStorylinePublishModes(storyConfig, 'standard', legacyBeats);

  const storylineRow = {
    story_id: storyId,
    user_id: systemUserId,
    title: story.title,
    beat_count: nodePath.length,
    // No client-side cover copy exists on this path -- finalizeStorylineShareAssets below
    // resolves share_cover_url from `beats` itself, and the gallery resolves a missing
    // cover_image_url live from the same beats[1]-or-beats[0] convention. See this file's
    // header (COVER IMAGE).
    cover_image_url: null,
    is_vertical_story: orientation.isVerticalStory,
    aspect_ratio: orientation.aspectRatio,
    story_kind: storyConfig.storyKind,
    story_format: publishModes.storyFormat,
    story_visual_mode: publishModes.storyVisualMode,
    orientation: publishModes.orientation,
    node_path: nodePath,
    beats: legacyBeats,
    choices: choices as unknown as Record<string, unknown>[],
    age_group: normalizeStoredAgeGroup(storyConfig.ageGroup),
    genre: normalizeStoredGenre(story.genre),
    // See this file's header (SERIES FIELDS) -- an agent-owned story never has
    // episode_branch_id set, so this is always NO_SERIES rather than a resolved value.
    series_id: null,
    episode_number: null,
    series_title: null,
    author_name: authorName,
    is_public: true,
    published_at: new Date().toISOString(),
    moderation_status: pipelineSettings.moderationRequiredForPublic ? 'pending' : 'none',
    path_hash: pathHash,
  };

  let storylineId: string | null = null;
  const { data: inserted, error: insertError } = await admin
    .from('storylines')
    .insert(storylineRow)
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: dup } = await admin
        .from('storylines')
        .select('id')
        .eq('path_hash', pathHash)
        .maybeSingle();
      if (dup) {
        return { storylineId: dup.id, alreadyPublished: true };
      }
    }
    if (isMissingAdditiveColumnError(insertError, 'storylines')) {
      const { data: fallbackInserted, error: fallbackError } = await admin
        .from('storylines')
        .insert(withoutAdditiveColumns(storylineRow, ADDITIVE_STORYLINE_COLUMNS))
        .select('id')
        .single();
      if (fallbackError || !fallbackInserted) {
        throw new Error(`Failed to publish storyline for story ${storyId}: ${fallbackError?.message || insertError.message}`);
      }
      storylineId = fallbackInserted.id;
    } else {
      throw new Error(`Failed to publish storyline for story ${storyId}: ${insertError.message}`);
    }
  }

  storylineId = storylineId ?? inserted?.id ?? null;
  if (!storylineId) {
    throw new Error(`Failed to publish storyline for story ${storyId}: missing inserted storyline id.`);
  }
  const publishedStorylineId = storylineId;

  const junctionRows = nodePath.map((nodeId, index) => {
    const beat = beatsMap.get(nodeId);
    const choiceForThisBeat = index > 0 ? choices[index - 1] : undefined;
    return {
      storyline_id: publishedStorylineId,
      beat_id: beat!.id,
      position: index,
      choice_label: choiceForThisBeat?.optionLabel || null,
    };
  });
  const { error: junctionError } = await admin.from('storyline_beats').insert(junctionRows);
  if (junctionError) {
    // Non-fatal, matching both existing publish paths: the storyline row is the durable
    // record, and the junction table is a denormalized index onto it.
    console.error('Failed to create storyline_beats (non-fatal):', junctionError.message);
  }

  // Deliberately no saved_storylines write here -- see this file's header
  // (saved_storylines).

  await finalizeStorylineShareAssets({
    storylineId: publishedStorylineId,
    storyId,
    userId: systemUserId,
    title: story.title,
    authorName,
    coverImageUrl: null,
    beats: legacyBeats as unknown as StoryBeat[],
    storyFormat: publishModes.storyFormat,
    storyVisualMode: publishModes.storyVisualMode,
    orientation: publishModes.orientation,
  });

  return { storylineId: publishedStorylineId, alreadyPublished: false };
}
