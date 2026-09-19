import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/billing/razorpay', () => ({
  fetchRazorpayPayment: vi.fn(),
  getRazorpayMode: vi.fn(() => 'test'),
}));

vi.mock('@/lib/billing/razorpay-sync', () => ({
  settleTopupOrder: vi.fn(),
  syncSubscriptionFromProvider: vi.fn(),
  nextSubscriptionCheckoutOrderStatus: (current: string, provider: string) =>
    ['refunded', 'partially_refunded', 'disputed'].includes(current) ? current : provider,
}));

vi.mock('@/lib/billing/ledger', () => ({
  recordRefund: vi.fn(),
  recordDispute: vi.fn(),
}));

import { fetchRazorpayPayment, getRazorpayMode } from '@/lib/billing/razorpay';
import { settleTopupOrder, syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import { recordDispute, recordRefund } from '@/lib/billing/ledger';
import { processRazorpayWebhookEvent, type RazorpayWebhookPayload } from './razorpay-webhook';

const fetchRazorpayPaymentMock = vi.mocked(fetchRazorpayPayment);
const getRazorpayModeMock = vi.mocked(getRazorpayMode);
const settleTopupOrderMock = vi.mocked(settleTopupOrder);
const syncSubscriptionFromProviderMock = vi.mocked(syncSubscriptionFromProvider);
const recordRefundMock = vi.mocked(recordRefund);
const recordDisputeMock = vi.mocked(recordDispute);

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

function fakeLedgerPayment(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

describe('processRazorpayWebhookEvent — refunds', () => {
  it('marks the order refunded when the full amount was refunded (no ledger payment matched)', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: null, error: null });
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
    expect(recordRefundMock).not.toHaveBeenCalled();
  });

  it('marks the order partially_refunded for a partial refund', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: null, error: null });
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
    enqueue('billing_payments', 'select', { data: null, error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid', provider_payment_id: 'pay_1' }), error: null });

    const payload: RazorpayWebhookPayload = { event: 'refund.failed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('refund_recorded');
    expect(calls.some((call) => call.op === 'update')).toBe(false);
    expect(fetchRazorpayPaymentMock).not.toHaveBeenCalled();
  });

  it('reports refund_unmatched when neither an order nor a ledger payment carries that payment id', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: null, error: null });
    enqueue('billing_orders', 'select', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'refund.created', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_unknown' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result).toEqual({ status: 'processed', outcome: 'refund_unmatched', relatedUserId: null, relatedSubscriptionId: null });
  });

  describe('matched through billing_payments (Payments Phase 2, Unit B — a renewal refund)', () => {
    it('writes a refund row split proportionally off the original payment, even with no billing_orders row at all', async () => {
      const { supabase, enqueue } = createFakeSupabase();
      enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
      enqueue('billing_orders', 'select', { data: null, error: null }); // a renewal never had an order row
      enqueue('billing_payments', 'update', { data: null, error: null }); // status sync to refunded
      fetchRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'pay_1', order_id: null, status: 'captured', amount: 1180, currency: 'INR',
        amount_refunded: 1180, refund_status: 'full', invoice_id: null, captured: true,
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-1' });

      const payload: RazorpayWebhookPayload = {
        event: 'refund.created',
        payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 1180 } } },
      };
      const result = await processRazorpayWebhookEvent({ supabase, payload });

      expect(result.outcome).toBe('refund_recorded');
      expect(recordRefundMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectRef: 'user-1',
          paymentId: 'payment-1',
          providerRefundId: 'rfnd_1',
          amountMinor: 1180,
          netMinor: 1000,
          taxMinor: 180,
          status: 'processed',
          initiatedBy: 'provider',
        })
      );
    });

    it('marks the payment refunded on the second of two half refunds, not partially_refunded', async () => {
      // The second event's own amount is only half the payment. Judging by it alone would leave the
      // ledger saying partially_refunded while billing_orders -- which uses Razorpay's cumulative
      // amount_refunded -- says refunded, and the two are meant to be the same fact.
      const { supabase, enqueue, calls } = createFakeSupabase();
      enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
      enqueue('billing_orders', 'select', { data: null, error: null });
      enqueue('billing_payments', 'update', { data: null, error: null });
      fetchRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'pay_1', order_id: null, status: 'captured', amount: 1180, currency: 'INR',
        amount_refunded: 1180, refund_status: 'full', invoice_id: null, captured: true,
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-2' });

      const payload: RazorpayWebhookPayload = {
        event: 'refund.created',
        payload: { refund: { entity: { id: 'rfnd_2', payment_id: 'pay_1', amount: 590 } } },
      };
      await processRazorpayWebhookEvent({ supabase, payload });

      // This refund row still records only its own 590...
      expect(recordRefundMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 590 }));
      // ...but the payment it belongs to is now fully refunded.
      const paymentUpdate = calls.find((call) => call.table === 'billing_payments' && call.op === 'update');
      expect(paymentUpdate?.payload).toMatchObject({ status: 'refunded' });
    });

    it('falls back to the provider payment total_refunded when the webhook payload carries no amount', async () => {
      const { supabase, enqueue } = createFakeSupabase();
      enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
      enqueue('billing_orders', 'select', { data: null, error: null });
      enqueue('billing_payments', 'update', { data: null, error: null });
      fetchRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'pay_1', order_id: null, status: 'captured', amount: 1180, currency: 'INR',
        amount_refunded: 590, refund_status: 'partial', invoice_id: null, captured: true,
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-1' });

      const payload: RazorpayWebhookPayload = {
        event: 'refund.created',
        payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } },
      };
      await processRazorpayWebhookEvent({ supabase, payload });

      expect(recordRefundMock).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 590 }));
    });
  });
});

