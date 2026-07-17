'use server';

import { createClient } from '@/lib/supabase/server';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { listPublishedReelMoodsAction } from '@/app/actions/reel-moods';
import {
  loadSavedStorylinesData,
  loadUserReelsData,
  loadUserStoriesData,
} from '@/app/actions/persistence';
import { loadCharacterUniversePayloadData } from '@/app/actions/character-library';
import { buildImageModelPickerState } from '@/lib/ai/image-models';
import { buildReelVisualStyleCards } from '@/lib/reel/style-cards';
import type { ImageModelPickerState, ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import type { ReelMoodRecord } from '@/lib/reel/moods';
import type { ReelVisualStyleCard } from '@/lib/reel/styles';
import type { PricingMarketKey, PricingRuntimeContext } from '@/lib/types/pricing';
import type { SavedStory, SavedStorylineItem, UserReel } from '@/lib/types/my-stories';
import type { CharacterMaster } from '@/lib/types/character-library';
import type { CharacterUniverseRuntimeSettings } from '@/lib/character-universe/settings';

export interface LandingBootstrapData {
  pricing: PricingRuntimeContext | null;
  imageModelPicker: ImageModelPickerState | null;
  reelVisualStyleCards: ReelVisualStyleCard[];
  reelMoods: ReelMoodRecord[];
}

export interface SessionBootstrapData extends LandingBootstrapData {
  /** null = anonymous session (or the section failed); client keeps its cache. */
  myStories: {
    stories: SavedStory[];
    storylines: SavedStorylineItem[];
    reels: UserReel[];
  } | null;
  /** null = anonymous session; `masters` is [] when the library flag is off. */
  characterUniverse: {
    settings: CharacterUniverseRuntimeSettings;
    masters: CharacterMaster[];
  } | null;
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

/**
 * One round-trip for everything a signed-in landing render needs: the public
 * landing payload (pricing, model picker, reel styles/moods) plus the user's
 * My Stories tabs and character universe. Auth is resolved once here and
 * threaded into the my-stories/character loaders, collapsing what used to be
 * five separate client→server actions (three of them serialized behind the
 * server-action queue) into a single POST with server-side parallelism.
 *
 * Anonymous sessions get the public payload only (`myStories`/`characterUniverse`
 * null). Every section degrades independently.
 */
export async function getSessionBootstrap(input: {
  imageTaskKey: ImageTaskKey;
  imageModelSelection?: ImageModelSelection | null;
  pricingMarketKey?: PricingMarketKey | null;
}): Promise<SessionBootstrapData> {
  const supabase = await createClient();
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Treat auth failures as anonymous — the public payload still loads.
  }

  const [landing, myStories, characterUniverse] = await Promise.all([
    getLandingBootstrap(input),
    user
      ? Promise.all([
          loadUserStoriesData(supabase, user.id).catch(() => [] as SavedStory[]),
          loadSavedStorylinesData(supabase, user.id).catch(() => [] as SavedStorylineItem[]),
          loadUserReelsData(supabase, user.id).catch(() => [] as UserReel[]),
        ]).then(([stories, storylines, reels]) => ({ stories, storylines, reels }))
      : Promise.resolve(null),
    user
      ? loadCharacterUniversePayloadData(supabase, user.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  return { ...landing, myStories, characterUniverse };
}
