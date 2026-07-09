'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
import { putR2Object } from '@/lib/media/r2-server';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { recordMediaAsset } from '@/lib/media/media-assets';
import { parseReelStorySettingsValue } from '@/lib/reel/settings';
import {
  canUseReelVisualStyle,
  mapReelVisualStyleRow,
  normalizePlanKey,
  normalizeReelTextOverlayStyle,
  type ReelTextOverlayStyle,
  type ReelVisualStyleCard,
  type ReelVisualStyleRecord,
  type ReelVisualStyleRuntime,
  type ReelVisualStyleStatus,
} from '@/lib/reel/styles';
import type { PlanKey } from '@/lib/types/pricing';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { callGeminiVisionText, callGeminiImage } from '@/app/actions/gemini-proxy';
import { getModelConfig } from '@/lib/ai/model-config';

type ReelStyleRow = Record<string, unknown>;

export interface SaveReelVisualStyleInput {
  name: string;
  slug?: string;
  minPlan: PlanKey;
  promptDefiner: string;
  sampleImageDataUrl: string;
  thumbnailDataUrl?: string;
  textOverlayStyle?: ReelTextOverlayStyle;
  noFaceDefault?: boolean;
  sortOrder?: number;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseDataUrl(value: string): { buffer: Buffer; mimeType: string; extension: string } {
  const parsed = splitBase64DataUrl(value);
  if (!parsed) {
    throw new Error('Sample image must be a generated data URL from the Reel Playground.');
  }

  const mimeType = parsed.mimeType;
  const buffer = Buffer.from(parsed.base64, 'base64');
  if (buffer.byteLength === 0) {
    throw new Error('Sample image data is empty.');
  }

  const extension = mimeType === 'image/webp'
    ? 'webp'
    : mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/jpeg'
        ? 'jpg'
        : null;

  if (!extension) {
    throw new Error(`Unsupported sample image type: ${mimeType}`);
  }

  return { buffer, mimeType, extension };
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function listStyleRows(status?: ReelVisualStyleStatus): Promise<ReelStyleRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from('reel_visual_styles')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    if (error.message.includes('reel_visual_styles')) return [];
    throw new Error(`Failed to load reel visual styles: ${error.message}`);
  }
  return (data ?? []) as ReelStyleRow[];
}

async function buildSettingsFallbackStyles(): Promise<ReelVisualStyleCard[]> {
  const settings = parseReelStorySettingsValue(await getFeatureFlagValue('reel_story_settings'));
  return settings.visualStyles.map((style, index) => {
    const record: ReelVisualStyleRecord = {
      id: `settings:${style.key}`,
      name: style.label,
      slug: style.key,
      status: 'published',
      minPlan: 'free',
      promptDefiner: style.prompt,
      sampleImageUrl: null,
      sampleR2ObjectKey: null,
      sampleR2Bucket: null,
      thumbnailUrl: null,
      thumbnailR2ObjectKey: null,
      thumbnailR2Bucket: null,
      textOverlayStyle: normalizeReelTextOverlayStyle(null),
      noFaceDefault: true,
      sortOrder: index,
      createdAt: '',
      updatedAt: '',
      publishedAt: null,
    };
    return { ...record, isLocked: false };
  });
}

export async function listReelVisualStylesForAdminAction(): Promise<ReelVisualStyleRecord[]> {
  await verifyAdmin();
  const rows = await listStyleRows();
  return rows.map(mapReelVisualStyleRow);
}

export async function listReelVisualStyleCardsAction(): Promise<ReelVisualStyleCard[]> {
  const rows = await listStyleRows('published');
  if (rows.length === 0) {
    return buildSettingsFallbackStyles();
  }

  const pricing = await getPricingRuntimeContext().catch(() => null);
  const userPlan = normalizePlanKey(pricing?.snapshot.planKey);
  return rows.map((row) => {
    const record = mapReelVisualStyleRow(row);
    return {
      ...record,
      isLocked: !canUseReelVisualStyle(userPlan, record.minPlan),
    };
  });
}

