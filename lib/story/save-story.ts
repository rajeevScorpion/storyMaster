import 'server-only';

// ── saveStoryForUser: an explicit-userId story save, no cookie session ─────
//
// app/actions/persistence.ts's saveStory is a 'use server' action: it resolves
// the caller from the request's Supabase cookie session, so it can only ever
// save a story as "whoever is signed in on this browser." Phase 6 (the
// agentic creator) generates stories server-side with no browser and no
// cookie session — it authenticates as a fixed system user instead — so it
// needs a version of the same write path that takes userId as an explicit
// argument.
//
// That is unsafe to expose as a server action: a 'use server' export is
// callable from any client, and a function that trusts a caller-supplied
// userId would let a browser save a story as someone else. So this module
// carries no 'use server' directive — only `server-only`, which fails the
// build if anything tries to import it into client code — and
// saveStoryForUser is never re-exported from persistence.ts. The only caller
// with a legitimate reason to pass an explicit userId is trusted server code
// that has already authenticated the system actor itself (see
// lib/pricing/enforcement.ts's agentic_system bypass for the same pattern).
//
// The row-shaping helpers below (stripBase64, nodeToBeatRow, the additive-
// column fallbacks, etc.) used to be private to persistence.ts. They move
// here too, verbatim, because persistence.ts is a 'use server' file and
// Next.js requires every export from one to be an async function — these are
// synchronous — so they cannot be exported from there for saveStoryForUser to
// import back. Moving them to this plain server-only module lets both
// directions work: persistence.ts imports them here for its own (cookie-bound)
// callers, and this file uses them directly for saveStoryForUser. Nothing
// about their behavior changed in the move.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeStorageUrl } from '@/lib/supabase/storage';
import {
  normalizeBeatMediaFields,
  getBeatPersistedAudioUrl,
  getBeatPersistedImageUrl,
} from '@/lib/types/beat-media';
import type { StorySession, StoryMap, StoryBeat, StoryNode, Character } from '@/lib/types/story';
import type { DbBeat } from '@/lib/types/database';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import {
  extractImageContinuityState,
  summarizeImageContinuityState,
} from '@/lib/ai/image-continuity.shared';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import {
  getReelRetentionDaysForPlan,
  parseReelStorySettingsValue,
} from '@/lib/reel/settings';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { linkReferenceSetupToStory } from '@/app/actions/references';
import { recordCharacterNoveltyUsageAction } from '@/app/actions/character-novelty';
import { recoverCharacterReferenceSheet } from '@/lib/media/character-reference';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import { normalizeStoryEffectConfig } from '@/lib/story-effects/settings';
import {
  sanitizeGalleryForBlob,
  serializeGalleryRows,
} from '@/lib/media/image-versions';

const CHARACTER_REFERENCE_STORAGE_CONTEXT = {
  r2PrivateBucket: process.env.R2_PRIVATE_BUCKET_NAME,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseBucket: 'story-assets',
};

function prepareCharacterReferenceForPersistence(
  character: Character,
  fallback?: Character,
  options: { synthesizeGallery?: boolean } = {}
): Character {
  const recovered = recoverCharacterReferenceSheet(
    character,
    fallback,
    CHARACTER_REFERENCE_STORAGE_CONTEXT,
    options
  );
  const referenceSheetUrl = recovered.referenceSheetUrl
    ? normalizeStorageUrl(recovered.referenceSheetUrl, 'story-assets')
    : undefined;
  const referenceSheetGallery = (recovered.referenceSheetGallery ?? [])
    .map((entry) => ({
      ...entry,
      url: normalizeStorageUrl(entry.url, 'story-assets'),
    }))
    .filter((entry) => Boolean(entry.url));

  return {
    ...recovered,
    referenceSheetUrl,
    referenceSheetGallery:
      referenceSheetGallery.length > 0 ? referenceSheetGallery : undefined,
  };
}

/**
 * Strip base64 data URLs from a StoryMap before saving to DB.
 * Keeps HTTP URLs intact (already uploaded to storage).
 */
