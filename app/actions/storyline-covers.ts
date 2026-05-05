'use server';

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { callGeminiImage } from '@/app/actions/gemini-proxy';
import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { authorizeBillableAction, finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  isAbsoluteCrawlerSafeImageUrl,
  processAndUploadStorylineAsset,
  resolveStorylineShareCover,
  uploadBrandedDefaultShareCover,
  verifyPublicStorylineBucket,
  type ProcessedStorylineAsset,
  type StorylineShareCoverRow,
} from '@/lib/story/share-cover';
import type {
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

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function readLegacyBeatCover(beats: StoryBeat[] | null | undefined): string | null {
  if (!beats?.length) return null;
  const preferred = beats.length > 1 ? beats[1] : beats[0];
  return cleanString(preferred?.imageUrl)
    ?? cleanString(preferred?.persistedImageUrl)
    ?? null;
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
): Promise<string | null> {
  const direct = cleanString(input.coverImageUrl) ?? readLegacyBeatCover(input.beats);
  if (direct) return direct;

  const nodePath = Array.isArray(input.nodePath) ? input.nodePath : [];
  const coverNodeId = nodePath.length > 1 ? nodePath[1] : nodePath[0];
  if (coverNodeId) {
    const { data } = await supabase
      .from('beats')
      .select('image_url')
      .eq('story_id', input.storyId)
      .eq('node_id', coverNodeId)
      .maybeSingle();
    const imageUrl = cleanString((data as { image_url?: string | null } | null)?.image_url);
    if (imageUrl) return imageUrl;
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
        .select('image_url')
        .eq('id', beatId)
        .maybeSingle();
      return cleanString((data as { image_url?: string | null } | null)?.image_url);
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
          storylineId: input.storylineId,
          kind: 'share_cover',
          source: 'fallback_beat',
          sourceUrlOrDataUrl: fallbackBeatImage,
          versionSeed: `${input.storylineId}:fallback:${fallbackBeatImage}`,
        });
        Object.assign(updatePatch, shareCoverUpdate(fallbackAsset));
      }
    }

    if (input.reelThumbnailDataUrl) {
      const reelAsset = await processAndUploadStorylineAsset({
        supabase,
        userId: input.userId,
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
}

function coverGenerationActionKey(kind: 'social' | 'youtube' | 'reel' | 'audio'): PricingActionKey {
  if (kind === 'audio') return 'generate_audio_story_cover';
  if (kind === 'reel') return 'generate_reel_thumbnail';
  return 'generate_social_share_cover';
}

function coverGenerationFlagKey(kind: 'social' | 'youtube' | 'reel' | 'audio'): string {
  if (kind === 'audio') return 'audio_story_cover_generation_enabled';
  if (kind === 'reel') return 'vertical_reel_thumbnail_generation_enabled';
  return 'visual_story_cover_generation_enabled';
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
  const authorization = await authorizeBillableAction({
    userId: user.id,
    actionKey,
    idempotencyKey: `cover:${input.kind}:${input.storyId ?? 'draft'}:${randomUUID()}`,
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

  const model = await getFeatureFlagValue('cover_generation_model') || 'gemini-3.1-flash-image-preview';
  const aspectRatio = input.kind === 'reel' ? '9:16' : '16:9';

  try {
    const result = await callGeminiImage({
      task: 'image_generation',
      model,
      prompt,
      aspectRatio,
      imageSize: '1K',
    });
    if (!result.dataUrl) {
      throw new Error(result.fallbackText || 'The image model did not return a cover image.');
    }

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
      dataUrl: result.dataUrl,
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
        const fallbackUrl = await resolveFallbackBeatImageUrl(supabase, {
          storylineId: row.id,
          storyId,
          nodePath: row.node_path,
          coverImageUrl: row.cover_image_url,
          beats: Array.isArray(row.beats) ? row.beats as unknown as StoryBeat[] : null,
        });

        if (fallbackUrl) {
          asset = await processAndUploadStorylineAsset({
            supabase,
            userId,
            storylineId: row.id,
            kind: 'share_cover',
            source: 'fallback_beat',
            sourceUrlOrDataUrl: fallbackUrl,
            versionSeed: `${row.id}:repair:${fallbackUrl}`,
          });
          processedFromBeat += 1;
        }
      }

      if (!asset) {
        asset = await uploadBrandedDefaultShareCover({
          supabase,
          userId,
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

export async function getStorylineShareCoverDiagnostics(storylineId: string): Promise<{
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

  const admin = createAdminClient();
  const { data, error: rowError } = await admin
    .from('storylines')
    .select('*')
    .eq('id', storylineId)
    .maybeSingle();
  if (rowError) throw new Error(`Failed to load storyline: ${rowError.message}`);

  const storyline = data as StorylineShareCoverRow | null;
  const origin = cleanString(process.env.APP_URL) ?? cleanString(process.env.NEXT_PUBLIC_APP_URL);
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
