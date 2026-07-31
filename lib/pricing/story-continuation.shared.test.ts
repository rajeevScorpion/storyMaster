import { describe, expect, it } from 'vitest';
import { DEFAULT_STORY_CONFIG } from '@/lib/ai/story-config';
import { resolveStoryContinuationDisplayQuote } from './story-continuation.shared';

describe('story continuation display quote', () => {
  it('uses the admin image-beat price when images are generated', () => {
    expect(
      resolveStoryContinuationDisplayQuote(
        { ...DEFAULT_STORY_CONFIG, imageGenerationMode: 'generate' },
        {
          continue_story_new_beat: 1.8,
          continue_story_new_beat_prompt_only: 0.4,
        }
      )
    ).toEqual({
      actionKey: 'continue_story_new_beat',
      coinCost: 18,
      includesImage: true,
    });
  });

  it('uses the admin no-image price for prompt-only beats', () => {
    expect(
      resolveStoryContinuationDisplayQuote(
        { ...DEFAULT_STORY_CONFIG, imageGenerationMode: 'prompt_only' },
        {
          continue_story_new_beat: 1.8,
          continue_story_new_beat_prompt_only: 0.4,
        }
      )
    ).toEqual({
      actionKey: 'continue_story_new_beat_prompt_only',
      coinCost: 4,
      includesImage: false,
    });
  });

  it('uses the no-image price when beat images are generated later in a batch', () => {
    expect(
      resolveStoryContinuationDisplayQuote(
        {
          ...DEFAULT_STORY_CONFIG,
          imageGenerationMode: 'generate',
          imageDeliveryMode: 'batch',
        },
        {
          continue_story_new_beat: 1.8,
          continue_story_new_beat_prompt_only: 0.4,
        }
      )
    ).toEqual({
      actionKey: 'continue_story_new_beat_prompt_only',
      coinCost: 4,
      includesImage: false,
    });
  });
});
