import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/billing/razorpay', () => ({
  fetchRazorpayPayment: vi.fn(),
}));

vi.mock('@/lib/billing/razorpay-sync', () => ({
  settleTopupOrder: vi.fn(),
  syncSubscriptionFromProvider: vi.fn(),
  nextSubscriptionCheckoutOrderStatus: (current: string, provider: string) =>
    ['refunded', 'partially_refunded', 'disputed'].includes(current) ? current : provider,
}));

import { fetchRazorpayPayment } from '@/lib/billing/razorpay';
import { settleTopupOrder, syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import { processRazorpayWebhookEvent, type RazorpayWebhookPayload } from './razorpay-webhook';

const fetchRazorpayPaymentMock = vi.mocked(fetchRazorpayPayment);
const settleTopupOrderMock = vi.mocked(settleTopupOrder);
const syncSubscriptionFromProviderMock = vi.mocked(syncSubscriptionFromProvider);

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  payload?: unknown;
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
      throw new Error(`razorpay-webhook.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const supabase = {
    from(table: string) {
      return {
        select: () => {
          calls.push({ table, op: 'select' });
          return new FakeQueryBuilder(dequeue(table, 'select'));
        },
        update: (row: unknown) => {
          calls.push({ table, op: 'update', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'update'));
        },
      };
    },
  };

  return { supabase: supabase as any, enqueue, calls };
}

function fakeOrder(overrides: Record<string, unknown> = {}) {
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
    purchase_snapshot_json: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('processRazorpayWebhookEvent — subscription events', () => {
  it('syncs and reports cycle_granted when coins were granted', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_subscriptions', 'select', { data: { user_id: 'user-1', plan_version_id: 'plan-version-1' }, error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ order_type: 'subscription_checkout', provider_checkout_session_id: 'sub_1' }), error: null });
    enqueue('pricing_plan_versions', 'select', { data: { id: 'plan-version-1' }, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    syncSubscriptionFromProviderMock.mockResolvedValueOnce({
      billingSubscriptionId: 'billing-sub-1',
      grantedCoins: 1000,
      firstChargeConfirmed: true,
      status: 'active',
    });

    const payload: RazorpayWebhookPayload = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'processed', outcome: 'cycle_granted', relatedUserId: 'user-1', relatedSubscriptionId: 'billing-sub-1' });
    const orderUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ status: 'active' });
  });

  it('keeps a recorded refund and the first payment id when a renewal syncs the checkout order', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_subscriptions', 'select', { data: { user_id: 'user-1', plan_version_id: 'plan-version-1' }, error: null });
    enqueue('billing_orders', 'select', {
      data: fakeOrder({
        order_type: 'subscription_checkout',
        provider_checkout_session_id: 'sub_1',
        provider_payment_id: 'pay_first',
        status: 'refunded',
      }),
      error: null,
    });
    enqueue('pricing_plan_versions', 'select', { data: { id: 'plan-version-1' }, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    syncSubscriptionFromProviderMock.mockResolvedValueOnce({
      billingSubscriptionId: 'billing-sub-1',
      grantedCoins: 1000,
      firstChargeConfirmed: true,
      status: 'active',
    });

    const payload: RazorpayWebhookPayload = {
      event: 'subscription.charged',
      payload: { subscription: { entity: { id: 'sub_1' } }, payment: { entity: { id: 'pay_renewal' } } },
    };
    await processRazorpayWebhookEvent({ supabase, payload });

    const orderUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ status: 'refunded', provider_payment_id: 'pay_first' });
  });

  it('reports subscription_synced when no coins were granted this event', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_subscriptions', 'select', { data: { user_id: 'user-1', plan_version_id: 'plan-version-1' }, error: null });
    enqueue('billing_orders', 'select', { data: null, error: null });
    enqueue('pricing_plan_versions', 'select', { data: { id: 'plan-version-1' }, error: null });
    syncSubscriptionFromProviderMock.mockResolvedValueOnce({
      billingSubscriptionId: 'billing-sub-1',
      grantedCoins: 0,
      firstChargeConfirmed: false,
      status: 'authenticated',
    });

    const payload: RazorpayWebhookPayload = { event: 'subscription.authenticated', payload: { subscription: { entity: { id: 'sub_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('subscription_synced');
  });

  it('ignores a subscription event when no user or plan can be resolved', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_orders', 'select', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_unknown' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'ignored', outcome: 'no_matching_subscription', relatedUserId: null, relatedSubscriptionId: null });
    expect(syncSubscriptionFromProviderMock).not.toHaveBeenCalled();
  });
});

describe('processRazorpayWebhookEvent — top-up success', () => {
  it('grants via settleTopupOrder and reports topup_granted', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    settleTopupOrderMock.mockResolvedValueOnce({ state: 'granted', grantedCoins: 500, paymentId: 'pay_1' });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1', order_id: 'order_rzp_1' } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'processed', outcome: 'topup_granted', relatedUserId: 'user-1', relatedSubscriptionId: null });
    expect(settleTopupOrderMock).toHaveBeenCalledWith(expect.objectContaining({ billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'webhook' }));
  });

  it('reports already_granted without a second grant', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    settleTopupOrderMock.mockResolvedValueOnce({ state: 'already_granted', grantedCoins: 0, paymentId: 'pay_1' });

    const payload: RazorpayWebhookPayload = { event: 'order.paid', payload: { order: { entity: { id: 'order_rzp_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('topup_already_granted');
  });

  it('ignores when no top-up order matches the provider order id', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'order.paid', payload: { order: { entity: { id: 'order_unknown' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'ignored', outcome: 'no_matching_order', relatedUserId: null, relatedSubscriptionId: null });
    expect(settleTopupOrderMock).not.toHaveBeenCalled();
  });
});

describe('processRazorpayWebhookEvent — payment.failed', () => {
  it('marks an unpaid top-up order failed', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'created' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_rzp_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('payment_failed_recorded');
    const update = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'failed' });
  });

  it('does not overwrite an already-paid order', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid' }), error: null });

    const payload: RazorpayWebhookPayload = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_rzp_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('payment_failed_recorded');
    expect(calls.some((call) => call.op === 'update')).toBe(false);
  });
});

describe('processRazorpayWebhookEvent — refunds', () => {
  it('marks the order refunded when the full amount was refunded', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce({
      id: 'pay_1', order_id: 'order_rzp_1', status: 'captured', amount: 500, currency: 'INR',
      amount_refunded: 500, refund_status: 'full', invoice_id: null, captured: true,
    });

    const payload: RazorpayWebhookPayload = { event: 'refund.created', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('refund_recorded');
    const update = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'refunded' });
  });

  it('marks the order partially_refunded for a partial refund', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce({
      id: 'pay_1', order_id: 'order_rzp_1', status: 'captured', amount: 500, currency: 'INR',
      amount_refunded: 200, refund_status: 'partial', invoice_id: null, captured: true,
    });

    const payload: RazorpayWebhookPayload = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    const update = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'partially_refunded' });
    expect(result.outcome).toBe('refund_recorded');
  });

  it('skips the status update for refund.failed but still records the outcome', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid', provider_payment_id: 'pay_1' }), error: null });

    const payload: RazorpayWebhookPayload = { event: 'refund.failed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('refund_recorded');
    expect(calls.some((call) => call.op === 'update')).toBe(false);
    expect(fetchRazorpayPaymentMock).not.toHaveBeenCalled();
  });

  it('reports refund_unmatched when no order carries that payment id', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'refund.created', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_unknown' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'processed', outcome: 'refund_unmatched', relatedUserId: null, relatedSubscriptionId: null });
  });
});

describe('processRazorpayWebhookEvent — disputes', () => {
  it('marks the matched order disputed', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_recorded');
    const update = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'disputed' });
  });

  it('reports dispute_unmatched when no order carries that payment id', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_unknown' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_unmatched');
  });
});

describe('processRazorpayWebhookEvent — unhandled events', () => {
  it('ignores an event type nothing here understands', async () => {
    const { supabase } = createFakeSupabase();
    const payload: RazorpayWebhookPayload = { event: 'account.updated' };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'ignored', outcome: 'unhandled_event_type', relatedUserId: null, relatedSubscriptionId: null });
  });
});
