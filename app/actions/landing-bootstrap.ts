'use server';

import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { listPublishedReelMoodsAction } from '@/app/actions/reel-moods';
import { buildImageModelPickerState } from '@/lib/ai/image-models';
import { buildReelVisualStyleCards } from '@/lib/reel/style-cards';
import type { ImageModelPickerState, ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import type { ReelMoodRecord } from '@/lib/reel/moods';
import type { ReelVisualStyleCard } from '@/lib/reel/styles';
import type { PricingMarketKey, PricingRuntimeContext } from '@/lib/types/pricing';

export interface LandingBootstrapData {
  pricing: PricingRuntimeContext | null;
  imageModelPicker: ImageModelPickerState | null;
  reelVisualStyleCards: ReelVisualStyleCard[];
  reelMoods: ReelMoodRecord[];
}

/**
 * One round-trip for everything the landing screen fetches on mount.
 * The pricing context is resolved once and its plan key parameterizes the
 * plan-dependent payloads (model picker, style-card locks) server-side, so
 * the client never supplies a plan. Each section degrades independently, the
 * same way the previously separate per-section fetches did.
 */
export async function getLandingBootstrap(input: {
  imageTaskKey: ImageTaskKey;
  imageModelSelection?: ImageModelSelection | null;
  pricingMarketKey?: PricingMarketKey | null;
}): Promise<LandingBootstrapData> {
  const pricing = await getPricingRuntimeContext({
    pricingMarketKey: input.pricingMarketKey ?? null,
  }).catch(() => null);
  const planKey = pricing?.snapshot.planKey ?? 'free';

  const [imageModelPicker, reelVisualStyleCards, reelMoods] = await Promise.all([
    buildImageModelPickerState(input.imageTaskKey, input.imageModelSelection ?? null, planKey)
      .catch(() => null),
    buildReelVisualStyleCards(planKey).catch(() => [] as ReelVisualStyleCard[]),
    listPublishedReelMoodsAction().catch(() => [] as ReelMoodRecord[]),
  ]);

  return { pricing, imageModelPicker, reelVisualStyleCards, reelMoods };
}