export async function getPublishedReelVisualStylesForRuntime(): Promise<ReelVisualStyleRuntime[]> {
  const rows = await listStyleRows('published');
  return rows.map((row) => {
    const record = mapReelVisualStyleRow(row);
    return {
      id: record.id,
      name: record.name,
      slug: record.slug,
      minPlan: record.minPlan,
      promptDefiner: record.promptDefiner,
      textOverlayStyle: record.textOverlayStyle,
      noFaceDefault: record.noFaceDefault,
    };
  });
}

export async function saveReelVisualStyleFromPlaygroundAction(
  input: SaveReelVisualStyleInput
): Promise<ReelVisualStyleRecord> {
  await verifyAdmin();
  const name = input.name.trim();
  if (!name) throw new Error('Style name is required.');

  const slug = slugify(input.slug || name);
  if (!slug) throw new Error('Style slug is required.');

  const promptDefiner = input.promptDefiner.trim();
  if (!promptDefiner) throw new Error('Prompt definer is required.');

  const { buffer, mimeType, extension } = parseDataUrl(input.sampleImageDataUrl);
  const storageConfig = await getEffectiveMediaStorageConfig();
  if (!storageConfig.r2.enabled || !storageConfig.r2.publicDeliveryEnabled) {
    throw new Error('R2 public storage is required for reel style samples and is not enabled in this environment.');
  }

  const userId = await getCurrentUserId();
  const objectKey = `reel-styles/${slug}/${crypto.randomUUID()}.${extension}`;
  const r2 = await putR2Object({
    access: 'public',
    objectKey,
    body: buffer,
    contentType: mimeType,
    cacheControl: storageConfig.r2.cacheControlPublic,
  });

  await recordMediaAsset({
    userId,
    assetType: 'reel_style_sample',
    storageProvider: 'r2',
    bucket: r2.bucket,
    objectKey: r2.objectKey,
    publicUrl: r2.publicUrl ?? r2.urlOrReference,
    mimeType,
    sizeBytes: buffer.byteLength,
    isPublic: true,
    cacheControl: storageConfig.r2.cacheControlPublic,
  });

  let thumbnailUrl: string | null = null;
  let thumbnailR2ObjectKey: string | null = null;
  let thumbnailR2Bucket: string | null = null;

  if (input.thumbnailDataUrl) {
    const { buffer: thumbBuffer, mimeType: thumbMimeType, extension: thumbExt } = parseDataUrl(input.thumbnailDataUrl);
    const thumbObjectKey = `reel-styles/${slug}/thumb-256.${thumbExt}`;
    const thumbR2 = await putR2Object({
      access: 'public',
      objectKey: thumbObjectKey,
      body: thumbBuffer,
      contentType: thumbMimeType,
      cacheControl: storageConfig.r2.cacheControlPublic,
    });
    await recordMediaAsset({
      userId,
      assetType: 'reel_style_sample',
      storageProvider: 'r2',
      bucket: thumbR2.bucket,
      objectKey: thumbR2.objectKey,
      publicUrl: thumbR2.publicUrl ?? thumbR2.urlOrReference,
      mimeType: thumbMimeType,
      sizeBytes: thumbBuffer.byteLength,
      isPublic: true,
      cacheControl: storageConfig.r2.cacheControlPublic,
    });
    thumbnailUrl = thumbR2.publicUrl ?? thumbR2.urlOrReference;
    thumbnailR2ObjectKey = thumbR2.objectKey;
    thumbnailR2Bucket = thumbR2.bucket;
  }

  const admin = createAdminClient();
  const row: Record<string, unknown> = {
    name,
    slug,
    status: 'draft',
    min_plan: normalizePlanKey(input.minPlan),
    prompt_definer: promptDefiner,
    sample_image_url: r2.publicUrl ?? r2.urlOrReference,
    sample_r2_object_key: r2.objectKey,
    sample_r2_bucket: r2.bucket,
    text_overlay_style: normalizeReelTextOverlayStyle(input.textOverlayStyle),
    no_face_default: input.noFaceDefault !== false,
    sort_order: Number.isFinite(Number(input.sortOrder)) ? Math.round(Number(input.sortOrder)) : 0,
    created_by: userId,
    updated_by: userId,
  };

  if (thumbnailUrl) {
    row.thumbnail_url = thumbnailUrl;
    row.thumbnail_r2_object_key = thumbnailR2ObjectKey;
    row.thumbnail_r2_bucket = thumbnailR2Bucket;
  }

  const { data, error } = await admin
    .from('reel_visual_styles')
    .upsert(row, { onConflict: 'slug' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to save reel visual style: ${error.message}`);
  }

  return mapReelVisualStyleRow(data as ReelStyleRow);
}

export async function publishReelVisualStyleAction(id: string): Promise<ReelVisualStyleRecord> {
  await verifyAdmin();
  const admin = createAdminClient();
  const userId = await getCurrentUserId();

  const { data: existing, error: loadError } = await admin
    .from('reel_visual_styles')
    .select('*')
    .eq('id', id)
    .single();
  if (loadError || !existing) {
    throw new Error(`Failed to load reel visual style: ${loadError?.message || 'not found'}`);
  }

  const record = mapReelVisualStyleRow(existing as ReelStyleRow);
  if (!record.sampleImageUrl || !record.sampleR2ObjectKey) {
    throw new Error('A reel visual style needs an R2 sample image before it can be published.');
  }

  const { data, error } = await admin
    .from('reel_visual_styles')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to publish reel visual style: ${error.message}`);
  }

  return mapReelVisualStyleRow(data as ReelStyleRow);
}

