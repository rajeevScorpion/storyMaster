import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
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

import { getFeatureFlag } from '@/lib/ai/model-config';
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
import { prepareRazorpayCheckoutInternal } from './pricing-checkout';
import type { DbPricingPlan, DbPricingPlanVersion } from '@/lib/types/database';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const createRazorpayPlanMock = vi.mocked(createRazorpayPlan);
const createRazorpaySubscriptionMock = vi.mocked(createRazorpaySubscription);
const createRazorpayOrderMock = vi.mocked(createRazorpayOrder);
const cancelRazorpaySubscriptionMock = vi.mocked(cancelRazorpaySubscription);

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
});

describe('prepareRazorpayCheckoutInternal — kill switch', () => {
  it('throws before any Razorpay call or admin client use when checkout is disabled', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(false);

    await expect(
      prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' })
    ).rejects.toThrow('Checkout is currently unavailable');

    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(createRazorpaySubscriptionMock).not.toHaveBeenCalled();
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
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
      prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' })
    ).rejects.toThrow('already have a Razorpay subscription in progress');

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
      prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' })
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

    const result = await prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' });

    expect(result).toMatchObject({
      kind: 'subscription',
      internalOrderId: 'order-existing',
      razorpaySubscriptionId: 'sub_existing',
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

    const result = await prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' });

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

    await prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' });

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
      prepareRazorpayCheckoutInternal({ kind: 'subscription', planVersionId: 'plan-version-1' })
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

    const result = await prepareRazorpayCheckoutInternal({ kind: 'topup', topupPackId: 'pack-1' });

    expect(result).toMatchObject({ kind: 'topup', internalOrderId: 'order-1', razorpayOrderId: 'order_rzp_1' });
    const insertCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      provider_mode: 'test',
      purchase_snapshot_json: expect.objectContaining({ kind: 'topup', beatAmount: 50, providerMode: 'test' }),
    });
  });
});
