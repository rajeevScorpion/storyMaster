// Phase 10 Round 4 (D25): authorizeImageModelBillableActionForUser's `userId` param
// decides who gets billed AND, before this round, who the free-tier/model-tier gate
// ran against too -- the same account, always. That conflation is what made D25's fix
// impossible to express in the existing call shape: a reviewer regenerating an image
// on an agent draft needs the RESERVATION to land on the agent (free plan, no
// subscription) while the ENTITLEMENT gate stays on the reviewer's own plan, or every
// reviewer submit would be refused as tier_locked (9c plan 11.2).
//
// `entitlementUserId` (defaulting to `userId`) is the new seam that lets those two
// diverge. These tests prove the default is inert for every pre-existing caller
// (authorizeCurrentUserImageModelBillableAction, authorizeCurrentUserStoryContinuation,
// beat-bundle.ts all omit it) and that, when it IS set, entitlement/model-tier
// resolution reads it while the coin reservation itself still reads `userId`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// image-aware-authorize.ts is `import 'server-only'`, same reason as enforcement.test.ts.
vi.mock('server-only', () => ({}));

const { getPricingPolicyContextForUserMock, authorizeCoinOperationForUserMock, resolveImageModelSnapshotMock } =
  vi.hoisted(() => ({
    getPricingPolicyContextForUserMock: vi.fn(),
    authorizeCoinOperationForUserMock: vi.fn(),
    resolveImageModelSnapshotMock: vi.fn(),
  }));

vi.mock('@/lib/pricing/enforcement', () => ({
  getPricingPolicyContextForUser: getPricingPolicyContextForUserMock,
}));

vi.mock('@/lib/pricing/coin-economy', () => ({
  authorizeCoinOperationForUser: authorizeCoinOperationForUserMock,
}));

vi.mock('@/lib/ai/image-models', () => ({
  resolveImageModelSnapshot: resolveImageModelSnapshotMock,
}));

vi.mock('@/lib/ai/story-config', () => ({
  normalizeStoryConfig: (config: unknown) => config,
}));

import { authorizeImageModelBillableActionForUser } from './image-aware-authorize';

const PAYER = 'agentic-system-user-id';
const CALLER = 'reviewer-user-id';
const ORDINARY_USER = 'ordinary-user-id';

function allowedResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'allowed',
    mode: 'hard',
    reservationId: 'reservation-1',
    beatCost: 1,
    coinCost: 2,
    availableBeats: 10,
    availableCoins: 20,
    expiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveImageModelSnapshotMock.mockResolvedValue({ coinCostPerImage: 2 });
});

describe('authorizeImageModelBillableActionForUser -- entitlementUserId defaults to userId', () => {
  it('resolves entitlement/model-tier from userId when entitlementUserId is omitted (every pre-Round-4 caller)', async () => {
    getPricingPolicyContextForUserMock.mockResolvedValue({ entitlementPlanKey: 'plus' });
    authorizeCoinOperationForUserMock.mockResolvedValue(allowedResult());

    const result = await authorizeImageModelBillableActionForUser(ORDINARY_USER, {
      actionKey: 'regenerate_image',
      idempotencyKey: 'k1',
      storyConfig: { imageGenerationMode: 'model' } as any,
    });

    expect(getPricingPolicyContextForUserMock).toHaveBeenCalledWith(ORDINARY_USER);
    expect(authorizeCoinOperationForUserMock).toHaveBeenCalledTimes(1);
    expect(authorizeCoinOperationForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ORDINARY_USER, actorKind: undefined })
    );
    expect(result).toEqual(allowedResult());
  });

  it('prompt-only mode never touches entitlement and still forwards actorKind', async () => {
    authorizeCoinOperationForUserMock.mockResolvedValue(allowedResult());

    await authorizeImageModelBillableActionForUser(PAYER, {
      actionKey: 'regenerate_image',
      idempotencyKey: 'k2',
      storyConfig: { imageGenerationMode: 'prompt_only' } as any,
      actorKind: 'agentic_system',
      entitlementUserId: CALLER,
    });

    expect(getPricingPolicyContextForUserMock).not.toHaveBeenCalled();
    expect(authorizeCoinOperationForUserMock).toHaveBeenCalledTimes(1);
    expect(authorizeCoinOperationForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PAYER, actorKind: 'agentic_system' })
    );
  });
});

describe('authorizeImageModelBillableActionForUser -- Round 4 payer/entitlement split', () => {
  it('gates the free-tier check against entitlementUserId (the caller), reserves against userId (the payer), and forwards actorKind', async () => {
    getPricingPolicyContextForUserMock.mockResolvedValue({ entitlementPlanKey: 'free' });
    // First call: the zero-cost free-tier gate. Second: the real reservation.
    authorizeCoinOperationForUserMock
      .mockResolvedValueOnce(allowedResult({ mode: 'soft', reservationId: null }))
      .mockResolvedValueOnce(allowedResult({ reservationId: 'reservation-2' }));

    const result = await authorizeImageModelBillableActionForUser(PAYER, {
      actionKey: 'regenerate_image',
      idempotencyKey: 'k3',
      relatedStoryId: 'story-1',
      storyConfig: { imageGenerationMode: 'model' } as any,
      actorKind: 'agentic_system',
      entitlementUserId: CALLER,
    });

    // Entitlement/model-tier resolution reads the CALLER, never the payer -- 9c plan
    // 11.2: routing this to the agent account (free plan) would refuse a submit that
    // works today for every reviewer.
    expect(getPricingPolicyContextForUserMock).toHaveBeenCalledWith(CALLER);
    expect(authorizeCoinOperationForUserMock).toHaveBeenCalledTimes(2);
    expect(authorizeCoinOperationForUserMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userId: CALLER })
    );
    // The real reservation lands on the resolved PAYER, with actorKind riding beside
    // it so the agentic bypass in authorizeBillableAction is reachable.
    expect(authorizeCoinOperationForUserMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userId: PAYER, actorKind: 'agentic_system' })
    );
    expect(result).toEqual(allowedResult({ reservationId: 'reservation-2' }));
  });

  it('stops at a denied free-tier gate on the caller and never reaches the real reservation', async () => {
    getPricingPolicyContextForUserMock.mockResolvedValue({ entitlementPlanKey: 'free' });
    const denied = {
      status: 'denied',
      reason: 'tier_locked',
      beatCost: 0,
      coinCost: 0,
      availableBeats: 0,
      availableCoins: 0,
    };
    authorizeCoinOperationForUserMock.mockResolvedValueOnce(denied);

    const result = await authorizeImageModelBillableActionForUser(PAYER, {
      actionKey: 'regenerate_image',
      idempotencyKey: 'k4',
      storyConfig: { imageGenerationMode: 'model' } as any,
      actorKind: 'agentic_system',
      entitlementUserId: CALLER,
    });

    expect(authorizeCoinOperationForUserMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(denied);
  });
});