export function stripBase64(storyMap: StoryMap, existingStoryMap?: StoryMap | null): StoryMap {
  const nodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(storyMap.nodes)) {
    const existingBeat = existingStoryMap?.nodes?.[id]?.data;
    const existingCharactersById = new Map(
      (existingBeat?.characters ?? []).map((character) => [character.id, character])
    );
    const persistedImageUrl = resolvePersistedImageUrlForSave(node.data, existingBeat);
    const persistedAudioUrl = resolvePersistedAudioUrlForSave(node.data, existingBeat);
    const cleanedGallery = sanitizeGalleryForBlob(node.data.imageGallery, (url) =>
      normalizeStorageUrl(url, 'story-assets')
    );
    nodes[id] = {
      ...node,
      data: {
        ...node.data,
        imageUrl: persistedImageUrl
          ? normalizeStorageUrl(persistedImageUrl, 'story-assets')
          : undefined,
        persistedImageUrl: undefined,
        audioUrl: persistedAudioUrl
          ? normalizeStorageUrl(persistedAudioUrl, 'story-assets')
          : undefined,
        imageGallery: cleanedGallery,
        // Strip portrait base64. Reference-sheet previews are replaced by their
        // durable URL/fallback/storage-key pointer so later saves cannot erase
        // an upload that already reached private storage.
        characters: node.data.characters.map(c => {
          const recovered = prepareCharacterReferenceForPersistence(
            c,
            existingCharactersById.get(c.id)
          );
          return {
            ...recovered,
            portraitUrl: c.portraitUrl?.startsWith('data:')
              ? undefined
              : c.portraitUrl
                ? normalizeStorageUrl(c.portraitUrl, 'story-assets')
                : undefined,
            portraitBase64: undefined,
          };
        }),
      },
    };
  }
  return { ...storyMap, nodes };
}

export function sanitizeSessionCharacters(
  session: StorySession,
  fallbackCharacters: Character[] = []
): StorySession['characters'] {
  const fallbackById = new Map(
    fallbackCharacters.map((character) => [character.id, character])
  );
  return (session.characters || []).map((character) => {
    const recovered = prepareCharacterReferenceForPersistence(
      character,
      fallbackById.get(character.id),
      { synthesizeGallery: true }
    );
    return {
      ...recovered,
      portraitUrl: character.portraitUrl?.startsWith('data:')
        ? undefined
        : character.portraitUrl
          ? normalizeStorageUrl(character.portraitUrl, 'story-assets')
          : undefined,
      portraitBase64: undefined,
    };
  });
}

export function resolvePersistedImageUrlForSave(
  beat: Pick<StoryBeat, 'imageUrl' | 'persistedImageUrl' | 'imageStatus'>,
  existingBeat?: Pick<StoryBeat, 'imageUrl' | 'persistedImageUrl'>
): string | undefined {
  return getBeatPersistedImageUrl(beat)
    || (beat.imageStatus === 'ready' ? getBeatPersistedImageUrl(existingBeat || {}) : undefined);
}

export function resolvePersistedAudioUrlForSave(
  beat: Pick<StoryBeat, 'audioUrl' | 'audioStatus'>,
  existingBeat?: Pick<StoryBeat, 'audioUrl'>
): string | undefined {
  return getBeatPersistedAudioUrl(beat)
    || (beat.audioStatus === 'ready' ? getBeatPersistedAudioUrl(existingBeat || {}) : undefined);
}

export function getStoryOrientation(config: StorySession['storyConfig']): { isVerticalStory: boolean; aspectRatio: '16:9' | '9:16' } {
  const normalizedConfig = normalizeStoryConfig(config);
  return {
    isVerticalStory: normalizedConfig.isVerticalStory,
    aspectRatio: normalizedConfig.isVerticalStory ? '9:16' : '16:9',
  };
}

