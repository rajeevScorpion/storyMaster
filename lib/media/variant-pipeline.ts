import 'server-only';

import sharp from 'sharp';

import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { putR2Object } from '@/lib/media/r2-server';
import { toR2Reference } from '@/lib/media/r2-reference';
import { recordMediaAsset, type MediaAssetType } from '@/lib/media/media-assets';
import { resolveOriginalExpiresAt } from '@/lib/media/retention';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
import type { MediaPipelineSettings } from '@/lib/media/media-pipeline-settings';
import type { PlanKey } from '@/lib/types/pricing';

export class R2PipelineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2PipelineUnavailableError';
  }
}

export type DerivedVariant = 'display' | 'thumbnail' | 'share_low' | 'share_high';

export interface VariantPipelineInput {
  /** Provider output as a base64 data URL, or a pre-decoded buffer + mime. */
  dataUrl?: string;
  buffer?: Buffer;
  mimeType?: string;
  userId: string;
  storyId: string;
  nodeId?: string | null;
  assetType: MediaAssetType;
  processingMode: 'client_legacy' | 'server_pipeline';
  planKey: PlanKey;
  sourceJobId?: string | null;
  /** Pass an existing group id to resume/overwrite deterministically on retry. */
  mediaGroupId?: string;
}

export interface VariantPipelineResult {
  mediaGroupId: string;
  /** Private r2:// reference of the display variant — sign at load time. */
  displayReference: string;
  thumbnailReference: string | null;
  originalReference: string;
  originalExpiresAt: string;
  width: number | null;
  height: number | null;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'bin';
}

export function buildMediaObjectKey(input: {
  userId: string;
  storyId: string;
  mediaGroupId: string;
  variant: 'original' | DerivedVariant;
  ext: string;
}): string {
  // Internal IDs only — never user emails/names (public-key safety rule).
  return `stories/${input.userId}/${input.storyId}/media/${input.mediaGroupId}/${input.variant}.${input.ext}`;
}

interface DerivedVariantSpec {
  variant: DerivedVariant;
  maxWidth: number;
  quality: number;
}

function derivedVariantSpecs(settings: MediaPipelineSettings): DerivedVariantSpec[] {
  return [
    { variant: 'display', maxWidth: settings.displayMaxWidth, quality: settings.displayWebpQuality },
    { variant: 'thumbnail', maxWidth: settings.thumbnailMaxWidth, quality: settings.thumbnailWebpQuality },
    { variant: 'share_low', maxWidth: settings.shareLowMaxWidth, quality: settings.displayWebpQuality },
    { variant: 'share_high', maxWidth: settings.shareHighMaxWidth, quality: settings.shareHighQuality },
  ];
}

/**
 * Server-side post-processing shared by the interactive image-job worker and
 * (behind its flag) the bulk batch/stateful workers:
 *
 *   provider output → private original (tier-retained) → webp variants
 *   (display / thumbnail / share_low / share_high) → media_assets ledger rows.
 *
 * Everything lands in the PRIVATE bucket and is stored as r2:// references,
 * matching how beat media is signed at load today. Public copies for
 * published stories are made at publish time, never here.
 *
 * Deterministic keys per (mediaGroupId, variant): re-running after a partial
 * failure overwrites the same objects instead of duplicating.
 */
export async function processAndStoreImageVariants(input: VariantPipelineInput): Promise<VariantPipelineResult> {
  const config = await getEffectiveMediaStorageConfig();
  if (!config.r2.enabled || !config.r2.privateBucketName) {
    throw new R2PipelineUnavailableError('R2 is not available for the media variant pipeline.');
  }

  let sourceBuffer: Buffer;
  let sourceMime: string;
  if (input.buffer) {
    sourceBuffer = input.buffer;
    sourceMime = input.mimeType ?? 'image/png';
  } else if (input.dataUrl) {
    const parsed = splitBase64DataUrl(input.dataUrl);
    if (!parsed) throw new Error('Invalid data URL for media variant pipeline.');
    sourceBuffer = Buffer.from(parsed.base64, 'base64');
    sourceMime = parsed.mimeType;
  } else {
    throw new Error('Variant pipeline needs a dataUrl or buffer.');
  }

  const settings = await getMediaPipelineSettings();
  const mediaGroupId = input.mediaGroupId ?? crypto.randomUUID();
  const originalExpiresAt = resolveOriginalExpiresAt(input.planKey, settings);

  const decoded = sharp(sourceBuffer, { failOn: 'none' }).rotate();
  const meta = await decoded.metadata();

  // 1. Original first — once it is safe, generation never has to re-run.
  const originalKey = buildMediaObjectKey({
    userId: input.userId,
    storyId: input.storyId,
    mediaGroupId,
    variant: 'original',
    ext: extensionForMime(sourceMime),
  });
  const originalPut = await putR2Object({
    access: 'private',
    objectKey: originalKey,
    body: sourceBuffer,
    contentType: sourceMime,
    cacheControl: config.r2.cacheControlPrivate,
  });
  await recordMediaAsset({
    storyId: input.storyId,
    nodeId: input.nodeId ?? null,
    userId: input.userId,
    assetType: input.assetType,
    storageProvider: 'r2',
    bucket: originalPut.bucket,
    objectKey: originalKey,
    mimeType: sourceMime,
    sizeBytes: sourceBuffer.length,
    width: meta.width ?? null,
    height: meta.height ?? null,
    isPublic: false,
    variant: 'original',
    mediaGroupId,
    processingMode: input.processingMode,
    sourceJobId: input.sourceJobId ?? null,
    originalExpiresAt,
  });

  // 2. Derived webp variants, sequentially from the one decoded source to
  //    keep worker memory bounded.
  let displayReference: string | null = null;
  let thumbnailReference: string | null = null;
  let displayWidth: number | null = null;
  let displayHeight: number | null = null;

  for (const spec of derivedVariantSpecs(settings)) {
    const output = await sharp(sourceBuffer, { failOn: 'none' })
      .rotate()
      .resize({ width: spec.maxWidth, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: spec.quality })
      .toBuffer({ resolveWithObject: true });

    const objectKey = buildMediaObjectKey({
      userId: input.userId,
      storyId: input.storyId,
      mediaGroupId,
      variant: spec.variant,
      ext: 'webp',
    });
    const put = await putR2Object({
      access: 'private',
      objectKey,
      body: output.data,
      contentType: 'image/webp',
      cacheControl: config.r2.cacheControlPrivate,
    });
    await recordMediaAsset({
      storyId: input.storyId,
      nodeId: input.nodeId ?? null,
      userId: input.userId,
      assetType: input.assetType,
      storageProvider: 'r2',
      bucket: put.bucket,
      objectKey,
      mimeType: 'image/webp',
      sizeBytes: output.data.length,
      width: output.info.width,
      height: output.info.height,
      isPublic: false,
      variant: spec.variant,
      mediaGroupId,
      processingMode: input.processingMode,
      sourceJobId: input.sourceJobId ?? null,
    });

    const reference = toR2Reference(put.bucket, objectKey);
    if (spec.variant === 'display') {
      displayReference = reference;
      displayWidth = output.info.width;
      displayHeight = output.info.height;
    }
    if (spec.variant === 'thumbnail') thumbnailReference = reference;
  }

  if (!displayReference) {
    throw new Error('Variant pipeline did not produce a display variant.');
  }

  return {
    mediaGroupId,
    displayReference,
    thumbnailReference,
    originalReference: toR2Reference(originalPut.bucket, originalKey),
    originalExpiresAt,
    width: displayWidth,
    height: displayHeight,
  };
}
