// D13/Unit 9d: the first coverage authorizeCoinOperationForUser has ever had.
//
// The plan's §1.4 identifies this file's authorizeBillableAction call (hop 5) as the
// single defect in the whole billing chain: without an `actorKind` key on that object
// literal, the agentic bypass is structurally unreachable no matter what a caller
// further up the chain (narration-batch.ts, story-narration.ts, narration.ts) claims.
// This test proves the key is there and is forwarded verbatim.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// coin-economy.ts (like enforcement.ts) is `import 'server-only'` -- that package
// throws unconditionally outside a Next.js server webpack build (it has no idea
// vitest's plain-node environment is safe), so it must be neutralized here the same
// way Next itself neutralizes it via webpack alias during a real server build.
vi.mock('server-only', () => ({}));

// vi.mock() factories are hoisted above ordinary top-level const declarations, so
// the mock fns they close over must be created through vi.hoisted() -- a plain
// `const x = vi.fn()` above the vi.mock() calls below is still a TDZ reference error
// at the point those factories actually run.
const { authorizeBillableActionMock, getPricingPolicyContextForUserMock, releaseBillableActionMock } = vi.hoisted(() => ({
  authorizeBillableActionMock: vi.fn(),
  getPricingPolicyContextForUserMock: vi.fn(),
  releaseBillableActionMock: vi.fn(),
}));

vi.mock('@/lib/pricing/enforcement', () => ({
  authorizeBillableAction: authorizeBillableActionMock,
  getPricingPolicyContextForUser: getPricingPolicyContextForUserMock,
  releaseBillableAction: releaseBillableActionMock,
}));

vi.mock('@/lib/admin/user-moderation', () => ({
  getEffectiveUserModeration: vi.fn().mockResolvedValue({
    status: 'active',
    suspendedUntil: null,
    reason: null,
  }),
}));

// Never actually invoked by the paths exercised below (both return statuses that
// skip the beat_spend_reservation_components upsert), but coin-economy.ts imports
// it at module scope, so it is mocked defensively rather than left to the real
// implementation, which would throw on missing service-role env vars.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { authorizeCoinOperationForUser } from '@/lib/pricing/coin-economy';

const SYSTEM_USER_ID = 'agentic-system-user-id';

describe('authorizeCoinOperationForUser -- actorKind forwarding (D13/Unit 9d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPricingPolicyContextForUserMock.mockResolvedValue({
      planKey: 'free',
      entitlementPlanKey: 'free',
      availableBeats: 5,
      actionCosts: [],
    });
  });

  it('forwards actorKind: "agentic_system" through to authorizeBillableAction', async () => {
    authorizeBillableActionMock.mockResolvedValue({
      status: 'bypassed',
      reason: 'agentic_system',
      beatCost: 0.5,
      coinCost: 1,
    });

    const result = await authorizeCoinOperationForUser({
      userId: SYSTEM_USER_ID,
      actorKind: 'agentic_system',
      operationKey: 'generate_story_narration',
      idempotencyKey: 'test-key-1',
      components: [{ meterKey: 'generate_story_narration' }],
    });

    expect(result.status).toBe('bypassed');
    expect(authorizeBillableActionMock).toHaveBeenCalledTimes(1);
    expect(authorizeBillableActionMock.mock.calls[0][0]).toMatchObject({
      userId: SYSTEM_USER_ID,
      actorKind: 'agentic_system',
      actionKey: 'generate_story_narration',
    });
  });

  it('an ordinary human/owner call (no actorKind) is byte-for-byte unchanged: authorizeBillableAction receives actorKind: undefined', async () => {
    authorizeBillableActionMock.mockResolvedValue({
      status: 'allowed',
      mode: 'soft',
      reservationId: null,
      beatCost: 0,
      coinCost: 0,
      availableBeats: 5,
      availableCoins: 10,
      expiresAt: null,
    });

    await authorizeCoinOperationForUser({
      userId: 'ordinary-user-id',
      operationKey: 'generate_story_narration',
      idempotencyKey: 'test-key-2',
      components: [{ meterKey: 'generate_story_narration' }],
    });

    expect(authorizeBillableActionMock).toHaveBeenCalledTimes(1);
    expect(authorizeBillableActionMock.mock.calls[0][0].actorKind).toBeUndefined();
    expect(authorizeBillableActionMock.mock.calls[0][0].userId).toBe('ordinary-user-id');
  });
});
