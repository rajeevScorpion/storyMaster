import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/pricing/enforcement', () => ({
  ensureFreeWelcomeGrantForUser: vi.fn(),
  expireStaleReservations: vi.fn(async () => 0),
  isAdminUserId: vi.fn(() => false),
  loadCachedPricingGlobals: vi.fn(),
  loadEntitlementOverridePlanKey: vi.fn(async () => null),
}));

vi.mock('@/lib/agentic/reviewers', () => ({
  resolveMyReviewerStanding: vi.fn(async () => null),
}));

vi.mock('@/lib/pricing/runtime-context-cache', () => ({
  buildPricingRuntimeCacheKey: vi.fn(() => 'cache-key'),
  // Cache always misses -- this test file is about what getPricingRuntimeContext *builds*, not
  // about the cache layer, which has no bearing on the allowlist override.
  getCachedPricingRuntimeContext: vi.fn(() => null),
  setCachedPricingRuntimeContext: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

vi.mock('@/lib/billing/checkout-allowlist', () => ({
  isCheckoutOpenForUser: vi.fn(),
}));

vi.mock('@/lib/billing/billing-profile', () => ({
  loadBillingProfile: vi.fn(),
  toBillingProfileDTO: vi.fn(),
  buildCustomerSnapshot: vi.fn(),
}));

vi.mock('@/lib/billing/tax-rules', () => ({
  getPublishedTaxRule: vi.fn(),
}));

vi.mock('@/lib/viewer-profile', () => ({
  resolveActiveViewerProfile: vi.fn(),
}));

import {
  loadCachedPricingGlobals,
  expireStaleReservations,
  isAdminUserId,
} from '@/lib/pricing/enforcement';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isCheckoutOpenForUser } from '@/lib/billing/checkout-allowlist';
import { getPricingRuntimeContext } from './pricing-runtime';

/**
 * Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): getPricingRuntimeContext
 * is the one place `controls.pricingCheckoutEnabled` is built for every client that reads it
 * (WalletPage's usePricingRuntime() hook, and -- via app/plans/page.tsx's initial props -- the plans
 * comparison too). These tests pin the override: `global && isCheckoutOpenForUser(userId)`, with
 * the global flag short-circuiting the allowlist read when it's already off.
 *
 * lib/pricing/snapshot.ts's buildPricingRuntimeContextData is deliberately left un-mocked -- it's the
 * "shared, non-per-user pricing snapshot" the execution spec says must not change, and the point of
 * this test is to prove the override happens on a copy *after* that function runs, not inside it.
 */

const loadCachedPricingGlobalsMock = vi.mocked(loadCachedPricingGlobals);
const expireStaleReservationsMock = vi.mocked(expireStaleReservations);
const isAdminUserIdMock = vi.mocked(isAdminUserId);
const createAdminClientMock = vi.mocked(createAdminClient);
const createClientMock = vi.mocked(createClient);
const isCheckoutOpenForUserMock = vi.mocked(isCheckoutOpenForUser);

function fakeGlobals(checkoutGloballyEnabled: boolean) {
  return {
    plans: [],
    planVersions: [],
    featureFlags: [
      { flag_key: 'pricing_checkout_enabled', enabled: checkoutGloballyEnabled, value: null },
    ],
    actionCosts: [],
  };
}

function fakeAdminClientForUser() {
  // A minimal chainable stub for the four parallel selects getPricingRuntimeContext issues when a
  // userId is present (billing_customers, billing_subscriptions, beat_grants, beat_spend_reservations).
  const builder: any = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.gt = () => builder;
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
  return { from: () => builder };
}

function signedOut() {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  } as any);
}

function signedInAs(userId: string) {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } }, error: null }) },
  } as any);
  createAdminClientMock.mockReturnValue(fakeAdminClientForUser() as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  expireStaleReservationsMock.mockResolvedValue(0);
  isAdminUserIdMock.mockReturnValue(false);
});

describe('getPricingRuntimeContext — controls.pricingCheckoutEnabled (Payments Phase 7, Unit B2)', () => {
  it('is true for a signed-out visitor when the global flag is on and the allowlist is open', async () => {
    signedOut();
    loadCachedPricingGlobalsMock.mockResolvedValue(fakeGlobals(true) as any);
    isCheckoutOpenForUserMock.mockResolvedValue(true);

    const context = await getPricingRuntimeContext();

    expect(context.controls.pricingCheckoutEnabled).toBe(true);
    expect(isCheckoutOpenForUserMock).toHaveBeenCalledWith(null);
  });

  it('is false for a signed-out visitor when the allowlist is on and closed', async () => {
    signedOut();
    loadCachedPricingGlobalsMock.mockResolvedValue(fakeGlobals(true) as any);
    isCheckoutOpenForUserMock.mockResolvedValue(false);

    const context = await getPricingRuntimeContext();

    expect(context.controls.pricingCheckoutEnabled).toBe(false);
  });

  it('is false when the global kill switch is off, and never even reads the allowlist', async () => {
    signedOut();
    loadCachedPricingGlobalsMock.mockResolvedValue(fakeGlobals(false) as any);

    const context = await getPricingRuntimeContext();

    expect(context.controls.pricingCheckoutEnabled).toBe(false);
    expect(isCheckoutOpenForUserMock).not.toHaveBeenCalled();
  });

  it('passes the signed-in userId through to isCheckoutOpenForUser', async () => {
    signedInAs('user-1');
    loadCachedPricingGlobalsMock.mockResolvedValue(fakeGlobals(true) as any);
    isCheckoutOpenForUserMock.mockResolvedValue(true);

    const context = await getPricingRuntimeContext();

    expect(context.userId).toBe('user-1');
    expect(context.controls.pricingCheckoutEnabled).toBe(true);
    expect(isCheckoutOpenForUserMock).toHaveBeenCalledWith('user-1');
  });

  it('is false for a signed-in, unlisted user when the flag is on', async () => {
    signedInAs('user-2');
    loadCachedPricingGlobalsMock.mockResolvedValue(fakeGlobals(true) as any);
    isCheckoutOpenForUserMock.mockResolvedValue(false);

    const context = await getPricingRuntimeContext();

    expect(context.controls.pricingCheckoutEnabled).toBe(false);
  });

  it('never mutates the globals object shared across requests (the non-per-user snapshot)', async () => {
    signedOut();
    const globals = fakeGlobals(true);
    loadCachedPricingGlobalsMock.mockResolvedValue(globals as any);
    isCheckoutOpenForUserMock.mockResolvedValue(false);

    await getPricingRuntimeContext();

    // The raw feature-flag row this whole process shares is untouched -- only the per-request
    // `controls` object built from it was overridden.
    expect(globals.featureFlags[0]).toEqual({ flag_key: 'pricing_checkout_enabled', enabled: true, value: null });
  });
});