const ADDITIVE_BEAT_COLUMNS = [
  'is_storyboard',
  'reel_captions',
  'storyboard_narration_timing',
  'story_text_overlay_enabled',
  'story_text_overlay_mode',
  'story_text_overlay_style',
  'story_text_overlay_captions',
  'story_text_overlay_alignment',
  'story_effects',
  'origin_kind',
  'seed_plan_beat_index',
  'canonical_option_id',
  'narration_voice_id',
  'image_status',
  'image_error',
  'image_provider_key',
  'image_model_key',
  'image_generation_metadata',
  'image_synced_at',
  'image_gallery',
  'audio_status',
  'audio_error',
  'audio_synced_at',
] as const;

const ADDITIVE_STORY_COLUMNS = [
  'story_kind',
  'reel_length_key',
  'reel_retention_days',
  'reel_expires_at',
  'reel_cleanup_status',
  'image_provider_key',
  'image_model_key',
  'image_model_snapshot',
  'visual_profile',
  // Migration 075 episode columns — stripped when the migration hasn't been
  // applied yet so saving keeps working during rollout.
  'episode_branch_id',
  'episode_number',
  'parent_story_id',
] as const;

export function isMissingBeatColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error?.message) return false;
  return (
    error.code === 'PGRST204'
    || (/schema cache/i.test(error.message) && /column/i.test(error.message) && /beats/i.test(error.message))
  );
}

export function isMissingAdditiveColumnError(error: { code?: string; message?: string } | null | undefined, tableName: string): boolean {
  if (!error?.message) return false;
  return (
    error.code === 'PGRST204'
    || (/schema cache/i.test(error.message) && /column/i.test(error.message) && error.message.includes(tableName))
  );
}

export function withoutAdditiveBeatColumns(row: Record<string, unknown>): Record<string, unknown> {
  const fallbackRow = { ...row };
  for (const column of ADDITIVE_BEAT_COLUMNS) {
    delete fallbackRow[column];
  }
  return fallbackRow;
}

export function withoutAdditiveBeatColumnsBatch(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(withoutAdditiveBeatColumns);
}

export function withoutAdditiveColumns(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const fallbackRow = { ...row };
  for (const column of columns) {
    delete fallbackRow[column];
  }
  return fallbackRow;
}

export async function buildReelStoryPersistencePatch(
  storyConfig: StorySession['storyConfig'],
  setInitialRetention: boolean
): Promise<Record<string, unknown>> {
  const normalized = normalizeStoryConfig(storyConfig);
  if (normalized.storyKind !== 'reel') {
    return {
      story_kind: 'story',
      reel_length_key: null,
    };
  }

  const patch: Record<string, unknown> = {
    story_kind: 'reel',
    reel_length_key: normalized.reel.length,
  };

  if (setInitialRetention) {
    const settingsValue = await getFeatureFlagValue('reel_story_settings').catch(() => null);
    const settings = parseReelStorySettingsValue(settingsValue);
    const pricing = await getPricingRuntimeContext().catch(() => null);
    const retentionDays = getReelRetentionDaysForPlan(settings, pricing?.snapshot.planKey);
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    patch.reel_retention_days = retentionDays;
    patch.reel_expires_at = expiresAt;
    patch.reel_cleanup_status = 'active';
  }

  return patch;
}

/**
 * Convert a StoryNode + beat data into a beats table row object.
 */
