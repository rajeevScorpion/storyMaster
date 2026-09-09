// D13/Unit 9d: the first coverage authorizeBillableAction's agentic bypass branch has
// ever had. lib/pricing/enforcement.ts:281-294 requires FOUR things before it returns
// {status: 'bypassed'}: actorKind === 'agentic_system', the agentic_billing_bypass_enabled
// flag, AGENTIC_SYSTEM_USER_ID being set, and the request's userId matching it exactly.
// These tests drop each condition one at a time and assert the bypass never fires --
// this is what makes a caller's claimed actorKind non-forgeable (D13's "what makes it
// safe" section, and the plan's "do not trust the claim" note on Unit 9d).
//
// buildPricingRuntimeContextData (lib/pricing/snapshot.ts) is mocked to a fixed,
// non-free-tier snapshot so authorizeBillableAction never takes the free-welcome-grant
// or admin-bypass branches -- those are unrelated machinery this file doesn't touch,
// and stubbing them out keeps every assertion here about the agentic bypass alone.
// createAdminClient is mocked to a generic chainable query stub so the several Supabase
// reads inside loadPricingState/loadActionCost resolve to harmless empty results.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// enforcement.ts is `import 'server-only'` -- that package throws unconditionally
// outside a Next.js server webpack build, so it must be neutralized here the same
// way Next itself neutralizes it via webpack alias during a real server build.
vi.mock('server-only', () => ({}));

// vi.mock() factories are hoisted above ordinary top-level const declarations, so the
// mock fns they close over must be created through vi.hoisted() -- a plain
// `const x = vi.fn()` above the vi.mock() calls below is still a TDZ reference error
// at the point those factories actually run.
const { getAgenticFlagsMock, buildPricingRuntimeContextDataMock } = vi.hoisted(() => ({
  getAgenticFlagsMock: vi.fn(),
  buildPricingRuntimeContextDataMock: vi.fn(),
}));

vi.mock('@/lib/agentic/flags', () => ({
  getAgenticFlags: getAgenticFlagsMock,
}));

vi.mock('@/lib/pricing/snapshot', () => ({
  buildPricingRuntimeContextData: buildPricingRuntimeContextDataMock,
}));

// A minimal chainable Supabase query-builder double: every filter/order method
// returns itself, and it resolves (directly awaited, or via .single()/.maybeSingle())
// to an empty, error-free result. Good enough for every read on the path this file
// exercises -- none of their row shapes matter once buildPricingRuntimeContextData
// is mocked above.
function makeChainableAdminClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    gt: () => chain,
    in: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject),
  };
  return { from: () => chain };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeChainableAdminClient(),
}));

import { authorizeBillableAction } from '@/lib/pricing/enforcement';

const SYSTEM_USER_ID = 'agentic-system-user-id';
const OTHER_USER_ID = 'ordinary-user-id';

describe('authorizeBillableAction -- the agentic bypass requires all four conditions', () => {
  const originalSystemUserId = process.env.AGENTIC_SYSTEM_USER_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    // Non-free plan with every other bypass-adjacent control off, so nothing but the
    // condition under test can make status 'bypassed' or short-circuit before it.
    buildPricingRuntimeContextDataMock.mockReturnValue({
      controls: {
        pricingSnapshotEnabled: false,
        pricingShadowMeteringEnabled: false,
        pricingHardEnforcementEnabled: false,
        pricingAdminBypassEnabled: false,
      },
      snapshot: {
        planKey: 'plus',
        availableTotalBeats: 100,
      },
    });
    getAgenticFlagsMock.mockResolvedValue({
      creatorEnabled: true,
      schedulerEnabled: true,
      supervisorEnabled: true,
      reviewerWorkflowEnabled: true,
      billingBypassEnabled: true,
      imageGenerationEnabled: true,
    });
    process.env.AGENTIC_SYSTEM_USER_ID = SYSTEM_USER_ID;
  });

  afterEach(() => {
    if (originalSystemUserId === undefined) delete process.env.AGENTIC_SYSTEM_USER_ID;
    else process.env.AGENTIC_SYSTEM_USER_ID = originalSystemUserId;
  });

  it('bypasses when actorKind, the flag, the env var, and userId all line up', async () => {
    const result = await authorizeBillableAction({
      userId: SYSTEM_USER_ID,
      actionKey: 'generate_story_narration',
      idempotencyKey: 'all-four-conditions',
      actorKind: 'agentic_system',
    });

    expect(result.status).toBe('bypassed');
    if (result.status === 'bypassed') {
      expect(result.reason).toBe('agentic_system');
    }
  });

  it('does NOT bypass without actorKind: "agentic_system" -- a human narration call is unchanged', async () => {
    const result = await authorizeBillableAction({
      userId: SYSTEM_USER_ID,
      actionKey: 'generate_story_narration',
      idempotencyKey: 'missing-actor-kind',
      // actorKind omitted entirely -- the shape every pre-9d narration call has.
    });

    expect(result.status).not.toBe('bypassed');
  });

  it('does NOT bypass when agentic_billing_bypass_enabled is off', async () => {
    getAgenticFlagsMock.mockResolvedValue({
      creatorEnabled: true,
      schedulerEnabled: true,
      supervisorEnabled: true,
      reviewerWorkflowEnabled: true,
      billingBypassEnabled: false,
      imageGenerationEnabled: true,
    });

    const result = await authorizeBillableAction({
      userId: SYSTEM_USER_ID,
      actionKey: 'generate_story_narration',
      idempotencyKey: 'flag-off',
      actorKind: 'agentic_system',
    });

    expect(result.status).not.toBe('bypassed');
  });

  it('does NOT bypass when AGENTIC_SYSTEM_USER_ID is unset', async () => {
    delete process.env.AGENTIC_SYSTEM_USER_ID;

    const result = await authorizeBillableAction({
      userId: SYSTEM_USER_ID,
      actionKey: 'generate_story_narration',
      idempotencyKey: 'no-system-user-env',
      actorKind: 'agentic_system',
    });

    expect(result.status).not.toBe('bypassed');
  });

  it('does NOT bypass when userId is not the system user -- the check a reviewer-stays-payer design would have failed (D13)', async () => {
    const result = await authorizeBillableAction({
      userId: OTHER_USER_ID,
      actionKey: 'generate_story_narration',
      idempotencyKey: 'wrong-user',
      actorKind: 'agentic_system',
    });

    expect(result.status).not.toBe('bypassed');
  });
});
