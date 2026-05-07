export type ImageUploadAssetType =
  | 'beat_image'
  | 'storyboard_image'
  | 'cover_image'
  | 'social_cover_image'
  | 'character_reference';

export type ImageUploadOrientation = 'landscape' | 'portrait' | 'square' | 'auto';

export interface ImageUploadOptimizationSettings {
  clientSideCompressionEnabled: boolean;
  compressBeatImages: boolean;
  compressStoryboardImages: boolean;
  compressCoverImages: boolean;
  compressSocialCoverImages: boolean;
  compressCharacterRefs: boolean;
  outputFormat: 'webp';
  defaultWebpQuality: number;
  characterRefWebpQuality: number;
  maxLandscapeWidth: number;
  maxLandscapeHeight: number;
  maxVerticalWidth: number;
  maxVerticalHeight: number;
  maxCharacterRefDimension: number;
  rawSelectedFileLimitMB: number;
  finalUploadLimitMB: number;
  showCompressionStatsToUser: boolean;
  allowOriginalUploadIfCompressionFailsAndWithinLimit: boolean;
}

export interface ImageCompressionMetadata {
  assetType: ImageUploadAssetType;
  originalFileName: string;
  originalMimeType: string;
  originalSizeBytes: number;
  originalWidth?: number;
  originalHeight?: number;
  optimizedSizeBytes: number;
  outputMimeType: string;
  outputFileName: string;
  outputWidth: number;
  outputHeight: number;
  compressionApplied: boolean;
  compressionQuality: number | null;
  skippedReason?: string;
  failureReason?: string;
}

export const SUPPORTED_UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS: ImageUploadOptimizationSettings = {
  clientSideCompressionEnabled: true,
  compressBeatImages: true,
  compressStoryboardImages: true,
  compressCoverImages: true,
  compressSocialCoverImages: true,
  compressCharacterRefs: true,
  outputFormat: 'webp',
  defaultWebpQuality: 0.85,
  characterRefWebpQuality: 0.9,
  maxLandscapeWidth: 1920,
  maxLandscapeHeight: 1080,
  maxVerticalWidth: 1080,
  maxVerticalHeight: 1920,
  maxCharacterRefDimension: 2048,
  rawSelectedFileLimitMB: 20,
  finalUploadLimitMB: 5,
  showCompressionStatsToUser: true,
  allowOriginalUploadIfCompressionFailsAndWithinLimit: true,
};

export const IMAGE_UPLOAD_OPTIMIZATION_FLAG_KEYS = {
  clientSideCompressionEnabled: 'image_upload_client_compression_enabled',
  compressBeatImages: 'image_upload_compress_beat_images',
  compressStoryboardImages: 'image_upload_compress_storyboard_images',
  compressCoverImages: 'image_upload_compress_cover_images',
  compressSocialCoverImages: 'image_upload_compress_social_cover_images',
  compressCharacterRefs: 'image_upload_compress_character_refs',
  outputFormat: 'image_upload_output_format',
  defaultWebpQuality: 'image_upload_default_webp_quality',
  characterRefWebpQuality: 'image_upload_character_ref_webp_quality',
  maxLandscapeWidth: 'image_upload_max_landscape_width',
  maxLandscapeHeight: 'image_upload_max_landscape_height',
  maxVerticalWidth: 'image_upload_max_vertical_width',
  maxVerticalHeight: 'image_upload_max_vertical_height',
  maxCharacterRefDimension: 'image_upload_max_character_ref_dimension',
  rawSelectedFileLimitMB: 'image_upload_raw_selected_file_limit_mb',
  finalUploadLimitMB: 'image_upload_final_upload_limit_mb',
  showCompressionStatsToUser: 'image_upload_show_compression_stats',
  allowOriginalUploadIfCompressionFailsAndWithinLimit: 'image_upload_allow_original_on_compression_failure',
} as const;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

export function normalizeImageUploadOptimizationSettings(
  input: Partial<ImageUploadOptimizationSettings> | null | undefined
): ImageUploadOptimizationSettings {
  const defaults = DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS;
  return {
    clientSideCompressionEnabled: normalizeBoolean(input?.clientSideCompressionEnabled, defaults.clientSideCompressionEnabled),
    compressBeatImages: normalizeBoolean(input?.compressBeatImages, defaults.compressBeatImages),
    compressStoryboardImages: normalizeBoolean(input?.compressStoryboardImages, defaults.compressStoryboardImages),
    compressCoverImages: normalizeBoolean(input?.compressCoverImages, defaults.compressCoverImages),
    compressSocialCoverImages: normalizeBoolean(input?.compressSocialCoverImages, defaults.compressSocialCoverImages),
    compressCharacterRefs: normalizeBoolean(input?.compressCharacterRefs, defaults.compressCharacterRefs),
    outputFormat: 'webp',
    defaultWebpQuality: clampNumber(input?.defaultWebpQuality, defaults.defaultWebpQuality, 0.1, 1),
    characterRefWebpQuality: clampNumber(input?.characterRefWebpQuality, defaults.characterRefWebpQuality, 0.1, 1),
    maxLandscapeWidth: clampInteger(input?.maxLandscapeWidth, defaults.maxLandscapeWidth, 320, 4096),
    maxLandscapeHeight: clampInteger(input?.maxLandscapeHeight, defaults.maxLandscapeHeight, 320, 4096),
    maxVerticalWidth: clampInteger(input?.maxVerticalWidth, defaults.maxVerticalWidth, 320, 4096),
    maxVerticalHeight: clampInteger(input?.maxVerticalHeight, defaults.maxVerticalHeight, 320, 4096),
    maxCharacterRefDimension: clampInteger(input?.maxCharacterRefDimension, defaults.maxCharacterRefDimension, 512, 4096),
    rawSelectedFileLimitMB: clampNumber(input?.rawSelectedFileLimitMB, defaults.rawSelectedFileLimitMB, 1, 50),
    finalUploadLimitMB: clampNumber(input?.finalUploadLimitMB, defaults.finalUploadLimitMB, 1, 20),
    showCompressionStatsToUser: normalizeBoolean(input?.showCompressionStatsToUser, defaults.showCompressionStatsToUser),
    allowOriginalUploadIfCompressionFailsAndWithinLimit: normalizeBoolean(
      input?.allowOriginalUploadIfCompressionFailsAndWithinLimit,
      defaults.allowOriginalUploadIfCompressionFailsAndWithinLimit
    ),
  };
}

export function getAssetTypeCompressionEnabled(
  assetType: ImageUploadAssetType,
  settings: ImageUploadOptimizationSettings
): boolean {
  if (!settings.clientSideCompressionEnabled) return false;
  if (assetType === 'beat_image') return settings.compressBeatImages;
  if (assetType === 'storyboard_image') return settings.compressStoryboardImages;
  if (assetType === 'cover_image') return settings.compressCoverImages;
  if (assetType === 'social_cover_image') return settings.compressSocialCoverImages;
  return settings.compressCharacterRefs;
}

export function bytesFromMB(value: number): number {
  return Math.round(value * 1024 * 1024);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}