export function nodeToBeatRow(
  storyId: string,
  nodeId: string,
  node: StoryNode,
  userId: string,
  existingBeat?: {
    imageUrl?: string;
    audioUrl?: string;
    imageSyncedAt?: string;
    audioSyncedAt?: string;
  }
) {
  const normalizedBeat = normalizeBeatMediaFields(node.data);
  const imageUrl = resolvePersistedImageUrlForSave(normalizedBeat);
  const audioUrl = resolvePersistedAudioUrlForSave(normalizedBeat);
  const normalizedImageUrl = imageUrl ? normalizeStorageUrl(imageUrl, 'story-assets') : undefined;
  const normalizedAudioUrl = audioUrl ? normalizeStorageUrl(audioUrl, 'story-assets') : undefined;
  const existingImageUrl = existingBeat?.imageUrl
    ? normalizeStorageUrl(existingBeat.imageUrl, 'story-assets')
    : undefined;
  const existingAudioUrl = existingBeat?.audioUrl
    ? normalizeStorageUrl(existingBeat.audioUrl, 'story-assets')
    : undefined;
  const row: Record<string, unknown> = {
    story_id: storyId,
    node_id: nodeId,
    beat_number: node.beatNumber,
    parent_node_id: node.parentId || null,
    selected_option_id: node.selectedOptionId || null,
    generated_by: userId,
    title: normalizedBeat.title,
    is_ending: normalizedBeat.isEnding,
    story_text: normalizedBeat.storyText,
    scene_summary: normalizedBeat.sceneSummary || null,
    options: normalizedBeat.options as unknown as Record<string, unknown>[],
    characters: normalizedBeat.characters as unknown as Record<string, unknown>[],
    continuity_notes: normalizedBeat.continuityNotes || null,
    image_prompt: normalizedBeat.imagePrompt || null,
    clues: normalizedBeat.clues || null,
    next_beat_goal: normalizedBeat.nextBeatGoal || null,
    ending_forecast: normalizedBeat.endingForecast || null,
    origin_kind: normalizedBeat.originKind || null,
    seed_plan_beat_index: normalizedBeat.seedPlanBeatIndex || null,
    canonical_option_id: normalizedBeat.canonicalOptionId || null,
    image_status: normalizedBeat.imageStatus,
    image_error: normalizedBeat.imageError || null,
    image_provider_key: normalizedBeat.imageProviderKey || null,
    image_model_key: normalizedBeat.imageModelKey || null,
    image_generation_metadata: normalizedBeat.imageGenerationMetadata || null,
    image_synced_at: normalizedBeat.imageStatus === 'ready'
      ? (normalizedImageUrl === existingImageUrl && existingBeat?.imageSyncedAt
          ? existingBeat.imageSyncedAt
          : new Date().toISOString())
      : null,
    audio_status: normalizedBeat.audioStatus,
    audio_error: normalizedBeat.audioError || null,
    audio_synced_at: normalizedBeat.audioStatus === 'ready'
      ? (normalizedAudioUrl === existingAudioUrl && existingBeat?.audioSyncedAt
          ? existingBeat.audioSyncedAt
          : new Date().toISOString())
      : null,
  };

  // Only include asset URLs when they have values — prevents UPSERT from
  // overwriting audio_url set by generateAndPersistNarration (race condition)
  if (normalizedImageUrl) {
    row.image_url = normalizedImageUrl;
  }

  if (normalizedAudioUrl) {
    row.audio_url = normalizedAudioUrl;
  }

  if (normalizedBeat.narrationVoiceId) {
    row.narration_voice_id = normalizedBeat.narrationVoiceId;
  }

  if (normalizedBeat.narrationMetadata) {
    row.narration_metadata = normalizedBeat.narrationMetadata as unknown as Record<string, unknown>;
  }

  if (normalizedBeat.activeNarrationPreviewId) {
    row.active_narration_preview_id = normalizedBeat.activeNarrationPreviewId;
  }

  // `isStoryboardBeat` rather than the raw field: every read path infers a
  // storyboard from a plan or a full set of panel captions too, and writing
  // only the raw flag left grids persisted as `is_storyboard = false`. Gallery
  // surfaces then rendered the whole 2×2 grid instead of one panel. Never
  // written false — a beat that has been a storyboard once stays one, and the
  // column already defaults to false.
  if (isStoryboardBeat(normalizedBeat)) {
    row.is_storyboard = true;
  }

  if (normalizedBeat.reelCaptions && normalizedBeat.reelCaptions.length > 0) {
    row.reel_captions = normalizedBeat.reelCaptions as unknown as Record<string, unknown>[];
  }

  if (normalizedBeat.storyboardNarrationTiming) {
    row.storyboard_narration_timing = normalizedBeat.storyboardNarrationTiming as unknown as Record<string, unknown>;
  }

  if (typeof normalizedBeat.storyTextOverlayEnabled === 'boolean') {
    row.story_text_overlay_enabled = normalizedBeat.storyTextOverlayEnabled;
  }

  if (normalizedBeat.storyTextOverlayMode) {
    row.story_text_overlay_mode = normalizedBeat.storyTextOverlayMode;
  }

  if (normalizedBeat.storyTextOverlayStyle) {
    row.story_text_overlay_style = normalizedBeat.storyTextOverlayStyle as unknown as Record<string, unknown>;
  }

  if (normalizedBeat.storyTextOverlayCaptions && normalizedBeat.storyTextOverlayCaptions.length > 0) {
    row.story_text_overlay_captions = normalizedBeat.storyTextOverlayCaptions as unknown as Record<string, unknown>[];
  }

  if (normalizedBeat.storyTextOverlayAlignment) {
    row.story_text_overlay_alignment = normalizedBeat.storyTextOverlayAlignment as unknown as Record<string, unknown>;
  }

  if (normalizedBeat.storyEffects) {
    row.story_effects = normalizeStoryEffectConfig(normalizedBeat.storyEffects) as unknown as Record<string, unknown>;
  }

  row.image_gallery = serializeGalleryRows(normalizedBeat.imageGallery, (url) =>
    normalizeStorageUrl(url, 'story-assets')
  );

  return row;
}

