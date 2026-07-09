import 'server-only';

import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import {
  MEDIA_PIPELINE_FLAG_KEYS,
  normalizeCanaryUserIds,
  normalizeMediaProcessingMode,
  parseMediaPipelineSettingsValue,
  resolveEffectiveProcessingModeShared,
  type EffectiveProcessingMode,
  type MediaPipelineSettings,
  type MediaProcessingMode,
} from '@/lib/media/media-pipeline-settings';

export async function getMediaPipelineSettings(): Promise<MediaPipelineSettings> {
  const raw = await getFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.settings);
  return parseMediaPipelineSettingsValue(raw);
}

export async function getConfiguredProcessingMode(): Promise<MediaProcessingMode> {
  const raw = await getFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.processingMode);
  return normalizeMediaProcessingMode(raw);
}

export async function getMediaCanaryUserIds(): Promise<string[]> {
  const raw = await getFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.canaryUserIds);
  return normalizeCanaryUserIds(raw);
}

export interface ServerPipelineAvailability {
  available: boolean;
  reason: string | null;
}

/**
 * The server pipeline needs working R2 with a private bucket for originals.
 * When this guard fails, every request stays on client_legacy regardless of
 * the configured mode.
 */
export async function getServerPipelineAvailability(): Promise<ServerPipelineAvailability> {
  const config = await getEffectiveMediaStorageConfig();
  if (!config.envStatus.effectiveEnabled) {
    const missing = config.envStatus.missing;
    return {
      available: false,
      reason: missing.length > 0
        ? `R2 is not effective (missing: ${missing.join(', ')})`
        : 'R2 is disabled by environment or storage settings',
    };
  }
  if (!config.r2.privateBucketName) {
    return { available: false, reason: 'R2 private bucket is not configured' };
  }
  return { available: true, reason: null };
}

/**
 * Resolve which flow a NEW generation request must use. Existing jobs/media
 * always render from whatever assets they already have — this only routes
 * new work.
 */
export async function resolveEffectiveProcessingMode(userId: string | null): Promise<EffectiveProcessingMode> {
  const [mode, availability] = await Promise.all([
    getConfiguredProcessingMode(),
    getServerPipelineAvailability(),
  ]);
  if (mode === 'client_legacy') return 'client_legacy';

  const canaryUserIds = mode === 'hybrid_canary' ? await getMediaCanaryUserIds() : [];
  return resolveEffectiveProcessingModeShared({
    mode,
    canaryUserIds,
    userId,
    serverPipelineAvailable: availability.available,
  });
}
