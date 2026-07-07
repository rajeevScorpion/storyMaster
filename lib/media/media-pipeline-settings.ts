export type MediaProcessingMode = 'client_legacy' | 'server_pipeline' | 'hybrid_canary';

/** Modes a job/media record can actually execute under (canary resolves to one of these). */
export type EffectiveProcessingMode = 'client_legacy' | 'server_pipeline';

export const MEDIA_PROCESSING_MODES: MediaProcessingMode[] = [
  'client_legacy',
  'server_pipeline',
  'hybrid_canary',
];

export interface MediaPipelineSettings {
  freeRetentionHours: number;
  plusRetentionDays: number;
  studioRetentionDays: number;
  displayMaxWidth: number;
  thumbnailMaxWidth: number;
  displayWebpQuality: number;
  thumbnailWebpQuality: number;
  shareLowMaxWidth: number;
  shareHighMaxWidth: number;
  shareHighQuality: number;
  cleanupEnabled: boolean;
  cleanupBatchSize: number;
  /** Tier gates for high-quality download/share (Free never qualifies). */
  allowPlusHighQuality: boolean;
  allowStudioHighQuality: boolean;
  maxAttempts: number;
  signedUrlTtlSeconds: number;
  variantsForBulkJobs: boolean;
  serverPersistInlineImages: boolean;
  publicPublishingEnabled: boolean;
  unlistedSharingEnabled: boolean;
  moderationRequiredForPublic: boolean;
}

export interface MediaPipelineAdminState {
  mode: MediaProcessingMode;
  canaryUserIds: string[];
  settings: MediaPipelineSettings;
  /** True when R2 env + storage flags allow the server pipeline to run at all. */
  serverPipelineAvailable: boolean;
  serverPipelineUnavailableReason: string | null;
}

export const DEFAULT_MEDIA_PIPELINE_SETTINGS: MediaPipelineSettings = {
  freeRetentionHours: 24,
  plusRetentionDays: 10,
  studioRetentionDays: 30,
  displayMaxWidth: 1440,
  thumbnailMaxWidth: 512,
  displayWebpQuality: 82,
  thumbnailWebpQuality: 75,
  shareLowMaxWidth: 1440,
  shareHighMaxWidth: 2048,
  shareHighQuality: 92,
  cleanupEnabled: true,
  cleanupBatchSize: 100,
  allowPlusHighQuality: true,
  allowStudioHighQuality: true,
  maxAttempts: 3,
  signedUrlTtlSeconds: 300,
  variantsForBulkJobs: false,
  serverPersistInlineImages: false,
  publicPublishingEnabled: true,
  unlistedSharingEnabled: true,
  moderationRequiredForPublic: false,
};

export const MEDIA_PIPELINE_FLAG_KEYS = {
  processingMode: 'media_processing_mode',
  canaryUserIds: 'media_canary_user_ids',
  settings: 'media_pipeline_settings',
} as const;

export function normalizeMediaProcessingMode(value: unknown): MediaProcessingMode {
  return value === 'server_pipeline' || value === 'hybrid_canary' || value === 'client_legacy'
    ? value
    : 'client_legacy';
}

export function normalizeCanaryUserIds(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeMediaPipelineSettings(
  input: Partial<MediaPipelineSettings> | null | undefined
): MediaPipelineSettings {
  const defaults = DEFAULT_MEDIA_PIPELINE_SETTINGS;
  return {
    freeRetentionHours: normalizeInteger(input?.freeRetentionHours, defaults.freeRetentionHours, 0, 24 * 30),
    plusRetentionDays: normalizeInteger(input?.plusRetentionDays, defaults.plusRetentionDays, 1, 365),
    studioRetentionDays: normalizeInteger(input?.studioRetentionDays, defaults.studioRetentionDays, 1, 365),
    displayMaxWidth: normalizeInteger(input?.displayMaxWidth, defaults.displayMaxWidth, 480, 4096),
    thumbnailMaxWidth: normalizeInteger(input?.thumbnailMaxWidth, defaults.thumbnailMaxWidth, 96, 1024),
    displayWebpQuality: normalizeInteger(input?.displayWebpQuality, defaults.displayWebpQuality, 40, 100),
    thumbnailWebpQuality: normalizeInteger(input?.thumbnailWebpQuality, defaults.thumbnailWebpQuality, 40, 100),
    shareLowMaxWidth: normalizeInteger(input?.shareLowMaxWidth, defaults.shareLowMaxWidth, 480, 4096),
    shareHighMaxWidth: normalizeInteger(input?.shareHighMaxWidth, defaults.shareHighMaxWidth, 480, 8192),
    shareHighQuality: normalizeInteger(input?.shareHighQuality, defaults.shareHighQuality, 40, 100),
    cleanupEnabled: normalizeBoolean(input?.cleanupEnabled, defaults.cleanupEnabled),
    cleanupBatchSize: normalizeInteger(input?.cleanupBatchSize, defaults.cleanupBatchSize, 1, 1000),
    allowPlusHighQuality: normalizeBoolean(input?.allowPlusHighQuality, defaults.allowPlusHighQuality),
    allowStudioHighQuality: normalizeBoolean(input?.allowStudioHighQuality, defaults.allowStudioHighQuality),
    maxAttempts: normalizeInteger(input?.maxAttempts, defaults.maxAttempts, 1, 10),
    signedUrlTtlSeconds: normalizeInteger(input?.signedUrlTtlSeconds, defaults.signedUrlTtlSeconds, 60, 3600),
    variantsForBulkJobs: normalizeBoolean(input?.variantsForBulkJobs, defaults.variantsForBulkJobs),
    serverPersistInlineImages: normalizeBoolean(input?.serverPersistInlineImages, defaults.serverPersistInlineImages),
    publicPublishingEnabled: normalizeBoolean(input?.publicPublishingEnabled, defaults.publicPublishingEnabled),
    unlistedSharingEnabled: normalizeBoolean(input?.unlistedSharingEnabled, defaults.unlistedSharingEnabled),
    moderationRequiredForPublic: normalizeBoolean(input?.moderationRequiredForPublic, defaults.moderationRequiredForPublic),
  };
}

export function parseMediaPipelineSettingsValue(raw: string | null | undefined): MediaPipelineSettings {
  if (!raw) return DEFAULT_MEDIA_PIPELINE_SETTINGS;
  try {
    return normalizeMediaPipelineSettings(JSON.parse(raw) as Partial<MediaPipelineSettings>);
  } catch {
    return DEFAULT_MEDIA_PIPELINE_SETTINGS;
  }
}

/**
 * Pure routing decision: which flow should a NEW generation request use.
 * Server availability is a hard guard — when the R2 pipeline cannot run
 * (missing env, disabled storage flags), everything stays on client_legacy.
 */
export function resolveEffectiveProcessingModeShared(input: {
  mode: MediaProcessingMode;
  canaryUserIds: string[];
  userId: string | null;
  serverPipelineAvailable: boolean;
}): EffectiveProcessingMode {
  if (!input.serverPipelineAvailable) return 'client_legacy';
  if (input.mode === 'server_pipeline') return 'server_pipeline';
  if (input.mode === 'hybrid_canary') {
    return input.userId && input.canaryUserIds.includes(input.userId)
      ? 'server_pipeline'
      : 'client_legacy';
  }
  return 'client_legacy';
}
