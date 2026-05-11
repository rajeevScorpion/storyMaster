export type MediaStorageProvider = 'supabase' | 'r2' | 'hybrid';

export interface MediaStorageSettings {
  storageProvider: MediaStorageProvider;
  r2Enabled: boolean;
  r2UseForImages: boolean;
  r2UseForCovers: boolean;
  r2UseForNarrationAudio: boolean;
  r2PublicDeliveryForPublishedStories: boolean;
  r2GenerateThumbnails: boolean;
  r2FallbackToSupabase: boolean;
  publishedAssetCacheDuration: number;
}

export interface R2EnvStatus {
  accountIdPresent: boolean;
  accessKeyPresent: boolean;
  secretKeyPresent: boolean;
  bucketNamePresent: boolean;
  privateBucketNamePresent: boolean;
  publicBaseUrlPresent: boolean;
  endpointPresent: boolean;
  environment: string | null;
  productionEnabled: boolean;
  effectiveEnabled: boolean;
  missing: string[];
}

export interface MediaStorageAdminState {
  settings: MediaStorageSettings;
  envStatus: R2EnvStatus;
}

export const DEFAULT_MEDIA_STORAGE_SETTINGS: MediaStorageSettings = {
  storageProvider: 'hybrid',
  r2Enabled: true,
  r2UseForImages: true,
  r2UseForCovers: true,
  r2UseForNarrationAudio: true,
  r2PublicDeliveryForPublishedStories: true,
  r2GenerateThumbnails: true,
  r2FallbackToSupabase: true,
  publishedAssetCacheDuration: 31536000,
};

export const MEDIA_STORAGE_FLAG_KEYS = {
  storageProvider: 'media_storage_provider',
  r2Enabled: 'media_r2_enabled',
  r2UseForImages: 'media_r2_use_for_images',
  r2UseForCovers: 'media_r2_use_for_covers',
  r2UseForNarrationAudio: 'media_r2_use_for_narration_audio',
  r2PublicDeliveryForPublishedStories: 'media_r2_public_delivery_for_published_stories',
  r2GenerateThumbnails: 'media_r2_generate_thumbnails',
  r2FallbackToSupabase: 'media_r2_fallback_to_supabase',
  publishedAssetCacheDuration: 'media_published_asset_cache_duration',
} as const;

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeProvider(value: unknown, fallback: MediaStorageProvider): MediaStorageProvider {
  return value === 'supabase' || value === 'r2' || value === 'hybrid'
    ? value
    : fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeMediaStorageSettings(
  input: Partial<MediaStorageSettings> | null | undefined
): MediaStorageSettings {
  const defaults = DEFAULT_MEDIA_STORAGE_SETTINGS;
  return {
    storageProvider: normalizeProvider(input?.storageProvider, defaults.storageProvider),
    r2Enabled: normalizeBoolean(input?.r2Enabled, defaults.r2Enabled),
    r2UseForImages: normalizeBoolean(input?.r2UseForImages, defaults.r2UseForImages),
    r2UseForCovers: normalizeBoolean(input?.r2UseForCovers, defaults.r2UseForCovers),
    r2UseForNarrationAudio: normalizeBoolean(input?.r2UseForNarrationAudio, defaults.r2UseForNarrationAudio),
    r2PublicDeliveryForPublishedStories: normalizeBoolean(
      input?.r2PublicDeliveryForPublishedStories,
      defaults.r2PublicDeliveryForPublishedStories
    ),
    r2GenerateThumbnails: normalizeBoolean(input?.r2GenerateThumbnails, defaults.r2GenerateThumbnails),
    r2FallbackToSupabase: normalizeBoolean(input?.r2FallbackToSupabase, defaults.r2FallbackToSupabase),
    publishedAssetCacheDuration: normalizeInteger(
      input?.publishedAssetCacheDuration,
      defaults.publishedAssetCacheDuration,
      60,
      31536000
    ),
  };
}
