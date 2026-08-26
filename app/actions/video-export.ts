'use server';

import { getFeatureFlag, getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  authorizeCoinOperationForUser,
  quoteCoinOperationForUser,
  quoteCoinOperationsForUser,
} from '@/lib/pricing/coin-economy';
import { resolveEntitlementPlanKeyForUser } from '@/lib/pricing/enforcement';
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
import type { PricingBillableActionAuthorization } from '@/lib/types/pricing';

function exportMeterKey(preset: Pick<ExportPresetDefinition, 'id' | 'width' | 'height'>) {
  return preset.id === 'sd' || Math.max(preset.width, preset.height) <= 1280
    ? 'export_video_sd' as const
    : 'export_video_hd' as const;
}

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
  const adminBypassEnabled = await getFeatureFlag('video_download_admin_bypass', false);
  const isAdmin = Boolean(adminBypassEnabled && user && adminUserId && user.id === adminUserId);
  const planKey = user ? await resolveEntitlementPlanKeyForUser(user.id) : 'free';
  const value = await getFeatureFlagValue(VIDEO_EXPORT_PRESETS_FLAG_KEY);
  const resolved = resolveExportPresetsForPlan(normalizeExportPresets(value), planKey, isAdmin);

  const quotes = await quoteCoinOperationsForUser({
    userId: user?.id ?? null,
    operations: resolved.map((preset) => {
      const meterKey = exportMeterKey(preset);
      return {
        operationKey: meterKey,
        components: [{ meterKey }],
        assumedPlanKey: 'studio' as const,
      };
    }),
  });

  return resolved.map((preset, index) => {
    const meterKey = exportMeterKey(preset);
    return {
      ...preset,
      coinCost: quotes[index]?.totalCoinCost ?? (meterKey === 'export_video_sd' ? 20 : 30),
    };
  });
}

export async function authorizeCurrentUserVideoExport(input: {
  presetId: string;
  idempotencyKey: string;
  relatedStoryId?: string | null;
  relatedNodeId?: string | null;
  relatedStorylineId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PricingBillableActionAuthorization> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const planKey = user ? await resolveEntitlementPlanKeyForUser(user.id) : 'free';
  const presets = normalizeExportPresets(await getFeatureFlagValue(VIDEO_EXPORT_PRESETS_FLAG_KEY));
  const preset = presets.find((candidate) => candidate.id === input.presetId && candidate.enabled);

  if (!preset || !(await getFeatureFlag('video_download_enabled', false))) {
    return {
      status: 'denied',
      reason: 'feature_disabled',
      beatCost: 0,
      coinCost: 0,
      availableBeats: 0,
      availableCoins: 0,
    };
  }

  const meterKey = exportMeterKey(preset);
  const tierPreset = resolveExportPresetsForPlan([preset], planKey, false)[0];
  if (!tierPreset || tierPreset.availability !== 'available') {
    const quote = await quoteCoinOperationForUser({
      userId: user?.id ?? null,
      operationKey: meterKey,
      components: [{ meterKey }],
      assumedPlanKey: 'studio',
    });
    return {
      status: 'denied',
      reason: 'tier_locked',
      beatCost: quote.totalBeatCost,
      coinCost: quote.totalCoinCost,
      availableBeats: 0,
      availableCoins: 0,
    };
  }

  return authorizeCoinOperationForUser({
    userId: user?.id ?? null,
    operationKey: meterKey,
    idempotencyKey: input.idempotencyKey,
    components: [{ meterKey, metadata: { presetId: preset.id } }],
    relatedStoryId: input.relatedStoryId ?? null,
    relatedNodeId: input.relatedNodeId ?? null,
    relatedStorylineId: input.relatedStorylineId ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
    },
  });
}
