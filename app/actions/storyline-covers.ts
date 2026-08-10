'use server';

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { callGeminiImage } from '@/app/actions/gemini-proxy';
import { generateSelectedImage } from '@/app/actions/image-generation';
import { refreshStorylineDiscoveryMetadata } from '@/app/actions/storyline-discovery';
import type { CostActivityKey, CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import {
  extractImageContinuityState,
  normalizeImageContinuityStrategy,
  type ImageContinuityProviderState,
  type ImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
import type { ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { DEFAULT_IMAGE_MODEL_ID } from '@/lib/ai/model-config.shared';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { authorizeCoinOperationForUser } from '@/lib/pricing/coin-economy';
import { finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  getStoryboardSharePanelSourceCrop,
  isAbsoluteCrawlerSafeImageUrl,
  processAndUploadStorylineAsset,
  resolveStorylineShareCover,
  uploadBrandedDefaultShareCover,
  verifyPublicStorylineBucket,
  type ProcessedStorylineAsset,
  type StorylineShareCoverRow,
} from '@/lib/story/share-cover';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import {
  buildStoryCoverPromptInputFromPublishedStoryline,
  generateStoryCoverPrompt,
} from '@/lib/story/cover-prompts';
import { getStoredStorylineClassificationPatch } from '@/lib/story/publish-modes';
import type {
  DbStory,
  StorylineFormat,
  StorylineOrientation,
  StorylineShareCoverSource,
  StorylineVisualMode,
} from '@/lib/types/database';
import type { PricingActionKey } from '@/lib/types/pricing';
import type { StoryBeat } from '@/lib/types/story';

type StorylineAssetUpdate = Record<string, string | number | null>;

type FinalizeStorylineShareAssetsInput = {
  storylineId: string;
  storyId: string;
  userId: string;
  title: string;
  authorName?: string | null;
  coverImageUrl?: string | null;
  beats?: StoryBeat[] | null;
  storyFormat: StorylineFormat;
  storyVisualMode: StorylineVisualMode;
  orientation: StorylineOrientation;
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
};

type RepairStorylineCoverResult = {
  scanned: number;
  ready: number;
  processedFromBeat: number;
  defaulted: number;
  failed: number;
  logs: string[];
};

type DiagnosticImageProbe = {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  contentLength: string | null;
  error: string | null;
};

type FallbackBeatImage = {
  url: string;
  isStoryboard: boolean;
};

type CoverGenerationContinuityInput = {
  requestedStrategy?: ImageContinuityStrategy | null;
  previousState?: ImageContinuityProviderState | null;
} | null;

type CoverGenerationContext = {
  imageModelSelection?: ImageModelSelection | null;
  imageContinuity?: CoverGenerationContinuityInput;
};

export type PublishedStorylineCoverEditorState = {
  storylineId: string;
  storylineUrl: string;
  storyId: string;
  title: string;
  authorName: string | null;
  beatCount: number;
  storyFormat: StorylineFormat;
  storyVisualMode: StorylineVisualMode;
  orientation: StorylineOrientation;
  isVerticalStory: boolean;
  socialCoverPrompt: string;
  youtubeThumbnailPrompt: string;
  reelThumbnailPrompt: string;
  audioCoverPrompt: string;
  shareCoverUrl: string | null;
  shareCoverWidth: number | null;
  shareCoverHeight: number | null;
  shareCoverMimeType: string | null;
  shareCoverUpdatedAt: string | null;
  youtubeThumbnailUrl: string | null;
  youtubeThumbnailWidth: number | null;
  youtubeThumbnailHeight: number | null;
  youtubeThumbnailMimeType: string | null;
  youtubeThumbnailUpdatedAt: string | null;
  reelThumbnailUrl: string | null;
  reelThumbnailWidth: number | null;
  reelThumbnailHeight: number | null;
  reelThumbnailMimeType: string | null;
  reelThumbnailUpdatedAt: string | null;
};

type PublishedStorylineCoverEditorRow = StorylineShareCoverRow & {
  user_id: string;
  story_id: string;
  title: string;
  author_name: string | null;
  beat_count?: number | null;
  beats?: StoryBeat[] | null;
  social_cover_prompt?: string | null;
  youtube_thumbnail_prompt?: string | null;
  reel_thumbnail_prompt?: string | null;
  audio_cover_prompt?: string | null;
  story_format: StorylineFormat;
  story_visual_mode: StorylineVisualMode;
  orientation: StorylineOrientation;
};

const STORYLINE_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOriginForDiagnostics(value: string | null | undefined): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:';
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isLocalDiagnosticsOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function extractStorylineIdInput(value: string): { storylineId: string; inputOrigin: string | null } {
  const trimmed = value.trim();
  let inputOrigin: string | null = null;

  try {
    const parsed = new URL(trimmed);
    inputOrigin = normalizeOriginForDiagnostics(parsed.origin);
  } catch {
    inputOrigin = null;
  }

  const match = trimmed.match(STORYLINE_UUID_PATTERN);
  if (!match) {
    throw new Error('Enter a published storyline UUID or a URL containing /storyline/{uuid}.');
  }

  return {
    storylineId: match[0],
    inputOrigin,
  };
}

function resolveDiagnosticsOrigin(inputOrigin: string | null, fallbackOrigin?: string | null): string | null {
  const fallback = normalizeOriginForDiagnostics(fallbackOrigin);
  const appOrigin = normalizeOriginForDiagnostics(process.env.APP_URL);
  const publicOrigin = normalizeOriginForDiagnostics(process.env.NEXT_PUBLIC_APP_URL);

  if (inputOrigin && !isLocalDiagnosticsOrigin(inputOrigin)) return inputOrigin;
  if (fallback && !isLocalDiagnosticsOrigin(fallback)) return fallback;
  if (appOrigin && !isLocalDiagnosticsOrigin(appOrigin)) return appOrigin;
  if (publicOrigin && !isLocalDiagnosticsOrigin(publicOrigin)) return publicOrigin;
  return inputOrigin ?? fallback ?? appOrigin ?? publicOrigin;
}

function buildPublishedStorylinePromptFields(
  storyline: PublishedStorylineCoverEditorRow,
  story: Pick<
    DbStory,
    'title' | 'user_prompt' | 'genre' | 'tone' | 'visual_style' | 'target_age' | 'story_config' | 'setting' | 'narrator_voice' | 'narration_voice_mode' | 'narration_language_code'
  >
): Pick<PublishedStorylineCoverEditorState, 'socialCoverPrompt' | 'youtubeThumbnailPrompt' | 'reelThumbnailPrompt' | 'audioCoverPrompt'> {
  const promptInput = buildStoryCoverPromptInputFromPublishedStoryline({
    story,
    storyline: {
      title: storyline.title,
      story_format: storyline.story_format,
      orientation: storyline.orientation,
      beats: Array.isArray(storyline.beats) ? storyline.beats : [],
    },
  });

  return {
    socialCoverPrompt: cleanString(storyline.social_cover_prompt)
      ?? generateStoryCoverPrompt(promptInput, { variant: 'social' }),
    youtubeThumbnailPrompt: cleanString(storyline.youtube_thumbnail_prompt)
      ?? generateStoryCoverPrompt(promptInput, { variant: 'youtube' }),
    reelThumbnailPrompt: cleanString(storyline.reel_thumbnail_prompt)
      ?? generateStoryCoverPrompt(promptInput, { variant: 'reel' }),
    audioCoverPrompt: cleanString(storyline.audio_cover_prompt)
      ?? generateStoryCoverPrompt(promptInput, { variant: 'audio' }),
  };
}

async function loadOwnedPublishedStorylineForCoverEditor(storylineId: string, userId: string): Promise<{
  storyline: PublishedStorylineCoverEditorRow;
  story: Pick<
    DbStory,
    'title' | 'user_prompt' | 'genre' | 'tone' | 'visual_style' | 'target_age' | 'story_config' | 'setting' | 'narrator_voice' | 'narration_voice_mode' | 'narration_language_code'
  >;
}> {
  const admin = createAdminClient();
  const { data: storylineData, error: storylineError } = await admin
    .from('storylines')
    .select(`
      id,
      user_id,
      story_id,
      title,
      author_name,
      beat_count,
      beats,
      share_cover_url,
      share_cover_source,
      share_cover_status,
      share_cover_width,
      share_cover_height,
      share_cover_mime_type,
      share_cover_updated_at,
      share_cover_version,
      youtube_thumbnail_url,
      youtube_thumbnail_source,
      youtube_thumbnail_status,
      youtube_thumbnail_width,
      youtube_thumbnail_height,
      youtube_thumbnail_mime_type,
      youtube_thumbnail_updated_at,
      youtube_thumbnail_version,
      reel_thumbnail_url,
      reel_thumbnail_source,
      reel_thumbnail_status,
      reel_thumbnail_width,
      reel_thumbnail_height,
      reel_thumbnail_mime_type,
      reel_thumbnail_updated_at,
      reel_thumbnail_version,
      social_cover_prompt,
      youtube_thumbnail_prompt,
      reel_thumbnail_prompt,
      audio_cover_prompt,
      story_format,
      story_visual_mode,
      orientation
    `)
    .eq('id', storylineId)
    .maybeSingle();

  if (storylineError) {
    throw new Error(`Failed to load storyline cover state: ${storylineError.message}`);
  }

  const storyline = storylineData as PublishedStorylineCoverEditorRow | null;
  if (!storyline || storyline.user_id !== userId) {
    throw new Error('You do not have permission to manage this storyline cover.');
  }

  const { data: storyData, error: storyError } = await admin
    .from('stories')
    .select(`
      title,
      user_prompt,
      genre,
      tone,
      visual_style,
      target_age,
      story_config,
      setting,
      narrator_voice,
      narration_voice_mode,
      narration_language_code
    `)
    .eq('id', storyline.story_id)
    .maybeSingle();

  if (storyError) {
    throw new Error(`Failed to load source story metadata: ${storyError.message}`);
  }

  const classificationPatch = getStoredStorylineClassificationPatch({
    storyFormat: storyline.story_format,
    storyVisualMode: storyline.story_visual_mode,
    beats: Array.isArray(storyline.beats) ? storyline.beats : [],
  });

  if (Object.keys(classificationPatch).length > 0) {
    const { error: classificationError } = await admin
      .from('storylines')
      .update(classificationPatch)
      .eq('id', storyline.id);

    if (!classificationError) {
      storyline.story_format = classificationPatch.story_format ?? storyline.story_format;
      storyline.story_visual_mode = classificationPatch.story_visual_mode ?? storyline.story_visual_mode;
    }
  }

  return {
    storyline,
    story: (storyData ?? {}) as Pick<
      DbStory,
      'title' | 'user_prompt' | 'genre' | 'tone' | 'visual_style' | 'target_age' | 'story_config' | 'setting' | 'narrator_voice' | 'narration_voice_mode' | 'narration_language_code'
    >,
  };
}

function buildPublishedStorylineCoverEditorState(
  storyline: PublishedStorylineCoverEditorRow,
  story: Pick<
    DbStory,
    'title' | 'user_prompt' | 'genre' | 'tone' | 'visual_style' | 'target_age' | 'story_config' | 'setting' | 'narrator_voice' | 'narration_voice_mode' | 'narration_language_code'
  >
): PublishedStorylineCoverEditorState {
  const prompts = buildPublishedStorylinePromptFields(storyline, story);

  return {
    storylineId: storyline.id,
    storylineUrl: `/storyline/${storyline.id}`,
    storyId: storyline.story_id,
    title: storyline.title,
    authorName: storyline.author_name ?? null,
    beatCount: storyline.beat_count ?? (Array.isArray(storyline.beats) ? storyline.beats.length : 0),
    storyFormat: storyline.story_format,
    storyVisualMode: storyline.story_visual_mode,
    orientation: storyline.orientation,
    isVerticalStory: storyline.orientation === 'portrait',
    socialCoverPrompt: prompts.socialCoverPrompt,
    youtubeThumbnailPrompt: prompts.youtubeThumbnailPrompt,
    reelThumbnailPrompt: prompts.reelThumbnailPrompt,
    audioCoverPrompt: prompts.audioCoverPrompt,
    shareCoverUrl: cleanString(storyline.share_cover_url),
    shareCoverWidth: storyline.share_cover_width ?? null,
    shareCoverHeight: storyline.share_cover_height ?? null,
    shareCoverMimeType: cleanString(storyline.share_cover_mime_type),
    shareCoverUpdatedAt: cleanString(storyline.share_cover_updated_at),
    youtubeThumbnailUrl: cleanString(storyline.youtube_thumbnail_url),
    youtubeThumbnailWidth: storyline.youtube_thumbnail_width ?? null,
    youtubeThumbnailHeight: storyline.youtube_thumbnail_height ?? null,
    youtubeThumbnailMimeType: cleanString(storyline.youtube_thumbnail_mime_type),
    youtubeThumbnailUpdatedAt: cleanString(storyline.youtube_thumbnail_updated_at),
    reelThumbnailUrl: cleanString(storyline.reel_thumbnail_url),
    reelThumbnailWidth: storyline.reel_thumbnail_width ?? null,
    reelThumbnailHeight: storyline.reel_thumbnail_height ?? null,
    reelThumbnailMimeType: cleanString(storyline.reel_thumbnail_mime_type),
    reelThumbnailUpdatedAt: cleanString(storyline.reel_thumbnail_updated_at),
  };
}

function shareCoverUpdate(asset: ProcessedStorylineAsset): StorylineAssetUpdate {
  return {
    share_cover_url: asset.url,
    share_cover_source: asset.source,
    share_cover_status: asset.status,
    share_cover_width: asset.width,
    share_cover_height: asset.height,
    share_cover_mime_type: asset.mimeType,
    share_cover_version: asset.version,
    share_cover_updated_at: new Date().toISOString(),
  };
}

function youtubeThumbnailUpdate(asset: ProcessedStorylineAsset): StorylineAssetUpdate {
  return {
    youtube_thumbnail_url: asset.url,
    youtube_thumbnail_source: asset.source,
    youtube_thumbnail_status: asset.status,
    youtube_thumbnail_width: asset.width,
    youtube_thumbnail_height: asset.height,
    youtube_thumbnail_mime_type: asset.mimeType,
    youtube_thumbnail_version: asset.version,
    youtube_thumbnail_updated_at: new Date().toISOString(),
  };
}

function reelThumbnailUpdate(asset: ProcessedStorylineAsset): StorylineAssetUpdate {
  return {
    reel_thumbnail_url: asset.url,
    reel_thumbnail_source: asset.source,
    reel_thumbnail_status: asset.status,
    reel_thumbnail_width: asset.width,
    reel_thumbnail_height: asset.height,
    reel_thumbnail_mime_type: asset.mimeType,
    reel_thumbnail_version: asset.version,
    reel_thumbnail_updated_at: new Date().toISOString(),
  };
}

function readLegacyBeatCover(beats: StoryBeat[] | null | undefined): FallbackBeatImage | null {
  if (!beats?.length) return null;
  const preferred = beats.length > 1 ? beats[1] : beats[0];
  if (!preferred) return null;
  const url = cleanString(preferred?.imageUrl)
    ?? cleanString(preferred?.persistedImageUrl)
    ?? null;
  return url ? { url, isStoryboard: isStoryboardBeat(preferred) } : null;
}

async function resolveFallbackBeatImageUrl(
  supabase: SupabaseClient,
  input: {
    storylineId?: string | null;
    storyId: string;
    nodePath?: string[] | null;
    coverImageUrl?: string | null;
    beats?: StoryBeat[] | null;
  }
): Promise<FallbackBeatImage | null> {
  const legacyCover = readLegacyBeatCover(input.beats);
  const direct = cleanString(input.coverImageUrl);
  if (direct) {
    return {
      url: direct,
      isStoryboard: legacyCover?.isStoryboard ?? false,
    };
  }
  if (legacyCover) return legacyCover;

  const nodePath = Array.isArray(input.nodePath) ? input.nodePath : [];
  const coverNodeId = nodePath.length > 1 ? nodePath[1] : nodePath[0];
  if (coverNodeId) {
    const { data } = await supabase
      .from('beats')
      .select('image_url, is_storyboard')
      .eq('story_id', input.storyId)
      .eq('node_id', coverNodeId)
      .maybeSingle();
    const imageUrl = cleanString((data as { image_url?: string | null } | null)?.image_url);
    if (imageUrl) {
      return {
        url: imageUrl,
        isStoryboard: (data as { is_storyboard?: boolean | null } | null)?.is_storyboard === true,
      };
    }
  }

  if (input.storylineId) {
    const { data: junctionRows } = await supabase
      .from('storyline_beats')
      .select('beat_id, position')
      .eq('storyline_id', input.storylineId)
      .in('position', [0, 1])
      .order('position', { ascending: false })
      .limit(1);
    const beatId = (junctionRows?.[0] as { beat_id?: string } | undefined)?.beat_id;
    if (beatId) {
      const { data } = await supabase
        .from('beats')
        .select('image_url, is_storyboard')
        .eq('id', beatId)
        .maybeSingle();
      const imageUrl = cleanString((data as { image_url?: string | null } | null)?.image_url);
      return imageUrl
        ? {
          url: imageUrl,
          isStoryboard: (data as { is_storyboard?: boolean | null } | null)?.is_storyboard === true,
        }
        : null;
    }
  }

  return null;
}

async function updateStorylineCoverFields(
  supabase: SupabaseClient,
  storylineId: string,
  patch: StorylineAssetUpdate
): Promise<void> {
  const { error } = await supabase
    .from('storylines')
    .update(patch)
    .eq('id', storylineId);
  if (error) {
    throw new Error(`Failed to update storyline cover fields: ${error.message}`);
  }
}

export async function finalizeStorylineShareAssets(
  input: FinalizeStorylineShareAssetsInput
): Promise<void> {
  const supabase = createAdminClient();
  const promptPatch: StorylineAssetUpdate = {
    social_cover_prompt: input.socialCoverPrompt ?? null,
    youtube_thumbnail_prompt: input.youtubeThumbnailPrompt ?? null,
    reel_thumbnail_prompt: input.reelThumbnailPrompt ?? null,
    audio_cover_prompt: input.audioCoverPrompt ?? null,
    story_format: input.storyFormat,
    story_visual_mode: input.storyVisualMode,
    orientation: input.orientation,
  };

  const updatePatch: StorylineAssetUpdate = { ...promptPatch };

  try {
    if (input.youtubeThumbnailDataUrl) {
      const youtubeAsset = await processAndUploadStorylineAsset({
        supabase,
        userId: input.userId,
        storyId: input.storyId,
        storylineId: input.storylineId,
        kind: 'youtube_thumbnail',
        source: input.youtubeThumbnailSource ?? 'uploaded',
        sourceUrlOrDataUrl: input.youtubeThumbnailDataUrl,
        versionSeed: `${input.storylineId}:youtube:${Date.now()}`,
      });
      Object.assign(updatePatch, youtubeThumbnailUpdate(youtubeAsset));

      const derivedShareAsset = await processAndUploadStorylineAsset({
        supabase,
        userId: input.userId,
        storyId: input.storyId,
        storylineId: input.storylineId,
        kind: 'share_cover',
        source: input.youtubeThumbnailSource ?? 'uploaded',
        sourceUrlOrDataUrl: input.youtubeThumbnailDataUrl,
        versionSeed: `${input.storylineId}:youtube-derived-share:${Date.now()}`,
      });
      Object.assign(updatePatch, shareCoverUpdate(derivedShareAsset));
    } else if (input.shareCoverDataUrl) {
      const shareAsset = await processAndUploadStorylineAsset({
        supabase,
        userId: input.userId,
        storyId: input.storyId,
        storylineId: input.storylineId,
        kind: 'share_cover',
        source: input.shareCoverSource ?? 'uploaded',
        sourceUrlOrDataUrl: input.shareCoverDataUrl,
        versionSeed: `${input.storylineId}:share-upload:${Date.now()}`,
      });
      Object.assign(updatePatch, shareCoverUpdate(shareAsset));
    } else if (input.storyFormat !== 'audio_story') {
      const fallbackBeatImage = await resolveFallbackBeatImageUrl(supabase, {
        storyId: input.storyId,
        coverImageUrl: input.coverImageUrl,
        beats: input.beats,
      });

      if (fallbackBeatImage) {
        const fallbackAsset = await processAndUploadStorylineAsset({
          supabase,
          userId: input.userId,
          storyId: input.storyId,
          storylineId: input.storylineId,
          kind: 'share_cover',
          source: 'fallback_beat',
          sourceUrlOrDataUrl: fallbackBeatImage.url,
          sourceCrop: fallbackBeatImage.isStoryboard ? getStoryboardSharePanelSourceCrop(0) : null,
          versionSeed: `${input.storylineId}:fallback:${fallbackBeatImage.isStoryboard ? 'storyboard-panel-0:' : ''}${fallbackBeatImage.url}`,
        });
        Object.assign(updatePatch, shareCoverUpdate(fallbackAsset));
      }
    }

    if (input.reelThumbnailDataUrl) {
      const reelAsset = await processAndUploadStorylineAsset({
        supabase,
        userId: input.userId,
        storyId: input.storyId,
        storylineId: input.storylineId,
        kind: 'reel_thumbnail',
        source: input.reelThumbnailSource ?? 'uploaded',
        sourceUrlOrDataUrl: input.reelThumbnailDataUrl,
        versionSeed: `${input.storylineId}:reel:${Date.now()}`,
      });
      Object.assign(updatePatch, reelThumbnailUpdate(reelAsset));
    }

    if (!updatePatch.share_cover_url) {
      const defaultAsset = await uploadBrandedDefaultShareCover({
        supabase,
        userId: input.userId,
        storyId: input.storyId,
        storylineId: input.storylineId,
        title: input.title,
        authorName: input.authorName,
        storyFormat: input.storyFormat,
      });
      Object.assign(updatePatch, shareCoverUpdate(defaultAsset));
    }

    await updateStorylineCoverFields(supabase, input.storylineId, updatePatch);
  } catch (error) {
    console.error('Failed to finalize storyline share cover assets:', error);
    try {
      const defaultAsset = await uploadBrandedDefaultShareCover({
        supabase,
        userId: input.userId,
        storyId: input.storyId,
        storylineId: input.storylineId,
        title: input.title,
        authorName: input.authorName,
        storyFormat: input.storyFormat,
      });
      await updateStorylineCoverFields(supabase, input.storylineId, {
        ...promptPatch,
        ...shareCoverUpdate(defaultAsset),
      });
    } catch (fallbackError) {
      console.error('Failed to create emergency branded share cover:', fallbackError);
      await updateStorylineCoverFields(supabase, input.storylineId, {
        ...promptPatch,
        share_cover_status: 'failed',
        share_cover_updated_at: new Date().toISOString(),
      });
    }
  }

  // Runs for every publish path that finalizes assets, and independently of
  // whether the cover work above succeeded. Never throws.
  await refreshStorylineDiscoveryMetadata({
    storylineId: input.storylineId,
    storyId: input.storyId,
    title: input.title,
    beats: input.beats,
  });
}

export async function getPublishedStorylineCoverEditorState(
  storylineId: string
): Promise<PublishedStorylineCoverEditorState> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Sign in to manage this storyline cover.');
  }

  const { storyline, story } = await loadOwnedPublishedStorylineForCoverEditor(storylineId, user.id);
  return buildPublishedStorylineCoverEditorState(storyline, story);
}

export async function updatePublishedStorylineShareAssets(input: {
  storylineId: string;
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
}): Promise<PublishedStorylineCoverEditorState> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Sign in to manage this storyline cover.');
  }

  const { storyline, story } = await loadOwnedPublishedStorylineForCoverEditor(input.storylineId, user.id);
  const fallbackPrompts = buildPublishedStorylinePromptFields(storyline, story);

  const updatePatch: StorylineAssetUpdate = {};
  const admin = createAdminClient();

  if (input.youtubeThumbnailDataUrl) {
    const youtubeAsset = await processAndUploadStorylineAsset({
      supabase: admin,
      userId: user.id,
      storyId: storyline.story_id,
      storylineId: storyline.id,
      kind: 'youtube_thumbnail',
      source: input.youtubeThumbnailSource ?? 'uploaded',
      sourceUrlOrDataUrl: input.youtubeThumbnailDataUrl,
      versionSeed: `${storyline.id}:youtube-update:${Date.now()}`,
    });
    Object.assign(updatePatch, youtubeThumbnailUpdate(youtubeAsset));

    const derivedShareAsset = await processAndUploadStorylineAsset({
      supabase: admin,
      userId: user.id,
      storyId: storyline.story_id,
      storylineId: storyline.id,
      kind: 'share_cover',
      source: input.youtubeThumbnailSource ?? 'uploaded',
      sourceUrlOrDataUrl: input.youtubeThumbnailDataUrl,
      versionSeed: `${storyline.id}:youtube-derived-share-update:${Date.now()}`,
    });
    Object.assign(updatePatch, shareCoverUpdate(derivedShareAsset));
  } else if (input.shareCoverDataUrl) {
    const shareAsset = await processAndUploadStorylineAsset({
      supabase: admin,
      userId: user.id,
      storyId: storyline.story_id,
      storylineId: storyline.id,
      kind: 'share_cover',
      source: input.shareCoverSource ?? 'uploaded',
      sourceUrlOrDataUrl: input.shareCoverDataUrl,
      versionSeed: `${storyline.id}:share-update:${Date.now()}`,
    });
    Object.assign(updatePatch, shareCoverUpdate(shareAsset));
  }

  if (input.reelThumbnailDataUrl) {
    const reelAsset = await processAndUploadStorylineAsset({
      supabase: admin,
      userId: user.id,
      storyId: storyline.story_id,
      storylineId: storyline.id,
      kind: 'reel_thumbnail',
      source: input.reelThumbnailSource ?? 'uploaded',
      sourceUrlOrDataUrl: input.reelThumbnailDataUrl,
      versionSeed: `${storyline.id}:reel-update:${Date.now()}`,
    });
    Object.assign(updatePatch, reelThumbnailUpdate(reelAsset));
  }

  if (Object.keys(updatePatch).length === 0) {
    return buildPublishedStorylineCoverEditorState(storyline, story);
  }

  Object.assign(updatePatch, {
    social_cover_prompt: input.socialCoverPrompt ?? fallbackPrompts.socialCoverPrompt,
    youtube_thumbnail_prompt: input.youtubeThumbnailPrompt ?? fallbackPrompts.youtubeThumbnailPrompt,
    reel_thumbnail_prompt: input.reelThumbnailPrompt ?? fallbackPrompts.reelThumbnailPrompt,
    audio_cover_prompt: input.audioCoverPrompt ?? fallbackPrompts.audioCoverPrompt,
  });

  await updateStorylineCoverFields(admin, storyline.id, updatePatch);

  const refreshed = await loadOwnedPublishedStorylineForCoverEditor(storyline.id, user.id);
  return buildPublishedStorylineCoverEditorState(refreshed.storyline, refreshed.story);
}

