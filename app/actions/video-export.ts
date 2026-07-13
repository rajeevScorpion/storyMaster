'use server';

import { getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import { resolvePlanKeyForUser } from '@/lib/pricing/enforcement';
import { verifyAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_EXPORT_PRESETS,
  normalizeExportPresets,
  resolveExportPresetsForPlan,
  serializeExportPresets,
  VIDEO_EXPORT_PRESETS_FLAG_KEY,
  type ExportPresetDefinition,
  type ResolvedExportPreset,
} from '@/lib/video-export/presets';

export async function getVideoExportPresetSettings(): Promise<ExportPresetDefinition[]> {
  await verifyAdmin();
  const value = await getFeatureFlagValue(VIDEO_EXPORT_PRESETS_FLAG_KEY);
  return normalizeExportPresets(value);
}

export async function saveVideoExportPresetSettings(
  presets: ExportPresetDefinition[]
): Promise<ExportPresetDefinition[]> {
  await verifyAdmin();
  const normalized = normalizeExportPresets(presets);
  await setFeatureFlagValue(VIDEO_EXPORT_PRESETS_FLAG_KEY, serializeExportPresets(normalized));
  return normalized;
}

export async function resetVideoExportPresetSettings(): Promise<ExportPresetDefinition[]> {
  await verifyAdmin();
  await setFeatureFlagValue(VIDEO_EXPORT_PRESETS_FLAG_KEY, serializeExportPresets(DEFAULT_EXPORT_PRESETS));
  return normalizeExportPresets(DEFAULT_EXPORT_PRESETS);
}

// Public: the export dialog's source of truth. The plan is resolved
// server-side, so a client cannot unlock a tier-gated preset by tampering
// with local state; locked presets are returned only for upsell display.
export async function getAvailableVideoExportPresets(): Promise<ResolvedExportPreset[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const adminUserId = process.env.ADMIN_USER_ID;
  const isAdmin = Boolean(user && adminUserId && user.id === adminUserId);
  const planKey = user ? await resolvePlanKeyForUser(user.id) : 'free';
  const value = await getFeatureFlagValue(VIDEO_EXPORT_PRESETS_FLAG_KEY);
  return resolveExportPresetsForPlan(normalizeExportPresets(value), planKey, isAdmin);
}
