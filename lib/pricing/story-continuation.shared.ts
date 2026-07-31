import { COINS_PER_BEAT, type PricingActionKey } from '@/lib/types/pricing';
import type { StoryConfig } from '@/lib/types/story';

export interface StoryContinuationDisplayQuote {
  actionKey: PricingActionKey;
  coinCost: number;
  includesImage: boolean;
}

/**
 * Resolve the user-facing continuation price from the live admin action-cost
 * catalog. Runtime authorization remains the final source of truth.
 */
export function resolveStoryContinuationDisplayQuote(
  storyConfig: StoryConfig,
  actionCosts: Record<string, number>
): StoryContinuationDisplayQuote {
  const defersImageGeneration =
    storyConfig.storyKind !== 'reel'
    && storyConfig.imageGenerationMode === 'generate'
    && (storyConfig.imageDeliveryMode === 'batch' || storyConfig.imageDeliveryMode === 'stateful');
  const includesImage =
    storyConfig.imageGenerationMode !== 'prompt_only' && !defersImageGeneration;
  const actionKey = includesImage
    ? 'continue_story_new_beat'
    : 'continue_story_new_beat_prompt_only';
  const fallbackBeatCost = includesImage ? 1 : 0.5;
  const beatCost = actionCosts[actionKey] ?? fallbackBeatCost;

  return {
    actionKey,
    includesImage,
    coinCost: Number((Math.max(0, beatCost) * COINS_PER_BEAT).toFixed(2)),
  };
}