function coverGenerationActionKey(kind: 'social' | 'youtube' | 'reel' | 'audio'): PricingActionKey {
  if (kind === 'audio') return 'generate_audio_story_cover';
  if (kind === 'reel') return 'generate_reel_thumbnail';
  return 'generate_social_share_cover';
}

function coverGenerationActivityKey(
  kind: 'social' | 'youtube' | 'reel' | 'audio'
): Extract<CostActivityKey, 'generate_social_share_cover' | 'generate_audio_story_cover' | 'generate_reel_thumbnail'> {
  if (kind === 'audio') return 'generate_audio_story_cover';
  if (kind === 'reel') return 'generate_reel_thumbnail';
  return 'generate_social_share_cover';
}

function coverGenerationFlagKey(kind: 'social' | 'youtube' | 'reel' | 'audio'): string {
  if (kind === 'audio') return 'audio_story_cover_generation_enabled';
  if (kind === 'reel') return 'vertical_reel_thumbnail_generation_enabled';
  return 'visual_story_cover_generation_enabled';
}

function coverImageTaskKey(kind: 'social' | 'youtube' | 'reel' | 'audio'): Extract<ImageTaskKey, 'image_generation' | 'reel_image_generation'> {
  return kind === 'reel' ? 'reel_image_generation' : 'image_generation';
}

