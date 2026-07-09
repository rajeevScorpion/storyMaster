import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_CONTINUITY_SETTINGS,
  estimateStatefulRuntimeCostUsd,
  extractStatefulUsageTokenCounts,
  normalizeImageContinuitySettings,
} from './image-continuity-settings.shared';

describe('image continuity settings helpers', () => {
  it('normalizes settings with safe defaults', () => {
    const settings = normalizeImageContinuitySettings({
      defaultStrategy: 'resend_refs',
      openai: {
        runtimeModelId: 'gpt-5.4-mini',
        inputUsdPer1MTokens: '1.2',
      },
    });

    expect(settings.defaultStrategy).toBe('resend_refs');
    expect(settings.openai.inputUsdPer1MTokens).toBe(1.2);
    expect(settings.openai.outputUsdPer1MTokens).toBe(DEFAULT_IMAGE_CONTINUITY_SETTINGS.openai.outputUsdPer1MTokens);
    expect(settings.xai.enabled).toBe(false);
  });

  it('extracts OpenAI and Gemini usage token counts', () => {
    expect(extractStatefulUsageTokenCounts({
      input_tokens: 1000,
      output_tokens: 200,
      input_tokens_details: { cached_tokens: 600 },
    })).toMatchObject({
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 600,
    });

    expect(extractStatefulUsageTokenCounts({
      total_input_tokens: 900,
      total_output_tokens: 100,
      total_cached_tokens: 300,
    })).toMatchObject({
      inputTokens: 900,
      outputTokens: 100,
      cachedTokens: 300,
    });
  });

  it('estimates runtime token cost with cached-token discount', () => {
    const estimate = estimateStatefulRuntimeCostUsd({
      pricing: {
        enabled: true,
        runtimeModelId: 'gpt-5.4-mini',
        inputUsdPer1MTokens: 0.75,
        cachedInputUsdPer1MTokens: 0.075,
        outputUsdPer1MTokens: 4.5,
      },
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 400 },
      },
    });

    expect(estimate.runtimeCostUsd).toBe(0.00093);
  });
});
