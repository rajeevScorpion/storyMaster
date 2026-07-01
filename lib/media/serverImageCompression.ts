import 'server-only';

import sharp from 'sharp';
import {
  DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  normalizeImageUploadOptimizationSettings,
  type ImageUploadAssetType,
  type ImageUploadOptimizationSettings,
} from '@/lib/media/imageUploadOptimization';

export interface ServerCompressionResult {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  quality: number;
}

function base64ToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 data URL for server compression.');
  return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
}

function qualityForAsset(assetType: ImageUploadAssetType, settings: ImageUploadOptimizationSettings): number {
  const quality = assetType === 'character_reference'
    ? settings.characterRefWebpQuality
    : settings.defaultWebpQuality;
  return Math.round(Math.max(10, Math.min(100, quality * 100)));
}

function maxDimensionsForAsset(
  assetType: ImageUploadAssetType,
  orientation: 'landscape' | 'portrait',
  settings: ImageUploadOptimizationSettings
): { maxWidth: number; maxHeight: number } {
  if (assetType === 'character_reference') {
    return { maxWidth: settings.maxCharacterRefDimension, maxHeight: settings.maxCharacterRefDimension };
  }
  return orientation === 'portrait'
    ? { maxWidth: settings.maxVerticalWidth, maxHeight: settings.maxVerticalHeight }
    : { maxWidth: settings.maxLandscapeWidth, maxHeight: settings.maxLandscapeHeight };
}

/**
 * Server-side equivalent of lib/media/clientImageCompression. Decodes a base64
 * image, downscales to the configured max dimensions, and re-encodes as WebP.
 * Used by the batch reconcile worker, which has no browser Canvas.
 */
export async function compressImageDataUrlServer(input: {
  dataUrl: string;
  assetType: ImageUploadAssetType;
  aspectRatio?: string;
  settings?: Partial<ImageUploadOptimizationSettings> | null;
}): Promise<ServerCompressionResult> {
  const settings = input.settings
    ? normalizeImageUploadOptimizationSettings(input.settings)
    : DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS;
  const { buffer } = base64ToBuffer(input.dataUrl);
  const originalSizeBytes = buffer.length;

  const pipeline = sharp(buffer, { failOn: 'none' });
  const meta = await pipeline.metadata();
  const orientation: 'landscape' | 'portrait' =
    input.aspectRatio === '9:16'
      ? 'portrait'
      : input.aspectRatio === '16:9'
      ? 'landscape'
      : (meta.height ?? 0) > (meta.width ?? 0)
      ? 'portrait'
      : 'landscape';

  const { maxWidth, maxHeight } = maxDimensionsForAsset(input.assetType, orientation, settings);
  const quality = qualityForAsset(input.assetType, settings);

  const output = await pipeline
    .rotate()
    .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    contentType: 'image/webp',
    width: output.info.width,
    height: output.info.height,
    originalSizeBytes,
    optimizedSizeBytes: output.data.length,
    quality,
  };
}

/**
 * Run an async mapper over items with a bounded number of in-flight tasks.
 * Used so a returning batch of N images doesn't spike server load.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
