// Pure entitlement resolution for Reference Personalization. Combines the master
// feature flag, the per-tier matrix, and global toggles into the concrete limits
// a given user sees at story creation. No I/O — callers resolve planKey + settings
// first (getPricingRuntimeContext / resolvePlanKeyForUser + reference settings),
// then pass them here. Server actions re-run this on every mutation; the UI runs
// it for display only.

import type { PlanKey } from '@/lib/types/pricing';
import type { WorldAdoptionMode } from '@/lib/types/references';
import {
  DEFAULT_REFERENCE_TIER_LIMITS,
  type ReferencePersonalizationSettings,
} from '@/lib/references/reference-settings';

export interface ReferenceEntitlements {
  /** Master feature is on AND the tier is enabled. Gates the whole panel. */
  enabled: boolean;
  charactersEnabled: boolean;
  worldsEnabled: boolean;
  maxCharacterRefs: number;
  maxWorldRefs: number;
  /** Resolved world visualization policy after global + tier gating. */
  worldAdoptionMode: WorldAdoptionMode;
}

const DISABLED_ENTITLEMENTS: ReferenceEntitlements = {
  enabled: false,
  charactersEnabled: false,
  worldsEnabled: false,
  maxCharacterRefs: 0,
  maxWorldRefs: 0,
  worldAdoptionMode: 'description_only',
};

export function resolveReferenceEntitlements(input: {
  masterEnabled: boolean;
  planKey: PlanKey | string | null | undefined;
  settings: ReferencePersonalizationSettings;
}): ReferenceEntitlements {
  const { masterEnabled, planKey, settings } = input;

  if (!masterEnabled) return DISABLED_ENTITLEMENTS;

  // Unknown/legacy plan keys fall back to the Free row (never a paid tier).
  const tier =
    (planKey && settings.tierMatrix[planKey as PlanKey]) ||
    settings.tierMatrix.free ||
    DEFAULT_REFERENCE_TIER_LIMITS.free;

  if (!tier.enabled) return DISABLED_ENTITLEMENTS;

  const charactersEnabled = settings.charactersEnabled && tier.maxCharacterRefs > 0;
  const worldsEnabled = settings.worldsEnabled && tier.maxWorldRefs > 0;

  // A tier may permit canonical world visuals, but the global toggle can force
  // description-only across the board.
  const worldAdoptionMode: WorldAdoptionMode =
    tier.worldAdoptionMode === 'description_plus_canonical_visual' && settings.worldVisualizationEnabled
      ? 'description_plus_canonical_visual'
      : 'description_only';

  return {
    enabled: charactersEnabled || worldsEnabled,
    charactersEnabled,
    worldsEnabled,
    maxCharacterRefs: charactersEnabled ? tier.maxCharacterRefs : 0,
    maxWorldRefs: worldsEnabled ? tier.maxWorldRefs : 0,
    worldAdoptionMode,
  };
}
