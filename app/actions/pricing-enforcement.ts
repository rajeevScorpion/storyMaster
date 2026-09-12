'use server';

import { createClient } from '@/lib/supabase/server';
import {
  ensureFreeWelcomeGrantForUser,
  expireStaleReservations,
  finalizeBillableAction,
  releaseBillableAction,
} from '@/lib/pricing/enforcement';
import { authorizeCoinOperationForUser } from '@/lib/pricing/coin-economy';
import { authorizeImageModelBillableActionForUser } from '@/lib/pricing/image-aware-authorize';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import type { ImageTaskKey } from '@/lib/ai/image-models.shared';
import type {
  AuthorizeBillableActionInput,
  FinalizeBillableActionInput,
  FinalizeBillableActionResult,
  PricingBillableActionAuthorization,
  ReleaseBillableActionInput,
  ReleaseBillableActionResult,
} from '@/lib/types/pricing';
import type { StoryConfig } from '@/lib/types/story';

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user?.id ?? null;
}

export async function authorizeCurrentUserBillableAction(
  input: AuthorizeBillableActionInput
): Promise<PricingBillableActionAuthorization> {
  const userId = await getCurrentUserId();
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

export async function authorizeCurrentUserImageModelBillableAction(
  input: AuthorizeBillableActionInput & {
    storyConfig: StoryConfig;
    imageCount?: number;
    taskKey?: ImageTaskKey;
  }
): Promise<PricingBillableActionAuthorization> {
  const userId = await getCurrentUserId();
  return authorizeImageModelBillableActionForUser(userId, input);
}

/**
 * Round 1 (D24/3.2): the legacy continueStory authorize call
 * (lib/store/story-store.ts), with one check added ahead of the coin
 * reservation -- continuing an existing story is owner-or-reviewer only.
 *
 * `authorizeCurrentUserImageModelBillableAction` above stays untouched: it
 * also serves start_story (no related story exists yet to check) and
 * regenerateImageForNode (Phase 10 Round 4's billing fix is a separate,
 * later change). Adding the check to this narrow continuation-only wrapper
 * instead keeps both of those exactly as they were.
 *
 * `assertCanEditStory` throws for a stranger and that throw is left to
 * propagate uncaught -- image-batch.ts and narration-batch.ts already let
 * the same throw surface this way. A real signed-in user never reaches this
 * as a stranger: app/story/[id]/layout.tsx and app/explore/[id]/layout.tsx
 * already redirect them before the "Continue" button is ever clickable.
 * This is defence in depth against a direct server-action call, per the
 * standing rule that server actions are directly invocable.
 */
export async function authorizeCurrentUserStoryContinuation(
  input: AuthorizeBillableActionInput & {
    storyConfig: StoryConfig;
    imageCount?: number;
    taskKey?: ImageTaskKey;
  }
): Promise<PricingBillableActionAuthorization> {
  const userId = await getCurrentUserId();
  if (userId && input.relatedStoryId) {
    await assertCanEditStory(input.relatedStoryId, userId);
  }
  return authorizeImageModelBillableActionForUser(userId, input);
}

export async function finalizeCurrentUserBillableAction(
  input: FinalizeBillableActionInput
): Promise<FinalizeBillableActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('You need to be signed in to finalize this paid action.');
  }

  return finalizeBillableAction({
    userId,
    ...input,
  });
}

export async function releaseCurrentUserBillableAction(
  input: ReleaseBillableActionInput
): Promise<ReleaseBillableActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('You need to be signed in to release this paid action.');
  }

  return releaseBillableAction({
    userId,
    ...input,
  });
}

export async function ensureCurrentUserFreeWelcomeGrant() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return {
      granted: false,
      grantId: null,
      beatsGranted: 0,
      expiresAt: null,
    };
  }

  return ensureFreeWelcomeGrantForUser(userId);
}

export async function expireCurrentPricingReservations(): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return 0;
  }

  return expireStaleReservations();
}
