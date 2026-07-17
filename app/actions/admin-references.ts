'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag, getFeatureFlagValue, setFeatureFlag, setFeatureFlagValue } from '@/lib/ai/model-config';
import { getServerPipelineAvailability } from '@/lib/media/processing-mode';
import {
  REFERENCE_FLAG_KEYS,
  normalizeReferenceInputMode,
  normalizeReferencePersonalizationSettings,
  parseReferencePersonalizationSettingsValue,
  type ReferencePersonalizationSettings,
} from '@/lib/references/reference-settings';
import type { ReferenceInputMode } from '@/lib/types/references';

export interface ReferenceAdminState {
  masterEnabled: boolean;
  /** 'direct' (raw refs to the model) or 'adoption' (v1 analyze + canonical). */
  inputMode: ReferenceInputMode;
  customOptionAttachmentEnabled: boolean;
  settings: ReferencePersonalizationSettings;
  /** Adoption needs the private R2 pipeline (same gate as server_pipeline). */
  serverPipelineAvailable: boolean;
  serverPipelineUnavailableReason: string | null;
  metrics: {
    pending: number;
    processing: number;
    ready24h: number;
    failed24h: number;
  };
}

async function loadReferenceMetrics(): Promise<ReferenceAdminState['metrics']> {
  const admin = createAdminClient();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await admin
    .from('reference_adoptions')
    .select('status, created_at')
    .gte('created_at', dayAgo);

  const metrics = { pending: 0, processing: 0, ready24h: 0, failed24h: 0 };
  // Pending/processing counts are point-in-time across all setups, not just 24h;
  // fetch them separately so an old stuck job still surfaces.
  const { data: active } = await admin
    .from('reference_adoptions')
    .select('status')
    .in('status', ['pending', 'processing']);
  for (const row of active ?? []) {
    if (row.status === 'pending') metrics.pending += 1;
    else if (row.status === 'processing') metrics.processing += 1;
  }
  for (const row of data ?? []) {
    if (row.status === 'ready') metrics.ready24h += 1;
    else if (row.status === 'failed') metrics.failed24h += 1;
  }
  return metrics;
}

export async function getReferenceAdminState(): Promise<ReferenceAdminState> {
  await verifyAdmin();
  const [masterEnabled, inputModeRaw, customOptionAttachmentEnabled, settingsRaw, availability, metrics] =
    await Promise.all([
      getFeatureFlag(REFERENCE_FLAG_KEYS.enabled, false),
      getFeatureFlagValue(REFERENCE_FLAG_KEYS.inputMode),
      getFeatureFlag(REFERENCE_FLAG_KEYS.customOptionAttachment, false),
      getFeatureFlagValue(REFERENCE_FLAG_KEYS.settings),
      getServerPipelineAvailability(),
      loadReferenceMetrics(),
    ]);
  return {
    masterEnabled,
    inputMode: normalizeReferenceInputMode(inputModeRaw),
    customOptionAttachmentEnabled,
    settings: parseReferencePersonalizationSettingsValue(settingsRaw),
    serverPipelineAvailable: availability.available,
    serverPipelineUnavailableReason: availability.reason,
    metrics,
  };
}

export async function setReferenceInputMode(mode: ReferenceInputMode): Promise<ReferenceAdminState> {
  await verifyAdmin();
  await setFeatureFlagValue(REFERENCE_FLAG_KEYS.inputMode, normalizeReferenceInputMode(mode));
  return getReferenceAdminState();
}

export async function setReferencePersonalizationEnabled(enabled: boolean): Promise<ReferenceAdminState> {
  await verifyAdmin();
  if (enabled) {
    const availability = await getServerPipelineAvailability();
    if (!availability.available) {
      throw new Error(
        `Cannot enable Reference Personalization: ${availability.reason ?? 'private R2 pipeline unavailable'}`
      );
    }
  }
  await setFeatureFlag(REFERENCE_FLAG_KEYS.enabled, enabled);
  return getReferenceAdminState();
}

export async function saveReferencePersonalizationSettings(
  input: Partial<ReferencePersonalizationSettings>
): Promise<ReferenceAdminState> {
  await verifyAdmin();
  const currentRaw = await getFeatureFlagValue(REFERENCE_FLAG_KEYS.settings);
  const current = parseReferencePersonalizationSettingsValue(currentRaw);
  const next = normalizeReferencePersonalizationSettings({ ...current, ...input });
  await setFeatureFlagValue(REFERENCE_FLAG_KEYS.settings, JSON.stringify(next));
  return getReferenceAdminState();
}