function normalizeCoverImageSelection(
  selection: ImageModelSelection | null | undefined,
  taskKey: Extract<ImageTaskKey, 'image_generation' | 'reel_image_generation'>
): ImageModelSelection | null {
  return selection?.modelKey
    ? {
        modelKey: selection.modelKey,
        taskKey,
      }
    : null;
}

function extractLatestContinuityStateFromBeats(beats: StoryBeat[] | null | undefined): ImageContinuityProviderState | null {
  if (!Array.isArray(beats)) return null;
  for (let index = beats.length - 1; index >= 0; index -= 1) {
    const state = extractImageContinuityState(beats[index]?.imageGenerationMetadata);
    if (state) return state;
  }
  return null;
}

function extractContinuityStateFromVisualProfile(visualProfile: Record<string, unknown> | null | undefined): ImageContinuityProviderState | null {
  const imageContinuity = visualProfile?.imageContinuity;
  if (!imageContinuity || typeof imageContinuity !== 'object') return null;
  const latestState = (imageContinuity as Record<string, unknown>).latestState;
  return extractImageContinuityState({ statefulContinuity: latestState });
}

async function resolveStoredCoverGenerationContext(input: {
  userId: string;
  storyId?: string | null;
  storylineId?: string | null;
}): Promise<CoverGenerationContext> {
  const admin = createAdminClient();
  let storyId = cleanString(input.storyId);
  let storylineBeats: StoryBeat[] | null = null;

  if (input.storylineId) {
    const { data: storylineData, error: storylineError } = await admin
      .from('storylines')
      .select('story_id, user_id, beats')
      .eq('id', input.storylineId)
      .maybeSingle();

    if (storylineError) {
      throw new Error(`Failed to load storyline continuity context: ${storylineError.message}`);
    }

    const storyline = storylineData as { story_id?: string | null; user_id?: string | null; beats?: StoryBeat[] | null } | null;
    if (storyline) {
      if (storyline.user_id && storyline.user_id !== input.userId) {
        throw new Error('You do not have permission to generate a cover for this storyline.');
      }
      storyId = storyId ?? cleanString(storyline.story_id);
      storylineBeats = Array.isArray(storyline.beats) ? storyline.beats : null;
    }
  }

  if (!storyId) {
    return {};
  }

  const { data: storyData, error: storyError } = await admin
    .from('stories')
    .select('story_config, image_model_key, visual_profile')
    .eq('id', storyId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (storyError) {
    throw new Error(`Failed to load story continuity context: ${storyError.message}`);
  }

  const story = storyData as {
    story_config?: Record<string, unknown> | null;
    image_model_key?: string | null;
    visual_profile?: Record<string, unknown> | null;
  } | null;
  if (!story) {
    return {};
  }

  const storyConfig = normalizeStoryConfig(story.story_config);
  const fallbackSelection = cleanString(story.image_model_key)
    ? { modelKey: cleanString(story.image_model_key) as string }
    : null;
  const previousState =
    extractLatestContinuityStateFromBeats(storylineBeats)
    ?? extractContinuityStateFromVisualProfile(story.visual_profile);

  return {
    imageModelSelection: storyConfig.imageModelSelection ?? fallbackSelection,
    imageContinuity: {
      requestedStrategy: storyConfig.imageContinuityStrategy,
      previousState,
    },
  };
}

async function generateCoverImageWithStoryContext(input: {
  prompt: string;
  kind: 'social' | 'youtube' | 'reel' | 'audio';
  storyId?: string | null;
  storylineId?: string | null;
  imageModelSelection?: ImageModelSelection | null;
  imageContinuity?: CoverGenerationContinuityInput;
  userId: string;
}): Promise<string> {
  const task = coverImageTaskKey(input.kind);
  const aspectRatio = input.kind === 'reel' ? '9:16' : '16:9';
  const storedContext = await resolveStoredCoverGenerationContext({
    userId: input.userId,
    storyId: input.storyId,
    storylineId: input.storylineId,
  });
  const selectedModel = normalizeCoverImageSelection(
    input.imageModelSelection ?? storedContext.imageModelSelection,
    task
  );
  const requestedStrategy = normalizeImageContinuityStrategy(
    input.imageContinuity?.requestedStrategy
      ?? storedContext.imageContinuity?.requestedStrategy
      ?? null
  );
  const previousState =
    input.imageContinuity?.previousState
    ?? storedContext.imageContinuity?.previousState
    ?? null;
  const telemetry: CostTelemetryContext = {
    activityKey: coverGenerationActivityKey(input.kind),
    storyId: input.storyId ?? null,
    storylineId: input.storylineId ?? null,
    phase: 'cover_generation',
    metadata: {
      coverKind: input.kind,
      continuityStrategy: previousState ? requestedStrategy : null,
    },
  };

  if (selectedModel || previousState) {
    const routedResult = await generateSelectedImage({
      task,
      prompt: input.prompt,
      aspectRatio,
      imageSize: '1K',
      selection: selectedModel,
      continuity: previousState
        ? {
            requestedStrategy,
            previousState,
            allowRuntimeFallback: true,
          }
        : null,
      telemetry,
    });

    if (routedResult.dataUrl) {
      return routedResult.dataUrl;
    }

    throw new Error(routedResult.fallbackText || 'The image model did not return a cover image.');
  }

  const model = await getFeatureFlagValue('cover_generation_model') || DEFAULT_IMAGE_MODEL_ID;
  const result = await callGeminiImage({
    task: 'image_generation',
    model,
    prompt: input.prompt,
    aspectRatio,
    imageSize: '1K',
  });
  if (!result.dataUrl) {
    throw new Error(result.fallbackText || 'The image model did not return a cover image.');
  }

  return result.dataUrl;
}

function authorizationErrorMessage(reason?: string | null): string {
  if (reason === 'sign_in_required') return 'Sign in to generate a cover.';
  if (reason === 'insufficient_balance') return 'You do not have enough coins to generate this cover.';
  if (reason === 'checkout_unavailable') return 'Cover generation needs coins, but checkout is not available right now.';
  return 'Cover generation is not available right now.';
}

export async function generateDraftStoryCoverImage(input: {
  storyId?: string | null;
  storylineId?: string | null;
  prompt: string;
  kind: 'social' | 'youtube' | 'reel' | 'audio';
  imageModelSelection?: ImageModelSelection | null;
  imageContinuity?: CoverGenerationContinuityInput;
}): Promise<{ dataUrl: string; coinCost: number; beatCost: number }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Cover prompt is required.');

  const enabled = await getFeatureFlag(coverGenerationFlagKey(input.kind), true);
  if (!enabled) {
    throw new Error('Cover generation is currently disabled.');
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Sign in to generate a cover.');

  const actionKey = coverGenerationActionKey(input.kind);
  const authorization = await authorizeCoinOperationForUser({
    userId: user.id,
    operationKey: actionKey,
    idempotencyKey: `cover:${input.kind}:${input.storyId ?? 'draft'}:${randomUUID()}`,
    components: [
      { meterKey: actionKey },
      {
        meterKey: 'image_generation',
        unitBeatCostOverride: 0,
        metadata: { entitlementOnly: true },
      },
    ],
    relatedStoryId: input.storyId ?? null,
    relatedStorylineId: input.storylineId ?? null,
    metadata: {
      coverKind: input.kind,
      promptChars: prompt.length,
    },
  });

  if (authorization.status === 'denied') {
    throw new Error(authorizationErrorMessage(authorization.reason));
  }

  try {
    const dataUrl = await generateCoverImageWithStoryContext({
      prompt,
      kind: input.kind,
      storyId: input.storyId ?? null,
      storylineId: input.storylineId ?? null,
      imageModelSelection: input.imageModelSelection ?? null,
      imageContinuity: input.imageContinuity ?? null,
      userId: user.id,
    });

    if (authorization.status === 'allowed' && authorization.mode === 'hard' && authorization.reservationId) {
      await finalizeBillableAction({
        userId: user.id,
        reservationId: authorization.reservationId,
        storyId: input.storyId ?? null,
        storylineId: input.storylineId ?? null,
        metadata: {
          coverKind: input.kind,
          promptChars: prompt.length,
        },
      });
    }

    return {
      dataUrl,
      coinCost: authorization.coinCost,
      beatCost: authorization.beatCost,
    };
  } catch (generationError) {
    if (authorization.status === 'allowed' && authorization.mode === 'hard' && authorization.reservationId) {
      await releaseBillableAction({
        userId: user.id,
        reservationId: authorization.reservationId,
        reason: 'cover_generation_failed',
        releaseStatus: 'failed',
        metadata: {
          coverKind: input.kind,
          message: generationError instanceof Error ? generationError.message : 'unknown error',
        },
      });
    }
    throw generationError;
  }
}

export async function repairPublishedStorylineShareCovers(options: { limit?: number } = {}): Promise<RepairStorylineCoverResult> {
  const supabase = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const logs: string[] = [];
  let ready = 0;
  let processedFromBeat = 0;
  let defaulted = 0;
  let failed = 0;

  const { data, error } = await supabase
    .from('storylines')
    .select(`
      id,
      story_id,
      user_id,
      title,
      author_name,
      cover_image_url,
      node_path,
      beats,
      share_cover_url,
      share_cover_source,
      share_cover_status,
      share_cover_width,
      share_cover_height,
      share_cover_mime_type,
      share_cover_version,
      story_format,
      story_visual_mode,
      orientation
    `)
    .eq('is_public', true)
    .or('share_cover_status.neq.ready,share_cover_url.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load storylines for repair: ${error.message}`);
  const rows = (data ?? []) as StorylineShareCoverRow[];

  for (const row of rows) {
    try {
      if (row.share_cover_status === 'ready' && isAbsoluteCrawlerSafeImageUrl(row.share_cover_url)) {
        ready += 1;
        continue;
      }

      const userId = row.user_id;
      const storyId = row.story_id;
      if (!userId || !storyId) {
        throw new Error('Storyline has no user_id or story_id.');
      }

      let asset: ProcessedStorylineAsset | null = null;
      if (row.story_format !== 'audio_story') {
        const fallbackBeatImage = await resolveFallbackBeatImageUrl(supabase, {
          storylineId: row.id,
          storyId,
          nodePath: row.node_path,
          coverImageUrl: row.cover_image_url,
          beats: Array.isArray(row.beats) ? row.beats as unknown as StoryBeat[] : null,
        });

        if (fallbackBeatImage) {
          asset = await processAndUploadStorylineAsset({
            supabase,
            userId,
            storyId,
            storylineId: row.id,
            kind: 'share_cover',
            source: 'fallback_beat',
            sourceUrlOrDataUrl: fallbackBeatImage.url,
            sourceCrop: fallbackBeatImage.isStoryboard ? getStoryboardSharePanelSourceCrop(0) : null,
            versionSeed: `${row.id}:repair:${fallbackBeatImage.isStoryboard ? 'storyboard-panel-0:' : ''}${fallbackBeatImage.url}`,
          });
          processedFromBeat += 1;
        }
      }

      if (!asset) {
        asset = await uploadBrandedDefaultShareCover({
          supabase,
          userId,
          storyId,
          storylineId: row.id,
          title: row.title,
          authorName: row.author_name,
          storyFormat: row.story_format,
        });
        defaulted += 1;
      }

      await updateStorylineCoverFields(supabase, row.id, shareCoverUpdate(asset));
      logs.push(`${row.id}: ${asset.source}`);
    } catch (repairError) {
      failed += 1;
      logs.push(`${row.id}: failed - ${repairError instanceof Error ? repairError.message : 'unknown error'}`);
      await supabase
        .from('storylines')
        .update({ share_cover_status: 'failed', share_cover_updated_at: new Date().toISOString() })
        .eq('id', row.id);
    }
  }

  return {
    scanned: rows.length,
    ready,
    processedFromBeat,
    defaulted,
    failed,
    logs,
  };
}

async function probeImageUrl(url: string | null | undefined): Promise<DiagnosticImageProbe> {
  if (!url) {
    return { ok: false, status: null, contentType: null, contentLength: null, error: 'missing url' };
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'KissagoShareCoverDiagnostics/1.0',
        Accept: 'image/jpeg,image/webp,image/png,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: null,
      contentLength: null,
      error: error instanceof Error ? error.message : 'fetch failed',
    };
  }
}

function extractMetaContent(html: string, propertyOrName: string): string | null {
  const escaped = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyRegex = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const contentFirstRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  return html.match(propertyRegex)?.[1] ?? html.match(contentFirstRegex)?.[1] ?? null;
}

async function inspectRawMetadata(shareUrl: string | null): Promise<{
  fetched: boolean;
  ogImage: string | null;
  twitterImage: string | null;
  error: string | null;
}> {
  if (!shareUrl) {
    return { fetched: false, ogImage: null, twitterImage: null, error: 'APP_URL/NEXT_PUBLIC_APP_URL is not configured.' };
  }
  try {
    const response = await fetch(shareUrl, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 KissagoShareCoverDiagnostics/1.0',
        Accept: 'text/html',
      },
    });
    const html = await response.text();
    return {
      fetched: response.ok,
      ogImage: extractMetaContent(html, 'og:image'),
      twitterImage: extractMetaContent(html, 'twitter:image'),
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      fetched: false,
      ogImage: null,
      twitterImage: null,
      error: error instanceof Error ? error.message : 'metadata fetch failed',
    };
  }
}

