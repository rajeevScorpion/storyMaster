'use server';

// Pack 1 beat-control server actions: runtime feature snapshot, beat text
// editing with timeline lock, downstream wipe, options regeneration, custom
// options, and image version restore. All actions verify story ownership and
// enforce feature flags server-side (UI gating alone is not trusted).

import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag, getFeatureFlagValue, getModelConfig } from '@/lib/ai/model-config';
import { optionsRegenerationSchema } from '@/lib/ai/generation-schemas';
import { OPTIONS_REGENERATION_PROMPT } from '@/lib/ai/prompts';
import { releaseBillableAction } from '@/lib/pricing/enforcement';
import { signMixedUrls } from '@/lib/media/storage-url-signing';
import {
  findGalleryEntry,
  imageUrlsMatch,
  parseGalleryRows,
} from '@/lib/media/image-versions';
import {
  collectNamedCharactersForNode,
  findChildForOption,
  getBeatsToNode,
  getChoiceHistoryToNode,
  getDescendantNodeIds,
  removeSubtree,
} from '@/lib/utils/story-map';
import { parseCharacterMentions } from '@/lib/utils/character-mentions';
import {
  BEAT_CONTROL_FLAG_KEYS,
  BEAT_IMAGE_MAX_VERSIONS_FLAG_KEY,
  DEFAULT_BEAT_CONTROL_RUNTIME_SETTINGS,
  normalizeMaxImageVersionsPerBeat,
  type BeatControlRuntimeSettings,
} from '@/lib/beat-control/settings';
import {
  MAX_CUSTOM_OPTIONS_PER_BEAT,
  countCustomOptions,
} from '@/lib/beat-control/custom-options';
import type {
  BeatImageGalleryEntry,
  Option,
  StoryMap,
} from '@/lib/types/story';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import {
  formatAudienceBranchingContract,
  getStoryAudienceProfile,
} from '@/lib/ai/story-audience';

const MAX_BEAT_TEXT_CHARS = 4000;
const MAX_CUSTOM_OPTION_CHARS = 200;
const DEFAULT_REGENERATED_OPTION_COUNT = 3;

// ── Runtime snapshot ───────────────────────────────────────────────

export async function getBeatControlRuntimeSettings(): Promise<BeatControlRuntimeSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Anonymous readers never see beat controls.
    return DEFAULT_BEAT_CONTROL_RUNTIME_SETTINGS;
  }

  const [flags, maxVersionsRaw] = await Promise.all([
    Promise.all(BEAT_CONTROL_FLAG_KEYS.map((key) => getFeatureFlag(key, false))),
    getFeatureFlagValue(BEAT_IMAGE_MAX_VERSIONS_FLAG_KEY),
  ]);

  const [
    textEditEnabled,
    timelineRewriteEnabled,
    imageRegenEnabled,
    imageVersionHistoryEnabled,
    narrationRegenEnabled,
    optionsRegenEnabled,
    customOptionsEnabled,
    panelSuggestionsEnabled,
  ] = flags;

  return {
    textEditEnabled,
    timelineRewriteEnabled,
    imageRegenEnabled,
    imageVersionHistoryEnabled,
    narrationRegenEnabled,
    optionsRegenEnabled,
    customOptionsEnabled,
    panelSuggestionsEnabled,
    maxImageVersionsPerBeat: normalizeMaxImageVersionsPerBeat(maxVersionsRaw),
  };
}

// ── Shared internals ───────────────────────────────────────────────

class BeatControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BeatControlError';
  }
}

async function requireFeature(flagKey: string, label: string): Promise<void> {
  if (!(await getFeatureFlag(flagKey, false))) {
    throw new BeatControlError(`${label} is currently disabled.`);
  }
}

interface OwnedStoryContext {
  userId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  storyMap: StoryMap;
}

async function requireOwnedStory(storyId: string): Promise<OwnedStoryContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new BeatControlError('Not authenticated.');

  const { data: story, error } = await supabase
    .from('stories')
    .select('id, user_id, story_map')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .single();
  if (error || !story?.story_map) throw new BeatControlError('Story not found.');

  return { userId: user.id, supabase, storyMap: story.story_map as StoryMap };
}

