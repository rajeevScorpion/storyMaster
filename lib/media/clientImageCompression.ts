'use client';

import {
  bytesFromMB,
  DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  formatFileSize,
  getAssetTypeCompressionEnabled,
  normalizeImageUploadOptimizationSettings,
  SUPPORTED_UPLOAD_IMAGE_TYPES,
  type ImageCompressionMetadata,
  type ImageUploadAssetType,
  type ImageUploadOptimizationSettings,
  type ImageUploadOrientation,
} from '@/lib/media/imageUploadOptimization';

export { formatFileSize };

export interface ImageCompressionOptions {
  assetType: ImageUploadAssetType;
  settings?: Partial<ImageUploadOptimizationSettings> | null;
  orientation?: ImageUploadOrientation;
  forceNormalization?: boolean;
  timeoutMs?: number;
}

export interface ImageCompressionResult {
  file: File;
  previewUrl: string;
  metadata: ImageCompressionMetadata;
  warningMessage?: string;
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

const DEFAULT_TIMEOUT_MS = 15000;
const WEBP_MIME_TYPE = 'image/webp';

function getFileExtension(mimeType: string, fallback = 'bin'): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return fallback;
}

function replaceExtension(fileName: string, extension: string): string {
  const clean = fileName.trim() || `image.${extension}`;
  const withoutQuery = clean.split(/[?#]/)[0] || clean;
  const idx = withoutQuery.lastIndexOf('.');
  if (idx <= 0) return `${withoutQuery}.${extension}`;
  return `${withoutQuery.slice(0, idx)}.${extension}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

function validateSupportedBrowser() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Image optimization is only available in the browser.');
  }
}

export function validateImageBeforeCompression(
  file: File,
  settingsInput?: Partial<ImageUploadOptimizationSettings> | null
): void {
  const settings = normalizeImageUploadOptimizationSettings(settingsInput);
  if (!SUPPORTED_UPLOAD_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_UPLOAD_IMAGE_TYPES)[number])) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }
  const rawLimitBytes = bytesFromMB(settings.rawSelectedFileLimitMB);
  if (file.size > rawLimitBytes) {
    throw new Error(`Image must be ${formatFileSize(rawLimitBytes)} or smaller.`);
  }
}

export function validateImageAfterCompression(
  file: File,
  settingsInput?: Partial<ImageUploadOptimizationSettings> | null
): void {
  const settings = normalizeImageUploadOptimizationSettings(settingsInput);
  const finalLimitBytes = bytesFromMB(settings.finalUploadLimitMB);
  if (file.size > finalLimitBytes) {
    throw new Error('The image is still too large after optimization. Please try a smaller image or reduce the image resolution.');
  }
}

async function decodeImage(file: File, timeoutMs: number): Promise<DecodedImage> {
  validateSupportedBrowser();

  if ('createImageBitmap' in window) {
    try {
      const bitmap = await withTimeout(
        createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions),
        timeoutMs,
        'Image optimization took too long on this device.'
      );
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement decoding. Safari support has varied,
      // so this fallback keeps uploads working even when ImageBitmap fails.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new window.Image();
  image.decoding = 'async';

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not inspect the selected image.'));
        image.src = objectUrl;
      }),
      timeoutMs,
      'Image optimization took too long on this device.'
    );
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => {
        image.onload = null;
        image.onerror = null;
        image.src = '';
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export async function readImageFileDimensions(file: File): Promise<{ width: number; height: number }> {
  const decoded = await decodeImage(file, DEFAULT_TIMEOUT_MS);
  try {
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.release();
  }
}

function getMaxDimensions(
  assetType: ImageUploadAssetType,
  orientation: ImageUploadOrientation,
  source: { width: number; height: number },
  settings: ImageUploadOptimizationSettings
): { maxWidth: number; maxHeight: number } {
  if (assetType === 'character_reference') {
    return {
      maxWidth: settings.maxCharacterRefDimension,
      maxHeight: settings.maxCharacterRefDimension,
    };
  }

  const resolvedOrientation = orientation === 'auto'
    ? source.height > source.width
      ? 'portrait'
      : 'landscape'
    : orientation;

  if (resolvedOrientation === 'portrait') {
    return {
      maxWidth: settings.maxVerticalWidth,
      maxHeight: settings.maxVerticalHeight,
    };
  }

  if (resolvedOrientation === 'square') {
    const max = Math.max(settings.maxLandscapeHeight, settings.maxVerticalWidth);
    return { maxWidth: max, maxHeight: max };
  }

  return {
    maxWidth: settings.maxLandscapeWidth,
    maxHeight: settings.maxLandscapeHeight,
  };
}

function getQuality(assetType: ImageUploadAssetType, settings: ImageUploadOptimizationSettings): number {
  return assetType === 'character_reference'
    ? settings.characterRefWebpQuality
    : settings.defaultWebpQuality;
}

function scaleToFit(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number; resized: boolean } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height, resized: false };
  }
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    resized: true,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number, timeoutMs: number): Promise<Blob> {
  return withTimeout(
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('This browser could not optimize the image.'));
          return;
        }
        resolve(blob);
      }, mimeType, quality);
    }),
    timeoutMs,
    'Image optimization took too long on this device.'
  );
}

function createOriginalResult(
  file: File,
  assetType: ImageUploadAssetType,
  dimensions: { width: number; height: number },
  skippedReason: string,
  failureReason?: string
): ImageCompressionResult {
  const metadata: ImageCompressionMetadata = {
    assetType,
    originalFileName: file.name,
    originalMimeType: file.type,
    originalSizeBytes: file.size,
    originalWidth: dimensions.width,
    originalHeight: dimensions.height,
    optimizedSizeBytes: file.size,
    outputMimeType: file.type || 'application/octet-stream',
    outputFileName: file.name,
    outputWidth: dimensions.width,
    outputHeight: dimensions.height,
    compressionApplied: false,
    compressionQuality: null,
    skippedReason,
    failureReason,
  };
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    metadata,
  };
}

function getLowMemoryFailureMessage(): string {
  return 'We could not optimize this image on your device. The file may be too large for mobile processing. Please try a smaller image or upload from a laptop/desktop.';
}

export function getCompressionOptionsForAssetType(
  assetType: ImageUploadAssetType,
  settingsInput?: Partial<ImageUploadOptimizationSettings> | null,
  orientation: ImageUploadOrientation = 'auto'
): {
  enabled: boolean;
  quality: number;
  rawLimitBytes: number;
  finalLimitBytes: number;
  orientation: ImageUploadOrientation;
} {
  const settings = normalizeImageUploadOptimizationSettings(settingsInput);
  return {
    enabled: getAssetTypeCompressionEnabled(assetType, settings),
    quality: getQuality(assetType, settings),
    rawLimitBytes: bytesFromMB(settings.rawSelectedFileLimitMB),
    finalLimitBytes: bytesFromMB(settings.finalUploadLimitMB),
    orientation,
  };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read the optimized image.'));
    reader.onerror = () => reject(new Error('Could not read the optimized image.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageFile(
  file: File,
  options: ImageCompressionOptions
): Promise<ImageCompressionResult> {
  const settings = normalizeImageUploadOptimizationSettings(
    options.settings ?? DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const assetType = options.assetType;
  const orientation = options.orientation ?? 'auto';
  const finalLimitBytes = bytesFromMB(settings.finalUploadLimitMB);

  validateImageBeforeCompression(file, settings);

  let decoded: DecodedImage | null = null;
  let canvas: HTMLCanvasElement | null = null;

  try {
    decoded = await decodeImage(file, timeoutMs);
    const maxDimensions = getMaxDimensions(assetType, orientation, decoded, settings);
    const target = scaleToFit(decoded.width, decoded.height, maxDimensions.maxWidth, maxDimensions.maxHeight);
    const compressionEnabled = getAssetTypeCompressionEnabled(assetType, settings);

    if (!compressionEnabled) {
      const legacyResult = createOriginalResult(file, assetType, decoded, 'compression_disabled');
      validateImageAfterCompression(legacyResult.file, settings);
      return legacyResult;
    }

    const canSkipRecompression =
      file.type === WEBP_MIME_TYPE &&
      file.size <= finalLimitBytes &&
      !target.resized &&
      !options.forceNormalization;

    if (canSkipRecompression) {
      return createOriginalResult(file, assetType, decoded, 'already_optimized_webp');
    }

    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('This browser could not prepare the image for optimization.');
    }

    context.drawImage(decoded.source, 0, 0, target.width, target.height);
    const quality = getQuality(assetType, settings);
    const optimizedBlob = await canvasToBlob(canvas, WEBP_MIME_TYPE, quality, timeoutMs);
    const optimizedFile = new File(
      [optimizedBlob],
      replaceExtension(file.name, 'webp'),
      { type: WEBP_MIME_TYPE, lastModified: Date.now() }
    );

    if (optimizedFile.size > finalLimitBytes) {
      throw new Error('The image is still too large after optimization. Please try a smaller image or reduce the image resolution.');
    }

    const metadata: ImageCompressionMetadata = {
      assetType,
      originalFileName: file.name,
      originalMimeType: file.type,
      originalSizeBytes: file.size,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      optimizedSizeBytes: optimizedFile.size,
      outputMimeType: WEBP_MIME_TYPE,
      outputFileName: optimizedFile.name,
      outputWidth: target.width,
      outputHeight: target.height,
      compressionApplied: true,
      compressionQuality: quality,
    };

    return {
      file: optimizedFile,
      previewUrl: URL.createObjectURL(optimizedFile),
      metadata,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image optimization failed.';
    if (
      settings.clientSideCompressionEnabled &&
      settings.allowOriginalUploadIfCompressionFailsAndWithinLimit &&
      file.size <= finalLimitBytes &&
      decoded
    ) {
      const fallback = createOriginalResult(file, assetType, decoded, 'compression_failed_original_within_limit', message);
      fallback.warningMessage = 'We could not optimize this image on your device, but the original file is within the allowed size and will be uploaded.';
      return fallback;
    }

    if (message.includes('still too large after optimization')) {
      throw error;
    }

    if (file.size > finalLimitBytes) {
      throw new Error(getLowMemoryFailureMessage());
    }

    throw new Error(message || 'Could not optimize the selected image.');
  } finally {
    decoded?.release();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas = null;
    }
  }
}

export function getUploadFileExtension(file: File): string {
  return getFileExtension(file.type, 'bin');
}
