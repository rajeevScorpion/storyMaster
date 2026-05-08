'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { normalizeStorageUrl, extractStoragePath, copyToPublicBucket } from '@/lib/supabase/storage';
import { signStoryMapAssetUrls, signCharacterRosterReferenceSheetUrls } from '@/lib/media/storage-url-signing';
import { createAdminClient } from '@/lib/supabase/admin';
import type { StorySession, StoryMap, StoryBeat, StoryNode, Character, BeatImageGalleryEntry } from '@/lib/types/story';
import type { DbStory, DbBeat } from '@/lib/types/database';
import type { StorylineShareCoverSource } from '@/lib/types/database';
import type { BeatMediaStatus } from '@/lib/types/beat-media';
import {
  normalizeBeatMediaFields,
  BEAT_ROW_NOT_FOUND_MESSAGE,
  getBeatPersistedAudioUrl,
  getBeatPersistedImageUrl,
} from '@/lib/types/beat-media';
import type { StorylineChoice } from '@/lib/utils/storyline';
import { deriveVisualStyleSummary, normalizeStoryConfig } from '@/lib/ai/story-config';
import { finalizeStorylineShareAssets } from '@/app/actions/storyline-covers';
import { processAndUploadStorylineAsset } from '@/lib/story/share-cover';
import { getStorylinePublishModes } from '@/lib/story/publish-modes';

/**
 * Strip base64 data URLs from a StoryMap before saving to DB.
 * Keeps HTTP URLs intact (already uploaded to storage).
 */
function stripBase64(storyMap: StoryMap, existingStoryMap?: StoryMap | null): StoryMap {
  const nodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(storyMap.nodes)) {
    const existingBeat = existingStoryMap?.nodes?.[id]?.data;
    const persistedImageUrl = resolvePersistedImageUrlForSave(node.data, existingBeat);
    const persistedAudioUrl = resolvePersistedAudioUrlForSave(node.data, existingBeat);
    const cleanedGallery = (node.data.imageGallery ?? [])
      .filter((entry) => Boolean(entry?.url) && !entry.url.startsWith('data:'))
      .map((entry) => ({
        url: normalizeStorageUrl(entry.url, 'story-assets'),
        storageKey: entry.storageKey,
        uploadedAt: entry.uploadedAt,
        ...(entry.optimizationMetadata ? { optimizationMetadata: entry.optimizationMetadata } : {}),
      }));
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
        // Strip portrait base64 + drop any leftover reference-sheet data URLs.
        // The persisted storage URL stays on the character; if the client only
        // had a base64 (unsaved upload), drop it so the JSONB row stays small.
        characters: node.data.characters.map(c => {
          const cleanedGallery = (c.referenceSheetGallery ?? [])
            .filter((entry) => Boolean(entry?.url) && !entry.url.startsWith('data:'))
            .map((entry) => ({
              url: normalizeStorageUrl(entry.url, 'story-assets'),
              storageKey: entry.storageKey,
              uploadedAt: entry.uploadedAt,
              ...(entry.optimizationMetadata ? { optimizationMetadata: entry.optimizationMetadata } : {}),
            }));
          return {
            ...c,
            portraitBase64: undefined,
            referenceSheetUrl: c.referenceSheetUrl?.startsWith('data:')
              ? undefined
              : c.referenceSheetUrl
                ? normalizeStorageUrl(c.referenceSheetUrl, 'story-assets')
                : undefined,
            referenceSheetGallery: cleanedGallery.length > 0 ? cleanedGallery : undefined,
          };
        }),
      },
    };
  }
  return { ...storyMap, nodes };
}

