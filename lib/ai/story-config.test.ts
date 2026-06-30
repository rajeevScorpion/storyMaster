import { describe, expect, it } from 'vitest';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from './story-config';

describe('story config normalization', () => {
  it('preserves generated image mode', () => {
    const config = normalizeStoryConfig({
      imageGenerationMode: 'generate',
    });

    expect(config.imageGenerationMode).toBe('generate');
  });

  it('preserves prompt-only image mode', () => {
    const config = normalizeStoryConfig({
      imageGenerationMode: 'prompt_only',
    });

    expect(config.imageGenerationMode).toBe('prompt_only');
  });

  it('falls back to the default image mode for unknown values', () => {
    const config = normalizeStoryConfig({
      imageGenerationMode: 'unknown',
    } as unknown as Parameters<typeof normalizeStoryConfig>[0]);

    expect(config.imageGenerationMode).toBe(DEFAULT_STORY_CONFIG.imageGenerationMode);
  });

  it('normalizes image continuity strategy', () => {
    const config = normalizeStoryConfig({
      imageContinuityStrategy: 'provider_stateful',
    });

    expect(config.imageContinuityStrategy).toBe('provider_stateful');
    expect(normalizeStoryConfig({
      imageContinuityStrategy: 'bad-value',
    } as unknown as Parameters<typeof normalizeStoryConfig>[0]).imageContinuityStrategy)
      .toBe(DEFAULT_STORY_CONFIG.imageContinuityStrategy);
  });
});
