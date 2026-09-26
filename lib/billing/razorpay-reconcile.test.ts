import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/razorpay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/razorpay')>();
  return {
    ...actual,
    fetchRazorpaySubscription: vi.fn(),
    fetchRazorpayRefund: vi.fn(),
    getRazorpayMode: vi.fn(),
  };
});

vi.mock('@/lib/billing/razorpay-sync', () => ({
  settleTopupOrder: vi.fn(),
  syncSubscriptionFromProvider: vi.fn(),
  nextSubscriptionCheckoutOrderStatus: (current: string, provider: string) =>
    ['refunded', 'partially_refunded', 'disputed'].includes(current) ? current : provider,
}));

// applyRefundOutcome/resolveRefundStatus are the real thing here (Payments Phase 6, Unit A2): the
// point of reconcilePendingRefunds is that it runs the identical tail a redelivered webhook would, so
// only processRazorpayWebhookEvent itself (the webhook-route entry point, irrelevant to the refund
// sweep) is mocked. applyRefundOutcome's own calls to recordRefund / endSubscriptionAfterFullRefund
// are mocked below, same as razorpay-webhook.test.ts does for the webhook side of the same tail.
vi.mock('@/lib/billing/razorpay-webhook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/razorpay-webhook')>();
  return {
    ...actual,
    processRazorpayWebhookEvent: vi.fn(),
  };
});

vi.mock('@/lib/billing/ledger', () => ({
  recordRefund: vi.fn(),
}));

vi.mock('@/lib/billing/subscription-refund-end', () => ({
  endSubscriptionAfterFullRefund: vi.fn(),
}));

