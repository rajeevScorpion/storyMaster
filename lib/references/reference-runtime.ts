import 'server-only';

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { resolvePlanKeyForUser } from '@/lib/pricing/enforcement';
import {
  REFERENCE_FLAG_KEYS,
  parseReferencePersonalizationSettingsValue,
  type ReferencePersonalizationSettings,
} from '@/lib/references/reference-settings';
import { resolveReferenceEntitlements, type ReferenceEntitlements } from '@/lib/references/entitlements';
import type { PlanKey } from '@/lib/types/pricing';

export async function getReferenceMasterEnabled(): Promise<boolean> {
  return getFeatureFlag(REFERENCE_FLAG_KEYS.enabled, false);
}

export async function getReferenceSettings(): Promise<ReferencePersonalizationSettings> {
  const raw = await getFeatureFlagValue(REFERENCE_FLAG_KEYS.settings);
  return parseReferencePersonalizationSettingsValue(raw);
}

export interface ReferenceRuntimeContext {
  masterEnabled: boolean;
  settings: ReferencePersonalizationSettings;
  entitlements: ReferenceEntitlements;
  planKey: PlanKey;
}

/**
 * Resolve everything a story-creation / upload / adoption flow needs for one
 * user: master flag, admin settings, and the concrete per-tier entitlements.
 * Always re-run server-side on every mutation (never trust the client's view).
 */
export async function getReferenceRuntimeContext(userId: string | null): Promise<ReferenceRuntimeContext> {
  const [masterEnabled, settings] = await Promise.all([getReferenceMasterEnabled(), getReferenceSettings()]);
  const planKey: PlanKey = userId ? await resolvePlanKeyForUser(userId) : 'free';
  const entitlements = resolveReferenceEntitlements({ masterEnabled, planKey, settings });
  return { masterEnabled, settings, entitlements, planKey };
}