export interface SaveStoryOptions {
  agentPersonaId?: string | null;
  agentTaskId?: string | null;
  /**
   * Read the story's existing beat assets WITHOUT filtering on `generated_by`.
   *
   * Default (false/absent) keeps the owner-scoped filter every caller has always
   * had, and every existing caller leaves it that way -- the human save path and
   * lib/agentic/story-assembly.ts's agent save alike, both of which pass a userId
   * that genuinely is the beats' generator.
   *
   * The one caller that sets it is app/actions/persistence.ts's saveStory on its
   * reviewer branch (D14/D19). A reviewer finishing an agent draft saves as the
   * story's OWNER (the agentic system user), but the beats underneath may have been
   * stamped `generated_by` = the reviewer by an earlier saveBeat, which takes the
   * opposite approach to the same mismatch (persistence.ts :769). Filtering on
   * either id alone would therefore miss real rows, and a missed row means this
   * function rebuilds the beat from the client's session only -- silently dropping
   * any image or audio URL the database holds and the client does not. Matching on
   * story_id alone is correct here precisely because the caller has already proven,
   * through assertCanEditStory, that it may write every beat of this story.
   */
  crossGeneratorBeats?: boolean;
}

/**
 * Save or update a story in the database.
 * Dual-writes: saves both story_map JSONB (legacy) and normalized beats.
 *
 * This is the body of app/actions/persistence.ts's saveStory, moved verbatim
 * with the caller's userId taken as an explicit argument instead of resolved
 * from a cookie session (see the module header for why). The only other
 * differences from the original are the optional agent provenance columns at
 * the end of storyData, added only when the caller supplies them.
 */
