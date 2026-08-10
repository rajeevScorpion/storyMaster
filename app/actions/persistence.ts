'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { normalizeStorageUrl, extractStoragePath, copyToPublicBucket } from '@/lib/supabase/storage';
import { signStoryMapAssetUrls, signCharacterRosterReferenceSheetUrls, signMixedUrls } from '@/lib/media/storage-url-signing';
import { createAdminClient } from '@/lib/supabase/admin';
import type { StorySession, StoryMap, StoryBeat, StoryNode, Character, BeatImageGalleryEntry } from '@/lib/types/story';
import type { DbStory, DbBeat } from '@/lib/types/database';
import type { StorylineShareCoverSource } from '@/lib/types/database';
import type { BeatMediaStatus } from '@/lib/types/beat-media';
import {
  normalizeBeatMediaFields,
  BEAT_ROW_NOT_FOUND_MESSAGE,
  isBeatRowNotFoundError,
  getBeatPersistedAudioUrl,
  getBeatPersistedImageUrl,
} from '@/lib/types/beat-media';
import type { StorylineChoice } from '@/lib/utils/storyline';
import { MY_STORIES_PAGE_SIZE, type ListPageInput, type PagedList } from '@/lib/types/my-stories';
import { deriveVisualStyleSummary, normalizeStoryConfig } from '@/lib/ai/story-config';
import { normalizeStoredAgeGroup } from '@/lib/ai/story-audience';
import { normalizeStoredGenre } from '@/lib/story/genres';
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
import { finalizeStorylineShareAssets } from '@/app/actions/storyline-covers';
import { refreshStorylineDiscoveryMetadata } from '@/app/actions/storyline-discovery';
import { linkReferenceSetupToStory } from '@/app/actions/references';
import { recordCharacterNoveltyUsageAction } from '@/app/actions/character-novelty';
import { processAndUploadStorylineAsset } from '@/lib/story/share-cover';
import { getStorylinePublishModes } from '@/lib/story/publish-modes';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import { normalizeStoryEffectConfig } from '@/lib/story-effects/settings';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import {
  parseGalleryRows,
  sanitizeGalleryForBlob,
  serializeGalleryRows,
} from '@/lib/media/image-versions';
import { recoverCharacterReferenceSheet } from '@/lib/media/character-reference';
import { resolveValidatedPublishQuality } from '@/lib/story/publish-quality';
import {
  generateShareToken,
  normalizeStorylineVisibility,
  type StorylinePublishQuality,
  type StorylineVisibility,
} from '@/lib/story/visibility';

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
function stripBase64(storyMap: StoryMap, existingStoryMap?: StoryMap | null): StoryMap {
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

function sanitizeSessionCharacters(
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

function mergeCharactersWithFallback(
  primary: StoryBeat['characters'],
  fallback?: StoryBeat['characters']
): StoryBeat['characters'] {
  if (!fallback || fallback.length === 0) {
    return primary;
  }

  const merged = new Map<string, StoryBeat['characters'][number]>();

  for (const character of fallback) {
    merged.set(character.id, { ...character });
  }

  for (const character of primary) {
    const existing = merged.get(character.id);
    merged.set(character.id, {
      ...existing,
      ...character,
      portraitUrl: character.portraitUrl || existing?.portraitUrl,
      portraitBase64: character.portraitBase64 || existing?.portraitBase64,
      referenceSheetUrl:
        character.referenceSheetUrl || existing?.referenceSheetUrl,
      referenceSheetStorageKey:
        character.referenceSheetStorageKey || existing?.referenceSheetStorageKey,
      referenceSheetUploadedAt:
        character.referenceSheetUploadedAt || existing?.referenceSheetUploadedAt,
      referenceSheetGallery:
        character.referenceSheetGallery ?? existing?.referenceSheetGallery,
    });
  }

  return Array.from(merged.values());
}

function resolvePersistedImageUrlForSave(
  beat: Pick<StoryBeat, 'imageUrl' | 'persistedImageUrl' | 'imageStatus'>,
  existingBeat?: Pick<StoryBeat, 'imageUrl' | 'persistedImageUrl'>
): string | undefined {
  return getBeatPersistedImageUrl(beat)
    || (beat.imageStatus === 'ready' ? getBeatPersistedImageUrl(existingBeat || {}) : undefined);
}

function resolvePersistedAudioUrlForSave(
  beat: Pick<StoryBeat, 'audioUrl' | 'audioStatus'>,
  existingBeat?: Pick<StoryBeat, 'audioUrl'>
): string | undefined {
  return getBeatPersistedAudioUrl(beat)
    || (beat.audioStatus === 'ready' ? getBeatPersistedAudioUrl(existingBeat || {}) : undefined);
}

function getStoryOrientation(config: StorySession['storyConfig']): { isVerticalStory: boolean; aspectRatio: '16:9' | '9:16' } {
  const normalizedConfig = normalizeStoryConfig(config);
  return {
    isVerticalStory: normalizedConfig.isVerticalStory,
    aspectRatio: normalizedConfig.isVerticalStory ? '9:16' : '16:9',
  };
}

function normalizePersistedAssetUrl(url: string | undefined): string | undefined {
  return url ? normalizeStorageUrl(url, 'story-assets') : url;
}

function normalizePublishedBeatAssetUrls(beat: StoryBeat): StoryBeat {
  return normalizeBeatMediaFields({
    ...beat,
    imageUrl: normalizePersistedAssetUrl(beat.imageUrl),
    persistedImageUrl: normalizePersistedAssetUrl(beat.persistedImageUrl),
    audioUrl: normalizePersistedAssetUrl(beat.audioUrl),
    imageGallery: (beat.imageGallery ?? []).map((entry) => ({
      ...entry,
      url: normalizePersistedAssetUrl(entry.url) ?? entry.url,
    })),
    characters: beat.characters.map((character) => ({
      ...character,
      portraitUrl: normalizePersistedAssetUrl(character.portraitUrl),
      referenceSheetUrl: normalizePersistedAssetUrl(character.referenceSheetUrl),
      referenceSheetGallery: character.referenceSheetGallery?.map((entry) => ({
        ...entry,
        url: normalizePersistedAssetUrl(entry.url) ?? entry.url,
      })),
    })),
  });
}

function buildStorageObjectPublicUrl(bucket: string, path: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return `/storage/v1/object/public/${bucket}/${path}`;
  }
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

function getBeatImageStoragePath(storyOwnerId: string, storyId: string, nodeId: string): string {
  return `${storyOwnerId}/${storyId}/${nodeId}/image.webp`;
}

async function storageObjectExists(
  supabase: SupabaseClient,
  bucket: string,
  path: string
): Promise<boolean> {
  const separatorIndex = path.lastIndexOf('/');
  const directory = separatorIndex === -1 ? '' : path.slice(0, separatorIndex);
  const fileName = separatorIndex === -1 ? path : path.slice(separatorIndex + 1);

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(directory, {
      limit: 100,
      search: fileName,
    });

  if (error) {
    console.error(`Failed to inspect storage path ${bucket}/${path}:`, error.message);
    return false;
  }

  return Boolean(data?.some((entry) => entry.name === fileName));
}

export async function repairMissingReadyBeatImageUrls(
  supabase: SupabaseClient,
  storyId: string,
  storyOwnerId: string,
  beats: DbBeat[],
  rawStoryMap?: StoryMap | null
): Promise<{
  beats: DbBeat[];
  storyMap: StoryMap | null;
  repairedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  const candidates = beats.filter((beat) => beat.image_status === 'ready' && !beat.image_url);
  if (candidates.length === 0) {
    return {
      beats,
      storyMap: rawStoryMap ?? null,
      repairedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  const nextBeats = beats.map((beat) => ({ ...beat }));
  const nextStoryMap = rawStoryMap
    ? {
        ...rawStoryMap,
        nodes: { ...rawStoryMap.nodes },
      }
    : null;

  let repairedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let storyMapChanged = false;

  for (const candidate of candidates) {
    try {
      const storyMapNode = nextStoryMap?.nodes?.[candidate.node_id];
      const storyMapImageUrl = storyMapNode?.data ? getBeatPersistedImageUrl(storyMapNode.data) : undefined;
      const storagePath = getBeatImageStoragePath(storyOwnerId, storyId, candidate.node_id);
      const repairedImageUrl = storyMapImageUrl
        || (
          await storageObjectExists(supabase, 'story-assets', storagePath)
            ? normalizeStorageUrl(buildStorageObjectPublicUrl('story-assets', storagePath), 'story-assets')
            : undefined
        );

      if (!repairedImageUrl) {
        skippedCount += 1;
        continue;
      }

      const { error: beatUpdateError } = await supabase
        .from('beats')
        .update({
          image_url: repairedImageUrl,
          image_status: 'ready',
          image_error: null,
          image_synced_at: candidate.image_synced_at || new Date().toISOString(),
        })
        .eq('story_id', storyId)
        .eq('node_id', candidate.node_id);

      if (beatUpdateError) {
        console.error('Failed to repair beat image_url:', beatUpdateError.message);
        failedCount += 1;
        continue;
      }

      const beatIndex = nextBeats.findIndex((beat) => beat.node_id === candidate.node_id);
      if (beatIndex !== -1) {
        nextBeats[beatIndex] = {
          ...nextBeats[beatIndex],
          image_url: repairedImageUrl,
          image_status: 'ready',
          image_error: null,
          image_synced_at: nextBeats[beatIndex].image_synced_at || new Date().toISOString(),
        };
      }

      if (storyMapNode) {
        nextStoryMap!.nodes[candidate.node_id] = {
          ...storyMapNode,
          data: {
            ...storyMapNode.data,
            imageUrl: repairedImageUrl,
            imageStatus: 'ready',
            imageError: undefined,
          },
        };
        storyMapChanged = true;
      }

      repairedCount += 1;
    } catch (error) {
      console.error('Failed to repair missing beat image URL:', error);
      failedCount += 1;
    }
  }

  if (storyMapChanged && nextStoryMap) {
    const { error: storyMapError } = await supabase
      .from('stories')
      .update({
        story_map: stripBase64(nextStoryMap) as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storyId);

    if (storyMapError) {
      console.error('Failed to persist repaired story_map image URLs:', storyMapError.message);
      failedCount += repairedCount;
      repairedCount = 0;
      return {
        beats,
        storyMap: rawStoryMap ?? null,
        repairedCount,
        skippedCount,
        failedCount,
      };
    }
  }

  return {
    beats: nextBeats,
    storyMap: nextStoryMap,
    repairedCount,
    skippedCount,
    failedCount,
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

const ADDITIVE_STORYLINE_COLUMNS = [
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

type StorylineSeriesFields = {
  series_id: string | null;
  episode_number: number | null;
  series_title: string | null;
};

const NO_SERIES: StorylineSeriesFields = {
  series_id: null,
  episode_number: null,
  series_title: null,
};

/**
 * Series membership to stamp onto a storyline at publish time (migration 093).
 *
 * The gallery reads storylines anonymously and cannot see `episode_branches` —
 * that table is owner-only and points at unpublished work. Publishing, though,
 * runs on the author's own client, which can read their own branch, so the
 * display name is resolved here and copied down. Mirrors the COALESCE chain in
 * the migration's backfill, so a row published now and a row backfilled then
 * carry the same title.
 *
 * Both the branch id and the episode number are required: a branch with no
 * episode number cannot be ordered, so such a story publishes as standalone
 * rather than joining a series at an unknown position.
 *
 * Queried on its own rather than folded into the caller's `stories` select so
 * that a database without migration 075 loses the series stamp instead of
 * failing the publish — a missing column fails the whole row, not one field.
 */
async function resolveStorylineSeriesFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storyId: string
): Promise<StorylineSeriesFields> {
  try {
    const { data: story, error } = await supabase
      .from('stories')
      .select('title, episode_branch_id, episode_number')
      .eq('id', storyId)
      .maybeSingle();

    if (error || !story) return NO_SERIES;

    const branchId = (story.episode_branch_id as string | null) ?? null;
    const episodeNumber = story.episode_number as number | null;
    if (!branchId || typeof episodeNumber !== 'number') return NO_SERIES;

    const storyTitle = (story.title as string | null)?.trim() || null;

    const { data: branch } = await supabase
      .from('episode_branches')
      .select('branch_name, root_story_id')
      .eq('id', branchId)
      .maybeSingle();

    const branchName = (branch?.branch_name as string | null)?.trim() || null;
    let rootTitle: string | null = null;

    if (!branchName && branch?.root_story_id) {
      const { data: root } = await supabase
        .from('stories')
        .select('title')
        .eq('id', branch.root_story_id as string)
        .maybeSingle();
      rootTitle = (root?.title as string | null)?.trim() || null;
    }

    return {
      series_id: branchId,
      episode_number: episodeNumber,
      series_title: branchName ?? rootTitle ?? storyTitle,
    };
  } catch (error) {
    console.warn('Failed to resolve storyline series fields:', error);
    return NO_SERIES;
  }
}

function isMissingBeatColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error?.message) return false;
  return (
    error.code === 'PGRST204'
    || (/schema cache/i.test(error.message) && /column/i.test(error.message) && /beats/i.test(error.message))
  );
}

function isMissingAdditiveColumnError(error: { code?: string; message?: string } | null | undefined, tableName: string): boolean {
  if (!error?.message) return false;
  return (
    error.code === 'PGRST204'
    || (/schema cache/i.test(error.message) && /column/i.test(error.message) && error.message.includes(tableName))
  );
}

function withoutAdditiveBeatColumns(row: Record<string, unknown>): Record<string, unknown> {
  const fallbackRow = { ...row };
  for (const column of ADDITIVE_BEAT_COLUMNS) {
    delete fallbackRow[column];
  }
  return fallbackRow;
}

function withoutAdditiveBeatColumnsBatch(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(withoutAdditiveBeatColumns);
}

function withoutAdditiveColumns(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const fallbackRow = { ...row };
  for (const column of columns) {
    delete fallbackRow[column];
  }
  return fallbackRow;
}

async function buildReelStoryPersistencePatch(
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
function nodeToBeatRow(
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

/**
 * Convert a DbBeat row back into a StoryNode for the client StoryMap.
 */
function beatRowToNode(beat: DbBeat, childNodeIds: string[]): StoryNode {
  const normalizedBeat = normalizeBeatMediaFields({
    title: beat.title,
    beatNumber: beat.beat_number,
    isEnding: beat.is_ending,
    storyText: beat.story_text,
    sceneSummary: beat.scene_summary || '',
    options: (beat.options || []) as unknown as StoryBeat['options'],
    characters: (beat.characters || []) as unknown as StoryBeat['characters'],
    continuityNotes: (beat.continuity_notes || []) as string[],
    imagePrompt: beat.image_prompt || '',
    clues: (beat.clues || []) as string[],
    nextBeatGoal: beat.next_beat_goal || '',
    endingForecast: (beat.ending_forecast || []) as string[],
    imageUrl: beat.image_url || undefined,
    imageVersion: beat.image_synced_at || undefined,
    imageStatus: beat.image_status,
    imageError: beat.image_error || undefined,
    imageProviderKey: beat.image_provider_key || undefined,
    imageModelKey: beat.image_model_key || undefined,
    imageGenerationMetadata: beat.image_generation_metadata || undefined,
    imageGallery: parseGalleryRows(beat.image_gallery),
    audioUrl: beat.audio_url || undefined,
    audioVersion: beat.audio_synced_at || undefined,
    audioStatus: beat.audio_status,
    audioError: beat.audio_error || undefined,
    narrationVoiceId: beat.narration_voice_id || undefined,
    narrationMetadata: beat.narration_metadata as StoryBeat['narrationMetadata'] | undefined,
    activeNarrationPreviewId: beat.active_narration_preview_id || undefined,
    isStoryboard: beat.is_storyboard || undefined,
    reelCaptions: Array.isArray(beat.reel_captions)
      ? beat.reel_captions as StoryBeat['reelCaptions']
      : undefined,
    storyboardNarrationTiming: beat.storyboard_narration_timing || undefined,
    storyTextOverlayEnabled: typeof beat.story_text_overlay_enabled === 'boolean'
      ? beat.story_text_overlay_enabled
      : undefined,
    storyTextOverlayMode: beat.story_text_overlay_mode || undefined,
    storyTextOverlayStyle: beat.story_text_overlay_style || undefined,
    storyTextOverlayCaptions: Array.isArray(beat.story_text_overlay_captions)
      ? beat.story_text_overlay_captions
      : undefined,
    storyTextOverlayAlignment: beat.story_text_overlay_alignment || undefined,
    storyEffects: beat.story_effects ? normalizeStoryEffectConfig(beat.story_effects) : undefined,
    originKind: (beat.origin_kind as StoryBeat['originKind'] | null) || undefined,
    seedPlanBeatIndex: beat.seed_plan_beat_index || undefined,
    canonicalOptionId: beat.canonical_option_id || undefined,
  });
  return {
    id: beat.node_id,
    beatNumber: beat.beat_number,
    parentId: beat.parent_node_id,
    selectedOptionId: beat.selected_option_id,
    data: normalizedBeat,
    children: childNodeIds,
  };
}

/**
 * Reconstruct a StoryMap from normalized beats rows.
 */
function reconstructStoryMap(beats: DbBeat[], currentNodeId?: string | null): StoryMap {
  // Build a map of node_id → DbBeat
  const beatsByNodeId = new Map<string, DbBeat>();
  for (const beat of beats) {
    beatsByNodeId.set(beat.node_id, beat);
  }

  // Build children map: parent_node_id → child node_ids
  const childrenMap = new Map<string, string[]>();
  let rootNodeId = '';
  for (const beat of beats) {
    if (!beat.parent_node_id) {
      rootNodeId = beat.node_id;
    } else {
      const siblings = childrenMap.get(beat.parent_node_id) || [];
      siblings.push(beat.node_id);
      childrenMap.set(beat.parent_node_id, siblings);
    }
  }

  // Build StoryNode records
  const nodes: Record<string, StoryNode> = {};
  for (const beat of beats) {
    const childNodeIds = childrenMap.get(beat.node_id) || [];
    nodes[beat.node_id] = beatRowToNode(beat, childNodeIds);
  }

  return {
    nodes,
    rootNodeId,
    currentNodeId: currentNodeId || rootNodeId,
  };
}

// ============================================================
// Save / Load Story
// ============================================================

/**
 * Save or update a story in the database.
 * Dual-writes: saves both story_map JSONB (legacy) and normalized beats.
 */
export async function saveStory(
  session: StorySession,
  storyMapWithUrls: StoryMap
): Promise<{ storyId: string; beatsWarning?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

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
      .eq('user_id', user.id)
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

    const { data: existingBeatRows, error: existingBeatRowsError } = await supabase
      .from('beats')
      .select('node_id, image_url, audio_url, image_synced_at, audio_synced_at')
      .eq('story_id', session.savedStoryId)
      .eq('generated_by', user.id);

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
    user_id: user.id,
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
  };

  let storyId: string;

  // Upsert: if savedStoryId exists, update; otherwise insert
  if (session.savedStoryId) {
    const { error } = await supabase
      .from('stories')
      .update(storyData)
      .eq('id', session.savedStoryId)
      .eq('user_id', user.id);

    if (error) {
      if (isMissingAdditiveColumnError(error, 'stories')) {
        const { error: fallbackError } = await supabase
          .from('stories')
          .update(withoutAdditiveColumns(storyData, ADDITIVE_STORY_COLUMNS))
          .eq('id', session.savedStoryId)
          .eq('user_id', user.id);

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
    nodeToBeatRow(storyId, nodeId, node, user.id, existingBeatUrlMap.get(nodeId))
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

/**
 * Load a saved story from the database.
 * Tries normalized beats first, falls back to story_map JSONB.
 */
export async function loadStory(storyId: string): Promise<StorySession> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();

  if (error || !data) throw new Error('Story not found');

  const story = data as DbStory;
  let rawStoryMap = story.story_map && typeof story.story_map === 'object' && 'nodes' in story.story_map
    ? (story.story_map as unknown as StoryMap)
    : null;

  // Try loading from normalized beats table
  const { data: beats } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .order('beat_number', { ascending: true });

  let repairedBeats = (beats as DbBeat[] | null) || [];
  if (repairedBeats.length > 0) {
    const repairResult = await repairMissingReadyBeatImageUrls(
      supabase,
      storyId,
      story.user_id,
      repairedBeats,
      rawStoryMap
    );
    repairedBeats = repairResult.beats;
    rawStoryMap = repairResult.storyMap;
  }

  let storyMap: StoryMap;
  if (repairedBeats.length > 0) {
    storyMap = reconstructStoryMap(repairedBeats, story.current_node_id);
    // Merge fields that only live inside story_map JSONB so older normalized rows still
    // preserve storyboard metadata and additive compatibility fields.
    if (rawStoryMap) {
      const jsonbMap = rawStoryMap;
      for (const nodeId of Object.keys(storyMap.nodes)) {
        const jsonbNode = jsonbMap.nodes?.[nodeId];
        if (!jsonbNode?.data) continue;
        storyMap.nodes[nodeId] = {
          ...storyMap.nodes[nodeId],
          data: {
            ...storyMap.nodes[nodeId].data,
            ...(!storyMap.nodes[nodeId].data.imageUrl && jsonbNode.data.imageUrl
              ? { imageUrl: jsonbNode.data.imageUrl }
              : {}),
            ...(!storyMap.nodes[nodeId].data.imageStatus && jsonbNode.data.imageStatus
              ? { imageStatus: jsonbNode.data.imageStatus }
              : {}),
            ...(!storyMap.nodes[nodeId].data.imageError && jsonbNode.data.imageError
              ? { imageError: jsonbNode.data.imageError }
              : {}),
            ...(!storyMap.nodes[nodeId].data.audioUrl && jsonbNode.data.audioUrl
              ? { audioUrl: jsonbNode.data.audioUrl }
              : {}),
            ...(!storyMap.nodes[nodeId].data.audioStatus && jsonbNode.data.audioStatus
              ? { audioStatus: jsonbNode.data.audioStatus }
              : {}),
            ...(!storyMap.nodes[nodeId].data.audioError && jsonbNode.data.audioError
              ? { audioError: jsonbNode.data.audioError }
              : {}),
            ...(jsonbNode.data.characters
              ? {
                  characters: mergeCharactersWithFallback(
                    storyMap.nodes[nodeId].data.characters,
                    jsonbNode.data.characters
                  ),
                }
              : {}),
            ...(jsonbNode.data.isStoryboard ? { isStoryboard: true } : {}),
            ...(jsonbNode.data.storyTextParts ? { storyTextParts: jsonbNode.data.storyTextParts } : {}),
            ...(jsonbNode.data.newCharacterIds ? { newCharacterIds: jsonbNode.data.newCharacterIds } : {}),
            ...(jsonbNode.data.changedCharacterIds ? { changedCharacterIds: jsonbNode.data.changedCharacterIds } : {}),
            ...(jsonbNode.data.storyboardPlan ? { storyboardPlan: jsonbNode.data.storyboardPlan } : {}),
            ...(jsonbNode.data.storyboardPromptText ? { storyboardPromptText: jsonbNode.data.storyboardPromptText } : {}),
            ...((!storyMap.nodes[nodeId].data.reelCaptions || storyMap.nodes[nodeId].data.reelCaptions.length === 0)
              && jsonbNode.data.reelCaptions
              ? { reelCaptions: jsonbNode.data.reelCaptions }
              : {}),
            ...(!storyMap.nodes[nodeId].data.storyboardNarrationTiming
              && jsonbNode.data.storyboardNarrationTiming
              ? { storyboardNarrationTiming: jsonbNode.data.storyboardNarrationTiming }
              : {}),
            ...(typeof storyMap.nodes[nodeId].data.storyTextOverlayEnabled !== 'boolean'
              && typeof jsonbNode.data.storyTextOverlayEnabled === 'boolean'
              ? { storyTextOverlayEnabled: jsonbNode.data.storyTextOverlayEnabled }
              : {}),
            ...(!storyMap.nodes[nodeId].data.storyTextOverlayMode
              && jsonbNode.data.storyTextOverlayMode
              ? { storyTextOverlayMode: jsonbNode.data.storyTextOverlayMode }
              : {}),
            ...(!storyMap.nodes[nodeId].data.storyTextOverlayStyle
              && jsonbNode.data.storyTextOverlayStyle
              ? { storyTextOverlayStyle: jsonbNode.data.storyTextOverlayStyle }
              : {}),
            ...((!storyMap.nodes[nodeId].data.storyTextOverlayCaptions || storyMap.nodes[nodeId].data.storyTextOverlayCaptions.length === 0)
              && jsonbNode.data.storyTextOverlayCaptions
              ? { storyTextOverlayCaptions: jsonbNode.data.storyTextOverlayCaptions }
              : {}),
            ...(!storyMap.nodes[nodeId].data.storyTextOverlayAlignment
              && jsonbNode.data.storyTextOverlayAlignment
              ? { storyTextOverlayAlignment: jsonbNode.data.storyTextOverlayAlignment }
              : {}),
            ...(!storyMap.nodes[nodeId].data.storyEffects && jsonbNode.data.storyEffects
              ? { storyEffects: normalizeStoryEffectConfig(jsonbNode.data.storyEffects) }
              : {}),
            ...(jsonbNode.data.finalImagePromptText ? { finalImagePromptText: jsonbNode.data.finalImagePromptText } : {}),
            ...(jsonbNode.data.originKind ? { originKind: jsonbNode.data.originKind } : {}),
            ...(jsonbNode.data.seedPlanBeatIndex ? { seedPlanBeatIndex: jsonbNode.data.seedPlanBeatIndex } : {}),
            ...(jsonbNode.data.canonicalOptionId ? { canonicalOptionId: jsonbNode.data.canonicalOptionId } : {}),
            ...((!storyMap.nodes[nodeId].data.imageGallery || storyMap.nodes[nodeId].data.imageGallery.length === 0)
              && Array.isArray(jsonbNode.data.imageGallery)
              ? { imageGallery: jsonbNode.data.imageGallery }
              : {}),
          },
        };
        storyMap.nodes[nodeId].data.imageVersion = repairedBeats.find((beat) => beat.node_id === nodeId)?.image_synced_at || undefined;
        storyMap.nodes[nodeId].data.audioVersion = repairedBeats.find((beat) => beat.node_id === nodeId)?.audio_synced_at || undefined;
        storyMap.nodes[nodeId].data = normalizeBeatMediaFields(storyMap.nodes[nodeId].data);
      }
    }
  } else {
    // Fallback to legacy story_map JSONB
    storyMap = rawStoryMap as StoryMap;
  }

  // Replace private storage URLs with signed URLs so images/audio load in the browser
  storyMap = await signStoryMapAssetUrls(supabase, storyMap);
  for (const nodeId of Object.keys(storyMap.nodes)) {
    storyMap.nodes[nodeId] = {
      ...storyMap.nodes[nodeId],
      data: normalizeBeatMediaFields(storyMap.nodes[nodeId].data),
    };
  }
  const signedRosterCharacters = await signCharacterRosterReferenceSheetUrls(
    supabase,
    (story.characters ?? []) as unknown as Character[]
  );
  const storyConfig = normalizeStoryConfig({
    ...(story.story_config as any),
    storyKind: story.story_kind,
    isVerticalStory: story.is_vertical_story,
    aspectRatio: story.aspect_ratio,
  });

  // Pack 2: rebuild the episode context for series stories so continuation
  // beats keep the carried bible/journal canon. Best-effort — a missing bible
  // (flag off, RLS, un-migrated DB) still yields a valid session.
  let episodeContext: StorySession['episodeContext'];
  if (story.episode_branch_id && story.episode_number) {
    episodeContext = {
      branchId: story.episode_branch_id,
      episodeNumber: story.episode_number,
      parentStoryId: story.parent_story_id ?? undefined,
    };
    try {
      const [{ data: bibleRow }, { data: journalRows }] = await Promise.all([
        supabase
          .from('story_bibles')
          .select('title, bible_text')
          .eq('branch_id', story.episode_branch_id)
          .maybeSingle(),
        supabase
          .from('episode_journal_events')
          .select('summary, payload, event_type, story_id')
          .eq('branch_id', story.episode_branch_id)
          .eq('event_type', 'episode_summary')
          .neq('story_id', story.id)
          .order('sequence_no', { ascending: false })
          .limit(5),
      ]);
      if (bibleRow) {
        episodeContext.seriesTitle = bibleRow.title || undefined;
        episodeContext.bibleText = bibleRow.bible_text || undefined;
      }
      const summaries = (journalRows ?? [])
        .map((row) => row.summary as string)
        .filter(Boolean)
        .reverse();
      if (summaries.length > 0) {
        episodeContext.journalSummary = summaries.join('\n\n');
      }
    } catch (episodeError) {
      console.error('Failed to load episode context (continuing without):', episodeError);
    }
  }

  return {
    storySessionId: story.id,
    savedStoryId: story.id,
    savedByUserId: story.user_id,
    sourceUpdatedAt: story.updated_at,
    userPrompt: story.user_prompt,
    title: story.title,
    genre: story.genre || 'adventure',
    tone: story.tone || 'playful',
    targetAge: story.target_age || 'all_ages',
    visualStyle: story.visual_style || deriveVisualStyleSummary(storyConfig.visualSettings),
    currentBeat: 0,
    maxBeats: storyConfig.maxBeats,
    status: story.status as 'active' | 'completed' | 'error',
    characters: signedRosterCharacters as any,
    setting: (story.setting || { world: 'unknown', timeOfDay: 'unknown', mood: 'unknown' }) as any,
    storyConfig,
    storyMap,
    beats: [],
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: 'all_ages',
    narratorVoice: story.narrator_voice || undefined,
    narrationVoiceMode: story.narration_voice_mode === 'user_selected' ? 'user_selected' : 'legacy_auto',
    narrationVoiceGenderBucket: story.narration_voice_gender_bucket === 'male' ? 'male' : story.narration_voice_gender_bucket === 'female' ? 'female' : undefined,
    narrationLanguageCode: story.narration_language_code === 'en-IN' || story.narration_language_code === 'hi-IN' ? story.narration_language_code : undefined,
    ...(episodeContext ? { episodeContext } : {}),
  };
}

// ============================================================
// Incremental Beat Save
// ============================================================

/**
 * Save a single beat incrementally (fire-and-forget from client).
 * Works for both story creators and explorers (shared branching).
 */
export async function saveBeat(
  storyId: string,
  nodeId: string,
  node: StoryNode,
  options?: {
    /** Append this node to its parent's children in story_map so a beat saved
     *  before the client's next full save is reachable after reload. */
    linkToParent?: boolean;
    /** Move story_map.currentNodeId to this node (branch continuation). */
    setAsCurrent?: boolean;
  }
): Promise<{ beatId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: existingBeat } = await supabase
    .from('beats')
      .select('image_url, audio_url, image_synced_at, audio_synced_at')
    .eq('story_id', storyId)
    .eq('node_id', nodeId)
    .eq('generated_by', user.id)
    .maybeSingle();

  const beatForSave: StoryNode = {
    ...node,
    data: {
      ...node.data,
      imageUrl: resolvePersistedImageUrlForSave(node.data, existingBeat
        ? { imageUrl: existingBeat.image_url || undefined }
        : undefined),
      persistedImageUrl: undefined,
      audioUrl: resolvePersistedAudioUrlForSave(node.data, existingBeat
        ? { audioUrl: existingBeat.audio_url || undefined }
        : undefined),
    },
  };

  const beatRow = nodeToBeatRow(storyId, nodeId, beatForSave, user.id, existingBeat
    ? {
        imageUrl: existingBeat.image_url || undefined,
        audioUrl: existingBeat.audio_url || undefined,
        imageSyncedAt: existingBeat.image_synced_at || undefined,
        audioSyncedAt: existingBeat.audio_synced_at || undefined,
      }
    : undefined);

  // Count the character as used once it has reached the user's generated beat,
  // even if an older beats schema later requires the persistence fallback.
  await recordCharacterNoveltyUsageAction({
    storyId,
    characters: node.data.characters || [],
  });

  const { data, error } = await supabase
    .from('beats')
    .upsert(beatRow, { onConflict: 'story_id,node_id' })
    .select('id')
    .single();

  if (error) {
    if (isMissingBeatColumnError(error)) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('beats')
        .upsert(withoutAdditiveBeatColumns(beatRow), { onConflict: 'story_id,node_id' })
        .select('id')
        .single();

      if (!fallbackError && fallbackData) {
        console.warn('Saved beat without additive beat metadata because the database schema is missing newer beat columns.');
        return { beatId: fallbackData.id };
      }

      throw new Error(`Failed to save beat: ${fallbackError?.message || error.message}`);
    }

    throw new Error(`Failed to save beat: ${error.message}`);
  }

  const { data: storyForPatch, error: storyForPatchError } = await supabase
    .from('stories')
    .select('story_map')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!storyForPatchError && storyForPatch?.story_map && typeof storyForPatch.story_map === 'object' && 'nodes' in storyForPatch.story_map) {
    const storyMap = storyForPatch.story_map as unknown as StoryMap;
    const patchedNodes: StoryMap['nodes'] = {
      ...storyMap.nodes,
      [nodeId]: node,
    };
    if (options?.linkToParent && node.parentId) {
      const parent = storyMap.nodes[node.parentId];
      if (parent && !parent.children.includes(nodeId)) {
        patchedNodes[node.parentId] = { ...parent, children: [...parent.children, nodeId] };
      }
    }
    const patchedMap: StoryMap = {
      ...storyMap,
      nodes: patchedNodes,
      currentNodeId: options?.setAsCurrent ? nodeId : (storyMap.currentNodeId || nodeId),
      rootNodeId: storyMap.rootNodeId || nodeId,
    };

    const { error: storyMapPatchError } = await supabase
      .from('stories')
      .update({
        story_map: stripBase64(patchedMap, storyMap) as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', storyId)
      .eq('user_id', user.id);

    if (storyMapPatchError) {
      console.warn('Failed to patch story_map during incremental beat save:', storyMapPatchError.message);
    }
  }

  return { beatId: data.id };
}

/**
 * Patch beat media fields in both normalized beats rows and stories.story_map.
 */
export async function updateBeatMediaState(
  storyId: string,
  nodeId: string,
  patch: {
    imageUrl?: string | null;
    imageStatus?: BeatMediaStatus;
    imageError?: string | null;
    imageGallery?: BeatImageGalleryEntry[];
    audioUrl?: string | null;
    audioStatus?: BeatMediaStatus;
    audioError?: string | null;
    narrationVoiceId?: string | null;
    narrationMetadata?: StoryBeat['narrationMetadata'] | null;
    activeNarrationPreviewId?: string | null;
    characters?: Character[];
    reelCaptions?: StoryBeat['reelCaptions'] | null;
    storyboardNarrationTiming?: StoryBeat['storyboardNarrationTiming'] | null;
    storyTextOverlayEnabled?: boolean | null;
    storyTextOverlayMode?: StoryBeat['storyTextOverlayMode'] | null;
    storyTextOverlayStyle?: StoryBeat['storyTextOverlayStyle'] | null;
    storyTextOverlayCaptions?: StoryBeat['storyTextOverlayCaptions'] | null;
    storyTextOverlayAlignment?: StoryBeat['storyTextOverlayAlignment'] | null;
    storyEffects?: StoryBeat['storyEffects'] | null;
  },
  // When present, run against the service-role client on behalf of `userId`
  // instead of the caller's auth session. This lets a background worker (which
  // has no user cookie) persist beat media. The interactive path passes nothing
  // and is byte-for-byte unchanged.
  serverAuth?: { userId: string }
): Promise<void> {
  const supabase = serverAuth ? createAdminClient() : await createClient();
  let userId: string;
  if (serverAuth) {
    userId = serverAuth.userId;
  } else {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');
    userId = user.id;
  }

  const updateData: Record<string, unknown> = {};
  if ('imageUrl' in patch) {
    updateData.image_url = patch.imageUrl ? normalizeStorageUrl(patch.imageUrl, 'story-assets') : null;
  }
  if (patch.imageStatus) updateData.image_status = patch.imageStatus;
  if ('imageError' in patch) updateData.image_error = patch.imageError ?? null;
  if (patch.imageStatus === 'ready') {
    updateData.image_synced_at = new Date().toISOString();
  } else if ('imageUrl' in patch || patch.imageStatus) {
    updateData.image_synced_at = null;
  }
  if ('imageGallery' in patch) {
    updateData.image_gallery = serializeGalleryRows(patch.imageGallery, (url) =>
      normalizeStorageUrl(url, 'story-assets')
    );
  }
  if ('audioUrl' in patch) {
    updateData.audio_url = patch.audioUrl ? normalizeStorageUrl(patch.audioUrl, 'story-assets') : null;
    if (!('storyboardNarrationTiming' in patch)) {
      updateData.storyboard_narration_timing = null;
    }
  }
  if (patch.audioStatus) updateData.audio_status = patch.audioStatus;
  if ('audioError' in patch) updateData.audio_error = patch.audioError ?? null;
  if (patch.audioStatus === 'ready') {
    updateData.audio_synced_at = new Date().toISOString();
  } else if ('audioUrl' in patch || patch.audioStatus) {
    updateData.audio_synced_at = null;
  }
  if ('narrationVoiceId' in patch) {
    updateData.narration_voice_id = patch.narrationVoiceId ?? null;
  }
  if ('narrationMetadata' in patch) {
    updateData.narration_metadata = patch.narrationMetadata
      ? patch.narrationMetadata as unknown as Record<string, unknown>
      : null;
  }
  if ('activeNarrationPreviewId' in patch) {
    updateData.active_narration_preview_id = patch.activeNarrationPreviewId ?? null;
  }
  if (patch.characters) {
    updateData.characters = patch.characters as unknown as Record<string, unknown>[];
  }
  if ('reelCaptions' in patch) {
    updateData.reel_captions = patch.reelCaptions
      ? patch.reelCaptions as unknown as Record<string, unknown>[]
      : null;
  }
  if ('storyboardNarrationTiming' in patch) {
    updateData.storyboard_narration_timing = patch.storyboardNarrationTiming
      ? patch.storyboardNarrationTiming as unknown as Record<string, unknown>
      : null;
  }
  if ('storyTextOverlayEnabled' in patch) {
    updateData.story_text_overlay_enabled = patch.storyTextOverlayEnabled ?? null;
  }
  if ('storyTextOverlayMode' in patch) {
    updateData.story_text_overlay_mode = patch.storyTextOverlayMode ?? null;
  }
  if ('storyTextOverlayStyle' in patch) {
    updateData.story_text_overlay_style = patch.storyTextOverlayStyle
      ? patch.storyTextOverlayStyle as unknown as Record<string, unknown>
      : null;
  }
  if ('storyTextOverlayCaptions' in patch) {
    updateData.story_text_overlay_captions = patch.storyTextOverlayCaptions
      ? patch.storyTextOverlayCaptions as unknown as Record<string, unknown>[]
      : null;
  }
  if ('storyTextOverlayAlignment' in patch) {
    updateData.story_text_overlay_alignment = patch.storyTextOverlayAlignment
      ? patch.storyTextOverlayAlignment as unknown as Record<string, unknown>
      : null;
  }
  if ('storyEffects' in patch) {
    updateData.story_effects = patch.storyEffects
      ? normalizeStoryEffectConfig(patch.storyEffects) as unknown as Record<string, unknown>
      : null;
  }

  if (Object.keys(updateData).length === 0) return;

  let beatUpdateQuery = supabase
    .from('beats')
    .update(updateData)
    .eq('story_id', storyId)
    .eq('node_id', nodeId);
  // The worker (admin client) scopes by story + node only; the interactive path
  // keeps the RLS-aligned generated_by guard.
  if (!serverAuth) beatUpdateQuery = beatUpdateQuery.eq('generated_by', userId);
  const { data: updatedBeatRows, error } = await beatUpdateQuery
    .select('id')
    .limit(1);

  if (error) {
    throw new Error(`Failed to update beat media state: ${error.message}`);
  }
  if (!updatedBeatRows || updatedBeatRows.length === 0) {
    throw new Error(`Failed to update beat media state: ${BEAT_ROW_NOT_FOUND_MESSAGE}`);
  }

  let storyQuery = supabase
    .from('stories')
    .select('story_map')
    .eq('id', storyId);
  if (!serverAuth) storyQuery = storyQuery.eq('user_id', userId);
  const { data: story, error: storyError } = await storyQuery.single();

  if (storyError || !story) {
    throw new Error(`Failed to load story map for media patch: ${storyError?.message || 'Story not found'}`);
  }

  const rawMap = story.story_map;
  if (!rawMap || typeof rawMap !== 'object' || !('nodes' in rawMap)) {
    throw new Error('Story map is missing or corrupted');
  }

  const storyMap = rawMap as unknown as StoryMap;
  const node = storyMap.nodes[nodeId];
  if (!node) {
    throw new Error('Story node was not found while patching media state');
  }

  const nextBeat = normalizeBeatMediaFields({
    ...node.data,
    ...('imageUrl' in patch ? {
      imageUrl: patch.imageUrl ? normalizeStorageUrl(patch.imageUrl, 'story-assets') : undefined,
      persistedImageUrl: patch.imageUrl ? normalizeStorageUrl(patch.imageUrl, 'story-assets') : undefined,
    } : {}),
    ...(patch.imageStatus ? { imageStatus: patch.imageStatus } : {}),
    ...('imageError' in patch ? { imageError: patch.imageError || undefined } : {}),
    ...('imageGallery' in patch ? {
      imageGallery: sanitizeGalleryForBlob(patch.imageGallery, (url) =>
        normalizeStorageUrl(url, 'story-assets')
      ),
    } : {}),
    ...('audioUrl' in patch ? { audioUrl: patch.audioUrl ? normalizeStorageUrl(patch.audioUrl, 'story-assets') : undefined } : {}),
    ...('audioUrl' in patch && !('storyboardNarrationTiming' in patch) ? { storyboardNarrationTiming: undefined } : {}),
    ...(patch.audioStatus ? { audioStatus: patch.audioStatus } : {}),
    ...('audioError' in patch ? { audioError: patch.audioError || undefined } : {}),
    ...('narrationVoiceId' in patch ? { narrationVoiceId: patch.narrationVoiceId || undefined } : {}),
    ...('narrationMetadata' in patch ? { narrationMetadata: patch.narrationMetadata || undefined } : {}),
    ...('activeNarrationPreviewId' in patch ? { activeNarrationPreviewId: patch.activeNarrationPreviewId || undefined } : {}),
    ...(patch.characters ? { characters: patch.characters } : {}),
    ...('reelCaptions' in patch ? { reelCaptions: patch.reelCaptions || undefined } : {}),
    ...('storyboardNarrationTiming' in patch ? {
      storyboardNarrationTiming: patch.storyboardNarrationTiming || undefined,
    } : {}),
    ...('storyTextOverlayEnabled' in patch ? {
      storyTextOverlayEnabled: patch.storyTextOverlayEnabled ?? undefined,
    } : {}),
    ...('storyTextOverlayMode' in patch ? {
      storyTextOverlayMode: patch.storyTextOverlayMode || undefined,
    } : {}),
    ...('storyTextOverlayStyle' in patch ? {
      storyTextOverlayStyle: patch.storyTextOverlayStyle || undefined,
    } : {}),
    ...('storyTextOverlayCaptions' in patch ? {
      storyTextOverlayCaptions: patch.storyTextOverlayCaptions || undefined,
    } : {}),
    ...('storyTextOverlayAlignment' in patch ? {
      storyTextOverlayAlignment: patch.storyTextOverlayAlignment || undefined,
    } : {}),
    ...('storyEffects' in patch ? {
      storyEffects: patch.storyEffects ? normalizeStoryEffectConfig(patch.storyEffects) : undefined,
    } : {}),
  });

  const patchedMap: StoryMap = {
    ...storyMap,
    nodes: {
      ...storyMap.nodes,
      [nodeId]: {
        ...node,
        data: nextBeat,
      },
    },
  };

  let storyUpdateQuery = supabase
    .from('stories')
    .update({
      story_map: stripBase64(patchedMap) as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storyId);
  if (!serverAuth) storyUpdateQuery = storyUpdateQuery.eq('user_id', userId);
  const { error: storyUpdateError } = await storyUpdateQuery;

  if (storyUpdateError) {
    throw new Error(`Failed to patch story map media state: ${storyUpdateError.message}`);
  }
}

/**
 * Same as {@link updateBeatMediaState}, but retries when the beat row isn't found yet.
 *
 * In regular (interactive) mode, narration is kicked off before the client's
 * fire-and-forget beat save has inserted the beat row, so a media patch can race
 * ahead and hit BEAT_ROW_NOT_FOUND. That's transient — the insert lands moments
 * later — so we retry that specific error a bounded number of times. Any other
 * error propagates immediately. Runs in the background (the user already hears the
 * audio), so the wait doesn't affect perceived latency. Batch/worker callers, which
 * insert the beat row before narrating, should pass { attempts: 1 } to opt out.
 */
export async function updateBeatMediaStateWithRetry(
  storyId: string,
  nodeId: string,
  patch: Parameters<typeof updateBeatMediaState>[2],
  serverAuth?: { userId: string },
  options: { attempts?: number; delayMs?: number } = {}
): Promise<void> {
  // Bounded so the total added time stays well under serverless duration caps —
  // narration itself already runs ~20-27s inside this same invocation.
  const attempts = Math.max(1, options.attempts ?? 8);
  const delayMs = Math.max(250, options.delayMs ?? 1500);
  for (let attempt = 1; ; attempt++) {
    try {
      await updateBeatMediaState(storyId, nodeId, patch, serverAuth);
      return;
    } catch (error) {
      if (!isBeatRowNotFoundError(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function updateBeatAssets(
  storyId: string,
  nodeId: string,
  assets: { imageUrl?: string; audioUrl?: string }
): Promise<void> {
  await updateBeatMediaState(storyId, nodeId, {
    ...(assets.imageUrl ? { imageUrl: assets.imageUrl, imageStatus: 'ready' as const, imageError: null } : {}),
    ...(assets.audioUrl ? { audioUrl: assets.audioUrl, audioStatus: 'ready' as const, audioError: null } : {}),
  });
}

// ============================================================
// Auto-Publish Storyline
// ============================================================

/**
 * Compute a path hash for duplicate storyline detection.
 * Uses a simple hash of the node_path joined by '|'.
 */
async function computePathHash(nodePath: string[]): Promise<string> {
  const data = new TextEncoder().encode(nodePath.join('|'));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Walk from an ending beat back to root to get the full node path.
 */
function walkPathToRoot(beats: DbBeat[], endingNodeId: string): string[] {
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

/**
 * Auto-publish a completed storyline when an ending beat is reached.
 * - Checks for duplicate paths via path_hash
 * - Creates storyline + storyline_beats junction rows
 * - Auto-saves to user's saved_storylines
 */
export async function autoPublishStoryline(
  storyId: string,
  endingNodeId: string,
  storyTitle: string,
  coverImageUrl?: string | null
): Promise<{ alreadyPublished: boolean; storylineId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: sourceStory, error: sourceStoryError } = await supabase
    .from('stories')
    .select('story_config, story_kind, is_vertical_story, aspect_ratio, genre')
    .eq('id', storyId)
    .maybeSingle();

  if (sourceStoryError) {
    throw new Error(`Failed to fetch story orientation: ${sourceStoryError.message}`);
  }

  const seriesFields = await resolveStorylineSeriesFields(supabase, storyId);

  const storyConfig = normalizeStoryConfig({
    ...((sourceStory?.story_config as Record<string, unknown> | null) ?? {}),
    story_kind: sourceStory?.story_kind,
    isVerticalStory: sourceStory?.is_vertical_story,
    aspectRatio: sourceStory?.aspect_ratio,
  });
  const orientation = getStoryOrientation(storyConfig);

  // Fetch all beats for the story to walk the path
  const { data: allBeats, error: beatsError } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId);

  if (beatsError || !allBeats) throw new Error('Failed to fetch beats');

  // Walk from ending to root
  const nodePath = walkPathToRoot(allBeats as DbBeat[], endingNodeId);
  if (nodePath.length === 0) throw new Error('Invalid path');

  // Compute path hash for duplicate detection
  const pathHash = await computePathHash(nodePath);

  // Check if this exact path is already published
  const { data: existing } = await supabase
    .from('storylines')
    .select('id')
    .eq('story_id', storyId)
    .eq('path_hash', pathHash)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Refresh the stored storyline snapshot when republishing the same path.
    const existingBeatsMap = new Map<string, DbBeat>();
    for (const beat of allBeats as DbBeat[]) {
      existingBeatsMap.set(beat.node_id, beat);
    }

    const refreshedChoices: StorylineChoice[] = [];
    for (let i = 1; i < nodePath.length; i++) {
      const currentBeat = existingBeatsMap.get(nodePath[i]);
      const parentBeat = existingBeatsMap.get(nodePath[i - 1]);
      if (currentBeat?.selected_option_id && parentBeat?.options) {
        const options = parentBeat.options as unknown as { id: string; label: string }[];
        const option = options.find(o => o.id === currentBeat.selected_option_id);
        if (option) {
          refreshedChoices.push({ fromBeat: parentBeat.beat_number, optionLabel: option.label });
        }
      }
    }

    const refreshedPathBeats = nodePath.map(nid => existingBeatsMap.get(nid)).filter(Boolean) as DbBeat[];
    const refreshedLegacyBeats = refreshedPathBeats.map(b => ({
      title: b.title,
      beatNumber: b.beat_number,
      isEnding: b.is_ending,
      storyText: b.story_text,
      sceneSummary: b.scene_summary,
      options: b.options,
      characters: b.characters,
      continuityNotes: b.continuity_notes,
      imagePrompt: b.image_prompt,
      clues: b.clues,
      nextBeatGoal: b.next_beat_goal,
      endingForecast: b.ending_forecast,
      imageUrl: b.image_url,
      imageStatus: b.image_status,
      imageError: b.image_error || undefined,
      audioUrl: b.audio_url,
      audioStatus: b.audio_status,
      audioError: b.audio_error || undefined,
      narrationVoiceId: b.narration_voice_id || undefined,
      narrationMetadata: b.narration_metadata as StoryBeat['narrationMetadata'] | undefined,
      activeNarrationPreviewId: b.active_narration_preview_id || undefined,
      isStoryboard: b.is_storyboard || undefined,
      reelCaptions: Array.isArray(b.reel_captions) ? b.reel_captions as StoryBeat['reelCaptions'] : undefined,
      storyboardNarrationTiming: b.storyboard_narration_timing || undefined,
      storyTextOverlayEnabled: typeof b.story_text_overlay_enabled === 'boolean'
        ? b.story_text_overlay_enabled
        : storyConfig.storyTextOverlay.enabled,
      storyTextOverlayMode: b.story_text_overlay_mode || storyConfig.storyTextOverlay.mode,
      storyTextOverlayStyle: b.story_text_overlay_style || storyConfig.storyTextOverlay.style,
      storyTextOverlayCaptions: Array.isArray(b.story_text_overlay_captions)
        ? b.story_text_overlay_captions as StoryBeat['storyTextOverlayCaptions']
        : undefined,
      storyTextOverlayAlignment: b.story_text_overlay_alignment || undefined,
      storyEffects: b.story_effects ? normalizeStoryEffectConfig(b.story_effects) : undefined,
      reelTextOverlayEnabled: storyConfig.reel.textOverlayEnabled,
      reelTextOverlayStyle: storyConfig.reel.textOverlayStyle,
      originKind: (b.origin_kind as StoryBeat['originKind'] | null) || undefined,
      seedPlanBeatIndex: b.seed_plan_beat_index || undefined,
      canonicalOptionId: b.canonical_option_id || undefined,
    }));
    const refreshedPublishModes = getStorylinePublishModes(storyConfig, 'standard', refreshedLegacyBeats);
    const refreshRow = {
      title: storyTitle,
      beat_count: nodePath.length,
      cover_image_url: coverImageUrl || null,
      is_vertical_story: orientation.isVerticalStory,
      aspect_ratio: orientation.aspectRatio,
      story_kind: storyConfig.storyKind,
      story_format: refreshedPublishModes.storyFormat,
      story_visual_mode: refreshedPublishModes.storyVisualMode,
      orientation: refreshedPublishModes.orientation,
      node_path: nodePath,
      beats: refreshedLegacyBeats as unknown as Record<string, unknown>[],
      choices: refreshedChoices as unknown as Record<string, unknown>[],
      age_group: normalizeStoredAgeGroup(storyConfig.ageGroup),
      genre: normalizeStoredGenre(sourceStory?.genre),
      ...seriesFields,
      is_public: true,
    };

    const { error: refreshError } = await supabase
      .from('storylines')
      .update(refreshRow)
      .eq('id', existing.id)
      .eq('user_id', user.id);

    if (refreshError) {
      if (isMissingAdditiveColumnError(refreshError, 'storylines')) {
        const { error: fallbackRefreshError } = await supabase
          .from('storylines')
          .update(withoutAdditiveColumns(refreshRow, ADDITIVE_STORYLINE_COLUMNS))
          .eq('id', existing.id)
          .eq('user_id', user.id);
        if (fallbackRefreshError) {
          throw new Error(`Failed to refresh published storyline: ${fallbackRefreshError.message}`);
        }
      } else {
        throw new Error(`Failed to refresh published storyline: ${refreshError.message}`);
      }
    }
    // The refresh above rewrote title and beats without going through
    // finalizeStorylineShareAssets, so the stored discovery intro would
    // otherwise describe the previous version.
    await refreshStorylineDiscoveryMetadata({
      storylineId: existing.id,
      storyId,
      title: storyTitle,
      beats: refreshedLegacyBeats,
    });

    // Already published — just auto-save to user's profile
    await supabase
      .from('saved_storylines')
      .upsert(
        { user_id: user.id, storyline_id: existing.id },
        { onConflict: 'user_id,storyline_id' }
      );

    return { alreadyPublished: true, storylineId: existing.id };
  }

  // Get author name from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();

  // Build beats map for junction
  const beatsMap = new Map<string, DbBeat>();
  for (const beat of allBeats as DbBeat[]) {
    beatsMap.set(beat.node_id, beat);
  }

  // Build choices array from path
  const choices: StorylineChoice[] = [];
  for (let i = 1; i < nodePath.length; i++) {
    const currentBeat = beatsMap.get(nodePath[i]);
    const parentBeat = beatsMap.get(nodePath[i - 1]);
    if (currentBeat?.selected_option_id && parentBeat?.options) {
      const options = parentBeat.options as unknown as { id: string; label: string }[];
      const option = options.find(o => o.id === currentBeat.selected_option_id);
      if (option) {
        choices.push({ fromBeat: parentBeat.beat_number, optionLabel: option.label });
      }
    }
  }

  // Create the storyline (legacy beats JSONB included for backward compat during transition)
  const pathBeats = nodePath.map(nid => beatsMap.get(nid)).filter(Boolean) as DbBeat[];
  const legacyBeats = pathBeats.map(b => ({
    title: b.title,
    beatNumber: b.beat_number,
    isEnding: b.is_ending,
    storyText: b.story_text,
    sceneSummary: b.scene_summary,
    options: b.options,
    characters: b.characters,
    continuityNotes: b.continuity_notes,
    imagePrompt: b.image_prompt,
    clues: b.clues,
    nextBeatGoal: b.next_beat_goal,
    endingForecast: b.ending_forecast,
    imageUrl: b.image_url,
    imageStatus: b.image_status,
    imageError: b.image_error || undefined,
    audioUrl: b.audio_url,
    audioStatus: b.audio_status,
    audioError: b.audio_error || undefined,
    narrationVoiceId: b.narration_voice_id || undefined,
    narrationMetadata: b.narration_metadata as StoryBeat['narrationMetadata'] | undefined,
    activeNarrationPreviewId: b.active_narration_preview_id || undefined,
    isStoryboard: b.is_storyboard || undefined,
    reelCaptions: Array.isArray(b.reel_captions) ? b.reel_captions as StoryBeat['reelCaptions'] : undefined,
    storyboardNarrationTiming: b.storyboard_narration_timing || undefined,
    storyTextOverlayEnabled: typeof b.story_text_overlay_enabled === 'boolean'
      ? b.story_text_overlay_enabled
      : storyConfig.storyTextOverlay.enabled,
    storyTextOverlayMode: b.story_text_overlay_mode || storyConfig.storyTextOverlay.mode,
    storyTextOverlayStyle: b.story_text_overlay_style || storyConfig.storyTextOverlay.style,
    storyTextOverlayCaptions: Array.isArray(b.story_text_overlay_captions)
      ? b.story_text_overlay_captions as StoryBeat['storyTextOverlayCaptions']
      : undefined,
    storyTextOverlayAlignment: b.story_text_overlay_alignment || undefined,
    storyEffects: b.story_effects ? normalizeStoryEffectConfig(b.story_effects) : undefined,
    reelTextOverlayEnabled: storyConfig.reel.textOverlayEnabled,
    reelTextOverlayStyle: storyConfig.reel.textOverlayStyle,
    originKind: (b.origin_kind as StoryBeat['originKind'] | null) || undefined,
    seedPlanBeatIndex: b.seed_plan_beat_index || undefined,
    canonicalOptionId: b.canonical_option_id || undefined,
  }));
  const publishModes = getStorylinePublishModes(storyConfig, 'standard', legacyBeats);

  const storylineRow = {
    story_id: storyId,
    user_id: user.id,
    title: storyTitle,
    beat_count: nodePath.length,
    cover_image_url: coverImageUrl || null,
    is_vertical_story: orientation.isVerticalStory,
    aspect_ratio: orientation.aspectRatio,
    story_kind: storyConfig.storyKind,
    story_format: publishModes.storyFormat,
    story_visual_mode: publishModes.storyVisualMode,
    orientation: publishModes.orientation,
    node_path: nodePath,
    beats: legacyBeats as unknown as Record<string, unknown>[],
    choices: choices as unknown as Record<string, unknown>[],
    age_group: normalizeStoredAgeGroup(storyConfig.ageGroup),
    genre: normalizeStoredGenre(sourceStory?.genre),
    ...seriesFields,
    author_name: profile?.display_name || 'Anonymous',
    is_public: true,
    path_hash: pathHash,
  };

  let storylineId: string | null = null;
  const { data: storyline, error: slError } = await supabase
    .from('storylines')
    .insert(storylineRow)
    .select('id')
    .single();

  if (slError) {
    // Handle concurrent publish race: another request beat us to the INSERT
    if (slError.code === '23505') {
      const { data: dup } = await supabase
        .from('storylines')
        .select('id')
        .eq('path_hash', pathHash)
        .maybeSingle();
      if (dup) {
        await supabase
          .from('saved_storylines')
          .upsert(
            { user_id: user.id, storyline_id: dup.id },
            { onConflict: 'user_id,storyline_id' }
          );
        return { alreadyPublished: true, storylineId: dup.id };
      }
    }
    if (isMissingAdditiveColumnError(slError, 'storylines')) {
      const { data: fallbackStoryline, error: fallbackError } = await supabase
        .from('storylines')
        .insert(withoutAdditiveColumns(storylineRow, ADDITIVE_STORYLINE_COLUMNS))
        .select('id')
        .single();

      if (fallbackError || !fallbackStoryline) {
        throw new Error(`Failed to publish storyline: ${fallbackError?.message || slError.message}`);
      }
      storylineId = fallbackStoryline.id;
    } else {
      throw new Error(`Failed to publish storyline: ${slError.message}`);
    }
  }

  storylineId = storylineId ?? storyline?.id ?? null;
  if (!storylineId) {
    throw new Error('Failed to publish storyline: missing inserted storyline id.');
  }
  const publishedStorylineId = storylineId;

  // Create storyline_beats junction rows
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

  const { error: junctionError } = await supabase
    .from('storyline_beats')
    .insert(junctionRows);

  if (junctionError) {
    console.error('Failed to create storyline_beats (non-fatal):', junctionError.message);
  }

  // Auto-save to user's profile
  await supabase
    .from('saved_storylines')
    .upsert(
      { user_id: user.id, storyline_id: publishedStorylineId },
      { onConflict: 'user_id,storyline_id' }
    );

  await finalizeStorylineShareAssets({
    storylineId: publishedStorylineId,
    storyId,
    userId: user.id,
    title: storyTitle,
    authorName: profile?.display_name || 'Anonymous',
    coverImageUrl: coverImageUrl || null,
    beats: legacyBeats as unknown as StoryBeat[],
    storyFormat: publishModes.storyFormat,
    storyVisualMode: publishModes.storyVisualMode,
    orientation: publishModes.orientation,
  });

  return { alreadyPublished: false, storylineId: publishedStorylineId };
}

// ============================================================
// Cover Image Helpers
// ============================================================

/**
 * Copy a beat image from the private story-assets bucket to the public
 * public-storylines bucket as a cover image. Returns the public URL.
 */
export async function copyCoverToPublicBucket(
  storyId: string,
  sourceImageUrl: string
): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const destPath = `${user.id}/${storyId}/cover.webp`;
  const copied = await copyToPublicBucket(supabase, sourceImageUrl, 'story-assets', 'public-storylines', destPath);
  if (copied) return copied;

  try {
    const asset = await processAndUploadStorylineAsset({
      userId: user.id,
      storyId,
      storylineId: storyId,
      kind: 'share_cover',
      source: 'fallback_beat',
      sourceUrlOrDataUrl: sourceImageUrl,
      versionSeed: `${storyId}:cover:${sourceImageUrl}`,
    });
    return asset.url;
  } catch (error) {
    console.error('Failed to copy non-Supabase cover source to public media:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Set the cover_image_url on the stories table (for tree thumbnails).
 */
export async function setStoryCoverImage(
  storyId: string,
  coverUrl: string
): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return;

  await supabase
    .from('stories')
    .update({ cover_image_url: coverUrl })
    .eq('id', storyId)
    .eq('user_id', user.id);
}

// ============================================================
// List / Delete / Archive
// ============================================================

// Signed thumbnail URLs must outlive the client-side list cache (5 min) by a
// comfortable margin; matches the gallery cover signing TTL.
const LIST_THUMBNAIL_SIGN_TTL_SECONDS = 60 * 60 * 24;

type ListThumbnail = { url: string | null; isStoryboard: boolean };

/**
 * Sign thumbnail URLs in place: private story-assets / R2 references become
 * signed URLs; public CDN URLs pass through untouched (so they stay cacheable).
 */
async function signListThumbnails(
  supabase: SupabaseClient,
  thumbnails: Map<string, ListThumbnail>
): Promise<Map<string, ListThumbnail>> {
  const urls = Array.from(thumbnails.values())
    .map((thumb) => thumb.url)
    .filter((url): url is string => Boolean(url));
  if (urls.length === 0) return thumbnails;

  try {
    const signed = await signMixedUrls(supabase, urls, 'story-assets', LIST_THUMBNAIL_SIGN_TTL_SECONDS);
    for (const [id, thumb] of thumbnails) {
      const signedUrl = thumb.url ? signed.get(thumb.url) : undefined;
      if (signedUrl) thumbnails.set(id, { ...thumb, url: signedUrl });
    }
  } catch (error) {
    console.error('Failed to sign list thumbnails:', error);
  }
  // An r2:// reference that couldn't be signed is not a fetchable URL — drop it
  // so the client falls back to the placeholder instead of a broken <Image>.
  for (const [id, thumb] of thumbnails) {
    if (thumb.url?.startsWith('r2://')) {
      thumbnails.set(id, { ...thumb, url: null });
    }
  }
  return thumbnails;
}

/**
 * Resolve display thumbnails for story list rows: cover image first, else the
 * story's root beat (first beat) image via one batched beats query. Covers of
 * storyboard-mode stories are copied beat grids, so the root beat's
 * is_storyboard flag decides the first-panel crop even when a cover is used
 * (client-side auto-detection can't work on thumbnail-sized image variants).
 * Failures degrade to no thumbnail — the list itself must never break over
 * covers.
 */
export async function resolveStoryListThumbnails(
  supabase: SupabaseClient,
  rows: Array<{ id: string; cover_image_url: string | null }>
): Promise<Map<string, ListThumbnail>> {
  const thumbnails = new Map<string, ListThumbnail>();
  if (rows.length === 0) return thumbnails;

  for (const row of rows) {
    const cover = row.cover_image_url?.trim();
    thumbnails.set(row.id, { url: cover || null, isStoryboard: false });
  }

  const { data: beatRows, error } = await supabase
    .from('beats')
    .select('story_id, image_url, is_storyboard')
    .in('story_id', rows.map((row) => row.id))
    .is('parent_node_id', null);

  if (error) {
    console.error('Failed to fetch story thumbnail beats:', error.message);
  }

  const rootBeatByStoryId = new Map<string, { image_url: string; isStoryboard: boolean }>();
  for (const beat of beatRows ?? []) {
    const imageUrl = typeof beat.image_url === 'string' ? beat.image_url.trim() : '';
    if (rootBeatByStoryId.has(beat.story_id)) continue;
    rootBeatByStoryId.set(beat.story_id, {
      image_url: imageUrl,
      isStoryboard: beat.is_storyboard === true,
    });
  }

  for (const row of rows) {
    const existing = thumbnails.get(row.id);
    const rootBeat = rootBeatByStoryId.get(row.id);
    if (!rootBeat) continue;
    thumbnails.set(row.id, {
      url: existing?.url || rootBeat.image_url || null,
      isStoryboard: rootBeat.isStoryboard,
    });
  }

  return signListThumbnails(supabase, thumbnails);
}

/**
 * Resolve display thumbnails for saved-storyline rows: storyline cover first,
 * else the first beat's image. The first beat is looked up through
 * `storylines.node_path` against the beats table — the storyline_beats
 * junction is not reliably populated (its insert is non-fatal on publish), so
 * node_path is the source of truth, same as the gallery cover pipeline. The
 * beat's is_storyboard flag drives the first-panel crop even for cover images,
 * since covers derive from beat grids.
 */
async function resolveStorylineListThumbnails(
  supabase: SupabaseClient,
  rows: Array<{
    storyline_id: string;
    story_id: string | null;
    first_node_id: string | null;
    cover_image_url: string | null;
  }>
): Promise<Map<string, ListThumbnail>> {
  const thumbnails = new Map<string, ListThumbnail>();
  if (rows.length === 0) return thumbnails;

  for (const row of rows) {
    const cover = row.cover_image_url?.trim();
    thumbnails.set(row.storyline_id, { url: cover || null, isStoryboard: false });
  }

  const targets = rows.filter(
    (row): row is typeof row & { story_id: string; first_node_id: string } =>
      Boolean(row.story_id && row.first_node_id)
  );

  if (targets.length > 0) {
    const { data: beatRows, error } = await supabase
      .from('beats')
      .select('story_id, node_id, image_url, is_storyboard')
      .in('story_id', Array.from(new Set(targets.map((t) => t.story_id))))
      .in('node_id', Array.from(new Set(targets.map((t) => t.first_node_id))));

    if (error) {
      console.error('Failed to fetch storyline thumbnail beats:', error.message);
    }

    const beatByStoryAndNode = new Map(
      (beatRows ?? []).map((beat) => [`${beat.story_id}:${beat.node_id}`, beat])
    );

    for (const target of targets) {
      const beat = beatByStoryAndNode.get(`${target.story_id}:${target.first_node_id}`);
      if (!beat) continue;
      const existing = thumbnails.get(target.storyline_id);
      const imageUrl = typeof beat.image_url === 'string' ? beat.image_url.trim() : '';
      thumbnails.set(target.storyline_id, {
        url: existing?.url || imageUrl || null,
        isStoryboard: beat.is_storyboard === true,
      });
    }
  }

  return signListThumbnails(supabase, thumbnails);
}

/**
 * List the current user's created stories.
 */
/**
 * Resolves a paging window. One extra row past the page is requested so "is
 * there more?" is answered by the same round trip, with no count query; the
 * probe row is sliced off by `takePage` before it reaches the client.
 */
function listRange(input?: ListPageInput): { limit: number; offset: number; last: number } {
  const limit = Math.max(1, input?.limit ?? MY_STORIES_PAGE_SIZE);
  const offset = Math.max(0, input?.offset ?? 0);
  return { limit, offset, last: offset + limit };
}

function takePage<T>(rows: T[], limit: number): PagedList<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Story-list loader threaded with an already-resolved auth context, so a
 * bundled bootstrap can authenticate once and fan out. `listUserStories` below
 * is the thin per-request wrapper.
 */
export async function loadUserStoriesData(
  supabase: SupabaseClient,
  userId: string,
  page?: ListPageInput
): Promise<PagedList<{
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
  cover_image_url: string | null;
  episode_number?: number | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  thumbnail_url: string | null;
  thumbnail_is_storyboard: boolean;
}>> {
  const { limit, offset, last } = listRange(page);
  const { data, error } = await supabase
    .from('stories')
    .select('id, title, status, is_archived, updated_at, user_prompt, cover_image_url, episode_number, is_vertical_story, aspect_ratio')
    .eq('user_id', userId)
    .neq('story_kind', 'reel')
    .order('updated_at', { ascending: false })
    .range(offset, last);

  let rows: Array<{
    id: string;
    title: string;
    status: string;
    is_archived: boolean;
    updated_at: string;
    user_prompt: string;
    cover_image_url: string | null;
    episode_number?: number | null;
    is_vertical_story?: boolean | null;
    aspect_ratio?: string | null;
  }> = data || [];
  if (error) {
    // Pre-075 fallback: episode_number doesn't exist yet.
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('stories')
      .select('id, title, status, is_archived, updated_at, user_prompt, cover_image_url, is_vertical_story, aspect_ratio')
      .eq('user_id', userId)
      .neq('story_kind', 'reel')
      .order('updated_at', { ascending: false })
      .range(offset, last);

    if (fallbackError) throw new Error(`Failed to list stories: ${fallbackError.message}`);
    rows = fallbackData || [];
  }

  // Thumbnails resolve for the page only — the probe row is dropped first so it
  // never costs a beats lookup or a signature.
  const { items: stories, hasMore } = takePage(rows, limit);
  const thumbnails = await resolveStoryListThumbnails(supabase, stories);

  return {
    items: stories.map((story) => ({
      ...story,
      thumbnail_url: thumbnails.get(story.id)?.url ?? null,
      thumbnail_is_storyboard: thumbnails.get(story.id)?.isStoryboard === true,
    })),
    hasMore,
  };
}

export async function listUserStories(page?: ListPageInput) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');
  return loadUserStoriesData(supabase, user.id, page);
}

/**
 * Reel-list loader threaded with an already-resolved auth context.
 * `listUserReels` below is the thin per-request wrapper.
 */
export async function loadUserReelsData(
  supabase: SupabaseClient,
  userId: string,
  page?: ListPageInput
): Promise<PagedList<{
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
  story_kind: 'reel';
  beat_count: number;
  cover_image_url: string | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  thumbnail_url: string | null;
  thumbnail_is_storyboard: boolean;
}>> {
  const { limit, offset, last } = listRange(page);
  const { data, error } = await supabase
    .from('stories')
    .select('id, title, status, is_archived, updated_at, user_prompt, story_kind, story_config, story_map, cover_image_url, is_vertical_story, aspect_ratio')
    .eq('user_id', userId)
    .eq('story_kind', 'reel')
    .order('updated_at', { ascending: false })
    .range(offset, last);

  if (error) throw new Error(`Failed to list reels: ${error.message}`);

  const { items: reels, hasMore } = takePage(data || [], limit);
  const thumbnails = await resolveStoryListThumbnails(supabase, reels);

  const items = reels.map((story: any) => {
    const storyMap = story.story_map && typeof story.story_map === 'object' ? story.story_map : null;
    const nodeCount = storyMap?.nodes && typeof storyMap.nodes === 'object'
      ? Object.keys(storyMap.nodes).length
      : 0;
    const configBeatCount = Number(story.story_config?.reel?.beatCount ?? story.story_config?.maxBeats ?? 0);

    return {
      id: story.id,
      title: story.title,
      status: story.status,
      is_archived: Boolean(story.is_archived),
      updated_at: story.updated_at,
      user_prompt: story.user_prompt,
      story_kind: 'reel' as const,
      beat_count: nodeCount || (Number.isFinite(configBeatCount) ? configBeatCount : 0),
      cover_image_url: story.cover_image_url,
      is_vertical_story: story.is_vertical_story,
      aspect_ratio: story.aspect_ratio,
      thumbnail_url: thumbnails.get(story.id)?.url ?? null,
      thumbnail_is_storyboard: thumbnails.get(story.id)?.isStoryboard === true,
    };
  });

  return { items, hasMore };
}

/**
 * List the current user's generated reels.
 */
export async function listUserReels(page?: ListPageInput) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');
  return loadUserReelsData(supabase, user.id, page);
}

/**
 * Delete a story and its associated assets.
 */
export async function deleteStory(storyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('stories')
    .delete()
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to delete story: ${error.message}`);
}

/**
 * Archive a story (soft delete — hidden from creator but stays public).
 */
export async function archiveStory(storyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('stories')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to archive story: ${error.message}`);
}

/**
 * Unarchive a story (restore from soft delete).
 */
export async function unarchiveStory(storyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('stories')
    .update({ is_archived: false, updated_at: new Date().toISOString() })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to unarchive story: ${error.message}`);
}

// ============================================================
// Storyline Profile Management
// ============================================================

/**
 * Save a storyline to the user's profile (bookmark — reference only).
 */
export async function saveStorylineToProfile(storylineId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('saved_storylines')
    .upsert(
      { user_id: user.id, storyline_id: storylineId },
      { onConflict: 'user_id,storyline_id' }
    );

  if (error) throw new Error(`Failed to save storyline: ${error.message}`);
}

/**
 * Remove a storyline from the user's profile.
 */
export async function unsaveStoryline(storylineId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('saved_storylines')
    .delete()
    .eq('user_id', user.id)
    .eq('storyline_id', storylineId);

  if (error) throw new Error(`Failed to unsave storyline: ${error.message}`);
}

/**
 * Saved-storyline loader threaded with an already-resolved auth context.
 * `listSavedStorylines` below is the thin per-request wrapper.
 */
export async function loadSavedStorylinesData(
  supabase: SupabaseClient,
  userId: string,
  page?: ListPageInput
): Promise<PagedList<{
  id: string;
  storyline_id: string;
  saved_at: string;
  is_owner: boolean;
  storyline: {
    id: string;
    title: string;
    beat_count: number;
    cover_image_url: string | null;
    author_name: string | null;
    story_id: string;
    is_vertical_story?: boolean | null;
    aspect_ratio?: string | null;
    thumbnail_url?: string | null;
    thumbnail_is_storyboard?: boolean;
  };
}>> {
  const { limit, offset, last } = listRange(page);
  const { data, error } = await supabase
    .from('saved_storylines')
    .select(`
      id,
      storyline_id,
      saved_at,
      storylines (
        id,
        title,
        beat_count,
        cover_image_url,
        author_name,
        story_id,
        user_id,
        is_vertical_story,
        aspect_ratio,
        node_path
      )
    `)
    .eq('user_id', userId)
    .order('saved_at', { ascending: false })
    .range(offset, last);

  if (error) throw new Error(`Failed to list saved storylines: ${error.message}`);

  const { items: rows, hasMore } = takePage(data || [], limit);
  const thumbnails = await resolveStorylineListThumbnails(
    supabase,
    rows
      .filter((row: any) => row.storylines)
      .map((row: any) => ({
        storyline_id: row.storyline_id,
        story_id: row.storylines.story_id ?? null,
        first_node_id: Array.isArray(row.storylines.node_path)
          ? row.storylines.node_path[0] ?? null
          : null,
        cover_image_url: row.storylines.cover_image_url ?? null,
      }))
  );

  const items = rows.map((row: any) => {
    if (!row.storylines) {
      return {
        id: row.id,
        storyline_id: row.storyline_id,
        saved_at: row.saved_at,
        is_owner: false,
        storyline: row.storylines,
      };
    }
    // node_path is only needed server-side for the thumbnail lookup.
    const { node_path, ...storylineFields } = row.storylines;
    void node_path;
    return {
      id: row.id,
      storyline_id: row.storyline_id,
      saved_at: row.saved_at,
      is_owner: row.storylines.user_id === userId,
      storyline: {
        ...storylineFields,
        thumbnail_url: thumbnails.get(row.storyline_id)?.url ?? null,
        thumbnail_is_storyboard: thumbnails.get(row.storyline_id)?.isStoryboard === true,
      },
    };
  });

  return { items, hasMore };
}

/**
 * List storylines saved to the user's profile.
 */
export async function listSavedStorylines(page?: ListPageInput) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');
  return loadSavedStorylinesData(supabase, user.id, page);
}

// ============================================================
// Legacy Publish (kept for backward compatibility during transition)
// ============================================================

/**
 * Publish a storyline to the database (legacy — used by PublishDialog).
 * Assets should already be uploaded by the client before calling this.
 */
export async function publishStoryline(params: {
  storyId: string;
  title: string;
  beats: StoryBeat[];
  choices: StorylineChoice[];
  nodePath: string[];
  coverImageUrl: string | null;
  publishMode?: 'standard' | 'audio_story';
  shareCoverDataUrl?: string | null;
  youtubeThumbnailDataUrl?: string | null;
  reelThumbnailDataUrl?: string | null;
  shareCoverSource?: StorylineShareCoverSource | null;
  youtubeThumbnailSource?: StorylineShareCoverSource | null;
  reelThumbnailSource?: StorylineShareCoverSource | null;
  socialCoverPrompt?: string | null;
  youtubeThumbnailPrompt?: string | null;
  reelThumbnailPrompt?: string | null;
  audioCoverPrompt?: string | null;
  visibility?: StorylineVisibility;
  quality?: StorylinePublishQuality;
}): Promise<{ storylineId: string; shareToken?: string | null }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  // Visibility + quality are server-validated; default keeps today's
  // public-publish behavior.
  const requestedVisibility = normalizeStorylineVisibility(params.visibility ?? 'public');
  const pipelineSettings = await getMediaPipelineSettings();
  if (requestedVisibility === 'public' && !pipelineSettings.publicPublishingEnabled) {
    throw new Error('Public publishing is currently disabled by the admin.');
  }
  if (requestedVisibility === 'unlisted' && !pipelineSettings.unlistedSharingEnabled) {
    throw new Error('Unlisted sharing is currently disabled by the admin.');
  }
  const { quality: validatedQuality } = await resolveValidatedPublishQuality(
    params.storyId,
    params.quality ?? 'standard'
  );

  const { data: sourceStory } = await supabase
    .from('stories')
    .select('story_config, story_kind, is_vertical_story, aspect_ratio, genre')
    .eq('id', params.storyId)
    .maybeSingle();
  const seriesFields = await resolveStorylineSeriesFields(supabase, params.storyId);
  const storyConfig = normalizeStoryConfig({
    ...((sourceStory?.story_config as Record<string, unknown> | null) ?? {}),
    story_kind: sourceStory?.story_kind,
    isVerticalStory: sourceStory?.is_vertical_story,
    aspectRatio: sourceStory?.aspect_ratio,
  });
  const orientation = getStoryOrientation(storyConfig);
  const publishedBeats = params.beats.map(normalizePublishedBeatAssetUrls);
  const publishModes = getStorylinePublishModes(storyConfig, params.publishMode ?? 'standard', publishedBeats);

  if (
    publishModes.storyFormat === 'audio_story' &&
    !params.shareCoverDataUrl &&
    !params.youtubeThumbnailDataUrl
  ) {
    throw new Error('Audio stories need a cover image before publishing.');
  }

  // Get author name from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();

  // Compute path hash
  const pathHash = await computePathHash(params.nodePath);

  const storylineRow = {
    story_id: params.storyId,
    user_id: user.id,
    title: params.title,
    beat_count: publishedBeats.length,
    cover_image_url: params.coverImageUrl,
    is_vertical_story: orientation.isVerticalStory,
    aspect_ratio: orientation.aspectRatio,
    story_kind: storyConfig.storyKind,
    story_format: publishModes.storyFormat,
    story_visual_mode: publishModes.storyVisualMode,
    orientation: publishModes.orientation,
    social_cover_prompt: params.socialCoverPrompt ?? null,
    youtube_thumbnail_prompt: params.youtubeThumbnailPrompt ?? null,
    reel_thumbnail_prompt: params.reelThumbnailPrompt ?? null,
    audio_cover_prompt: params.audioCoverPrompt ?? null,
    node_path: params.nodePath,
    beats: publishedBeats as unknown as Record<string, unknown>[],
    choices: params.choices as unknown as Record<string, unknown>[],
    // Denormalized for discovery filtering. Unrecognised values persist as
    // NULL rather than a plausible-looking default.
    age_group: normalizeStoredAgeGroup(storyConfig.ageGroup),
    genre: normalizeStoredGenre(sourceStory?.genre),
    ...seriesFields,
    author_name: profile?.display_name || 'Anonymous',
    is_public: requestedVisibility === 'public',
    visibility: requestedVisibility,
    publish_quality: validatedQuality,
    published_at: requestedVisibility === 'public' ? new Date().toISOString() : null,
    share_token: requestedVisibility === 'unlisted' ? generateShareToken() : null,
    moderation_status:
      requestedVisibility === 'public' && pipelineSettings.moderationRequiredForPublic
        ? 'pending'
        : 'none',
    path_hash: pathHash,
  };

  let insertedStorylineId: string | null = null;
  const { data, error } = await supabase
    .from('storylines')
    .insert(storylineRow)
    .select('id')
    .single();

  if (error) {
    // Path-hash collision: another publish race already created this storyline.
    // Surface the existing one and link it to the author so it lands in their list.
    if (error.code === '23505') {
      const { data: dup } = await supabase
        .from('storylines')
        .select('id')
        .eq('path_hash', pathHash)
        .maybeSingle();
      if (dup) {
        await supabase
          .from('saved_storylines')
          .upsert(
            { user_id: user.id, storyline_id: dup.id },
            { onConflict: 'user_id,storyline_id' }
          );
        await finalizeStorylineShareAssets({
          storylineId: dup.id,
          storyId: params.storyId,
          userId: user.id,
          title: params.title,
          authorName: profile?.display_name || 'Anonymous',
          coverImageUrl: params.coverImageUrl,
          beats: publishedBeats,
          storyFormat: publishModes.storyFormat,
          storyVisualMode: publishModes.storyVisualMode,
          orientation: publishModes.orientation,
          shareCoverDataUrl: params.shareCoverDataUrl ?? null,
          youtubeThumbnailDataUrl: params.youtubeThumbnailDataUrl ?? null,
          reelThumbnailDataUrl: params.reelThumbnailDataUrl ?? null,
          shareCoverSource: params.shareCoverSource ?? null,
          youtubeThumbnailSource: params.youtubeThumbnailSource ?? null,
          reelThumbnailSource: params.reelThumbnailSource ?? null,
          socialCoverPrompt: params.socialCoverPrompt ?? null,
          youtubeThumbnailPrompt: params.youtubeThumbnailPrompt ?? null,
          reelThumbnailPrompt: params.reelThumbnailPrompt ?? null,
          audioCoverPrompt: params.audioCoverPrompt ?? null,
        });
        return { storylineId: dup.id };
      }
    }
    if (isMissingAdditiveColumnError(error, 'storylines')) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('storylines')
        .insert(withoutAdditiveColumns(storylineRow, ADDITIVE_STORYLINE_COLUMNS))
        .select('id')
        .single();

      if (fallbackError || !fallbackData) {
        throw new Error(`Failed to publish storyline: ${fallbackError?.message || error.message}`);
      }
      insertedStorylineId = fallbackData.id;
    } else {
      throw new Error(`Failed to publish storyline: ${error.message}`);
    }
  }

  insertedStorylineId = insertedStorylineId ?? data?.id ?? null;
  if (!insertedStorylineId) {
    throw new Error('Failed to publish storyline: missing inserted storyline id.');
  }
  const publishedStorylineId = insertedStorylineId;

  // Link the author to their own published storyline so it appears in the
  // saved-storylines list alongside the auto-publish path's behavior.
  await supabase
    .from('saved_storylines')
    .upsert(
      { user_id: user.id, storyline_id: publishedStorylineId },
      { onConflict: 'user_id,storyline_id' }
    );

  await finalizeStorylineShareAssets({
    storylineId: publishedStorylineId,
    storyId: params.storyId,
    userId: user.id,
    title: params.title,
    authorName: profile?.display_name || 'Anonymous',
    coverImageUrl: params.coverImageUrl,
    beats: publishedBeats,
    storyFormat: publishModes.storyFormat,
    storyVisualMode: publishModes.storyVisualMode,
    orientation: publishModes.orientation,
    shareCoverDataUrl: params.shareCoverDataUrl ?? null,
    youtubeThumbnailDataUrl: params.youtubeThumbnailDataUrl ?? null,
    reelThumbnailDataUrl: params.reelThumbnailDataUrl ?? null,
    shareCoverSource: params.shareCoverSource ?? null,
    youtubeThumbnailSource: params.youtubeThumbnailSource ?? null,
    reelThumbnailSource: params.reelThumbnailSource ?? null,
    socialCoverPrompt: params.socialCoverPrompt ?? null,
    youtubeThumbnailPrompt: params.youtubeThumbnailPrompt ?? null,
    reelThumbnailPrompt: params.reelThumbnailPrompt ?? null,
    audioCoverPrompt: params.audioCoverPrompt ?? null,
  });

  return {
    storylineId: publishedStorylineId,
    shareToken: (storylineRow.share_token as string | null) ?? null,
  };
}

// ============================================================
// Backfill Missing Cover Images
// ============================================================

/**
 * Backfill missing cover images for storylines and story trees.
 * - Storyline covers: uses beat at index 1 (or 0 for single-beat paths)
 * - Tree covers: uses root beat (index 0)
 * Copies images from story-assets (private) to public-storylines (public).
 */
export async function backfillMissingCovers(): Promise<{
  storylinesFixed: number;
  treesFixed: number;
  failed: number;
}> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  let storylinesFixed = 0;
  let treesFixed = 0;
  let failed = 0;

  // 1. Fix storylines with NULL or private-bucket cover URLs
  const { data: storylines } = await supabase
    .from('storylines')
    .select('id, story_id, user_id, node_path, cover_image_url')
    .eq('is_public', true);

  if (storylines) {
    const toFix = storylines.filter(
      (sl) =>
        !sl.cover_image_url ||
        sl.cover_image_url.includes('/story-assets/')
    );

    const BATCH_SIZE = 10;
    for (let i = 0; i < toFix.length; i += BATCH_SIZE) {
      const batch = toFix.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (sl) => {
          const nodePath: string[] = sl.node_path || [];
          const coverNodeId = nodePath.length > 1 ? nodePath[1] : nodePath[0];
          if (!coverNodeId) return;

          // Look up beat image_url
          const { data: beat } = await supabase
            .from('beats')
            .select('image_url')
            .eq('story_id', sl.story_id)
            .eq('node_id', coverNodeId)
            .single();

          const imageUrl = beat?.image_url;
          if (!imageUrl) return;

          let publicUrl: string | null = null;

          if (extractStoragePath(imageUrl, 'public-storylines')) {
            publicUrl = imageUrl;
          } else if (extractStoragePath(imageUrl, 'story-assets')) {
            const destPath = `${sl.user_id}/${sl.id}/cover.webp`;
            publicUrl = await copyToPublicBucket(
              supabase,
              imageUrl,
              'story-assets',
              'public-storylines',
              destPath
            );
          }

          if (publicUrl) {
            await supabase
              .from('storylines')
              .update({ cover_image_url: publicUrl })
              .eq('id', sl.id);
            storylinesFixed++;
          }
        })
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('Storyline backfill failed:', r.reason);
          failed++;
        }
      }
    }
  }

  // 2. Fix stories (trees) with NULL cover_image_url
  const { data: stories } = await supabase
    .from('stories')
    .select('id, user_id, cover_image_url')
    .is('cover_image_url', null)
    .eq('is_archived', false);

  if (stories) {
    const BATCH_SIZE = 10;
    for (let i = 0; i < stories.length; i += BATCH_SIZE) {
      const batch = stories.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (story) => {
          // Get root beat (parent_node_id IS NULL)
          const { data: rootBeat } = await supabase
            .from('beats')
            .select('image_url')
            .eq('story_id', story.id)
            .is('parent_node_id', null)
            .single();

          const imageUrl = rootBeat?.image_url;
          if (!imageUrl) return;

          let publicUrl: string | null = null;

          if (extractStoragePath(imageUrl, 'public-storylines')) {
            publicUrl = imageUrl;
          } else if (extractStoragePath(imageUrl, 'story-assets')) {
            const destPath = `${story.user_id}/${story.id}/tree-cover.webp`;
            publicUrl = await copyToPublicBucket(
              supabase,
              imageUrl,
              'story-assets',
              'public-storylines',
              destPath
            );
          }

          if (publicUrl) {
            await supabase
              .from('stories')
              .update({ cover_image_url: publicUrl })
              .eq('id', story.id);
            treesFixed++;
          }
        })
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('Tree backfill failed:', r.reason);
          failed++;
        }
      }
    }
  }

  return { storylinesFixed, treesFixed, failed };
}

export async function backfillMissingReadyBeatImageUrls(): Promise<{
  storiesScanned: number;
  candidateBeats: number;
  repairedCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  const supabase = createAdminClient();

  const { data: candidateRows, error: candidateError } = await supabase
    .from('beats')
    .select('story_id')
    .eq('image_status', 'ready')
    .is('image_url', null);

  if (candidateError) {
    throw new Error(`Failed to load beat image repair candidates: ${candidateError.message}`);
  }

  const storyIds = Array.from(new Set((candidateRows || []).map((row) => row.story_id).filter(Boolean)));
  if (storyIds.length === 0) {
    return {
      storiesScanned: 0,
      candidateBeats: 0,
      repairedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  let candidateBeats = 0;
  let repairedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const storyId of storyIds) {
    const { data: story, error: storyError } = await supabase
      .from('stories')
      .select('id, user_id, story_map')
      .eq('id', storyId)
      .maybeSingle();

    if (storyError || !story) {
      failedCount += 1;
      console.error('Failed to load story for beat image repair:', storyError?.message || storyId);
      continue;
    }

    const { data: storyBeats, error: storyBeatsError } = await supabase
      .from('beats')
      .select('*')
      .eq('story_id', storyId)
      .order('beat_number', { ascending: true });

    if (storyBeatsError || !storyBeats) {
      failedCount += 1;
      console.error('Failed to load story beats for image repair:', storyBeatsError?.message || storyId);
      continue;
    }

    candidateBeats += storyBeats.filter((beat) => beat.image_status === 'ready' && !beat.image_url).length;
    const rawStoryMap = story.story_map && typeof story.story_map === 'object' && 'nodes' in story.story_map
      ? (story.story_map as unknown as StoryMap)
      : null;

    const result = await repairMissingReadyBeatImageUrls(
      supabase,
      storyId,
      story.user_id,
      storyBeats as DbBeat[],
      rawStoryMap
    );

    repairedCount += result.repairedCount;
    skippedCount += result.skippedCount;
    failedCount += result.failedCount;
  }

  return {
    storiesScanned: storyIds.length,
    candidateBeats,
    repairedCount,
    skippedCount,
    failedCount,
  };
}
