// Phase 10 Round 4 (D25): the per-beat "Regenerate image..." billed the REVIEWER for
// work on an agent-owned draft -- the image twin of the interactive narration defect
// fixed in 04e739b. The single most important property of the fix is that authorize
// and finalize/release agree on who pays:
//
//  - authorizeCurrentUserImageRegenerationBillableAction resolves the payer from the
//    story (resolveAgenticBillingIdentity) BEFORE reserving anything, gated on
//    assertCanEditStory + canTriggerMediaForEditAccess.
//  - finalizeCurrentUserBillableAction / releaseCurrentUserBillableAction no longer
//    trust the session user as the payer at all -- they read it off the reservation
//    row itself (the same row pricing_finalize_reservation matches
//    `WHERE id = p_reservation_id AND user_id = p_user_id` against), and authorize the
//    CALLER separately so a client can't finalize an arbitrary reservation by id.
//
// Fixing only one half would reproduce the exact charge-and-write-nothing defect this
// phase has already fixed four times: the reservation lands on the agent while
// finalize still passes the reviewer, and pricing_finalize_reservation raises AFTER
// the AI work already happened and was paid for.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/pricing/enforcement', () => ({
  ensureFreeWelcomeGrantForUser: vi.fn(),
  expireStaleReservations: vi.fn(),
  finalizeBillableAction: vi.fn(),
  releaseBillableAction: vi.fn(),
}));

vi.mock('@/lib/pricing/coin-economy', () => ({
  authorizeCoinOperationForUser: vi.fn(),
}));

vi.mock('@/lib/pricing/image-aware-authorize', () => ({
  authorizeImageModelBillableActionForUser: vi.fn(),
}));

vi.mock('@/lib/agentic/reviewers', () => ({
  assertCanEditStory: vi.fn(),
}));

// @/lib/agentic/reviewers.shared (canTriggerMediaForEditAccess) and
// @/lib/agentic/billing-identity.shared (resolveAgenticBillingIdentity) are left
// real: both are pure, already unit-tested on their own, and using the real
// implementations here proves the wiring, not just that a mock was called.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import { authorizeImageModelBillableActionForUser } from '@/lib/pricing/image-aware-authorize';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import {
  authorizeCurrentUserImageRegenerationBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from './pricing-enforcement';

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const finalizeBillableActionMock = vi.mocked(finalizeBillableAction);
const releaseBillableActionMock = vi.mocked(releaseBillableAction);
const authorizeImageModelBillableActionForUserMock = vi.mocked(authorizeImageModelBillableActionForUser);
const assertCanEditStoryMock = vi.mocked(assertCanEditStory);

const CALLER = 'reviewer-user-id';
const SYSTEM = 'agentic-system-user-id';
const AUTHOR = 'author-user-id';
const STRANGER = 'stranger-user-id';

function signedInAs(userId: string) {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } }, error: null }) },
  } as any);
}

function signedOut() {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  } as any);
}

function adminReturningReservation(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  createAdminClientMock.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error }),
        }),
      }),
    }),
  } as any);
}

function fakeInput() {
  return {
    actionKey: 'regenerate_image' as const,
    idempotencyKey: 'idem-1',
    relatedStoryId: 'story-1',
    relatedNodeId: 'node-1',
    storyConfig: {} as any,
    imageCount: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeImageModelBillableActionForUserMock.mockResolvedValue({
    status: 'allowed',
    mode: 'hard',
    reservationId: 'reservation-1',
    beatCost: 1,
    coinCost: 2,
    availableBeats: 10,
    availableCoins: 20,
    expiresAt: null,
  });
});

