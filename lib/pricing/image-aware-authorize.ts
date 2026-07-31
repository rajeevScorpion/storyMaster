import 'server-only';

import { getPricingPolicyContextForUser } from '@/lib/pricing/enforcement';
import { authorizeCoinOperationForUser } from '@/lib/pricing/coin-economy';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import { coinsToBeatCost, imageTaskForStoryKind, type ImageTaskKey } from '@/lib/ai/image-models.shared';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import type {
  AuthorizeBillableActionInput,
  PricingActionKey,
  PricingBillableActionAuthorization,
} from '@/lib/types/pricing';
import type { StoryConfig } from '@/lib/types/story';

function getPromptOnlyBaseActionKey(actionKey: PricingActionKey): PricingActionKey | null {
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
    return authorizeCoinOperationForUser({
      userId,
      operationKey: input.actionKey,
      idempotencyKey: input.idempotencyKey,
      components: [{ meterKey: input.actionKey }],
      relatedStoryId: input.relatedStoryId ?? null,
      relatedNodeId: input.relatedNodeId ?? null,
      relatedStorylineId: input.relatedStorylineId ?? null,
      metadata: input.metadata,
    });
  }

  const pricing = await getPricingPolicyContextForUser(userId);
  if (pricing.planKey === 'free') {
    const freeTierGate = await authorizeCoinOperationForUser({
      userId,
      operationKey: input.actionKey,
      idempotencyKey: input.idempotencyKey,
      components: [{
        meterKey: 'image_generation',
        unitBeatCostOverride: 0,
      }],
      relatedStoryId: input.relatedStoryId ?? null,
      relatedNodeId: input.relatedNodeId ?? null,
      relatedStorylineId: input.relatedStorylineId ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        entitlementCheckOnly: true,
      },
    });
    if (freeTierGate.status === 'denied') return freeTierGate;
  }

  const taskKey = input.taskKey ?? imageTaskForStoryKind(storyConfig.storyKind);
  const imageModelSnapshot = await resolveImageModelSnapshot({
    taskKey,
    selection: storyConfig.imageModelSelection ?? null,
    currentPlanKey: pricing.planKey,
  });
  const imageCount = Math.max(1, Math.round(input.imageCount ?? 1));
  const promptOnlyActionKey = getPromptOnlyBaseActionKey(input.actionKey);
  const modelUnitBeatCost = coinsToBeatCost(imageModelSnapshot.coinCostPerImage);

  return authorizeCoinOperationForUser({
    userId,
    operationKey: input.actionKey,
    idempotencyKey: input.idempotencyKey,
    components: [
      ...(promptOnlyActionKey
        ? [{ meterKey: promptOnlyActionKey }]
        : []),
      {
        meterKey: 'image_generation',
        quantity: imageCount,
        unitBeatCostOverride: modelUnitBeatCost,
        metadata: {
          taskKey,
          imageModelSnapshot,
        },
      },
    ],
    relatedStoryId: input.relatedStoryId ?? null,
    relatedNodeId: input.relatedNodeId ?? null,
    relatedStorylineId: input.relatedStorylineId ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      billingPolicy: 'coin_economy_gateway',
      imageCount,
      imageModelSnapshot,
    },
  });
}
