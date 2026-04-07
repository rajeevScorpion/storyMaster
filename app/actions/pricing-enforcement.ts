'use server';

import { createClient } from '@/lib/supabase/server';
import {
  authorizeBillableAction,
  ensureFreeAllowanceForUser,
  expireStaleReservations,
  finalizeBillableAction,
  releaseBillableAction,
} from '@/lib/pricing/enforcement';
import type {
  AuthorizeBillableActionInput,
  FinalizeBillableActionInput,
  FinalizeBillableActionResult,
  PricingBillableActionAuthorization,
  ReleaseBillableActionInput,
  ReleaseBillableActionResult,
} from '@/lib/types/pricing';

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

export async function ensureCurrentUserFreeAllowance() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return {
      granted: false,
      grantId: null,
      beatsGranted: 0,
      expiresAt: null,
    };
  }

  return ensureFreeAllowanceForUser(userId);
}

export async function expireCurrentPricingReservations(): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return 0;
  }

  return expireStaleReservations();
}
