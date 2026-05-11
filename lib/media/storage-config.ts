import 'server-only';

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import {
  DEFAULT_MEDIA_STORAGE_SETTINGS,
  MEDIA_STORAGE_FLAG_KEYS,
  normalizeMediaStorageSettings,
  type MediaStorageAdminState,
  type MediaStorageSettings,
  type MediaStorageProvider,
  type R2EnvStatus,
} from '@/lib/media/storage-settings';

export interface EffectiveMediaStorageConfig {
  settings: MediaStorageSettings;
  envStatus: R2EnvStatus;
  r2: {
    enabled: boolean;
    accountId: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    bucketName: string | null;
    privateBucketName: string | null;
    publicBaseUrl: string | null;
    endpoint: string | null;
    publicDeliveryEnabled: boolean;
    cacheControlPublic: string;
    cacheControlPrivate: string;
  };
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readEnvStatus(): Omit<R2EnvStatus, 'effectiveEnabled' | 'missing'> & { missing: string[] } {
  const accountId = cleanEnv(process.env.CLOUDFLARE_ACCOUNT_ID);
  const accessKey = cleanEnv(process.env.R2_ACCESS_KEY_ID);
  const secretKey = cleanEnv(process.env.R2_SECRET_ACCESS_KEY);
  const bucketName = cleanEnv(process.env.R2_BUCKET_NAME);
  const privateBucketName = cleanEnv(process.env.R2_PRIVATE_BUCKET_NAME);
  const publicBaseUrl = cleanEnv(process.env.R2_PUBLIC_BASE_URL);
  const endpoint = cleanEnv(process.env.R2_ENDPOINT) || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  const productionEnabled = cleanEnv(process.env.R2_PRODUCTION_ENABLED)?.toLowerCase() === 'true';

  const missing = [
    !accountId ? 'CLOUDFLARE_ACCOUNT_ID' : null,
    !accessKey ? 'R2_ACCESS_KEY_ID' : null,
    !secretKey ? 'R2_SECRET_ACCESS_KEY' : null,
    !bucketName ? 'R2_BUCKET_NAME' : null,
    !privateBucketName ? 'R2_PRIVATE_BUCKET_NAME' : null,
    !publicBaseUrl ? 'R2_PUBLIC_BASE_URL' : null,
    !endpoint ? 'R2_ENDPOINT' : null,
  ].filter((item): item is string => Boolean(item));

  return {
    accountIdPresent: Boolean(accountId),
    accessKeyPresent: Boolean(accessKey),
    secretKeyPresent: Boolean(secretKey),
    bucketNamePresent: Boolean(bucketName),
    privateBucketNamePresent: Boolean(privateBucketName),
    publicBaseUrlPresent: Boolean(publicBaseUrl),
    endpointPresent: Boolean(endpoint),
    environment: cleanEnv(process.env.R2_ENVIRONMENT) || cleanEnv(process.env.VERCEL_ENV),
    productionEnabled,
    missing,
  };
}

function envR2Enabled(): boolean {
  return cleanEnv(process.env.R2_ENABLED)?.toLowerCase() === 'true';
}

function envR2PublicDeliveryEnabled(): boolean {
  return cleanEnv(process.env.R2_PUBLIC_DELIVERY_ENABLED)?.toLowerCase() !== 'false';
}

function envStorageProvider(): MediaStorageProvider | null {
  const mode = cleanEnv(process.env.R2_STORAGE_MODE);
  return mode === 'supabase' || mode === 'r2' || mode === 'hybrid' ? mode : null;
}

function productionGuardAllowsR2(): boolean {
  const r2Environment = cleanEnv(process.env.R2_ENVIRONMENT)?.toLowerCase();
  if (r2Environment && r2Environment !== 'production') return true;
  if (process.env.VERCEL_ENV !== 'production') return true;
  return cleanEnv(process.env.R2_PRODUCTION_ENABLED)?.toLowerCase() === 'true';
}

export async function getMediaStorageSettings(): Promise<MediaStorageSettings> {
  const keys = MEDIA_STORAGE_FLAG_KEYS;
  const defaults = DEFAULT_MEDIA_STORAGE_SETTINGS;
  const [
    storageProvider,
    r2Enabled,
    r2UseForImages,
    r2UseForCovers,
    r2UseForNarrationAudio,
    r2PublicDeliveryForPublishedStories,
    r2GenerateThumbnails,
    r2FallbackToSupabase,
    publishedAssetCacheDuration,
  ] = await Promise.all([
    getFeatureFlagValue(keys.storageProvider),
    getFeatureFlag(keys.r2Enabled, defaults.r2Enabled),
    getFeatureFlag(keys.r2UseForImages, defaults.r2UseForImages),
    getFeatureFlag(keys.r2UseForCovers, defaults.r2UseForCovers),
    getFeatureFlag(keys.r2UseForNarrationAudio, defaults.r2UseForNarrationAudio),
    getFeatureFlag(keys.r2PublicDeliveryForPublishedStories, defaults.r2PublicDeliveryForPublishedStories),
    getFeatureFlag(keys.r2GenerateThumbnails, defaults.r2GenerateThumbnails),
    getFeatureFlag(keys.r2FallbackToSupabase, defaults.r2FallbackToSupabase),
    getFeatureFlagValue(keys.publishedAssetCacheDuration),
  ]);
  const featureStorageProvider: MediaStorageProvider | null =
    storageProvider === 'supabase' || storageProvider === 'r2' || storageProvider === 'hybrid'
      ? storageProvider
      : null;
  const featurePublishedAssetCacheDuration =
    publishedAssetCacheDuration === null
      ? defaults.publishedAssetCacheDuration
      : Number(publishedAssetCacheDuration);

  return normalizeMediaStorageSettings({
    storageProvider: featureStorageProvider ?? envStorageProvider() ?? defaults.storageProvider,
    r2Enabled,
    r2UseForImages,
    r2UseForCovers,
    r2UseForNarrationAudio,
    r2PublicDeliveryForPublishedStories,
    r2GenerateThumbnails,
    r2FallbackToSupabase,
    publishedAssetCacheDuration: featurePublishedAssetCacheDuration,
  });
}

export async function getEffectiveMediaStorageConfig(): Promise<EffectiveMediaStorageConfig> {
  const settings = await getMediaStorageSettings();
  const envStatusBase = readEnvStatus();
  const accountId = cleanEnv(process.env.CLOUDFLARE_ACCOUNT_ID);
  const endpoint = cleanEnv(process.env.R2_ENDPOINT) || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  const canUseR2 =
    envR2Enabled()
    && settings.r2Enabled
    && settings.storageProvider !== 'supabase'
    && productionGuardAllowsR2()
    && envStatusBase.missing.length === 0;

  return {
    settings,
    envStatus: {
      ...envStatusBase,
      effectiveEnabled: canUseR2,
    },
    r2: {
      enabled: canUseR2,
      accountId,
      accessKeyId: cleanEnv(process.env.R2_ACCESS_KEY_ID),
      secretAccessKey: cleanEnv(process.env.R2_SECRET_ACCESS_KEY),
      bucketName: cleanEnv(process.env.R2_BUCKET_NAME),
      privateBucketName: cleanEnv(process.env.R2_PRIVATE_BUCKET_NAME),
      publicBaseUrl: cleanEnv(process.env.R2_PUBLIC_BASE_URL),
      endpoint,
      publicDeliveryEnabled: envR2PublicDeliveryEnabled(),
      cacheControlPublic: cleanEnv(process.env.R2_CACHE_CONTROL_PUBLIC) || 'public, max-age=31536000, immutable',
      cacheControlPrivate: cleanEnv(process.env.R2_CACHE_CONTROL_PRIVATE) || 'private, max-age=3600',
    },
  };
}

export async function getMediaStorageAdminState(): Promise<MediaStorageAdminState> {
  const config = await getEffectiveMediaStorageConfig();
  return {
    settings: config.settings,
    envStatus: config.envStatus,
  };
}
