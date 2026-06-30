export interface ElevenLabsModelCost {
  modelId: string;
  displayName: string;
  usdPer1kChars: number;
}

export interface ElevenLabsCostSettings {
  models: ElevenLabsModelCost[];
  forcedAlignmentUsdPerHour: number;
}

export const DEFAULT_ELEVENLABS_COST_SETTINGS: ElevenLabsCostSettings = {
  forcedAlignmentUsdPerHour: 0.22,
  models: [
    {
      modelId: 'eleven_multilingual_v2',
      displayName: 'Eleven Multilingual v2',
      usdPer1kChars: 0.22,
    },
    {
      modelId: 'eleven_flash_v2_5',
      displayName: 'Eleven Flash v2.5',
      usdPer1kChars: 0.11,
    },
    {
      modelId: 'eleven_v3',
      displayName: 'Eleven v3',
      usdPer1kChars: 0.22,
    },
  ],
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanCost(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number(value)
    : NaN;
  return Number.isFinite(numeric)
    ? Math.max(0, Number(numeric.toFixed(6)))
    : 0;
}

export function normalizeElevenLabsCostSettings(value: unknown): ElevenLabsCostSettings {
  const raw = value && typeof value === 'object' ? value as { models?: unknown } : {};
  const models = Array.isArray(raw.models)
    ? raw.models
      .map((item) => {
        const row = item && typeof item === 'object'
          ? item as { modelId?: unknown; displayName?: unknown; usdPer1kChars?: unknown }
          : {};
        const modelId = cleanString(row.modelId);
        if (!modelId) return null;
        return {
          modelId,
          displayName: cleanString(row.displayName) || modelId,
          usdPer1kChars: cleanCost(row.usdPer1kChars),
        };
      })
      .filter((item): item is ElevenLabsModelCost => Boolean(item))
    : [];

  return {
    models: models.length > 0 ? models : DEFAULT_ELEVENLABS_COST_SETTINGS.models,
    forcedAlignmentUsdPerHour: cleanCost(
      (raw as { forcedAlignmentUsdPerHour?: unknown }).forcedAlignmentUsdPerHour
        ?? DEFAULT_ELEVENLABS_COST_SETTINGS.forcedAlignmentUsdPerHour
    ),
  };
}

export function serializeElevenLabsCostSettings(settings: ElevenLabsCostSettings): string {
  return JSON.stringify(normalizeElevenLabsCostSettings(settings));
}

export function getElevenLabsUsdPer1kChars(settings: ElevenLabsCostSettings, modelId: string): number {
  const exact = settings.models.find((item) => item.modelId === modelId);
  if (exact) return exact.usdPer1kChars;
  return DEFAULT_ELEVENLABS_COST_SETTINGS.models[0]?.usdPer1kChars ?? 0;
}

export function estimateElevenLabsCostUsd(input: {
  settings: ElevenLabsCostSettings;
  modelId: string;
  characterCount: number;
}): number {
  const chars = Math.max(0, Math.round(input.characterCount));
  const rate = getElevenLabsUsdPer1kChars(input.settings, input.modelId);
  return Number(((chars / 1000) * rate).toFixed(6));
}

export function estimateElevenLabsForcedAlignmentCostUsd(input: {
  settings: ElevenLabsCostSettings;
  audioSeconds: number;
}): number {
  const seconds = Math.max(0, Number.isFinite(input.audioSeconds) ? input.audioSeconds : 0);
  const rate = cleanCost(input.settings.forcedAlignmentUsdPerHour);
  return Number(((seconds / 3600) * rate).toFixed(6));
}