describe('processRazorpayWebhookEvent \u2014 disputes', () => {
  // Razorpay debits the merchant only when a dispute is LOST
  // (docs/payments/research/06-razorpay-capabilities.md section 4). Every dispute event used to be
  // handled identically, so a dispute the merchant won left the payment `disputed` and its
  // billing_refunds row `pending` for good, in a record kept eight years. These cover each way out.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The settled-dispute probe the open path runs before it writes anything. */
  function noDisputeRecorded(
    enqueue: (t: string, op: 'select' | 'update', r: { data?: unknown; error?: { message: string } | null }) => void
  ) {
    enqueue('billing_refunds', 'select', { data: null, error: null });
  }

  it('marks the matched order disputed (no ledger payment matched)', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: null, error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'paid', provider_payment_id: 'pay_1' }), error: null });
    noDisputeRecorded(enqueue);
    enqueue('billing_orders', 'update', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_recorded');
    const update = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'disputed' });
    expect(recordDisputeMock).not.toHaveBeenCalled();
  });

  it('reports dispute_unmatched when neither an order nor a ledger payment carries that payment id', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: null, error: null });
    enqueue('billing_orders', 'select', { data: null, error: null });

    const payload: RazorpayWebhookPayload = { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_unknown' } } } };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_unmatched');
  });

  it('records a dispute matched through billing_payments and marks the payment disputed', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
    enqueue('billing_orders', 'select', { data: null, error: null });
    noDisputeRecorded(enqueue);
    enqueue('billing_payments', 'update', { data: null, error: null });
    recordDisputeMock.mockResolvedValueOnce({ state: 'inserted', id: 'dispute-1' });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.created',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 1180 } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_recorded');
    expect(recordDisputeMock).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'payment-1', providerRefundId: 'disp_1', amountMinor: 1180, netMinor: 1000, taxMinor: 180, status: 'pending' })
    );
  });

  it('settles a lost dispute as a processed reversal and marks the payment refunded', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'disputed', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    enqueue('billing_payments', 'update', { data: null, error: null });
    recordDisputeMock.mockResolvedValueOnce({ state: 'already_recorded', id: 'dispute-1' });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.lost',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 1180, status: 'lost' } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_lost');
    expect(calls.find((c) => c.table === 'billing_orders' && c.op === 'update')?.payload).toMatchObject({ status: 'refunded' });
    expect(calls.find((c) => c.table === 'billing_payments' && c.op === 'update')?.payload).toMatchObject({ status: 'refunded' });
    expect(recordDisputeMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed', processedAt: expect.any(String) })
    );
  });

  it('sizes a lost dispute that covers less than the whole payment as partially refunded', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'disputed', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    enqueue('billing_payments', 'update', { data: null, error: null });
    recordDisputeMock.mockResolvedValueOnce({ state: 'inserted', id: 'dispute-1' });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.lost',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 590, status: 'lost' } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_lost');
    expect(calls.find((c) => c.table === 'billing_payments' && c.op === 'update')?.payload).toMatchObject({ status: 'partially_refunded' });
  });

  it('releases a won dispute: the payment goes back to captured and the reversal is marked failed', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment({ status: 'disputed' }), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'disputed', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    enqueue('billing_payments', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce({
      id: 'pay_1', order_id: 'order_rzp_1', status: 'captured', amount: 1180, currency: 'INR',
      amount_refunded: 0, refund_status: null, invoice_id: null, captured: true,
    });
    recordDisputeMock.mockResolvedValueOnce({ state: 'already_recorded', id: 'dispute-1' });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.won',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 1180, status: 'won' } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_won');
    expect(calls.find((c) => c.table === 'billing_orders' && c.op === 'update')?.payload).toMatchObject({ status: 'paid' });
    expect(calls.find((c) => c.table === 'billing_payments' && c.op === 'update')?.payload).toMatchObject({ status: 'captured' });
    // 'failed' is this vocabulary's "the reversal did not happen", not an error.
    expect(recordDisputeMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', processedAt: null }));
  });

  it('does not erase an ordinary partial refund when the dispute is won', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment({ status: 'disputed' }), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'disputed', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    enqueue('billing_payments', 'update', { data: null, error: null });
    // The customer was refunded half separately; winning the chargeback does not undo that.
    fetchRazorpayPaymentMock.mockResolvedValueOnce({
      id: 'pay_1', order_id: 'order_rzp_1', status: 'captured', amount: 1180, currency: 'INR',
      amount_refunded: 590, refund_status: 'partial', invoice_id: null, captured: true,
    });
    recordDisputeMock.mockResolvedValueOnce({ state: 'already_recorded', id: 'dispute-1' });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.won',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', status: 'won' } } },
    };
    await processRazorpayWebhookEvent({ supabase, payload });

    expect(calls.find((c) => c.table === 'billing_payments' && c.op === 'update')?.payload).toMatchObject({ status: 'partially_refunded' });
  });

  it('writes nothing for a close, which carries no money outcome of its own', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'refunded', provider_payment_id: 'pay_1' }), error: null });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.closed',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', status: 'closed' } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_closed');
    expect(result.relatedUserId).toBe('user-1');
    expect(calls.some((c) => c.op === 'update')).toBe(false);
    expect(recordDisputeMock).not.toHaveBeenCalled();
  });

  it('does not re-open a settled dispute when a created event is redelivered late', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment({ status: 'refunded' }), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'refunded', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_refunds', 'select', { data: { status: 'processed' }, error: null });

    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.created',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 1180 } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_already_settled');
    expect(calls.some((c) => c.op === 'update')).toBe(false);
    expect(recordDisputeMock).not.toHaveBeenCalled();
  });

  it('believes the dispute entity status over a less specific event name', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'select', { data: fakeLedgerPayment(), error: null });
    enqueue('billing_orders', 'select', { data: fakeOrder({ status: 'disputed', provider_payment_id: 'pay_1' }), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    enqueue('billing_payments', 'update', { data: null, error: null });
    recordDisputeMock.mockResolvedValueOnce({ state: 'already_recorded', id: 'dispute-1' });

    // Razorpay can close the entity while sending the outcome event; the outcome is the fact.
    const payload: RazorpayWebhookPayload = {
      event: 'payment.dispute.lost',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 1180, status: 'closed' } } },
    };
    const result = await processRazorpayWebhookEvent({ supabase, payload });

    expect(result.outcome).toBe('dispute_lost');
    expect(calls.find((c) => c.table === 'billing_payments' && c.op === 'update')?.payload).toMatchObject({ status: 'refunded' });
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
