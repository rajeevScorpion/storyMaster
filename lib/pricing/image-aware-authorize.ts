import 'server-only';

import { authorizeBillableAction } from '@/lib/pricing/enforcement';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import { coinsToBeatCost, imageTaskForStoryKind, type ImageTaskKey } from '@/lib/ai/image-models.shared';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import type {
  AuthorizeBillableActionInput,
  PricingBillableActionAuthorization,
} from '@/lib/types/pricing';
import type { StoryConfig } from '@/lib/types/story';

const ACTION_COST_FALLBACKS: Record<string, number> = {
  start_story_initial_beat: 1,
  start_story_initial_beat_prompt_only: 0.5,
  start_reel_full_generation: 3,
  start_reel_full_generation_prompt_only: 1.5,
  continue_story_new_beat: 1,
  continue_story_new_beat_prompt_only: 0.5,
  regenerate_image: 1,
};

function getPromptOnlyBaseActionKey(actionKey: string): string | null {
  switch (actionKey) {
    case 'start_story_initial_beat':
      return 'start_story_initial_beat_prompt_only';
    case 'start_reel_full_generation':
      return 'start_reel_full_generation_prompt_only';
    case 'continue_story_new_beat':
      return 'continue_story_new_beat_prompt_only';
    case 'regenerate_image':
      return null;
    default:
      return actionKey.endsWith('_prompt_only') ? actionKey : null;
  }
}

function getActionBeatCost(actionCosts: Record<string, number>, actionKey: string): number {
  return Number(actionCosts[actionKey] ?? ACTION_COST_FALLBACKS[actionKey] ?? 0);
}

export type AuthorizeImageModelBillableActionInput = AuthorizeBillableActionInput & {
  storyConfig: StoryConfig;
  imageCount?: number;
  taskKey?: ImageTaskKey;
};

/**
 * Image-model-aware coin authorization for an explicit user. The cookie-bound
 * `authorizeCurrentUserImageModelBillableAction` server action and the beat
 * bundle share this body; only user resolution differs.
 */
export async function authorizeImageModelBillableActionForUser(
  userId: string | null,
  input: AuthorizeImageModelBillableActionInput
): Promise<PricingBillableActionAuthorization> {
  const storyConfig = normalizeStoryConfig(input.storyConfig);

  if (storyConfig.imageGenerationMode === 'prompt_only') {
    return authorizeBillableAction({
      userId,
      actionKey: input.actionKey,
      idempotencyKey: input.idempotencyKey,
      relatedStoryId: input.relatedStoryId ?? null,
      relatedNodeId: input.relatedNodeId ?? null,
      relatedStorylineId: input.relatedStorylineId ?? null,
      metadata: input.metadata,
    });
  }

  const pricing = await getPricingRuntimeContext();
  const taskKey = input.taskKey ?? imageTaskForStoryKind(storyConfig.storyKind);
  const imageModelSnapshot = await resolveImageModelSnapshot({
    taskKey,
    selection: storyConfig.imageModelSelection ?? null,
    currentPlanKey: pricing.snapshot.planKey,
  });
  const imageCount = Math.max(1, Math.round(input.imageCount ?? 1));
  const promptOnlyActionKey = getPromptOnlyBaseActionKey(input.actionKey);
  const baseBeatCost = promptOnlyActionKey
    ? getActionBeatCost(pricing.actionCosts, promptOnlyActionKey)
    : 0;
  const modelBeatCost = coinsToBeatCost(imageModelSnapshot.coinCostPerImage * imageCount);
  const requestedBeatCost = Number((baseBeatCost + modelBeatCost).toFixed(2));

  return authorizeBillableAction({
    userId,
    actionKey: input.actionKey,
    idempotencyKey: input.idempotencyKey,
    relatedStoryId: input.relatedStoryId ?? null,
    relatedNodeId: input.relatedNodeId ?? null,
    relatedStorylineId: input.relatedStorylineId ?? null,
    requestedBeatCostOverride: requestedBeatCost,
    metadata: {
      ...(input.metadata ?? {}),
      billingPolicy: 'image_model_registry',
      baseBeatCost,
      imageCount,
      modelBeatCost,
      imageModelSnapshot,
    },
  });
}