describe('authorizeCurrentUserImageRegenerationBillableAction', () => {
  it('falls back to the plain authorize call when signed out, without touching assertCanEditStory', async () => {
    signedOut();

    await authorizeCurrentUserImageRegenerationBillableAction(fakeInput());

    expect(assertCanEditStoryMock).not.toHaveBeenCalled();
    expect(authorizeImageModelBillableActionForUserMock).toHaveBeenCalledWith(null, fakeInput());
  });

  it('falls back to the plain authorize call when there is no related story yet (an unsaved session)', async () => {
    signedInAs(AUTHOR);
    const input = { ...fakeInput(), relatedStoryId: null };

    await authorizeCurrentUserImageRegenerationBillableAction(input);

    expect(assertCanEditStoryMock).not.toHaveBeenCalled();
    expect(authorizeImageModelBillableActionForUserMock).toHaveBeenCalledWith(AUTHOR, input);
  });

  it('an ordinary author on their own story: payer and entitlement are both the caller', async () => {
    signedInAs(AUTHOR);
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: 'story-1', user_id: AUTHOR, agent_persona_id: null },
      reviewer: null,
    } as any);

    await authorizeCurrentUserImageRegenerationBillableAction(fakeInput());

    expect(assertCanEditStoryMock).toHaveBeenCalledWith('story-1', AUTHOR);
    expect(authorizeImageModelBillableActionForUserMock).toHaveBeenCalledWith(AUTHOR, {
      ...fakeInput(),
      actorKind: 'user',
      entitlementUserId: AUTHOR,
    });
  });

  it('bills the agent owner, not the reviewer, on an agent draft', async () => {
    const originalSystemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
    process.env.AGENTIC_SYSTEM_USER_ID = SYSTEM;
    try {
      signedInAs(CALLER);
      assertCanEditStoryMock.mockResolvedValue({
        story: { id: 'story-1', user_id: SYSTEM, agent_persona_id: 'persona-1' },
        reviewer: { userId: CALLER, status: 'active', role: 'reviewer' },
      } as any);

      await authorizeCurrentUserImageRegenerationBillableAction(fakeInput());

      expect(authorizeImageModelBillableActionForUserMock).toHaveBeenCalledWith(SYSTEM, {
        ...fakeInput(),
        actorKind: 'agentic_system',
        entitlementUserId: CALLER,
      });
    } finally {
      if (originalSystemUserId === undefined) delete process.env.AGENTIC_SYSTEM_USER_ID;
      else process.env.AGENTIC_SYSTEM_USER_ID = originalSystemUserId;
    }
  });

  it('refuses a reviewer without media-trigger capability before reserving anything', async () => {
    signedInAs(CALLER);
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: 'story-1', user_id: SYSTEM, agent_persona_id: 'persona-1' },
      reviewer: { userId: CALLER, status: 'suspended', role: 'reviewer' },
    } as any);

    await expect(authorizeCurrentUserImageRegenerationBillableAction(fakeInput())).rejects.toThrow('Forbidden.');

    expect(authorizeImageModelBillableActionForUserMock).not.toHaveBeenCalled();
  });

  it('lets a stranger throw uncaught from assertCanEditStory, never reaching authorize', async () => {
    signedInAs(STRANGER);
    assertCanEditStoryMock.mockRejectedValue(new Error('Forbidden.'));

    await expect(authorizeCurrentUserImageRegenerationBillableAction(fakeInput())).rejects.toThrow('Forbidden.');

    expect(authorizeImageModelBillableActionForUserMock).not.toHaveBeenCalled();
  });
});

