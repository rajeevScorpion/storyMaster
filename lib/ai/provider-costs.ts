import 'server-only';

import { getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  DEFAULT_ELEVENLABS_COST_SETTINGS,
  estimateElevenLabsCostUsd,
  normalizeElevenLabsCostSettings,
  serializeElevenLabsCostSettings,
  type ElevenLabsCostSettings,
} from '@/lib/ai/provider-costs.shared';

export const ELEVENLABS_COST_SETTINGS_FLAG = 'elevenlabs_cost_per_1k_chars_usd';

export async function getElevenLabsCostSettings(): Promise<ElevenLabsCostSettings> {
  const raw = await getFeatureFlagValue(ELEVENLABS_COST_SETTINGS_FLAG).catch(() => null);
  if (!raw) {
    return DEFAULT_ELEVENLABS_COST_SETTINGS;
  }

  try {
    return normalizeElevenLabsCostSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_ELEVENLABS_COST_SETTINGS;
  }
}

export async function saveElevenLabsCostSettings(settings: ElevenLabsCostSettings): Promise<ElevenLabsCostSettings> {
  const normalized = normalizeElevenLabsCostSettings(settings);
  await setFeatureFlagValue(ELEVENLABS_COST_SETTINGS_FLAG, serializeElevenLabsCostSettings(normalized));
  return normalized;
}

export async function estimateElevenLabsModelCostUsd(input: {
  modelId: string;
  characterCount: number;
}): Promise<number> {
  const settings = await getElevenLabsCostSettings();
  return estimateElevenLabsCostUsd({
    settings,
    modelId: input.modelId,
    characterCount: input.characterCount,
  });
}