export async function getStorylineShareCoverDiagnostics(storylineInput: string, options: { origin?: string | null } = {}): Promise<{
  bucket: Awaited<ReturnType<typeof verifyPublicStorylineBucket>>;
  storyline: StorylineShareCoverRow | null;
  resolved: ReturnType<typeof resolveStorylineShareCover>;
  imageProbe: DiagnosticImageProbe;
  urlChecks: {
    isAbsolute: boolean;
    isCrawlerSafe: boolean;
    hasSignedToken: boolean;
  };
  metadata: Awaited<ReturnType<typeof inspectRawMetadata>>;
  shareUrl: string | null;
  debuggerLinks: {
    facebook: string | null;
    twitter: string | null;
    linkedin: string | null;
  };
}> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const adminUserId = process.env.ADMIN_USER_ID;
  if (error || !user || !adminUserId || user.id !== adminUserId) {
    throw new Error('Forbidden');
  }

  const { storylineId, inputOrigin } = extractStorylineIdInput(storylineInput);
  const admin = createAdminClient();
  const { data, error: rowError } = await admin
    .from('storylines')
    .select('*')
    .eq('id', storylineId)
    .maybeSingle();
  if (rowError) throw new Error(`Failed to load storyline: ${rowError.message}`);

  const storyline = data as StorylineShareCoverRow | null;
  const origin = resolveDiagnosticsOrigin(inputOrigin, options.origin);
  const shareUrl = origin ? new URL(`/storyline/${storylineId}`, origin).toString() : null;
  const resolved = resolveStorylineShareCover(storyline, { origin });
  const imageProbe = await probeImageUrl(resolved.url);
  const metadata = await inspectRawMetadata(shareUrl);
  const parsed = (() => {
    try {
      return new URL(resolved.url);
    } catch {
      return null;
    }
  })();

  return {
    bucket: await verifyPublicStorylineBucket(admin),
    storyline,
    resolved,
    imageProbe,
    urlChecks: {
      isAbsolute: Boolean(parsed),
      isCrawlerSafe: isAbsoluteCrawlerSafeImageUrl(resolved.url),
      hasSignedToken: Boolean(parsed?.pathname.includes('/storage/v1/object/sign/') || parsed?.searchParams.has('token')),
    },
    metadata,
    shareUrl,
    debuggerLinks: {
      facebook: shareUrl ? `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(shareUrl)}` : null,
      twitter: shareUrl ? `https://cards-dev.twitter.com/validator` : null,
      linkedin: shareUrl ? `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(shareUrl)}` : null,
    },
  };
}