export async function setReelVisualStyleStatusAction(
  id: string,
  status: Exclude<ReelVisualStyleStatus, 'published'>
): Promise<ReelVisualStyleRecord> {
  await verifyAdmin();
  const admin = createAdminClient();
  const userId = await getCurrentUserId();
  const nextStatus = status === 'archived' ? 'archived' : 'draft';

  const { data, error } = await admin
    .from('reel_visual_styles')
    .update({
      status: nextStatus,
      published_at: null,
      updated_by: userId,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update reel visual style: ${error.message}`);
  }

  return mapReelVisualStyleRow(data as ReelStyleRow);
}

export async function extractGraphicStyleFromImageAction(input: {
  referenceImageDataUrl: string;
}): Promise<{ promptText: string; rawText: string }> {
  await verifyAdmin();

  const parsed = splitBase64DataUrl(input.referenceImageDataUrl);
  if (!parsed) throw new Error('Reference image must be a base64 data URL.');

  const mimeType = parsed.mimeType;
  const base64Data = parsed.base64;
  if (!base64Data) throw new Error('Reference image data is empty.');

  const modelConfig = await getModelConfig('graphic_style_extraction');
  const rawText = await callGeminiVisionText({
    task: 'graphic_style_extraction',
    model: modelConfig.model,
    prompt: 'Analyze the visual style of this reference image and describe it in plain text, ≤150 words. Focus only on style — not subject or scene.',
    referenceParts: [{ mimeType, data: base64Data }],
    temperature: modelConfig.temperature ?? 0.4,
  });

  const promptText = rawText.trim();
  return { promptText, rawText };
}

export async function generateGraphicStyleSampleAction(input: {
  styleName: string;
  promptDefiner: string;
}): Promise<{ imageDataUrl: string; finalPromptText: string }> {
  await verifyAdmin();

  const { styleName, promptDefiner } = input;
  if (!promptDefiner.trim()) throw new Error('Style prompt definer is required.');

  const modelConfig = await getModelConfig('reel_image_generation');
  const samplePrompt = `Create a single 1:1 512×512 sample image demonstrating ONLY the visual style described below. The subject is a calm symbolic motif — a landscape silhouette, abstract geometric shape, hands, sky, or natural texture. No text, no logos, no watermarks, no faces unless the style explicitly requires them.\n\nStyle name: ${styleName || 'Untitled style'}\nVisual style: ${promptDefiner}`;

  const result = await callGeminiImage({
    task: 'reel_image_generation',
    model: modelConfig.model,
    prompt: samplePrompt,
  });

  if (!result.dataUrl) {
    throw new Error('Image generation returned no image. The model may have refused the prompt or timed out.');
  }

  return { imageDataUrl: result.dataUrl, finalPromptText: samplePrompt };
}