export interface TimelineImpact {
  affectedBeatCount: number;
  affectedNodeIds: string[];
  affectedAssets: { images: number; narration: number; optionsBatches: number };
  affectsPublishedStorylines: boolean;
}

const TIMELINE_REWRITE_MESSAGE =
  'Changing this beat will rewrite the story from this point onward.\n\n' +
  'All later beats, generated images, narration, and options after this beat will be removed. ' +
  'You can then continue the story again from the updated version.\n\n' +
  'Do you want to continue?';

async function buildTimelineImpact(
  storyId: string,
  descendantNodeIds: string[]
): Promise<TimelineImpact> {
  const admin = createAdminClient();
  const [{ data: beatRows }, { count: storylineCount }] = await Promise.all([
    admin
      .from('beats')
      .select('node_id, image_url, audio_url, options')
      .eq('story_id', storyId)
      .in('node_id', descendantNodeIds),
    admin
      .from('storylines')
      .select('id', { count: 'exact', head: true })
      .eq('story_id', storyId)
      .overlaps('node_path', descendantNodeIds),
  ]);

  const rows = beatRows ?? [];
  return {
    affectedBeatCount: descendantNodeIds.length,
    affectedNodeIds: descendantNodeIds,
    affectedAssets: {
      images: rows.filter((row) => Boolean(row.image_url)).length,
      narration: rows.filter((row) => Boolean(row.audio_url)).length,
      optionsBatches: rows.filter((row) => Array.isArray(row.options) && row.options.length > 0).length,
    },
    affectsPublishedStorylines: (storylineCount ?? 0) > 0,
  };
}

/**
 * Hard-delete the descendant subtree of a node after recording an audit row.
 * Strict order: snapshot → audit → cancel jobs → remove storylines → delete
 * beats → patch story_map. A failure after the audit insert leaves the
 * snapshot available for manual recovery.
 */
