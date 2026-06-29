import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ELEVENLABS_COST_SETTINGS,
  estimateElevenLabsCostUsd,
  normalizeElevenLabsCostSettings,
} from './provider-costs.shared';

describe('provider cost settings', () => {
  it('normalizes ElevenLabs model cost settings', () => {
    expect(normalizeElevenLabsCostSettings({
      models: [
        { modelId: 'eleven_flash_v2_5', displayName: 'Flash', usdPer1kChars: '0.11' },
      ],
    })).toEqual({
      models: [
        { modelId: 'eleven_flash_v2_5', displayName: 'Flash', usdPer1kChars: 0.11 },
      ],
    });
  });

  it('falls back to default ElevenLabs settings when empty', () => {
    expect(normalizeElevenLabsCostSettings({ models: [] })).toEqual(DEFAULT_ELEVENLABS_COST_SETTINGS);
  });

  it('estimates ElevenLabs character cost by model', () => {
    expect(estimateElevenLabsCostUsd({
      settings: {
        models: [
          { modelId: 'model-a', displayName: 'Model A', usdPer1kChars: 0.2 },
        ],
      },
      modelId: 'model-a',
      characterCount: 1500,
    })).toBe(0.3);
  });
});