describe('finalizeCurrentUserBillableAction / releaseCurrentUserBillableAction -- payer read from the reservation', () => {
  beforeEach(() => {
    finalizeBillableActionMock.mockResolvedValue({
      reservationId: 'reservation-1',
      usageEventId: 'usage-1',
      beatCost: 1,
      coinCost: 2,
    });
    releaseBillableActionMock.mockResolvedValue({
      reservationId: 'reservation-1',
      released: true,
      finalStatus: 'released',
    });
  });

  it('throws when signed out, without ever reading a reservation', async () => {
    signedOut();

    await expect(
      finalizeCurrentUserBillableAction({ reservationId: 'reservation-1' })
    ).rejects.toThrow('You need to be signed in to finalize this paid action.');
    expect(createAdminClientMock).not.toHaveBeenCalled();

    await expect(
      releaseCurrentUserBillableAction({ reservationId: 'reservation-1', reason: 'x' })
    ).rejects.toThrow('You need to be signed in to release this paid action.');
  });

  it('throws "Reservation not found." when the admin lookup returns nothing', async () => {
    signedInAs(AUTHOR);
    adminReturningReservation(null);

    await expect(
      finalizeCurrentUserBillableAction({ reservationId: 'missing' })
    ).rejects.toThrow('Reservation not found.');
    expect(finalizeBillableActionMock).not.toHaveBeenCalled();
  });

  it('an ordinary author: assertCanEditStory\'s owner branch is a no-op, and the payer comes off the reservation', async () => {
    signedInAs(AUTHOR);
    adminReturningReservation({ id: 'reservation-1', user_id: AUTHOR, related_story_id: 'story-1' });
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: 'story-1', user_id: AUTHOR, agent_persona_id: null },
      reviewer: null,
    } as any);

    await finalizeCurrentUserBillableAction({ reservationId: 'reservation-1', storyId: 'story-1' });

    expect(assertCanEditStoryMock).toHaveBeenCalledWith('story-1', AUTHOR);
    expect(finalizeBillableActionMock).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
      storyId: 'story-1',
      userId: AUTHOR,
    });
  });

  it('a reviewer finalizing an agent draft: the agent is billed even though the reviewer pressed the button', async () => {
    signedInAs(CALLER);
    adminReturningReservation({ id: 'reservation-1', user_id: SYSTEM, related_story_id: 'story-1' });
    assertCanEditStoryMock.mockResolvedValue({
      story: { id: 'story-1', user_id: SYSTEM, agent_persona_id: 'persona-1' },
      reviewer: { userId: CALLER, status: 'active', role: 'reviewer' },
    } as any);

    await finalizeCurrentUserBillableAction({ reservationId: 'reservation-1' });

    expect(finalizeBillableActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SYSTEM })
    );

    // Same rule, same result, for release.
    await releaseCurrentUserBillableAction({ reservationId: 'reservation-1', reason: 'x' });
    expect(releaseBillableActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SYSTEM })
    );
  });

  it('refuses a caller assertCanEditStory rejects, and never finalizes or releases', async () => {
    signedInAs(STRANGER);
    adminReturningReservation({ id: 'reservation-1', user_id: SYSTEM, related_story_id: 'story-1' });
    assertCanEditStoryMock.mockRejectedValue(new Error('Forbidden.'));

    await expect(
      finalizeCurrentUserBillableAction({ reservationId: 'reservation-1' })
    ).rejects.toThrow('Forbidden.');
    expect(finalizeBillableActionMock).not.toHaveBeenCalled();

    await expect(
      releaseCurrentUserBillableAction({ reservationId: 'reservation-1', reason: 'x' })
    ).rejects.toThrow('Forbidden.');
    expect(releaseBillableActionMock).not.toHaveBeenCalled();
  });

  it('a reservation with no related story: the caller must BE its own payer (e.g. start_story, before any story row exists)', async () => {
    signedInAs(AUTHOR);
    adminReturningReservation({ id: 'reservation-1', user_id: AUTHOR, related_story_id: null });

    await finalizeCurrentUserBillableAction({ reservationId: 'reservation-1' });

    expect(assertCanEditStoryMock).not.toHaveBeenCalled();
    expect(finalizeBillableActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: AUTHOR })
    );
  });

  it('...and refuses a caller who is not that reservation\'s own payer, without ever calling assertCanEditStory', async () => {
    signedInAs(STRANGER);
    adminReturningReservation({ id: 'reservation-1', user_id: AUTHOR, related_story_id: null });

    await expect(
      finalizeCurrentUserBillableAction({ reservationId: 'reservation-1' })
    ).rejects.toThrow('Forbidden.');
    expect(assertCanEditStoryMock).not.toHaveBeenCalled();
    expect(finalizeBillableActionMock).not.toHaveBeenCalled();
  });
});
