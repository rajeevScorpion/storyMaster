'use server';

import { verifyAdmin } from '@/lib/supabase/admin';
import { setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  MEDIA_PIPELINE_FLAG_KEYS,
  normalizeMediaPipelineSettings,
  normalizeMediaProcessingMode,
  type MediaPipelineAdminState,
  type MediaPipelineSettings,
  type MediaProcessingMode,
} from '@/lib/media/media-pipeline-settings';
import {
  getConfiguredProcessingMode,
  getMediaCanaryUserIds,
  getMediaPipelineSettings,
  getServerPipelineAvailability,
} from '@/lib/media/processing-mode';

export async function getMediaPipelineAdminState(): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const [mode, canaryUserIds, settings, availability] = await Promise.all([
    getConfiguredProcessingMode(),
    getMediaCanaryUserIds(),
    getMediaPipelineSettings(),
    getServerPipelineAvailability(),
  ]);
  return {
    mode,
    canaryUserIds,
    settings,
    serverPipelineAvailable: availability.available,
    serverPipelineUnavailableReason: availability.reason,
  };
}

export async function setMediaProcessingMode(mode: MediaProcessingMode): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const normalized = normalizeMediaProcessingMode(mode);
  if (normalized !== 'client_legacy') {
    const availability = await getServerPipelineAvailability();
    if (!availability.available) {
      throw new Error(
        `Cannot enable ${normalized}: ${availability.reason ?? 'server pipeline unavailable'}`
      );
    }
  }
  await setFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.processingMode, normalized);
  return getMediaPipelineAdminState();
}

export async function setMediaCanaryUserIds(userIds: string[]): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const cleaned = userIds.map((id) => id.trim()).filter((id) => id.length > 0);
  await setFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.canaryUserIds, JSON.stringify(cleaned));
  return getMediaPipelineAdminState();
}

export async function saveMediaPipelineSettings(
  input: Partial<MediaPipelineSettings>
): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const current = await getMediaPipelineSettings();
  const next = normalizeMediaPipelineSettings({ ...current, ...input });
  await setFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.settings, JSON.stringify(next));
  return getMediaPipelineAdminState();
}
