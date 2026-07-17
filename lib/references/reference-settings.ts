// Reference Personalization admin settings — serialized as a single JSON blob in
// the feature_flags table (flag key 'reference_personalization_settings'), the
// same pattern as media-pipeline-settings.ts. All values are admin-editable and
// clamped by normalize* so a malformed/stale blob can never exceed platform
// ceilings or break the runtime.

import { PLAN_KEYS, type PlanKey } from '@/lib/types/pricing';
import type { ReferenceInputMode, WorldAdoptionMode } from '@/lib/types/references';

/** Platform hard ceilings for the first release (pack: 3 character / 3 world). */
export const REFERENCE_PLATFORM_MAX_CHARACTER_REFS = 3;
export const REFERENCE_PLATFORM_MAX_WORLD_REFS = 3;

/** Input modes for the References feature (see ReferenceInputMode). */
export const REFERENCE_INPUT_MODES: readonly ReferenceInputMode[] = ['adoption', 'direct'] as const;
export const DEFAULT_REFERENCE_INPUT_MODE: ReferenceInputMode = 'direct';

export function normalizeReferenceInputMode(value: unknown): ReferenceInputMode {
  return value === 'adoption' || value === 'direct' ? value : DEFAULT_REFERENCE_INPUT_MODE;
}

export interface ReferenceTierLimits {
  enabled: boolean;
  maxCharacterRefs: number;
  maxWorldRefs: number;
  worldAdoptionMode: WorldAdoptionMode;
}

export interface ReferencePersonalizationSettings {
  charactersEnabled: boolean;
  worldsEnabled: boolean;
  /** Global kill for canonical world visuals (tier may still allow the mode). */
  worldVisualizationEnabled: boolean;
  descriptionOnlyFallbackEnabled: boolean;
  /** Kill switch: stop creating new adoption jobs; existing ones keep displaying. */
  pauseNewAdoptions: boolean;
  tierMatrix: Record<PlanKey, ReferenceTierLimits>;
  maxAttempts: number;
  staleReclaimMinutes: number;
  maxFileSizeMb: number;
  minDimensionPx: number;
  abandonedSetupTtlHours: number;
}

export const REFERENCE_FLAG_KEYS = {
  enabled: 'reference_personalization_enabled',
  settings: 'reference_personalization_settings',
  customOptionAttachment: 'reference_custom_option_attachment_enabled',
  inputMode: 'reference_input_mode',
} as const;

export const DEFAULT_REFERENCE_TIER_LIMITS: Record<PlanKey, ReferenceTierLimits> = {
  free: { enabled: true, maxCharacterRefs: 2, maxWorldRefs: 1, worldAdoptionMode: 'description_only' },
  plus: { enabled: true, maxCharacterRefs: 3, maxWorldRefs: 3, worldAdoptionMode: 'description_plus_canonical_visual' },
  studio: { enabled: true, maxCharacterRefs: 3, maxWorldRefs: 3, worldAdoptionMode: 'description_plus_canonical_visual' },
};

export const DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS: ReferencePersonalizationSettings = {
  charactersEnabled: true,
  worldsEnabled: true,
  worldVisualizationEnabled: true,
  descriptionOnlyFallbackEnabled: true,
  pauseNewAdoptions: false,
  tierMatrix: DEFAULT_REFERENCE_TIER_LIMITS,
  maxAttempts: 3,
  staleReclaimMinutes: 10,
  maxFileSizeMb: 8,
  minDimensionPx: 512,
  abandonedSetupTtlHours: 48,
};

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

function normalizeWorldAdoptionMode(value: unknown, fallback: WorldAdoptionMode): WorldAdoptionMode {
  return value === 'description_plus_canonical_visual' || value === 'description_only'
    ? value
    : fallback;
}

function normalizeTierLimits(
  input: Partial<ReferenceTierLimits> | null | undefined,
  defaults: ReferenceTierLimits
): ReferenceTierLimits {
  return {
    enabled: normalizeBoolean(input?.enabled, defaults.enabled),
    maxCharacterRefs: normalizeInteger(
      input?.maxCharacterRefs,
      defaults.maxCharacterRefs,
      0,
      REFERENCE_PLATFORM_MAX_CHARACTER_REFS
    ),
    maxWorldRefs: normalizeInteger(
      input?.maxWorldRefs,
      defaults.maxWorldRefs,
      0,
      REFERENCE_PLATFORM_MAX_WORLD_REFS
    ),
    worldAdoptionMode: normalizeWorldAdoptionMode(input?.worldAdoptionMode, defaults.worldAdoptionMode),
  };
}

export function normalizeReferencePersonalizationSettings(
  input: Partial<ReferencePersonalizationSettings> | null | undefined
): ReferencePersonalizationSettings {
  const defaults = DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS;
  const tierInput = (input?.tierMatrix ?? {}) as Partial<
    Record<PlanKey, Partial<ReferenceTierLimits>>
  >;
  const tierMatrix = PLAN_KEYS.reduce((acc, planKey) => {
    acc[planKey] = normalizeTierLimits(tierInput[planKey], DEFAULT_REFERENCE_TIER_LIMITS[planKey]);
    return acc;
  }, {} as Record<PlanKey, ReferenceTierLimits>);

  return {
    charactersEnabled: normalizeBoolean(input?.charactersEnabled, defaults.charactersEnabled),
    worldsEnabled: normalizeBoolean(input?.worldsEnabled, defaults.worldsEnabled),
    worldVisualizationEnabled: normalizeBoolean(
      input?.worldVisualizationEnabled,
      defaults.worldVisualizationEnabled
    ),
    descriptionOnlyFallbackEnabled: normalizeBoolean(
      input?.descriptionOnlyFallbackEnabled,
      defaults.descriptionOnlyFallbackEnabled
    ),
    pauseNewAdoptions: normalizeBoolean(input?.pauseNewAdoptions, defaults.pauseNewAdoptions),
    tierMatrix,
    maxAttempts: normalizeInteger(input?.maxAttempts, defaults.maxAttempts, 1, 5),
    staleReclaimMinutes: normalizeInteger(input?.staleReclaimMinutes, defaults.staleReclaimMinutes, 2, 60),
    maxFileSizeMb: normalizeInteger(input?.maxFileSizeMb, defaults.maxFileSizeMb, 1, 15),
    minDimensionPx: normalizeInteger(input?.minDimensionPx, defaults.minDimensionPx, 128, 2048),
    abandonedSetupTtlHours: normalizeInteger(
      input?.abandonedSetupTtlHours,
      defaults.abandonedSetupTtlHours,
      1,
      720
    ),
  };
}

export function parseReferencePersonalizationSettingsValue(
  raw: string | null | undefined
): ReferencePersonalizationSettings {
  if (!raw) return DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS;
  try {
    return normalizeReferencePersonalizationSettings(
      JSON.parse(raw) as Partial<ReferencePersonalizationSettings>
    );
  } catch {
    return DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS;
  }
}

export function serializeReferencePersonalizationSettings(
  settings: ReferencePersonalizationSettings
): string {
  return JSON.stringify(normalizeReferencePersonalizationSettings(settings));
}