async function wipeDownstreamSubtree(args: {
  userId: string;
  storyId: string;
  sourceNodeId: string;
  storyMap: StoryMap;
  reason: 'beat_text_edit' | 'options_regeneration';
}): Promise<{ rewriteEventId: string | null; wipedNodeIds: string[]; prunedMap: StoryMap }> {
  const { userId, storyId, sourceNodeId, storyMap, reason } = args;
  const wipedNodeIds = getDescendantNodeIds(storyMap, sourceNodeId);
  const prunedMap = removeSubtree(storyMap, sourceNodeId);
  if (wipedNodeIds.length === 0) {
    return { rewriteEventId: null, wipedNodeIds, prunedMap };
  }

  const admin = createAdminClient();

  // 1. Snapshot the rows that are about to disappear.
  const { data: snapshotRows } = await admin
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .in('node_id', wipedNodeIds);

  // 2. Audit row FIRST — the wipe is only allowed to proceed once the
  //    snapshot is durable.
  const { data: auditRow, error: auditError } = await admin
    .from('timeline_rewrite_events')
    .insert({
      story_id: storyId,
      user_id: userId,
      source_node_id: sourceNodeId,
      reason,
      affected_node_ids: wipedNodeIds,
      wiped_beats_snapshot: snapshotRows ?? [],
    })
    .select('id')
    .single();
  if (auditError || !auditRow) {
    throw new BeatControlError('Could not record the timeline rewrite. Nothing was changed.');
  }
  const rewriteEventId = auditRow.id as string;

  // 3. Cancel in-flight generation jobs for wiped nodes and release their
  //    billing reservations (best-effort; a missed release only over-reserves).
  const cancelledJobIds: string[] = [];
  const { data: cancelledImageJobs } = await admin
    .from('image_generation_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('story_id', storyId)
    .in('node_id', wipedNodeIds)
    .in('status', ['pending', 'processing'])
    .select('id, reservation_id, user_id');
  for (const job of cancelledImageJobs ?? []) {
    cancelledJobIds.push(job.id);
    if (job.reservation_id) {
      await releaseBillableAction({
        userId: job.user_id,
        reservationId: job.reservation_id,
        reason: 'timeline_rewrite',
      }).catch(() => {});
    }
  }

  // Narration batch jobs target whole node paths; cancel active ones whose
  // targets include a wiped node (the worker halts on cancelled status).
  const { data: activeNarrationJobs } = await admin
    .from('narration_batch_jobs')
    .select('id, node_ids')
    .eq('story_id', storyId)
    .in('status', ['pending', 'running']);
  const wipedSet = new Set(wipedNodeIds);
  for (const job of activeNarrationJobs ?? []) {
    const targets: string[] = Array.isArray(job.node_ids) ? job.node_ids : [];
    if (!targets.some((nodeId) => wipedSet.has(nodeId))) continue;
    await admin
      .from('narration_batch_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString(), error: 'timeline_rewrite' })
      .eq('id', job.id)
      .in('status', ['pending', 'running']);
    cancelledJobIds.push(job.id);
  }

  // 4. Published storylines that include a wiped node no longer describe a
  //    real path — remove them explicitly (their beat links would otherwise
  //    silently lose rows via the FK cascade).
  const { data: removedStorylines } = await admin
    .from('storylines')
    .delete()
    .eq('story_id', storyId)
    .overlaps('node_path', wipedNodeIds)
    .select('id');
  const removedStorylineIds = (removedStorylines ?? []).map((row) => row.id as string);

  // 5. Delete the descendant beats rows.
  const { error: deleteError } = await admin
    .from('beats')
    .delete()
    .eq('story_id', storyId)
    .in('node_id', wipedNodeIds);
  if (deleteError) {
    throw new BeatControlError(`Failed to remove later beats: ${deleteError.message}`);
  }

  // 6. Patch the story_map blob (source of truth for tree shape) and repoint
  //    the current node to the edited beat.
  await admin
    .from('stories')
    .update({
      story_map: prunedMap,
      current_node_id: sourceNodeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storyId);

  // 7. Backfill audit bookkeeping (best-effort).
  await admin
    .from('timeline_rewrite_events')
    .update({ removed_storyline_ids: removedStorylineIds, cancelled_job_ids: cancelledJobIds })
    .eq('id', rewriteEventId);

  return { rewriteEventId, wipedNodeIds, prunedMap };
}

// ── Beat text editing ──────────────────────────────────────────────

export type EditBeatTextResult =
  | { status: 'updated'; revisionId: string | null; rewriteEventId?: string; wipedNodeIds?: string[] }
  | { status: 'requires_confirmation'; impact: TimelineImpact; message: string }
  | { status: 'failed'; error: string };

export async function editBeatText(input: {
  storyId: string;
  nodeId: string;
  newText: string;
  confirmTimelineRewrite?: boolean;
}): Promise<EditBeatTextResult> {
  try {
    await requireFeature('beat_text_edit_enabled', 'Beat text editing');
    const newText = input.newText.trim();
    if (!newText) return { status: 'failed', error: 'Story text cannot be empty.' };
    if (newText.length > MAX_BEAT_TEXT_CHARS) {
      return { status: 'failed', error: `Story text is too long (max ${MAX_BEAT_TEXT_CHARS} characters).` };
    }

    const { userId, supabase, storyMap } = await requireOwnedStory(input.storyId);
    const node = storyMap.nodes[input.nodeId];
    if (!node) return { status: 'failed', error: 'Beat not found in this story.' };
    const previousText = node.data.storyText ?? '';
    if (previousText === newText) return { status: 'updated', revisionId: null };

    const descendants = getDescendantNodeIds(storyMap, input.nodeId);
    let rewriteEventId: string | undefined;
    let wipedNodeIds: string[] | undefined;
    let mapForEdit = storyMap;

    if (descendants.length > 0) {
      const rewriteEnabled = await getFeatureFlag('beat_timeline_rewrite_enabled', false);
      if (!rewriteEnabled) {
        return {
          status: 'failed',
          error: 'This beat is locked: later beats depend on it and timeline rewrite is disabled.',
        };
      }
      if (!input.confirmTimelineRewrite) {
        const impact = await buildTimelineImpact(input.storyId, descendants);
        return { status: 'requires_confirmation', impact, message: TIMELINE_REWRITE_MESSAGE };
      }
      const wipe = await wipeDownstreamSubtree({
        userId,
        storyId: input.storyId,
        sourceNodeId: input.nodeId,
        storyMap,
        reason: 'beat_text_edit',
      });
      rewriteEventId = wipe.rewriteEventId ?? undefined;
      wipedNodeIds = wipe.wipedNodeIds;
      mapForEdit = wipe.prunedMap;
    }

    // Apply the edit to both persistence halves: beats row first (durable
    // source of truth), then the story_map blob. Derived text artifacts
    // (4-part split, narration overlay timing) are cleared — they no longer
    // match the text; audio/image stay until the user regenerates them.
    // Admin client: ownership was verified above, and the beats RLS update
    // policy keys on generated_by which can differ from the story owner.
    const admin = createAdminClient();
    const { error: beatUpdateError } = await admin
      .from('beats')
      .update({
        story_text: newText,
        story_text_overlay_captions: null,
        story_text_overlay_alignment: null,
      })
      .eq('story_id', input.storyId)
      .eq('node_id', input.nodeId);
    if (beatUpdateError) {
      return { status: 'failed', error: `Failed to save the new text: ${beatUpdateError.message}` };
    }
    const patchedMap: StoryMap = {
      ...mapForEdit,
      nodes: {
        ...mapForEdit.nodes,
        [input.nodeId]: {
          ...mapForEdit.nodes[input.nodeId],
          data: {
            ...mapForEdit.nodes[input.nodeId].data,
            storyText: newText,
            storyTextParts: undefined,
            storyTextOverlayCaptions: undefined,
            storyTextOverlayAlignment: undefined,
          },
        },
      },
    };
    await admin
      .from('stories')
      .update({ story_map: patchedMap, updated_at: new Date().toISOString() })
      .eq('id', input.storyId);

    // Revision row via the RLS client (owner INSERT policy).
    const { data: revision } = await supabase
      .from('beat_revisions')
      .insert({
        story_id: input.storyId,
        node_id: input.nodeId,
        user_id: userId,
        previous_text: previousText,
        new_text: newText,
        rewrite_event_id: rewriteEventId ?? null,
      })
      .select('id')
      .single();

    return {
      status: 'updated',
      revisionId: (revision?.id as string | undefined) ?? null,
      ...(rewriteEventId ? { rewriteEventId } : {}),
      ...(wipedNodeIds && wipedNodeIds.length > 0 ? { wipedNodeIds } : {}),
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to edit the beat.',
    };
  }
}

// ── Options regeneration ───────────────────────────────────────────

export type RegenerateBeatOptionsResult =
  | { status: 'updated'; options: Option[] }
  | { status: 'requires_confirmation'; impact: TimelineImpact; message: string }
  | { status: 'failed'; error: string };

function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

export async function regenerateBeatOptions(input: {
  storyId: string;
  nodeId: string;
  confirmTimelineRewrite?: boolean;
}): Promise<RegenerateBeatOptionsResult> {
  try {
    await requireFeature('beat_options_regen_enabled', 'Options regeneration');
    const { userId, supabase, storyMap } = await requireOwnedStory(input.storyId);
    const node = storyMap.nodes[input.nodeId];
    if (!node) return { status: 'failed', error: 'Beat not found in this story.' };

    const descendants = getDescendantNodeIds(storyMap, input.nodeId);
    let mapForUpdate = storyMap;
    if (descendants.length > 0) {
      // A chosen option already shaped the later story. Regenerating options
      // rewrites the path, so it goes through the same confirmation + wipe.
      const rewriteEnabled = await getFeatureFlag('beat_timeline_rewrite_enabled', false);
      if (!rewriteEnabled) {
        return {
          status: 'failed',
          error: 'Options for this beat already shaped the later story and cannot be regenerated.',
        };
      }
      if (!input.confirmTimelineRewrite) {
        const impact = await buildTimelineImpact(input.storyId, descendants);
        return {
          status: 'requires_confirmation',
          impact,
          message:
            'Options for this beat already shaped the later story. Regenerating them will rewrite the story from this point onward.\n\n' +
            'All later beats, generated images, narration, and options after this beat will be removed.\n\nDo you want to continue?',
        };
      }
      const wipe = await wipeDownstreamSubtree({
        userId,
        storyId: input.storyId,
        sourceNodeId: input.nodeId,
        storyMap,
        reason: 'options_regeneration',
      });
      mapForUpdate = wipe.prunedMap;
    }

    // Build the options-only prompt from the linear path context.
    const beats = getBeatsToNode(storyMap, input.nodeId);
    const choices = getChoiceHistoryToNode(storyMap, input.nodeId);
    const characters = collectNamedCharactersForNode(storyMap, input.nodeId);
    const storyContext = beats
      .slice(0, -1)
      .map((beat, index) => `Beat ${index + 1}: ${beat.sceneSummary || beat.storyText}`)
      .join('\n') || '(this is the first beat)';

    const { data: storyRow } = await supabase
      .from('stories')
      .select('tone, genre, target_age, story_config')
      .eq('id', input.storyId)
      .single();
    const storyConfig = normalizeStoryConfig(
      (storyRow?.story_config as Record<string, unknown> | null) ?? {
        ageGroup: storyRow?.target_age,
      }
    );
    const audienceProfile = getStoryAudienceProfile(storyConfig.ageGroup);
    const regeneratedOptionCount = audienceProfile.optionCount === '3_or_4'
      ? 4
      : DEFAULT_REGENERATED_OPTION_COUNT;
    const audience = [storyRow?.genre, storyRow?.tone, audienceProfile.label]
      .filter(Boolean)
      .join(', ') || 'general audience';

    const prompt = `${fillPrompt(OPTIONS_REGENERATION_PROMPT, {
      numberOfOptions: String(regeneratedOptionCount),
      storyContext,
      choiceHistory: choices.length > 0 ? choices.map((label) => `- ${label}`).join('\n') : '(none yet)',
      beatText: node.data.storyText,
      namedCharacters:
        characters.map((c) => `- ${c.name} (${c.type}): ${c.personalitySummary}`).join('\n') || '(none named yet)',
      audience,
    })}\n\n${formatAudienceBranchingContract(storyConfig.ageGroup)}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { status: 'failed', error: 'Story generation is not configured.' };
    const { model, temperature } = await getModelConfig('story_generation');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: optionsRegenerationSchema,
        temperature: temperature ?? 0.7,
      },
    });
    const raw = response.text;
    if (!raw) return { status: 'failed', error: 'No options were generated. Please try again.' };
    let parsed: { options?: Array<{ label?: string; intent?: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'failed', error: 'Generated options were malformed. Please try again.' };
    }
    const generated = (parsed.options ?? [])
      .filter((option) => option.label?.trim())
      .slice(0, regeneratedOptionCount)
      .map<Option>((option) => ({
        id: `opt_${uuidv4()}`,
        label: option.label!.trim(),
        intent: option.intent?.trim() ?? '',
        source: 'ai',
      }));
    const uniqueGeneratedLabels = new Set(generated.map((option) => option.label.toLocaleLowerCase()));
    if (generated.length !== regeneratedOptionCount || uniqueGeneratedLabels.size !== generated.length) {
      return { status: 'failed', error: 'A complete set of distinct options could not be generated. Please try again.' };
    }

    // Replace AI options, preserve user-authored custom options.
    const preservedCustom = (node.data.options ?? []).filter(
      (option) => option.source === 'user_custom'
    );
    const nextOptions = [...generated, ...preservedCustom];

    await persistNodeOptions(input.storyId, input.nodeId, nextOptions, mapForUpdate);

    return { status: 'updated', options: nextOptions };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to regenerate options.',
    };
  }
}

/** Write a node's options to both persistence halves. */
async function persistNodeOptions(
  storyId: string,
  nodeId: string,
  options: Option[],
  storyMap: StoryMap
): Promise<void> {
  const admin = createAdminClient();
  const { error: beatError } = await admin
    .from('beats')
    .update({ options })
    .eq('story_id', storyId)
    .eq('node_id', nodeId);
  if (beatError) throw new BeatControlError(`Failed to save options: ${beatError.message}`);

  const node = storyMap.nodes[nodeId];
  if (!node) return;
  const patchedMap: StoryMap = {
    ...storyMap,
    nodes: {
      ...storyMap.nodes,
      [nodeId]: { ...node, data: { ...node.data, options } },
    },
  };
  await admin
    .from('stories')
    .update({ story_map: patchedMap, updated_at: new Date().toISOString() })
    .eq('id', storyId);
}

// ── Custom options ─────────────────────────────────────────────────

export type AddCustomOptionResult =
  | { status: 'added'; option: Option }
  | { status: 'invalid_mentions'; unknownMentions: string[]; availableCharacters: string[] }
  | { status: 'failed'; error: string };

export type DeleteCustomOptionResult =
  | { status: 'deleted'; optionId: string }
  | { status: 'failed'; error: string };

export async function addCustomOption(input: {
  storyId: string;
  nodeId: string;
  optionText: string;
}): Promise<AddCustomOptionResult> {
  try {
    await requireFeature('beat_custom_options_enabled', 'Custom options');
    const optionText = input.optionText.trim().replace(/\s+/g, ' ');
    if (!optionText) return { status: 'failed', error: 'Write your choice first.' };
    if (optionText.length > MAX_CUSTOM_OPTION_CHARS) {
      return { status: 'failed', error: `Keep your choice under ${MAX_CUSTOM_OPTION_CHARS} characters.` };
    }

    const { userId, storyMap } = await requireOwnedStory(input.storyId);
    const node = storyMap.nodes[input.nodeId];
    if (!node) return { status: 'failed', error: 'Beat not found in this story.' };
    if (countCustomOptions(node.data.options) >= MAX_CUSTOM_OPTIONS_PER_BEAT) {
      return {
        status: 'failed',
        error: `You can add up to ${MAX_CUSTOM_OPTIONS_PER_BEAT} custom choices to each beat.`,
      };
    }

    const characters = collectNamedCharactersForNode(storyMap, input.nodeId);
    const parsed = parseCharacterMentions(optionText, characters.map((c) => c.name));
    if (parsed.unknownMentions.length > 0) {
      return {
        status: 'invalid_mentions',
        unknownMentions: parsed.unknownMentions,
        availableCharacters: characters.map((c) => c.name),
      };
    }

    const option: Option = {
      id: `opt_custom_${uuidv4()}`,
      label: optionText,
      intent: 'your own choice',
      source: 'user_custom',
      createdByUserId: userId,
      ...(parsed.mentions.length > 0
        ? { characterMentions: parsed.mentions.map((m) => m.characterName) }
        : {}),
    };

    await persistNodeOptions(
      input.storyId,
      input.nodeId,
      [...(node.data.options ?? []), option],
      storyMap
    );

    return { status: 'added', option };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to add your option.',
    };
  }
}

export async function deleteCustomOption(input: {
  storyId: string;
  nodeId: string;
  optionId: string;
}): Promise<DeleteCustomOptionResult> {
  try {
    await requireFeature('beat_custom_options_enabled', 'Custom options');
    const { storyMap } = await requireOwnedStory(input.storyId);
    const node = storyMap.nodes[input.nodeId];
    if (!node) return { status: 'failed', error: 'Beat not found in this story.' };

    const option = node.data.options?.find((candidate) => candidate.id === input.optionId);
    if (!option || option.source !== 'user_custom') {
      return { status: 'failed', error: 'Only your custom choices can be deleted.' };
    }
    if (findChildForOption(storyMap, input.nodeId, input.optionId)) {
      return {
        status: 'failed',
        error: 'This choice has already been explored and can no longer be deleted.',
      };
    }

    await persistNodeOptions(
      input.storyId,
      input.nodeId,
      (node.data.options ?? []).filter((candidate) => candidate.id !== input.optionId),
      storyMap
    );
    return { status: 'deleted', optionId: input.optionId };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to delete your custom choice.',
    };
  }
}

// ── Image version history ──────────────────────────────────────────

export interface BeatImageVersionView extends BeatImageGalleryEntry {
  displayUrl: string;
  isActive: boolean;
}

export async function listBeatImageVersions(input: {
  storyId: string;
  nodeId: string;
}): Promise<BeatImageVersionView[]> {
  await requireFeature('beat_image_version_history_enabled', 'Image version history');
  const { supabase } = await requireOwnedStory(input.storyId);

  const admin = createAdminClient();
  const { data: beatRow } = await admin
    .from('beats')
    .select('image_url, image_gallery')
    .eq('story_id', input.storyId)
    .eq('node_id', input.nodeId)
    .maybeSingle();
  if (!beatRow) return [];

  const gallery = parseGalleryRows(beatRow.image_gallery);
  if (gallery.length === 0) return [];

  const signed = await signMixedUrls(
    supabase,
    gallery.map((entry) => entry.url),
    'story-assets',
    3600
  );

  return gallery
    .map((entry) => ({
      ...entry,
      displayUrl: signed.get(entry.url) ?? entry.url,
      isActive: imageUrlsMatch(entry.url, beatRow.image_url),
    }))
    .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0) || b.uploadedAt.localeCompare(a.uploadedAt));
}

export type RestoreBeatImageVersionResult =
  | { status: 'restored'; imageUrl: string; displayUrl: string }
  | { status: 'failed'; error: string };

/**
 * Repoint the beat's active image to a stored version. No regeneration and
 * no new version entry — restore only changes which version is active.
 */
export async function restoreBeatImageVersion(input: {
  storyId: string;
  nodeId: string;
  storageKey: string;
}): Promise<RestoreBeatImageVersionResult> {
  try {
    await requireFeature('beat_image_version_history_enabled', 'Image version history');
    const { supabase, storyMap } = await requireOwnedStory(input.storyId);
    const node = storyMap.nodes[input.nodeId];
    if (!node) return { status: 'failed', error: 'Beat not found in this story.' };

    const admin = createAdminClient();
    const { data: beatRow } = await admin
      .from('beats')
      .select('image_url, image_gallery')
      .eq('story_id', input.storyId)
      .eq('node_id', input.nodeId)
      .maybeSingle();
    if (!beatRow) return { status: 'failed', error: 'Beat not found.' };

    const gallery = parseGalleryRows(beatRow.image_gallery);
    const entry = findGalleryEntry(gallery, input.storageKey);
    if (!entry) return { status: 'failed', error: 'That image version no longer exists.' };

    const { error: beatError } = await admin
      .from('beats')
      .update({
        image_url: entry.url,
        image_status: 'ready',
        image_error: null,
        image_synced_at: new Date().toISOString(),
      })
      .eq('story_id', input.storyId)
      .eq('node_id', input.nodeId);
    if (beatError) return { status: 'failed', error: `Failed to restore: ${beatError.message}` };

    const patchedMap: StoryMap = {
      ...storyMap,
      nodes: {
        ...storyMap.nodes,
        [input.nodeId]: {
          ...node,
          data: {
            ...node.data,
            imageUrl: entry.url,
            imageStatus: 'ready',
            imageError: undefined,
          },
        },
      },
    };
    await admin
      .from('stories')
      .update({ story_map: patchedMap, updated_at: new Date().toISOString() })
      .eq('id', input.storyId);

    const signed = await signMixedUrls(supabase, [entry.url], 'story-assets', 3600);
    return {
      status: 'restored',
      imageUrl: entry.url,
      displayUrl: signed.get(entry.url) ?? entry.url,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to restore the image version.',
    };
  }
}
