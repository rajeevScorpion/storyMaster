import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
  getFeatureFlagValue: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/razorpay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/razorpay')>();
  return {
    ...actual,
    getRazorpayMode: vi.fn(() => 'test'),
    getRazorpayKeyId: vi.fn(() => 'rzp_test_key'),
    createRazorpayPlan: vi.fn(),
    createRazorpaySubscription: vi.fn(),
    createRazorpayOrder: vi.fn(),
    cancelRazorpaySubscription: vi.fn(),
  };
});

vi.mock('@/lib/billing/tax-rules', () => ({
  getPublishedTaxRule: vi.fn(),
}));

vi.mock('@/lib/billing/international', () => ({
  getInternationalCheckoutCountries: vi.fn(),
}));

vi.mock('@/lib/billing/billing-profile', async (importOriginal) => {
  // buildCustomerSnapshot (Payments Phase 5, Unit A) is left as the real, pure mapper so these tests
  // exercise the exact snapshot pricing-checkout.ts freezes into purchase_snapshot_json.customer,
  // rather than a third hand-copied version of it; only the DB-backed loadBillingProfile is stubbed.
  const actual = await importOriginal<typeof import('@/lib/billing/billing-profile')>();
  return {
    ...actual,
    loadBillingProfile: vi.fn(),
  };
});

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  cancelRazorpaySubscription,
  createRazorpayOrder,
  createRazorpayPlan,
  createRazorpaySubscription,
  type RazorpayPlan,
  type RazorpaySubscription,
} from '@/lib/billing/razorpay';
import { getPublishedTaxRule } from '@/lib/billing/tax-rules';
import { loadBillingProfile } from '@/lib/billing/billing-profile';
import { getInternationalCheckoutCountries } from '@/lib/billing/international';
import { prepareRazorpayCheckoutInternal } from './pricing-checkout';
import type { DbPricingPlan, DbPricingPlanVersion } from '@/lib/types/database';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const getFeatureFlagValueMock = vi.mocked(getFeatureFlagValue);
const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const createRazorpayPlanMock = vi.mocked(createRazorpayPlan);
const createRazorpaySubscriptionMock = vi.mocked(createRazorpaySubscription);
const createRazorpayOrderMock = vi.mocked(createRazorpayOrder);
const cancelRazorpaySubscriptionMock = vi.mocked(cancelRazorpaySubscription);
const getPublishedTaxRuleMock = vi.mocked(getPublishedTaxRule);
const loadBillingProfileMock = vi.mocked(loadBillingProfile);
const getInternationalCheckoutCountriesMock = vi.mocked(getInternationalCheckoutCountries);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  single(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function createFakeSupabase() {
  const queues: Record<string, QueryResult[]> = {};
  const rpcQueue: QueryResult[] = [];
  const calls: RecordedCall[] = [];

  function enqueue(table: string, op: string, result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function enqueueRpc(result: QueryResult) {
    rpcQueue.push(result);
  }

  function dequeue(table: string, op: string): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`pricing-checkout.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const supabase = {
    from(table: string) {
      return {
        select: (..._args: unknown[]) => {
          calls.push({ table, op: 'select' });
          return new FakeQueryBuilder(dequeue(table, 'select'));
        },
        insert: (row: unknown) => {
          calls.push({ table, op: 'insert', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'insert'));
        },
        update: (row: unknown) => {
          calls.push({ table, op: 'update', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'update'));
        },
      };
    },
    rpc: (fn: string, args: unknown) => {
      calls.push({ table: fn, op: 'rpc', payload: args });
      if (rpcQueue.length === 0) {
        throw new Error(`pricing-checkout.test: no queued rpc result for "${fn}"`);
      }
      const result = rpcQueue.length > 1 ? rpcQueue.shift()! : rpcQueue[0];
      return Promise.resolve(result);
    },
  };

  return { supabase: supabase as any, enqueue, enqueueRpc, calls };
}

function fakePlanVersion(overrides: Partial<DbPricingPlanVersion> = {}): DbPricingPlanVersion {
  return {
    id: 'plan-version-1',
    plan_id: 'plan-1',
    status: 'published',
    provider: 'razorpay',
    billing_interval: 'monthly',
    currency_code: 'INR',
    pricing_market_key: 'IN',
    price_minor: 19900,
    monthly_included_beats: 100,
    carry_forward_cap_multiplier: 2,
    story_length_cap: 10,
    grace_period_days: 5,
    provider_product_ref: null,
    provider_price_ref: 'plan_existing_ref',
    provider_price_ref_mode: 'test',
    extensions_json: {},
    published_at: null,
    published_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as DbPricingPlanVersion;
}

function fakePlan(overrides: Partial<DbPricingPlan> = {}): DbPricingPlan {
  return {
    id: 'plan-1',
    plan_key: 'pro',
    name: 'Pro',
    tier_rank: 1,
    is_active: true,
    is_public: true,
    description: null,
    feature_flags_json: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as DbPricingPlan;
}

function fakeRazorpaySubscription(overrides: Partial<RazorpaySubscription> = {}): RazorpaySubscription {
  return {
    id: 'sub_new_1',
    plan_id: 'plan_rzp_1',
    customer_id: null,
    status: 'created',
    current_start: null,
    current_end: null,
    charge_at: null,
    start_at: null,
    total_count: 1200,
    notes: {},
    ...overrides,
  };
}

function fakeRazorpayPlan(overrides: Partial<RazorpayPlan> = {}): RazorpayPlan {
  return {
    id: 'plan_rzp_new',
    period: 'monthly',
    interval: 1,
    item: { id: 'item_1', name: 'Pro Monthly', description: null, amount: 19900, currency: 'INR' },
    notes: {},
    ...overrides,
  };
}

function fakeTopupPackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pack-1',
    pack_key: 'pack_small',
    status: 'published',
    provider: 'razorpay',
    name: 'Small pack',
    currency_code: 'INR',
    pricing_market_key: 'IN',
    price_minor: 500,
    beat_amount: 50,
    provider_product_ref: null,
    provider_price_ref: null,
    extensions_json: {},
    published_at: null,
    published_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeTaxRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    marketKey: 'IN',
    appliesTo: 'all',
    taxRegime: 'in_gst',
    ratePercent: 18,
    sacCode: '998439',
    supplierStateCode: '24',
    ...overrides,
  };
}

function taxAvailable(rule: Record<string, unknown> = fakeTaxRule()) {
  getPublishedTaxRuleMock.mockResolvedValueOnce({ status: 'ok', rule } as any);
}

// Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, P7): resolveCheckoutTax now gates on
// isBillingProfileComplete, not just a declared state, so this fixture has to satisfy the full
// Personal required set (billing-profile.shared.ts's validateBillingProfile) or every tax test below
// would start failing on "Please complete your billing details" instead of exercising tax math.
function billingProfileWithState(stateCode = '24') {
  loadBillingProfileMock.mockResolvedValueOnce({
    status: 'ok',
    profile: {
      id: 'bp-1',
      user_id: 'user-1',
      legal_name: 'Jane Doe',
      billing_email: 'jane@example.com',
      phone: '+919876543210',
      company_name: null,
      gstin: null,
      state_code: stateCode,
      country_code: 'IN',
      address_line_1: null,
      address_line_2: null,
      city: 'Ahmedabad',
      postal_code: '380001',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  } as any);
}

// Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit AC): a foreign billing profile -- state
// code '96' (GST's "Foreign Country") plus a US `region` (Unit B's validateUsBillingFields requires
// it), same completeness intent as billingProfileWithState.
function billingProfileWithCountry(countryCode: string) {
  loadBillingProfileMock.mockResolvedValueOnce({
    status: 'ok',
    profile: {
      id: 'bp-2',
      user_id: 'user-1',
      legal_name: 'Jane Doe',
      billing_email: 'jane@example.com',
      phone: '+14155551234',
      company_name: null,
      gstin: null,
      state_code: '96',
      country_code: countryCode,
      region: 'CA',
      address_line_1: null,
      address_line_2: null,
      city: 'San Francisco',
      postal_code: '94103',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  } as any);
}

function signedIn() {
  createClientMock.mockResolvedValue({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'user-1', email: 'user@example.com', user_metadata: {} } }, error: null }),
    },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  // Default: migration 125 absent -- checkout charges the net, exactly as before Phase 2. Tests
  // that exercise tax charging override this with mockResolvedValueOnce.
  getPublishedTaxRuleMock.mockResolvedValue({ status: 'unavailable' });
  // Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit AC): resolveCheckoutTax now loads the
  // profile before the rule (it needs the profile's country to pick IN vs ROW), so this needs the
  // same "125 absent" default as the rule above -- in practice both come from the same migration.
  loadBillingProfileMock.mockResolvedValue({ status: 'unavailable' });
});

describe('prepareRazorpayCheckoutInternal — kill switch', () => {
  it('throws before any Razorpay call or admin client use when checkout is disabled', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(false);

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('Checkout is currently unavailable');

    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });
});

// Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner decision P6, defect 8): the gate
// runs against the REAL assertCheckoutAllowed here (only 'server-only', supabase and the Razorpay/tax
// modules are mocked above) -- proving the refusal lives inside prepareRazorpayCheckoutInternal itself,
// not only in the route that calls it.
describe('prepareRazorpayCheckoutInternal — kids and attestation gate (owner decision P6)', () => {
  it('refuses a kids viewer profile before touching auth or the database', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'kids' }
      )
    ).rejects.toThrow('Switch to an adult profile to buy.');

    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('refuses an unattested purchase before touching auth or the database', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: false, audienceMode: 'all' }
      )
    ).rejects.toThrow("Please confirm you're 18 or older and the one paying.");

    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('proceeds once attested and not a kids profile', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 500, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).resolves.toMatchObject({ kind: 'topup', internalOrderId: 'order-1' });
  });
});

// Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the named-account
// rollout, checked right after auth resolves. isCheckoutOpenForUser's own unit tests
// (checkout-allowlist.test.ts) pin the parsing/matching logic in isolation; these prove the refusal
// is wired into prepareRazorpayCheckoutInternal itself, after auth and before any catalogue read.
describe('prepareRazorpayCheckoutInternal — named-account rollout (R3)', () => {
  it('proceeds when the allowlist flag is off (today\'s behaviour)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true); // pricing_checkout_enabled
    getFeatureFlagMock.mockResolvedValueOnce(false); // billing_checkout_allowlist: off
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 500, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    await expect(
      prepareRazorpayCheckoutInternal({ kind: 'topup', topupPackId: 'pack-1' }, { adultAttested: true, audienceMode: 'all' })
    ).resolves.toMatchObject({ kind: 'topup', internalOrderId: 'order-1' });
    expect(getFeatureFlagValueMock).not.toHaveBeenCalled();
  });

  it('proceeds when the allowlist flag row is missing entirely (getFeatureFlag falls back to false, same as off)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true); // pricing_checkout_enabled
    getFeatureFlagMock.mockResolvedValueOnce(false); // billing_checkout_allowlist: no row -> getFeatureFlag's own fallback
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 500, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    await expect(
      prepareRazorpayCheckoutInternal({ kind: 'topup', topupPackId: 'pack-1' }, { adultAttested: true, audienceMode: 'all' })
    ).resolves.toMatchObject({ kind: 'topup', internalOrderId: 'order-1' });
  });

  it('proceeds when the flag is on and the signed-in user is listed', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true); // pricing_checkout_enabled
    getFeatureFlagMock.mockResolvedValueOnce(true); // billing_checkout_allowlist: on
    getFeatureFlagValueMock.mockResolvedValueOnce('user-1,someone-else');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 500, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    await expect(
      prepareRazorpayCheckoutInternal({ kind: 'topup', topupPackId: 'pack-1' }, { adultAttested: true, audienceMode: 'all' })
    ).resolves.toMatchObject({ kind: 'topup', internalOrderId: 'order-1' });
  });

  it('refuses with not_in_rollout when the flag is on and the signed-in user is not listed', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true); // pricing_checkout_enabled
    getFeatureFlagMock.mockResolvedValueOnce(true); // billing_checkout_allowlist: on
    getFeatureFlagValueMock.mockResolvedValueOnce('someone-else');

    const error = await prepareRazorpayCheckoutInternal(
      { kind: 'topup', topupPackId: 'pack-1' },
      { adultAttested: true, audienceMode: 'all' }
    ).catch((err) => err);

    expect(error).toMatchObject({
      message: "Payments aren't open yet. We'll let you know when they are.",
      code: 'not_in_rollout',
      httpStatus: 403,
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});

describe('prepareRazorpayCheckoutInternal — subscription checkout', () => {
  it('surfaces subscription_exists as the existing-subscription message', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    enqueueRpc({
      data: [{ order_id: null, reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: 'subscription_exists' }],
      error: null,
    });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('You already have a plan. To switch, cancel it in Billing.');

    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('surfaces checkout_in_progress as a distinct message', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    enqueueRpc({
      data: [{ order_id: null, reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: 'checkout_in_progress' }],
      error: null,
    });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('A checkout is already opening in another tab');

    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('returns the reused checkout without making any Razorpay calls', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    enqueueRpc({
      data: [{ order_id: 'order-existing', reused: true, provider_checkout_session_id: 'sub_existing', superseded_session_ids: [], blocked_reason: null }],
      error: null,
    });

    const result = await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(result).toMatchObject({
      kind: 'subscription',
      internalOrderId: 'order-existing',
      razorpaySubscriptionId: 'sub_existing',
      // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): the reused early return still
      // carries userPhone/reused -- tax was already resolved before the RPC call either way.
      userPhone: null,
      reused: true,
    });
    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
    expect(createRazorpayPlanMock).not.toHaveBeenCalled();
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('best-effort cancels every superseded session id and still completes checkout', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null }); // matching mode ref: no plan creation
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    enqueueRpc({
      data: [{
        order_id: 'order-new',
        reused: false,
        provider_checkout_session_id: null,
        superseded_session_ids: ['sub_old_1', 'sub_old_2'],
        blocked_reason: null,
      }],
      error: null,
    });
    cancelRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('cancel not allowed'));
    cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription({ id: 'sub_old_2', status: 'cancelled' }));
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    const result = await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledTimes(2);
    expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'sub_old_1', atCycleEnd: false });
    expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'sub_old_2', atCycleEnd: false });
    expect(result.kind).toBe('subscription');
    if (result.kind === 'subscription') {
      expect(result.razorpaySubscriptionId).toBe('sub_new_1');
    }
    const orderUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ provider_checkout_session_id: 'sub_new_1' });
  });

  it('creates a new Razorpay plan when the stored ref is from the other mode', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', {
      data: fakePlanVersion({ provider_price_ref: 'plan_live_ref', provider_price_ref_mode: 'live' }),
      error: null,
    });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    enqueueRpc({
      data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }],
      error: null,
    });
    createRazorpayPlanMock.mockResolvedValueOnce(fakeRazorpayPlan());
    enqueue('pricing_plan_versions', 'update', { data: null, error: null });
    enqueue('pricing_plan_versions', 'select', { data: { provider_price_ref: 'plan_rzp_new' }, error: null });
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(createRazorpayPlanMock).toHaveBeenCalledTimes(1);
    expect(createRazorpaySubscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan_rzp_new' })
    );
    const planUpdate = calls.find((call) => call.table === 'pricing_plan_versions' && call.op === 'update');
    expect(planUpdate?.payload).toMatchObject({ provider_price_ref: 'plan_rzp_new', provider_price_ref_mode: 'test' });
  });

  it('marks the order failed and rethrows when Razorpay subscription creation fails', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    enqueueRpc({
      data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }],
      error: null,
    });
    createRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('razorpay is down'));
    enqueue('billing_orders', 'update', { data: null, error: null });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('razorpay is down');

    const failUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(failUpdate?.payload).toMatchObject({ status: 'failed' });
  });
});

describe('prepareRazorpayCheckoutInternal — top-up checkout', () => {
  it('stores provider_mode and a purchase snapshot on the top-up order', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', {
      data: {
        id: 'pack-1',
        pack_key: 'pack_small',
        status: 'published',
        provider: 'razorpay',
        name: 'Small pack',
        currency_code: 'INR',
        pricing_market_key: 'IN',
        price_minor: 500,
        beat_amount: 50,
        provider_product_ref: null,
        provider_price_ref: null,
        extensions_json: {},
        published_at: null,
        published_by: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    });
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 500, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    const result = await prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(result).toMatchObject({
      kind: 'topup',
      internalOrderId: 'order-1',
      razorpayOrderId: 'order_rzp_1',
      // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): no billing profile in this test
      // (tax is 'unavailable'), so there is nothing to prefill Razorpay's prefill.contact with.
      userPhone: null,
      reused: false,
    });
    const insertCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      provider_mode: 'test',
      purchase_snapshot_json: expect.objectContaining({
        kind: 'topup',
        beatAmount: 50,
        providerMode: 'test',
        adultAttestedAt: expect.any(String),
      }),
    });
  });
});

describe('prepareRazorpayCheckoutInternal — top-up checkout charges tax', () => {
  it('charges the gross to Razorpay and records net/tax/gross plus subject_ref in the snapshot', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    taxAvailable();
    billingProfileWithState('24'); // same state as the rule's supplier -> intra-state
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 590, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    const result = await prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(createRazorpayOrderMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 590 }));
    expect(result).toMatchObject({ kind: 'topup', amountMinor: 590 });
    const insertCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      amount_minor: 590,
      subject_ref: 'user-1',
      purchase_snapshot_json: expect.objectContaining({
        netMinor: 500,
        taxMinor: 90,
        grossMinor: 590,
        tax: expect.objectContaining({ ruleId: 'rule-1', placeOfSupplyStateCode: '24' }),
      }),
    });
  });

  it('freezes the billing profile into the purchase snapshot as customer (Phase 5, Unit A)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 590, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    const insertCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'insert');
    const snapshot = (insertCall?.payload as any)?.purchase_snapshot_json;
    expect(snapshot?.customer).toMatchObject({
      profileType: 'personal',
      legalName: 'Jane Doe',
      stateCode: '24',
      stateName: 'Gujarat',
    });
  });

  it('refuses checkout when a tax rule is published but no billing-profile state is declared', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    // Payments Phase 8 (Unit AC): the profile now loads before the rule, and a null profile refuses
    // before the rule is ever looked up -- no taxAvailable() needed here.
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: null });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('billing details');

    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });

  it('refuses checkout when migration 125 is present but no tax rule is published', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    // Payments Phase 8 (Unit AC): resolveCheckoutTax now loads the profile before the rule, so a
    // complete profile is needed to reach the rule lookup at all.
    billingProfileWithState('24');
    getPublishedTaxRuleMock.mockResolvedValueOnce({ status: 'not_found' });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('temporarily unavailable');

    expect(loadBillingProfileMock).toHaveBeenCalled();
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });

  it('charges only the net, with no subject_ref, when migration 125 is absent', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow(), error: null });
    // beforeEach already defaults both loadBillingProfileMock and getPublishedTaxRuleMock to
    // 'unavailable' (Payments Phase 8, Unit AC: the profile now loads first).
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_1', amount: 500, currency: 'INR', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-1' }, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'topup', topupPackId: 'pack-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(createRazorpayOrderMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 500 }));
    const insertCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'insert');
    expect(insertCall?.payload).not.toHaveProperty('subject_ref');
    expect(loadBillingProfileMock).toHaveBeenCalled();
    expect(getPublishedTaxRuleMock).not.toHaveBeenCalled();
  });
});

describe('prepareRazorpayCheckoutInternal — subscription checkout charges tax', () => {
  it('creates the Razorpay plan at the gross amount and fixes up the order amount_minor', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion({ provider_price_ref: null, provider_price_ref_mode: null }), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    createRazorpayPlanMock.mockResolvedValueOnce(fakeRazorpayPlan({ id: 'plan_rzp_gross' }));
    enqueue('pricing_plan_versions', 'update', { data: null, error: null });
    enqueue('pricing_plan_versions', 'select', { data: { provider_price_ref: 'plan_rzp_gross' }, error: null });
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    // 19900 * 18% = 3582 exactly -> gross 23482.
    expect(createRazorpayPlanMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 23482 }));
    const orderUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ amount_minor: 23482, subject_ref: 'user-1' });
  });

  it('reuses the plan ref when the recorded mode and gross both match (migration 126 present)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', {
      data: fakePlanVersion({ provider_price_ref: 'plan_cached', provider_price_ref_mode: 'test', provider_price_ref_gross_minor: 23482 }),
      error: null,
    });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(createRazorpayPlanMock).not.toHaveBeenCalled();
    expect(createRazorpaySubscriptionMock).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan_cached' }));
  });

  it('creates a new plan when the mode matches but the recorded gross differs (a rate changed)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', {
      data: fakePlanVersion({ provider_price_ref: 'plan_stale', provider_price_ref_mode: 'test', provider_price_ref_gross_minor: 10000 }),
      error: null,
    });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    createRazorpayPlanMock.mockResolvedValueOnce(fakeRazorpayPlan({ id: 'plan_rzp_new_rate' }));
    enqueue('pricing_plan_versions', 'update', { data: null, error: null });
    enqueue('pricing_plan_versions', 'select', { data: { provider_price_ref: 'plan_rzp_new_rate', provider_price_ref_gross_minor: 23482 }, error: null });
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(createRazorpayPlanMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 23482 }));
    expect(createRazorpaySubscriptionMock).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan_rzp_new_rate' }));
  });

  it('refuses and marks the order failed when the re-selected plan gross does not match what was quoted', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', {
      data: fakePlanVersion({ provider_price_ref: null, provider_price_ref_mode: null, provider_price_ref_gross_minor: null }),
      error: null,
    });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    createRazorpayPlanMock.mockResolvedValueOnce(fakeRazorpayPlan({ id: 'plan_rzp_race' }));
    enqueue('pricing_plan_versions', 'update', { data: null, error: null });
    // A concurrent request's write won the race: the re-select comes back with a different gross.
    enqueue('pricing_plan_versions', 'select', { data: { provider_price_ref: 'plan_rzp_other', provider_price_ref_gross_minor: 99999 }, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('Pricing changed while preparing checkout');

    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
    const failUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(failUpdate?.payload).toMatchObject({ status: 'failed' });
  });

  it('refuses to reuse a cached plan ref, while charging tax, on a database without migration 126', async () => {
    // 125 applied without 126: the plan cache is still keyed on mode alone, so this ref was created
    // at the pre-tax net. Reusing it would have Razorpay debit the net while the order records the
    // gross -- a silent under-charge. No gross column means unverifiable, and unverifiable refuses.
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    // fakePlanVersion carries no provider_price_ref_gross_minor key at all -- 126 is absent.
    enqueue('pricing_plan_versions', 'select', {
      data: fakePlanVersion({ provider_price_ref: 'plan_pre_tax', provider_price_ref_mode: 'test' }),
      error: null,
    });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('pending a database update');

    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('still creates a fresh plan at the gross on a database without migration 126', async () => {
    // The counterpart to the test above: a plan created right now was created at the gross just
    // quoted, so there is nothing stale to guard against and checkout must not be blocked.
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', {
      data: fakePlanVersion({ provider_price_ref: null, provider_price_ref_mode: null }),
      error: null,
    });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    createRazorpayPlanMock.mockResolvedValueOnce(fakeRazorpayPlan({ id: 'plan_rzp_fresh' }));
    enqueue('pricing_plan_versions', 'update', { data: null, error: null });
    enqueue('pricing_plan_versions', 'select', { data: { provider_price_ref: 'plan_rzp_fresh' }, error: null });
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    expect(createRazorpayPlanMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 23482 }));
    expect(createRazorpaySubscriptionMock).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan_rzp_fresh' }));
  });

  it('freezes the billing profile into the subscription snapshot as customer (Phase 5, Unit A)', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, enqueueRpc, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion({ provider_price_ref: null, provider_price_ref_mode: null }), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    taxAvailable();
    billingProfileWithState('24');
    enqueueRpc({ data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }], error: null });
    createRazorpayPlanMock.mockResolvedValueOnce(fakeRazorpayPlan({ id: 'plan_rzp_gross' }));
    enqueue('pricing_plan_versions', 'update', { data: null, error: null });
    enqueue('pricing_plan_versions', 'select', { data: { provider_price_ref: 'plan_rzp_gross' }, error: null });
    createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
    enqueue('billing_orders', 'update', { data: null, error: null });

    await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

    const rpcCall = calls.find((call) => call.table === 'billing_begin_subscription_checkout');
    const snapshot = (rpcCall?.payload as any)?.p_snapshot;
    expect(snapshot?.customer).toMatchObject({ profileType: 'personal', legalName: 'Jane Doe', stateCode: '24' });
  });

  describe('customerNotify (Payments Phase 6, Unit C2, hook 7)', () => {
    function setUpFreshSubscriptionCheckout(enqueueRpc: ReturnType<typeof createFakeSupabase>['enqueueRpc'], enqueue: ReturnType<typeof createFakeSupabase>['enqueue']) {
      enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null }); // matching mode ref: no plan creation
      enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
      enqueueRpc({
        data: [{ order_id: 'order-new', reused: false, provider_checkout_session_id: null, superseded_session_ids: [], blocked_reason: null }],
        error: null,
      });
      createRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription());
      enqueue('billing_orders', 'update', { data: null, error: null });
    }

    it('is true (Razorpay sends its own emails) when billing_emails_enabled is off', async () => {
      getFeatureFlagMock.mockResolvedValueOnce(true); // pricing_checkout_enabled
      getFeatureFlagMock.mockResolvedValueOnce(false); // billing_checkout_allowlist (not restricted)
      getFeatureFlagMock.mockResolvedValueOnce(false); // billing_emails_enabled
      const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
      createAdminClientMock.mockReturnValue(supabase);
      setUpFreshSubscriptionCheckout(enqueueRpc, enqueue);

      await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

      expect(createRazorpaySubscriptionMock).toHaveBeenCalledWith(expect.objectContaining({ customerNotify: true }));
    });

    it('is false (Kissago sends its own emails) when billing_emails_enabled is on', async () => {
      getFeatureFlagMock.mockResolvedValueOnce(true); // pricing_checkout_enabled
      getFeatureFlagMock.mockResolvedValueOnce(false); // billing_checkout_allowlist (not restricted)
      getFeatureFlagMock.mockResolvedValueOnce(true); // billing_emails_enabled
      const { supabase, enqueue, enqueueRpc } = createFakeSupabase();
      createAdminClientMock.mockReturnValue(supabase);
      setUpFreshSubscriptionCheckout(enqueueRpc, enqueue);

      await prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      );

      expect(createRazorpaySubscriptionMock).toHaveBeenCalledWith(expect.objectContaining({ customerNotify: false }));
    });
  });

  it('refuses subscription checkout without a declared billing-profile state', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_plan_versions', 'select', { data: fakePlanVersion(), error: null });
    enqueue('pricing_plans', 'select', { data: fakePlan(), error: null });
    // Payments Phase 8 (Unit AC): the profile now loads before the rule, and a null profile refuses
    // before the rule is ever looked up -- no taxAvailable() needed here.
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: null });

    await expect(
      prepareRazorpayCheckoutInternal(
        { kind: 'subscription', planVersionId: 'plan-version-1' },
        { adultAttested: true, audienceMode: 'all' }
      )
    ).rejects.toThrow('billing details');

    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });
});

// Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit AC): the provider guard (G1) and the
// market-country consistency rule, wired into prepareRazorpayCheckoutInternal itself.
describe('prepareRazorpayCheckoutInternal — provider and country guard (Payments Phase 8, Unit AC)', () => {
  it('refuses a stripe-tagged item and never calls Razorpay', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPackRow({ provider: 'stripe' }), error: null });

    const error = await prepareRazorpayCheckoutInternal(
      { kind: 'topup', topupPackId: 'pack-1' },
      { adultAttested: true, audienceMode: 'all' }
    ).catch((err) => err);

    expect(error).toMatchObject({
      message: "This item can't be bought here yet.",
      code: 'provider_unavailable',
      httpStatus: 400,
    });
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });

  it('refuses an India profile buying a ROW item', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', {
      data: fakeTopupPackRow({ pricing_market_key: 'ROW', currency_code: 'USD' }),
      error: null,
    });
    billingProfileWithState('24'); // country_code 'IN'
    getInternationalCheckoutCountriesMock.mockResolvedValueOnce(['US']);

    const error = await prepareRazorpayCheckoutInternal(
      { kind: 'topup', topupPackId: 'pack-1' },
      { adultAttested: true, audienceMode: 'all' }
    ).catch((err) => err);

    expect(error).toMatchObject({ code: 'market_country_mismatch' });
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });

  it("refuses a US profile when the countries flag is off (empty list)", async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', {
      data: fakeTopupPackRow({ pricing_market_key: 'ROW', currency_code: 'USD' }),
      error: null,
    });
    billingProfileWithCountry('US');
    getInternationalCheckoutCountriesMock.mockResolvedValueOnce([]); // flag off

    const error = await prepareRazorpayCheckoutInternal(
      { kind: 'topup', topupPackId: 'pack-1' },
      { adultAttested: true, audienceMode: 'all' }
    ).catch((err) => err);

    expect(error).toMatchObject({ code: 'country_not_supported' });
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });

  it('charges a US profile the zero-rated export price once the countries flag lists it', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('pricing_topup_packs', 'select', {
      data: fakeTopupPackRow({ pricing_market_key: 'ROW', currency_code: 'USD', price_minor: 2900 }),
      error: null,
    });
    billingProfileWithCountry('US');
    getInternationalCheckoutCountriesMock.mockResolvedValueOnce(['US']);
    getPublishedTaxRuleMock.mockResolvedValueOnce({
      status: 'ok',
      rule: { id: 'rule-row', marketKey: 'ROW', appliesTo: 'all', taxRegime: 'in_export_lut', ratePercent: 0, sacCode: '998439', supplierStateCode: '24' },
    } as any);
    createRazorpayOrderMock.mockResolvedValueOnce({ id: 'order_rzp_row', amount: 2900, currency: 'USD', receipt: null, status: 'created', notes: {} });
    enqueue('billing_orders', 'insert', { data: { id: 'order-row-1' }, error: null });

    const result = await prepareRazorpayCheckoutInternal(
      { kind: 'topup', topupPackId: 'pack-1' },
      { adultAttested: true, audienceMode: 'all' }
    );

    expect(getPublishedTaxRuleMock).toHaveBeenCalledWith('ROW', 'topup');
    expect(result).toMatchObject({ kind: 'topup', amountMinor: 2900 });
    const insertCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      purchase_snapshot_json: expect.objectContaining({ netMinor: 2900, taxMinor: 0, grossMinor: 2900 }),
    });
  });
});
