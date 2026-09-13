'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ensureFreeWelcomeGrantForUser,
  expireStaleReservations,
  finalizeBillableAction,
  releaseBillableAction,
} from '@/lib/pricing/enforcement';
import { authorizeCoinOperationForUser } from '@/lib/pricing/coin-economy';
import { authorizeImageModelBillableActionForUser } from '@/lib/pricing/image-aware-authorize';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import { canTriggerMediaForEditAccess } from '@/lib/agentic/reviewers.shared';
import {
  resolveAgenticBillingIdentity,
  AGENT_STORY_REVIEWER_SPEND_METADATA_KEY,
} from '@/lib/agentic/billing-identity.shared';
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
 * also serves start_story, where no related story exists yet to check.
 * `authorizeCurrentUserImageRegenerationBillableAction` below is the
 * separate, Round 4 wrapper for regenerateImageForNode. Adding the check to
 * this narrow continuation-only wrapper instead keeps start_story exactly as
 * it was.
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

/**
 * Round 4 (D25): authorize for regenerateImageForNode (lib/store/story-store.ts),
 * the per-beat "Regenerate image..." button -- the image twin of the interactive
 * narration defect fixed in 04e739b. Before this, it called
 * `authorizeCurrentUserImageModelBillableAction` above, which resolves the payer
 * as the session user unconditionally: a reviewer regenerating an image on an
 * agent draft paid for it themselves.
 *
 * Shaped like `authorizeCurrentUserStoryContinuation` above (assertCanEditStory
 * gates BEFORE anything is reserved), but additionally resolves who pays via
 * `resolveAgenticBillingIdentity` -- the same identity resolution
 * submitStoryImageBatch / submitStoryStatefulVisuals (a5e9bff) already use for
 * the batch paths, applied here to the single-image interactive one.
 *
 * Entitlement/model-tier resolution stays pinned to the CALLER
 * (`entitlementUserId`) even when the reservation moves to a different payer --
 * per 9c plan 11.2, the agent account resolves to the free plan, so routing the
 * feature-availability gate to it would refuse a submit that works today for
 * every reviewer. Only the coin reservation itself (`userId` below) moves to the
 * resolved payer; finalizeCurrentUserBillableAction / releaseCurrentUserBillableAction
 * read that same payer back off the reservation, never off the session, so the
 * two ends of this billable action agree on who is being charged.
 *
 * Also gates on `canTriggerMediaForEditAccess(reviewer)`, matching
 * image-batch.ts's `loadOwnedStory` (the same check both batch submit paths run):
 * assertCanEditStory deliberately proves only "may edit this story at all", not
 * the finer can_trigger_media capability, and its own docstring says image
 * submits are exactly the callers meant to check that separately. Short-circuits
 * to true for the owner branch (`reviewer` is null there), so an ordinary author
 * never consults `agent_reviewers` at all.
 */
export async function authorizeCurrentUserImageRegenerationBillableAction(
  input: AuthorizeBillableActionInput & {
    storyConfig: StoryConfig;
    imageCount?: number;
    taskKey?: ImageTaskKey;
  }
): Promise<PricingBillableActionAuthorization> {
  const callerUserId = await getCurrentUserId();
  if (!callerUserId || !input.relatedStoryId) {
    // Signed out, or no story yet to check (an unsaved session cannot be an
    // agent draft -- lib/agentic/story-assembly.ts always saves one before a
    // reviewer can ever see it). Behave exactly as
    // authorizeCurrentUserImageModelBillableAction always has.
    return authorizeImageModelBillableActionForUser(callerUserId, input);
  }

  const { story, reviewer } = await assertCanEditStory(input.relatedStoryId, callerUserId);
  if (!canTriggerMediaForEditAccess(reviewer)) {
    throw new Error('Forbidden.');
  }
  const { payerUserId, actorKind } = resolveAgenticBillingIdentity({
    storyUserId: story.user_id,
    agentPersonaId: story.agent_persona_id,
    callerUserId,
    systemUserId: process.env.AGENTIC_SYSTEM_USER_ID,
  });

  return authorizeImageModelBillableActionForUser(payerUserId, {
    ...input,
    actorKind,
    entitlementUserId: callerUserId,
    // Phase 11: actorKind above is resolveAgenticBillingIdentity's own output --
    // reused here, not a new signal. Only touches `metadata` for the agent-owned
    // case, so an ordinary author's call is byte-for-byte what it was before.
    ...(actorKind === 'agentic_system'
      ? {
          metadata: {
            ...(input.metadata ?? {}),
            [AGENT_STORY_REVIEWER_SPEND_METADATA_KEY]: true,
          },
        }
      : {}),
  });
}

interface ReservationPayerRow {
  id: string;
  user_id: string;
  related_story_id: string | null;
}

async function loadReservationPayer(reservationId: string): Promise<ReservationPayerRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('beat_spend_reservations')
    .select('id, user_id, related_story_id')
    .eq('id', reservationId)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Reservation not found.');
  }

  return data as ReservationPayerRow;
}

/**
 * Round 4 (D25): finalize/release must charge whoever the RESERVATION says paid,
 * never the session user overriding it -- pricing_finalize_reservation matches
 * `WHERE id = p_reservation_id AND user_id = p_user_id`, so passing the wrong id
 * there doesn't bill the wrong account, it RAISES "Reservation not found" after
 * the AI work already happened and was paid for by the reservation's real payer.
 *
 * The client only ever supplies a reservation id, so the caller is authorized
 * separately here rather than trusted: owner-or-reviewer via assertCanEditStory
 * when the reservation names a story, otherwise (e.g. a start_story reservation
 * made before any story row exists) the caller must BE the reservation's own
 * payer -- the exact rule this function enforced for every reservation before
 * Round 4. For an ordinary author, reservation.user_id already equals the
 * caller, so assertCanEditStory's owner branch is a no-op every time.
 */
async function authorizeReservationCaller(
  reservation: ReservationPayerRow,
  callerUserId: string
): Promise<void> {
  if (reservation.related_story_id) {
    await assertCanEditStory(reservation.related_story_id, callerUserId);
    return;
  }
  if (reservation.user_id !== callerUserId) {
    throw new Error('Forbidden.');
  }
}

export async function finalizeCurrentUserBillableAction(
  input: FinalizeBillableActionInput
): Promise<FinalizeBillableActionResult> {
  const callerUserId = await getCurrentUserId();
  if (!callerUserId) {
    throw new Error('You need to be signed in to finalize this paid action.');
  }

  const reservation = await loadReservationPayer(input.reservationId);
  await authorizeReservationCaller(reservation, callerUserId);

  return finalizeBillableAction({
    ...input,
    userId: reservation.user_id,
  });
}

export async function releaseCurrentUserBillableAction(
  input: ReleaseBillableActionInput
): Promise<ReleaseBillableActionResult> {
  const callerUserId = await getCurrentUserId();
  if (!callerUserId) {
    throw new Error('You need to be signed in to release this paid action.');
  }

  const reservation = await loadReservationPayer(input.reservationId);
  await authorizeReservationCaller(reservation, callerUserId);

  return releaseBillableAction({
    ...input,
    userId: reservation.user_id,
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
