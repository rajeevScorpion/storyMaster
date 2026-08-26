import 'server-only';

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { resolveEntitlementPlanKeyForUser } from '@/lib/pricing/enforcement';
import {
  REFERENCE_FLAG_KEYS,
  normalizeReferenceInputMode,
  parseReferencePersonalizationSettingsValue,
  type ReferencePersonalizationSettings,
} from '@/lib/references/reference-settings';
import { resolveReferenceEntitlements, type ReferenceEntitlements } from '@/lib/references/entitlements';
import type { PlanKey } from '@/lib/types/pricing';
import type { ReferenceInputMode } from '@/lib/types/references';

export async function getReferenceMasterEnabled(): Promise<boolean> {
  return getFeatureFlag(REFERENCE_FLAG_KEYS.enabled, false);
}

export async function getReferenceSettings(): Promise<ReferencePersonalizationSettings> {
  const raw = await getFeatureFlagValue(REFERENCE_FLAG_KEYS.settings);
  return parseReferencePersonalizationSettingsValue(raw);
}

export async function getReferenceInputMode(): Promise<ReferenceInputMode> {
  const raw = await getFeatureFlagValue(REFERENCE_FLAG_KEYS.inputMode);
  return normalizeReferenceInputMode(raw);
}

export interface ReferenceRuntimeContext {
  masterEnabled: boolean;
  inputMode: ReferenceInputMode;
  settings: ReferencePersonalizationSettings;
  entitlements: ReferenceEntitlements;
  planKey: PlanKey;
}

/**
 * Resolve everything a story-creation / upload / adoption flow needs for one
 * user: master flag, input mode, admin settings, and the concrete per-tier
 * entitlements. Always re-run server-side on every mutation (never trust the
 * client's view).
 */
export async function getReferenceRuntimeContext(userId: string | null): Promise<ReferenceRuntimeContext> {
  const [masterEnabled, inputMode, settings] = await Promise.all([
    getReferenceMasterEnabled(),
    getReferenceInputMode(),
    getReferenceSettings(),
  ]);
  const planKey: PlanKey = userId ? await resolveEntitlementPlanKeyForUser(userId) : 'free';
  const entitlements = resolveReferenceEntitlements({ masterEnabled, planKey, settings });
  return { masterEnabled, inputMode, settings, entitlements, planKey };
}