export async function saveStoryForUser(
  supabase: SupabaseClient,
  userId: string,
  session: StorySession,
  storyMapWithUrls: StoryMap,
  options?: SaveStoryOptions
): Promise<{ storyId: string; beatsWarning?: string }> {
  let existingStoryMap: StoryMap | null = null;
  let existingStoryCharacters: Character[] = [];
  const existingBeatUrlMap = new Map<string, {
    imageUrl?: string;
    audioUrl?: string;
    imageSyncedAt?: string;
    audioSyncedAt?: string;
  }>();
  if (session.savedStoryId) {
    const { data: existingStory, error: existingStoryError } = await supabase
      .from('stories')
      .select('story_map, characters')
      .eq('id', session.savedStoryId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingStoryError) {
      throw new Error(`Failed to load existing story before save: ${existingStoryError.message}`);
    }

    const rawExistingStoryMap = existingStory?.story_map;
    if (rawExistingStoryMap && typeof rawExistingStoryMap === 'object' && 'nodes' in rawExistingStoryMap) {
      existingStoryMap = rawExistingStoryMap as unknown as StoryMap;
    }
    existingStoryCharacters =
      (existingStory?.characters ?? []) as unknown as Character[];

    let existingBeatRowsQuery = supabase
      .from('beats')
      .select('node_id, image_url, audio_url, image_synced_at, audio_synced_at')
      .eq('story_id', session.savedStoryId);
    // Owner-scoped by default, story-scoped on the reviewer branch -- see
    // SaveStoryOptions.crossGeneratorBeats for why the distinction matters.
    if (!options?.crossGeneratorBeats) {
      existingBeatRowsQuery = existingBeatRowsQuery.eq('generated_by', userId);
    }
    const { data: existingBeatRows, error: existingBeatRowsError } = await existingBeatRowsQuery;

    if (existingBeatRowsError) {
      throw new Error(`Failed to load existing beat assets before save: ${existingBeatRowsError.message}`);
    }

    for (const beat of existingBeatRows || []) {
      existingBeatUrlMap.set(beat.node_id, {
        imageUrl: beat.image_url || undefined,
        audioUrl: beat.audio_url || undefined,
        imageSyncedAt: beat.image_synced_at || undefined,
        audioSyncedAt: beat.audio_synced_at || undefined,
      });
    }
  }

  const fallbackStoryMap = existingStoryMap
    ? {
        ...existingStoryMap,
        nodes: { ...existingStoryMap.nodes },
      }
    : {
        nodes: {},
        rootNodeId: storyMapWithUrls.rootNodeId,
        currentNodeId: storyMapWithUrls.currentNodeId,
      };

  for (const [nodeId, node] of Object.entries(storyMapWithUrls.nodes)) {
    const existingNode = fallbackStoryMap.nodes[nodeId];
    const existingBeatUrls = existingBeatUrlMap.get(nodeId);
    if (!existingNode && !existingBeatUrls) {
      continue;
    }

    fallbackStoryMap.nodes[nodeId] = {
      ...(existingNode || node),
      ...(!existingNode ? { id: node.id, beatNumber: node.beatNumber, parentId: node.parentId, selectedOptionId: node.selectedOptionId, children: node.children } : {}),
      data: {
        ...(existingNode?.data || node.data),
        ...(existingBeatUrls?.imageUrl && !(existingNode?.data?.imageUrl) ? { imageUrl: existingBeatUrls.imageUrl } : {}),
        ...(existingBeatUrls?.audioUrl && !(existingNode?.data?.audioUrl) ? { audioUrl: existingBeatUrls.audioUrl } : {}),
      },
    };
  }

  const cleanMap = stripBase64(storyMapWithUrls, fallbackStoryMap);
  const storyOrientation = getStoryOrientation(session.storyConfig);
  const firstImageBeat = Object.values(cleanMap.nodes)
    .map((node) => node.data)
    .find((beat) => beat.imageModelKey || beat.imageGenerationMetadata?.imageModelSnapshot);
  const imageModelSnapshot = (
    firstImageBeat?.imageGenerationMetadata?.imageModelSnapshot
    && typeof firstImageBeat.imageGenerationMetadata.imageModelSnapshot === 'object'
  )
    ? firstImageBeat.imageGenerationMetadata.imageModelSnapshot as Record<string, unknown>
    : null;
  const latestContinuityState = Object.values(cleanMap.nodes)
    .map((node) => extractImageContinuityState(node.data.imageGenerationMetadata))
    .filter((state): state is NonNullable<typeof state> => Boolean(state))
    .at(-1) ?? null;

  const reelPersistencePatch = await buildReelStoryPersistencePatch(session.storyConfig, !session.savedStoryId);

  const storyData = {
    user_id: userId,
    title: session.title,
    user_prompt: session.userPrompt,
    genre: session.genre,
    tone: session.tone,
    visual_style: session.visualStyle,
    target_age: session.targetAge,
    story_config: session.storyConfig as unknown as Record<string, unknown>,
    image_provider_key: firstImageBeat?.imageProviderKey || (imageModelSnapshot?.providerKey as string | undefined) || null,
    image_model_key: firstImageBeat?.imageModelKey || session.storyConfig.imageModelSelection?.modelKey || null,
    image_model_snapshot: imageModelSnapshot,
    visual_profile: {
      visualSettings: session.storyConfig.visualSettings,
      aspectRatio: session.storyConfig.aspectRatio,
      storyKind: session.storyConfig.storyKind,
      imageContinuity: {
        requestedStrategy: session.storyConfig.imageContinuityStrategy,
        latestState: summarizeImageContinuityState(latestContinuityState),
        updatedAt: new Date().toISOString(),
      },
    },
    ...reelPersistencePatch,
    // Pack 2: episode links write only for episode sessions so legacy saves
    // never clobber columns they don't know about.
    ...(session.episodeContext
      ? {
          episode_branch_id: session.episodeContext.branchId,
          episode_number: session.episodeContext.episodeNumber,
          parent_story_id: session.episodeContext.parentStoryId ?? null,
        }
      : {}),
    is_vertical_story: storyOrientation.isVerticalStory,
    aspect_ratio: storyOrientation.aspectRatio,
    story_map: cleanMap as unknown as Record<string, unknown>,
    characters: sanitizeSessionCharacters(
      session,
      existingStoryCharacters
    ) as unknown as Record<string, unknown>[],
    setting: session.setting as unknown as Record<string, unknown>,
    status: session.status,
    narrator_voice: session.narratorVoice || null,
    narration_voice_mode: session.narrationVoiceMode || session.storyConfig.narrationVoice?.mode || 'legacy_auto',
    narration_voice_gender_bucket: session.narrationVoiceGenderBucket || session.storyConfig.narrationVoice?.genderBucket || null,
    narration_language_code: session.narrationLanguageCode || session.storyConfig.narrationVoice?.languageCode || null,
    current_node_id: cleanMap.currentNodeId || null,
    updated_at: new Date().toISOString(),
    // Agent provenance (migrations 103/106): omitted entirely when the caller
    // doesn't supply them, so the human save path writes exactly the columns
    // it always has — including on a database without those migrations.
    ...(options?.agentPersonaId !== undefined ? { agent_persona_id: options.agentPersonaId } : {}),
    ...(options?.agentTaskId !== undefined ? { agent_task_id: options.agentTaskId } : {}),
  };

  let storyId: string;

  // Upsert: if savedStoryId exists, update; otherwise insert
  if (session.savedStoryId) {
    const { error } = await supabase
      .from('stories')
      .update(storyData)
      .eq('id', session.savedStoryId)
      .eq('user_id', userId);

    if (error) {
      if (isMissingAdditiveColumnError(error, 'stories')) {
        const { error: fallbackError } = await supabase
          .from('stories')
          .update(withoutAdditiveColumns(storyData, ADDITIVE_STORY_COLUMNS))
          .eq('id', session.savedStoryId)
          .eq('user_id', userId);

        if (fallbackError) throw new Error(`Failed to update story: ${fallbackError.message}`);
      } else {
        throw new Error(`Failed to update story: ${error.message}`);
      }
    }
    storyId = session.savedStoryId;
  } else {
    const { data, error } = await supabase
      .from('stories')
      .insert(storyData)
      .select('id')
      .single();

    if (error) {
      if (isMissingAdditiveColumnError(error, 'stories')) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('stories')
          .insert(withoutAdditiveColumns(storyData, ADDITIVE_STORY_COLUMNS))
          .select('id')
          .single();

        if (fallbackError || !fallbackData) {
          throw new Error(`Failed to save story: ${fallbackError?.message || error.message}`);
        }
        storyId = fallbackData.id;
      } else {
        throw new Error(`Failed to save story: ${error.message}`);
      }
    } else {
      storyId = data.id;
    }
  }

  await recordCharacterNoveltyUsageAction({
    storyId,
    characters: storyData.characters as unknown as Character[],
    storyConfig: session.storyConfig,
  });

  // Reference Personalization: backfill story_id onto the setup's reference rows
  // now that the story exists. Idempotent + owner-scoped; never blocks the save.
  const referenceSetupId = session.storyConfig?.references?.setupId;
  if (referenceSetupId && storyId) {
    await linkReferenceSetupToStory(referenceSetupId, storyId).catch((error) => {
      console.error('Failed to link reference setup to story:', error instanceof Error ? error.message : error);
    });
  }

  // Dual-write: batch upsert all nodes into beats table
  const beatRows = Object.entries(cleanMap.nodes).map(([nodeId, node]) =>
    nodeToBeatRow(storyId, nodeId, node, userId, existingBeatUrlMap.get(nodeId))
  );

  if (beatRows.length > 0) {
    const { error: beatsError } = await supabase
      .from('beats')
      .upsert(beatRows, { onConflict: 'story_id,node_id' });

    if (beatsError) {
      if (isMissingBeatColumnError(beatsError)) {
        const { error: fallbackError } = await supabase
          .from('beats')
          .upsert(withoutAdditiveBeatColumnsBatch(beatRows), { onConflict: 'story_id,node_id' });

        if (!fallbackError) {
          console.warn('Saved beats without additive beat metadata because the database schema is missing newer beat columns.');
          return { storyId };
        }

        console.error('Failed to upsert beats after schema fallback:', fallbackError.message);
        return { storyId, beatsWarning: 'Beat data failed to sync - publishing may be unavailable until next save' };
      }

      console.error('Failed to upsert beats:', beatsError.message);
      return { storyId, beatsWarning: 'Beat data failed to sync - publishing may be unavailable until next save' };
    }
  }

  return { storyId };
}