import { getFeatureFlag } from '@/lib/ai/model-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { RazorpayConfigError, fetchRazorpayRefund, fetchRazorpaySubscription, getRazorpayMode } from '@/lib/billing/razorpay';
import { settleTopupOrder, syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import { processRazorpayWebhookEvent } from '@/lib/billing/razorpay-webhook';
import { recordRefund } from '@/lib/billing/ledger';
import { endSubscriptionAfterFullRefund } from '@/lib/billing/subscription-refund-end';
import { reconcilePendingRefunds, reconcileRazorpayBilling } from './razorpay-reconcile';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const createAdminClientMock = vi.mocked(createAdminClient);
const fetchRazorpaySubscriptionMock = vi.mocked(fetchRazorpaySubscription);
const fetchRazorpayRefundMock = vi.mocked(fetchRazorpayRefund);
const getRazorpayModeMock = vi.mocked(getRazorpayMode);
const settleTopupOrderMock = vi.mocked(settleTopupOrder);
const syncSubscriptionFromProviderMock = vi.mocked(syncSubscriptionFromProvider);
const processRazorpayWebhookEventMock = vi.mocked(processRazorpayWebhookEvent);
const recordRefundMock = vi.mocked(recordRefund);
const endSubscriptionAfterFullRefundMock = vi.mocked(endSubscriptionAfterFullRefund);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  payload?: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult, private readonly record: RecordedCall) {}
  private track(method: string, args: unknown[]) {
    this.record.filters.push({ method, args });
    return this;
  }
  eq(...args: unknown[]) { return this.track('eq', args); }
  in(...args: unknown[]) { return this.track('in', args); }
  or(...args: unknown[]) { return this.track('or', args); }
  not(...args: unknown[]) { return this.track('not', args); }
  gte(...args: unknown[]) { return this.track('gte', args); }
  lte(...args: unknown[]) { return this.track('lte', args); }
  lt(...args: unknown[]) { return this.track('lt', args); }
  is(...args: unknown[]) { return this.track('is', args); }
  order(...args: unknown[]) { return this.track('order', args); }
  limit(...args: unknown[]) { return this.track('limit', args); }
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

  function enqueue(table: string, op: RecordedCall['op'], result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: RecordedCall['op']): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`razorpay-reconcile.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const supabase = {
    from(table: string) {
      return {
        select: (..._args: unknown[]) => {
          const record: RecordedCall = { table, op: 'select', filters: [] };
          calls.push(record);
          return new FakeQueryBuilder(dequeue(table, 'select'), record);
        },
        update: (row: unknown) => {
          const record: RecordedCall = { table, op: 'update', payload: row, filters: [] };
          calls.push(record);
          return new FakeQueryBuilder(dequeue(table, 'update'), record);
        },
      };
    },
  };

  return { supabase: supabase as any, enqueue, calls };
}

function fakeTopupOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    user_id: 'user-1',
    provider: 'razorpay',
    order_type: 'topup_checkout',
    provider_checkout_session_id: null,
    provider_order_id: 'order_rzp_1',
    provider_payment_id: null,
    currency_code: 'INR',
    amount_minor: 500,
    status: 'created',
    plan_version_id: null,
    topup_pack_id: 'pack-1',
    raw_provider_payload_json: {},
    provider_mode: 'test',
    purchase_snapshot_json: { kind: 'topup', beatAmount: 50 },
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeWebhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    provider: 'razorpay',
    event_type: 'payment.captured',
    provider_event_id: 'evt_1',
    provider_account_id: null,
    status: 'failed',
    related_user_id: null,
    related_subscription_id: null,
    payload_json: { event: 'payment.captured' },
    received_at: '2026-09-01T00:00:00.000Z',
    processed_at: null,
    error_message: 'boom',
    attempt_count: 3,
    last_attempt_at: null,
    outcome: null,
    ...overrides,
  };
}

function fakeRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    subject_ref: 'user-1',
    payment_id: 'payment-1',
    provider: 'razorpay',
    provider_mode: 'test',
    provider_refund_id: 'rfnd_1',
    provider_payment_id: 'pay_1',
    amount_minor: 1180,
    net_minor: 1000,
    tax_minor: 180,
    currency_code: 'INR',
    status: 'pending',
    reason: null,
    initiated_by: 'provider',
    actor_user_ref: null,
    coin_adjustment_json: null,
    raw_payload_json: {},
    processed_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    subject_ref: 'user-1',
    user_id: 'user-1',
    provider: 'razorpay',
    provider_mode: 'test',
    provider_payment_id: 'pay_1',
    net_minor: 1000,
    tax_minor: 180,
    gross_minor: 1180,
    currency_code: 'INR',
    status: 'captured',
    kind: 'topup',
    provider_subscription_id: null,
    cycle_end: null,
    ...overrides,
  };
}

// Queues the four empty-category results (checkouts, subscriptions, topups, the topup-abandon update,
// webhooks) that every run past the flag/mode gate makes, so a test can enqueue just what it cares about
// on top.
function enqueueEmptyRun(enqueue: ReturnType<typeof createFakeSupabase>['enqueue']) {
  enqueue('billing_orders', 'select', { data: [], error: null }); // checkouts
  enqueue('billing_subscriptions', 'select', { data: [], error: null }); // subscriptions
  enqueue('billing_orders', 'select', { data: [], error: null }); // topups
  enqueue('billing_orders', 'update', { data: null, error: null }); // abandon stale top-ups
  enqueue('billing_webhook_events', 'select', { data: [], error: null }); // webhooks
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcileRazorpayBilling — gating', () => {
  it('returns zero counts and touches nothing when the flag is off', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(false);

    const result = await reconcileRazorpayBilling();

    expect(result).toEqual({ checkouts: 0, subscriptions: 0, topups: 0, webhooks: 0 });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(getRazorpayModeMock).not.toHaveBeenCalled();
  });

  it('returns zero counts and logs when the Razorpay key prefix cannot be classified', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockImplementationOnce(() => {
      throw new RazorpayConfigError('unknown_key_prefix');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reconcileRazorpayBilling();

    expect(result).toEqual({ checkouts: 0, subscriptions: 0, topups: 0, webhooks: 0 });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[razorpay.reconcile] config_error', { reason: 'unknown_key_prefix' });
    errorSpy.mockRestore();
  });
});

describe('reconcileRazorpayBilling — top-ups', () => {
  it('settles a missed top-up (no webhook ever arrived) and reports it granted', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_orders', 'select', { data: [], error: null }); // checkouts
    enqueue('billing_subscriptions', 'select', { data: [], error: null }); // subscriptions
    enqueue('billing_orders', 'select', { data: [fakeTopupOrder()], error: null }); // topups
    enqueue('billing_orders', 'update', { data: null, error: null }); // abandon stale
    enqueue('billing_webhook_events', 'select', { data: [], error: null }); // webhooks
    settleTopupOrderMock.mockResolvedValueOnce({ state: 'granted', grantedCoins: 500, paymentId: 'pay_1' });

    const result = await reconcileRazorpayBilling();

    expect(result.topups).toBe(1);
    expect(settleTopupOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ billingOrderId: 'order-1', source: 'reconcile' })
    );
    expect(settleTopupOrderMock.mock.calls[0][0]).not.toHaveProperty('paymentIdHint');
  });
});

describe('reconcileRazorpayBilling — subscription checkouts', () => {
  it('closes an abandoned checkout whose Razorpay subscription expired, without syncing a subscription', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_orders', 'select', {
      data: [fakeTopupOrder({
        order_type: 'subscription_checkout',
        provider_checkout_session_id: 'sub_1',
        plan_version_id: 'plan-version-1',
        status: 'abandoned',
      })],
      error: null,
    }); // checkouts
    enqueue('billing_subscriptions', 'select', { data: [], error: null }); // subscriptions
    enqueue('billing_orders', 'select', { data: [], error: null }); // topups
    enqueue('billing_orders', 'update', { data: null, error: null }); // close checkout, then abandon stale top-ups
    enqueue('billing_webhook_events', 'select', { data: [], error: null }); // webhooks
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce({ id: 'sub_1', status: 'expired' } as any);

    const result = await reconcileRazorpayBilling();

    expect(result.checkouts).toBe(0);
    expect(syncSubscriptionFromProviderMock).not.toHaveBeenCalled();
    const closeUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(closeUpdate?.payload).toMatchObject({ status: 'expired' });
  });
});

describe('reconcileRazorpayBilling — webhooks', () => {
  it('reprocesses a stuck failed webhook event and bumps attempt_count', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_orders', 'select', { data: [], error: null });
    enqueue('billing_subscriptions', 'select', { data: [], error: null });
    enqueue('billing_orders', 'select', { data: [], error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    enqueue('billing_webhook_events', 'select', { data: [fakeWebhookEvent({ attempt_count: 3 })], error: null });
    enqueue('billing_webhook_events', 'update', { data: null, error: null }); // reopen
    enqueue('billing_webhook_events', 'update', { data: null, error: null }); // processed result
    processRazorpayWebhookEventMock.mockResolvedValueOnce({
      status: 'processed',
      outcome: 'topup_granted',
      relatedUserId: 'user-1',
      relatedSubscriptionId: null,
    });

    const result = await reconcileRazorpayBilling();

    expect(result.webhooks).toBe(1);
    const updateCalls = calls.filter((call) => call.table === 'billing_webhook_events' && call.op === 'update');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].payload).toMatchObject({ status: 'received', attempt_count: 4 });
    expect(updateCalls[1].payload).toMatchObject({ status: 'processed', outcome: 'topup_granted', related_user_id: 'user-1' });
    expect(processRazorpayWebhookEventMock).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileRazorpayBilling — mode isolation', () => {
  it('filters checkouts, subscriptions and top-ups by the resolved provider mode', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueueEmptyRun(enqueue);

    await reconcileRazorpayBilling();

    const orderSelects = calls.filter((call) => call.table === 'billing_orders' && call.op === 'select');
    const subscriptionSelects = calls.filter((call) => call.table === 'billing_subscriptions' && call.op === 'select');
    expect(orderSelects).toHaveLength(2); // checkouts + topups
    expect(subscriptionSelects).toHaveLength(1);

    for (const call of [...orderSelects, ...subscriptionSelects]) {
      expect(
        call.filters.some((f) => f.method === 'eq' && f.args[0] === 'provider_mode' && f.args[1] === 'test')
      ).toBe(true);
    }

    // billing_webhook_events has no provider_mode column and must not be filtered by one.
    const webhookSelect = calls.find((call) => call.table === 'billing_webhook_events' && call.op === 'select');
    expect(webhookSelect?.filters.some((f) => f.args[0] === 'provider_mode')).toBe(false);
  });

  it('never calls fetchRazorpaySubscription or syncSubscriptionFromProvider when nothing is due', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('live');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueueEmptyRun(enqueue);

    const result = await reconcileRazorpayBilling();

    expect(result).toEqual({ checkouts: 0, subscriptions: 0, topups: 0, webhooks: 0 });
    expect(fetchRazorpaySubscriptionMock).not.toHaveBeenCalled();
    expect(syncSubscriptionFromProviderMock).not.toHaveBeenCalled();
  });
});

describe('reconcilePendingRefunds (Payments Phase 6, Unit A2)', () => {
  it('does nothing, and touches no table, when the flag is off', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(false);

    const result = await reconcilePendingRefunds();

    expect(result).toBe(0);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('returns zero and logs when the Razorpay key prefix cannot be classified', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockImplementationOnce(() => {
      throw new RazorpayConfigError('unknown_key_prefix');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reconcilePendingRefunds();

    expect(result).toBe(0);
    expect(createAdminClientMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('settles a pending refund Razorpay now reports processed, through the same tail the webhook uses', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', 'select', { data: [fakeRefund()], error: null });
    enqueue('billing_payments', 'select', { data: fakePayment(), error: null });
    enqueue('billing_payments', 'update', { data: null, error: null }); // payment status sync to refunded
    fetchRazorpayRefundMock.mockResolvedValueOnce({
      id: 'rfnd_1', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
    });
    recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-1' });

    const result = await reconcilePendingRefunds();

    expect(result).toBe(1);
    expect(fetchRazorpayRefundMock).toHaveBeenCalledWith('pay_1', 'rfnd_1');
    expect(recordRefundMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed', providerRefundId: 'rfnd_1', paymentId: 'payment-1' })
    );
  });

  it('records a refund Razorpay now reports failed, with no processed_at', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', 'select', { data: [fakeRefund()], error: null });
    enqueue('billing_payments', 'select', { data: fakePayment(), error: null });
    fetchRazorpayRefundMock.mockResolvedValueOnce({
      id: 'rfnd_1', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'failed',
    });
    recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-1' });

    const result = await reconcilePendingRefunds();

    expect(result).toBe(1);
    expect(recordRefundMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', processedAt: null }));
  });

  it('leaves a refund Razorpay still reports pending for the next sweep', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', 'select', { data: [fakeRefund()], error: null });
    enqueue('billing_payments', 'select', { data: fakePayment(), error: null });
    fetchRazorpayRefundMock.mockResolvedValueOnce({
      id: 'rfnd_1', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'pending',
    });

    const result = await reconcilePendingRefunds();

    expect(result).toBe(0);
    expect(recordRefundMock).not.toHaveBeenCalled();
  });

  it('skips a refund with no local payment match (an unmatched renewal refund) without calling Razorpay', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', 'select', { data: [fakeRefund({ payment_id: null })], error: null });

    const result = await reconcilePendingRefunds();

    expect(result).toBe(0);
    expect(fetchRazorpayRefundMock).not.toHaveBeenCalled();
  });

  it('logs and continues past one failing item, without throwing or losing the others', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('test');
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', 'select', {
      data: [
        fakeRefund({ id: 'refund-1', provider_refund_id: 'rfnd_1' }),
        fakeRefund({ id: 'refund-2', provider_refund_id: 'rfnd_2' }),
      ],
      error: null,
    });
    enqueue('billing_payments', 'select', { data: fakePayment(), error: null });
    enqueue('billing_payments', 'select', { data: fakePayment(), error: null });
    enqueue('billing_payments', 'update', { data: null, error: null });
    fetchRazorpayRefundMock.mockRejectedValueOnce(new Error('network blip'));
    fetchRazorpayRefundMock.mockResolvedValueOnce({
      id: 'rfnd_2', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
    });
    recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-2' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reconcilePendingRefunds();

    expect(result).toBe(1);
    errorSpy.mockRestore();
  });

  it('filters by provider_mode, pending status and the 1-hour age cutoff', async () => {
    getFeatureFlagMock.mockResolvedValueOnce(true);
    getRazorpayModeMock.mockReturnValueOnce('live');
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', 'select', { data: [], error: null });

    await reconcilePendingRefunds();

    const select = calls.find((call) => call.table === 'billing_refunds' && call.op === 'select');
    expect(select?.filters.some((f) => f.method === 'eq' && f.args[0] === 'provider_mode' && f.args[1] === 'live')).toBe(true);
    expect(select?.filters.some((f) => f.method === 'eq' && f.args[0] === 'status' && f.args[1] === 'pending')).toBe(true);
    expect(select?.filters.some((f) => f.method === 'lt' && f.args[0] === 'created_at')).toBe(true);
  });
});
