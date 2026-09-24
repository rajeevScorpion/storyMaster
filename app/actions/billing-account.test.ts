import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/viewer-profile', () => ({
  resolveActiveViewerProfile: vi.fn(),
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

vi.mock('@/lib/billing/razorpay-sync', () => ({
  syncSubscriptionFromProvider: vi.fn(),
}));

vi.mock('@/lib/billing/tax-rules', () => ({
  getPublishedTaxRule: vi.fn(),
}));

vi.mock('@/lib/billing/billing-profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/billing-profile')>();
  return {
    ...actual,
    loadBillingProfile: vi.fn(),
  };
});

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { cancelRazorpaySubscription, getRazorpayMode } from '@/lib/billing/razorpay';
import { syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import { cancelMySubscription } from './billing-account';

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const cancelRazorpaySubscriptionMock = vi.mocked(cancelRazorpaySubscription);
const getRazorpayModeMock = vi.mocked(getRazorpayMode);
const syncSubscriptionFromProviderMock = vi.mocked(syncSubscriptionFromProvider);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  eq: [string, unknown][];
  payload?: unknown;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult, private readonly call: RecordedCall) {}
  select() { return this; }
  eq(column: string, value: unknown) {
    this.call.eq.push([column, value]);
    return this;
  }
  in() { return this; }
  order() { return this; }
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
  const calls: RecordedCall[] = [];

  function enqueue(table: string, op: 'select' | 'update', result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: 'select' | 'update'): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`billing-account.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const supabase = {
    from(table: string) {
      return {
        select: () => {
          const call: RecordedCall = { table, op: 'select', eq: [] };
          calls.push(call);
          return new FakeQueryBuilder(dequeue(table, 'select'), call);
        },
        update: (row: unknown) => {
          const call: RecordedCall = { table, op: 'update', eq: [], payload: row };
          calls.push(call);
          return new FakeQueryBuilder(dequeue(table, 'update'), call);
        },
      };
    },
  };

  return { supabase: supabase as any, enqueue, calls };
}

const USER_ID = 'user-1';

function fakeSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-row-1',
    provider_subscription_id: 'sub_1',
    provider_mode: 'test',
    plan_version_id: 'plan-version-1',
    current_period_end: '2026-10-24T00:00:00.000Z',
    cancel_at_period_end: false,
    ...overrides,
  };
}

function fakeRazorpaySubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1', plan_id: 'plan_rzp_1', customer_id: 'cust_1', status: 'active',
    current_start: null, current_end: null, charge_at: null, start_at: null, total_count: 1200,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
  } as any);
  getRazorpayModeMock.mockReturnValue('test');
});

describe('cancelMySubscription', () => {
  it('gives an error when there is no live subscription to cancel', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [], error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await cancelMySubscription();

    expect(result).toEqual({ ok: false, error: "There's no active plan to cancel." });
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('filters the subscription lookup on the signed-in user, never on anything client-supplied', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [], error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await cancelMySubscription();

    const lookup = fake.calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'select');
    expect(lookup?.eq).toContainEqual(['user_id', USER_ID]);
  });

  it('makes no provider call when cancel_at_period_end is already true', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [fakeSubscriptionRow({ cancel_at_period_end: true })], error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await cancelMySubscription();

    expect(result).toEqual({ ok: true, endsAt: '2026-10-24T00:00:00.000Z', alreadyApplied: true });
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
    // Only the one lookup -- no marker write, no re-sync, nothing else touched billing_subscriptions.
    expect(fake.calls.filter((call) => call.table === 'billing_subscriptions')).toHaveLength(1);
  });

  it('calls the provider with atCycleEnd: true, a literal never derived from input', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [fakeSubscriptionRow()], error: null });
    fake.enqueue('billing_subscriptions', 'update', { data: null, error: null });
    fake.enqueue('pricing_plan_versions', 'select', { data: { id: 'plan-version-1' }, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);
    cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeRazorpaySubscription() as any);
    syncSubscriptionFromProviderMock.mockResolvedValueOnce({} as any);

    const result = await cancelMySubscription();

    expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'sub_1', atCycleEnd: true });
    expect(result).toEqual({ ok: true, endsAt: '2026-10-24T00:00:00.000Z', alreadyApplied: false });
    const markerUpdate = fake.calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'update');
    expect(markerUpdate?.payload).toMatchObject({ cancel_at_period_end: true, cancel_requested_by: 'user' });
    expect((markerUpdate?.payload as any)?.cancel_requested_at).toEqual(expect.any(String));
  });

  it('a provider throw followed by a raced marker write reports alreadyApplied', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [fakeSubscriptionRow()], error: null });
    // The recheck after the throw finds the marker already set (a concurrent request won the race).
    fake.enqueue('billing_subscriptions', 'select', {
      data: { cancel_at_period_end: true, current_period_end: '2026-10-24T00:00:00.000Z' },
      error: null,
    });
    createAdminClientMock.mockReturnValue(fake.supabase);
    cancelRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('Razorpay request failed: bad_request_error'));

    const result = await cancelMySubscription();

    expect(result).toEqual({ ok: true, endsAt: '2026-10-24T00:00:00.000Z', alreadyApplied: true });
  });

  it('a provider throw with no raced marker gives the generic sentence, never the provider text', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [fakeSubscriptionRow()], error: null });
    fake.enqueue('billing_subscriptions', 'select', {
      data: { cancel_at_period_end: false, current_period_end: '2026-10-24T00:00:00.000Z' },
      error: null,
    });
    createAdminClientMock.mockReturnValue(fake.supabase);
    cancelRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('Razorpay request failed: some internal provider detail'));

    const result = await cancelMySubscription();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("We couldn't cancel your plan right now. Nothing has changed. Please try again.");
      expect(result.error).not.toMatch(/razorpay/i);
      expect(result.error).not.toMatch(/provider detail/i);
    }
  });

  it('ignores a subscription row from a different provider mode', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_subscriptions', 'select', { data: [fakeSubscriptionRow({ provider_mode: 'live' })], error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await cancelMySubscription();

    expect(result).toEqual({ ok: false, error: "There's no active plan to cancel." });
  });
});