function sanitizeSessionCharacters(session: StorySession): StorySession['characters'] {
  return (session.characters || []).map((character) => {
    const cleanedGallery = (character.referenceSheetGallery ?? [])
      .filter((entry) => Boolean(entry?.url) && !entry.url.startsWith('data:'))
      .map((entry) => ({
        url: normalizeStorageUrl(entry.url, 'story-assets'),
        storageKey: entry.storageKey,
        uploadedAt: entry.uploadedAt,
        ...(entry.optimizationMetadata ? { optimizationMetadata: entry.optimizationMetadata } : {}),
      }));
    return {
      ...character,
      portraitBase64: undefined,
      referenceSheetUrl: character.referenceSheetUrl?.startsWith('data:')
        ? undefined
        : character.referenceSheetUrl
          ? normalizeStorageUrl(character.referenceSheetUrl, 'story-assets')
          : undefined,
      referenceSheetGallery: cleanedGallery.length > 0 ? cleanedGallery : undefined,
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
  'origin_kind',
  'seed_plan_beat_index',
  'canonical_option_id',
  'narration_voice_id',
  'image_status',
  'image_error',
  'image_synced_at',
  'image_gallery',
  'audio_status',
  'audio_error',
  'audio_synced_at',
] as const;

function isMissingBeatColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error?.message) return false;
  return (
    error.code === 'PGRST204'
    || (/schema cache/i.test(error.message) && /column/i.test(error.message) && /beats/i.test(error.message))
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

/**
 * Convert a StoryNode + beat data into a beats table row object.
 */
function nodeToBeatRow(storyId: string, nodeId: string, node: StoryNode, userId: string) {
  const normalizedBeat = normalizeBeatMediaFields(node.data);
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
    image_synced_at: normalizedBeat.imageStatus === 'ready' ? new Date().toISOString() : null,
    audio_status: normalizedBeat.audioStatus,
    audio_error: normalizedBeat.audioError || null,
    audio_synced_at: normalizedBeat.audioStatus === 'ready' ? new Date().toISOString() : null,
  };

  // Only include asset URLs when they have values — prevents UPSERT from
  // overwriting audio_url set by generateAndPersistNarration (race condition)
  const imageUrl = resolvePersistedImageUrlForSave(normalizedBeat);
  if (imageUrl) {
    row.image_url = normalizeStorageUrl(imageUrl, 'story-assets');
  }

  const audioUrl = resolvePersistedAudioUrlForSave(normalizedBeat);
  if (audioUrl) {
    row.audio_url = normalizeStorageUrl(audioUrl, 'story-assets');
  }

  if (normalizedBeat.narrationVoiceId) {
    row.narration_voice_id = normalizedBeat.narrationVoiceId;
  }

  if (normalizedBeat.isStoryboard) {
    row.is_storyboard = true;
  }

  if (normalizedBeat.imageGallery && normalizedBeat.imageGallery.length > 0) {
    row.image_gallery = normalizedBeat.imageGallery.map((entry) => ({
      url: normalizeStorageUrl(entry.url, 'story-assets'),
      storage_key: entry.storageKey,
      uploaded_at: entry.uploadedAt,
      ...(entry.optimizationMetadata ? { optimization_metadata: entry.optimizationMetadata as unknown as Record<string, unknown> } : {}),
    }));
  }

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
    imageStatus: beat.image_status,
    imageError: beat.image_error || undefined,
    imageGallery: Array.isArray(beat.image_gallery)
      ? beat.image_gallery.map((entry) => ({
          url: entry.url,
          storageKey: entry.storage_key,
          uploadedAt: entry.uploaded_at,
          ...(entry.optimization_metadata ? {
            optimizationMetadata: entry.optimization_metadata as unknown as import('@/lib/media/imageUploadOptimization').ImageCompressionMetadata,
          } : {}),
        }))
      : [],
    audioUrl: beat.audio_url || undefined,
    audioStatus: beat.audio_status,
    audioError: beat.audio_error || undefined,
    narrationVoiceId: beat.narration_voice_id || undefined,
    isStoryboard: beat.is_storyboard || undefined,
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
  const existingBeatUrlMap = new Map<string, { imageUrl?: string; audioUrl?: string }>();
  if (session.savedStoryId) {
    const { data: existingStory, error: existingStoryError } = await supabase
      .from('stories')
      .select('story_map')
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

    const { data: existingBeatRows, error: existingBeatRowsError } = await supabase
      .from('beats')
      .select('node_id, image_url, audio_url')
      .eq('story_id', session.savedStoryId)
      .eq('generated_by', user.id);

    if (existingBeatRowsError) {
      throw new Error(`Failed to load existing beat assets before save: ${existingBeatRowsError.message}`);
    }

    for (const beat of existingBeatRows || []) {
      existingBeatUrlMap.set(beat.node_id, {
        imageUrl: beat.image_url || undefined,
        audioUrl: beat.audio_url || undefined,
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

  const storyData = {
    user_id: user.id,
    title: session.title,
    user_prompt: session.userPrompt,
    genre: session.genre,
    tone: session.tone,
    visual_style: session.visualStyle,
    target_age: session.targetAge,
    story_config: session.storyConfig as unknown as Record<string, unknown>,
    is_vertical_story: storyOrientation.isVerticalStory,
    aspect_ratio: storyOrientation.aspectRatio,
    story_map: cleanMap as unknown as Record<string, unknown>,
    characters: sanitizeSessionCharacters(session) as unknown as Record<string, unknown>[],
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

    if (error) throw new Error(`Failed to update story: ${error.message}`);
    storyId = session.savedStoryId;
  } else {
    const { data, error } = await supabase
      .from('stories')
      .insert(storyData)
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save story: ${error.message}`);
    storyId = data.id;
  }

  // Dual-write: batch upsert all nodes into beats table
  const beatRows = Object.entries(cleanMap.nodes).map(([nodeId, node]) =>
    nodeToBeatRow(storyId, nodeId, node, user.id)
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
            ...(jsonbNode.data.newCharacterIds ? { newCharacterIds: jsonbNode.data.newCharacterIds } : {}),
            ...(jsonbNode.data.changedCharacterIds ? { changedCharacterIds: jsonbNode.data.changedCharacterIds } : {}),
            ...(jsonbNode.data.storyboardPlan ? { storyboardPlan: jsonbNode.data.storyboardPlan } : {}),
            ...(jsonbNode.data.storyboardPromptText ? { storyboardPromptText: jsonbNode.data.storyboardPromptText } : {}),
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
    isVerticalStory: story.is_vertical_story,
    aspectRatio: story.aspect_ratio,
  });

  return {
    storySessionId: story.id,
    savedStoryId: story.id,
    savedByUserId: story.user_id,
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
  node: StoryNode
): Promise<{ beatId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: existingBeat } = await supabase
    .from('beats')
    .select('image_url, audio_url')
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

  const beatRow = nodeToBeatRow(storyId, nodeId, beatForSave, user.id);

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
    const patchedMap: StoryMap = {
      ...storyMap,
      nodes: {
        ...storyMap.nodes,
        [nodeId]: node,
      },
      currentNodeId: storyMap.currentNodeId || nodeId,
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
    narrationVoiceId?: string;
    characters?: Character[];
  }
): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

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
    updateData.image_gallery = (patch.imageGallery ?? []).map((entry) => ({
      url: normalizeStorageUrl(entry.url, 'story-assets'),
      storage_key: entry.storageKey,
      uploaded_at: entry.uploadedAt,
      ...(entry.optimizationMetadata ? { optimization_metadata: entry.optimizationMetadata as unknown as Record<string, unknown> } : {}),
    }));
  }
  if ('audioUrl' in patch) {
    updateData.audio_url = patch.audioUrl ? normalizeStorageUrl(patch.audioUrl, 'story-assets') : null;
  }
  if (patch.audioStatus) updateData.audio_status = patch.audioStatus;
  if ('audioError' in patch) updateData.audio_error = patch.audioError ?? null;
  if (patch.audioStatus === 'ready') {
    updateData.audio_synced_at = new Date().toISOString();
  } else if ('audioUrl' in patch || patch.audioStatus) {
    updateData.audio_synced_at = null;
  }
  if (patch.narrationVoiceId) updateData.narration_voice_id = patch.narrationVoiceId;
  if (patch.characters) {
    updateData.characters = patch.characters as unknown as Record<string, unknown>[];
  }

  if (Object.keys(updateData).length === 0) return;

  const { data: updatedBeatRows, error } = await supabase
    .from('beats')
    .update(updateData)
    .eq('story_id', storyId)
    .eq('node_id', nodeId)
    .eq('generated_by', user.id)
    .select('id')
    .limit(1);

  if (error) {
    throw new Error(`Failed to update beat media state: ${error.message}`);
  }
  if (!updatedBeatRows || updatedBeatRows.length === 0) {
    throw new Error(`Failed to update beat media state: ${BEAT_ROW_NOT_FOUND_MESSAGE}`);
  }

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('story_map')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .single();

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
      imageGallery: (patch.imageGallery ?? []).map((entry) => ({
        url: normalizeStorageUrl(entry.url, 'story-assets'),
        storageKey: entry.storageKey,
        uploadedAt: entry.uploadedAt,
        ...(entry.optimizationMetadata ? { optimizationMetadata: entry.optimizationMetadata } : {}),
      })),
    } : {}),
    ...('audioUrl' in patch ? { audioUrl: patch.audioUrl ? normalizeStorageUrl(patch.audioUrl, 'story-assets') : undefined } : {}),
    ...(patch.audioStatus ? { audioStatus: patch.audioStatus } : {}),
    ...('audioError' in patch ? { audioError: patch.audioError || undefined } : {}),
    ...(patch.narrationVoiceId ? { narrationVoiceId: patch.narrationVoiceId } : {}),
    ...(patch.characters ? { characters: patch.characters } : {}),
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

  const { error: storyUpdateError } = await supabase
    .from('stories')
    .update({
      story_map: stripBase64(patchedMap) as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (storyUpdateError) {
    throw new Error(`Failed to patch story map media state: ${storyUpdateError.message}`);
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
    .select('story_config, is_vertical_story, aspect_ratio')
    .eq('id', storyId)
    .maybeSingle();

  if (sourceStoryError) {
    throw new Error(`Failed to fetch story orientation: ${sourceStoryError.message}`);
  }

  const storyConfig = normalizeStoryConfig({
    ...((sourceStory?.story_config as Record<string, unknown> | null) ?? {}),
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
    isStoryboard: b.is_storyboard || undefined,
    originKind: (b.origin_kind as StoryBeat['originKind'] | null) || undefined,
    seedPlanBeatIndex: b.seed_plan_beat_index || undefined,
    canonicalOptionId: b.canonical_option_id || undefined,
  }));
  const publishModes = getStorylinePublishModes(storyConfig, 'standard', legacyBeats);

  const { data: storyline, error: slError } = await supabase
    .from('storylines')
    .insert({
      story_id: storyId,
      user_id: user.id,
      title: storyTitle,
      beat_count: nodePath.length,
      cover_image_url: coverImageUrl || null,
      is_vertical_story: orientation.isVerticalStory,
      aspect_ratio: orientation.aspectRatio,
      story_format: publishModes.storyFormat,
      story_visual_mode: publishModes.storyVisualMode,
      orientation: publishModes.orientation,
      node_path: nodePath,
      beats: legacyBeats as unknown as Record<string, unknown>[],
      choices: choices as unknown as Record<string, unknown>[],
      author_name: profile?.display_name || 'Anonymous',
      is_public: true,
      path_hash: pathHash,
    })
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
    throw new Error(`Failed to publish storyline: ${slError.message}`);
  }

  // Create storyline_beats junction rows
  const junctionRows = nodePath.map((nodeId, index) => {
    const beat = beatsMap.get(nodeId);
    const choiceForThisBeat = index > 0 ? choices[index - 1] : undefined;
    return {
      storyline_id: storyline.id,
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
      { user_id: user.id, storyline_id: storyline.id },
      { onConflict: 'user_id,storyline_id' }
    );

  await finalizeStorylineShareAssets({
    storylineId: storyline.id,
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

  return { alreadyPublished: false, storylineId: storyline.id };
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

/**
 * List the current user's created stories.
 */
export async function listUserStories(): Promise<Array<{
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
}>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('stories')
    .select('id, title, status, is_archived, updated_at, user_prompt')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to list stories: ${error.message}`);
  return data || [];
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
 * List storylines saved to the user's profile.
 */
export async function listSavedStorylines(): Promise<Array<{
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
  };
}>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

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
        user_id
      )
    `)
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false });

  if (error) throw new Error(`Failed to list saved storylines: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row.id,
    storyline_id: row.storyline_id,
    saved_at: row.saved_at,
    is_owner: row.storylines?.user_id === user.id,
    storyline: row.storylines,
  }));
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
}): Promise<{ storylineId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: sourceStory } = await supabase
    .from('stories')
    .select('story_config, is_vertical_story, aspect_ratio')
    .eq('id', params.storyId)
    .maybeSingle();
  const storyConfig = normalizeStoryConfig({
    ...((sourceStory?.story_config as Record<string, unknown> | null) ?? {}),
    isVerticalStory: sourceStory?.is_vertical_story,
    aspectRatio: sourceStory?.aspect_ratio,
  });
  const orientation = getStoryOrientation(storyConfig);
  const publishModes = getStorylinePublishModes(storyConfig, params.publishMode ?? 'standard', params.beats);

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

  const { data, error } = await supabase
    .from('storylines')
    .insert({
      story_id: params.storyId,
      user_id: user.id,
      title: params.title,
      beat_count: params.beats.length,
      cover_image_url: params.coverImageUrl,
      is_vertical_story: orientation.isVerticalStory,
      aspect_ratio: orientation.aspectRatio,
      story_format: publishModes.storyFormat,
      story_visual_mode: publishModes.storyVisualMode,
      orientation: publishModes.orientation,
      social_cover_prompt: params.socialCoverPrompt ?? null,
      youtube_thumbnail_prompt: params.youtubeThumbnailPrompt ?? null,
      reel_thumbnail_prompt: params.reelThumbnailPrompt ?? null,
      audio_cover_prompt: params.audioCoverPrompt ?? null,
      node_path: params.nodePath,
      beats: params.beats as unknown as Record<string, unknown>[],
      choices: params.choices as unknown as Record<string, unknown>[],
      author_name: profile?.display_name || 'Anonymous',
      is_public: true,
      path_hash: pathHash,
    })
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
          beats: params.beats,
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
    throw new Error(`Failed to publish storyline: ${error.message}`);
  }

  // Link the author to their own published storyline so it appears in the
  // saved-storylines list alongside the auto-publish path's behavior.
  await supabase
    .from('saved_storylines')
    .upsert(
      { user_id: user.id, storyline_id: data.id },
      { onConflict: 'user_id,storyline_id' }
    );

  await finalizeStorylineShareAssets({
    storylineId: data.id,
    storyId: params.storyId,
    userId: user.id,
    title: params.title,
    authorName: profile?.display_name || 'Anonymous',
    coverImageUrl: params.coverImageUrl,
    beats: params.beats,
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

  return { storylineId: data.id };
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