// ── Storyline publish helpers, shared with lib/agentic/review-publish.ts (D15) ─────
//
// Moved here verbatim from app/actions/persistence.ts, for the identical reason
// everything else above did: persistence.ts is 'use server' and Next.js requires every
// export from a 'use server' file to be an async function, so these -- one sync, one
// merely small -- could not be exported from there for a second, non-'use-server' caller
// to import back. Unit 9e-ii (D15, docs/agentic-creator-decisions.md) needs both:
// review-publish.ts builds a reviewer's storyline row the same way autoPublishStoryline
// does, on the admin client instead of the session client, and must compute the same
// path_hash and walk the same parent_node_id chain to get there. persistence.ts imports
// them back for its own two publish paths; nothing about their behavior changed in the
// move.

/**
 * Additive storyline columns (migrations 073 visibility/share/moderation, 089 discovery
 * classification, 093 series) that may not exist yet on every environment. Stripped via
 * isMissingAdditiveColumnError/withoutAdditiveColumns (above) on a missing-column error so
 * publishing keeps working during rollout -- see WORKING_AGREEMENTS's fail-closed rule.
 */
export const ADDITIVE_STORYLINE_COLUMNS = [
  'story_kind',
  // Migration 073 visibility columns — stripped when the migration hasn't
  // been applied yet so publishing keeps working during rollout.
  'visibility',
  'share_token',
  'published_at',
  'unpublished_at',
  'moderation_status',
  'publish_quality',
  // Migration 089 discovery classification columns.
  'age_group',
  'genre',
  // Migration 093 series columns — stripped when the migration hasn't been
  // applied yet so publishing keeps working during rollout.
  'series_id',
  'episode_number',
  'series_title',
] as const;

/**
 * Compute a path hash for duplicate storyline detection.
 * Uses a simple hash of the node_path joined by '|'.
 */
export async function computePathHash(nodePath: string[]): Promise<string> {
  const data = new TextEncoder().encode(nodePath.join('|'));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Walk from an ending beat back to root to get the full node path.
 */
export function walkPathToRoot(beats: DbBeat[], endingNodeId: string): string[] {
  const beatMap = new Map<string, DbBeat>();
  for (const beat of beats) {
    beatMap.set(beat.node_id, beat);
  }

  const path: string[] = [];
  let currentId: string | null = endingNodeId;
  while (currentId) {
    path.unshift(currentId);
    const beat = beatMap.get(currentId);
    currentId = beat?.parent_node_id || null;
  }
  return path;
}
