import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/billing/razorpay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/razorpay')>();
  return {
    ...actual,
    getRazorpayMode: vi.fn(() => 'test'),
    fetchRazorpayPayment: vi.fn(),
    captureRazorpayPayment: vi.fn(),
    fetchRazorpayOrderPayments: vi.fn(),
    fetchRazorpaySubscription: vi.fn(),
    fetchRazorpaySubscriptionInvoices: vi.fn(),
  };
});

import {
  fetchRazorpayPayment,
  captureRazorpayPayment,
  fetchRazorpayOrderPayments,
  fetchRazorpaySubscription,
  fetchRazorpaySubscriptionInvoices,
  type RazorpayPayment,
  type RazorpaySubscription,
  type RazorpayInvoice,
} from '@/lib/billing/razorpay';
import {
  isUniqueViolation,
  settleTopupOrder,
  syncSubscriptionFromProvider,
  grantTopupIfMissing,
  syncRazorpaySubscriptionState,
} from './razorpay-sync';
import type { DbBillingOrder, DbPricingPlanVersion, DbPricingTopupPack } from '@/lib/types/database';

const fetchRazorpayPaymentMock = vi.mocked(fetchRazorpayPayment);
const captureRazorpayPaymentMock = vi.mocked(captureRazorpayPayment);
const fetchRazorpayOrderPaymentsMock = vi.mocked(fetchRazorpayOrderPayments);
const fetchRazorpaySubscriptionMock = vi.mocked(fetchRazorpaySubscription);
const fetchRazorpaySubscriptionInvoicesMock = vi.mocked(fetchRazorpaySubscriptionInvoices);

// --- A minimal, generic stand-in for the supabase-js query builder: every chain method is a
// no-op passthrough, and the builder is directly awaitable (like the real one) so callers that
// stop chaining early (e.g. a bare `.insert(...)`) still get a resolved `{ data, error }`.
interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  is() { return this; }
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

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert';
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
      throw new Error(`razorpay-sync.test: no queued ${op} result for table "${table}"`);
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
        upsert: (row: unknown) => {
          calls.push({ table, op: 'upsert', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'upsert'));
        },
      };
    },
  };

  return { supabase: supabase as any, enqueue, calls };
}

function fakePayment(overrides: Partial<RazorpayPayment> = {}): RazorpayPayment {
  return {
    id: 'pay_1',
    order_id: 'order_rzp_1',
    status: 'captured',
    amount: 500,
    currency: 'INR',
    amount_refunded: 0,
    refund_status: null,
    invoice_id: null,
    captured: true,
    ...overrides,
  };
}

function fakeOrder(overrides: Partial<DbBillingOrder> = {}): DbBillingOrder {
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as DbBillingOrder;
}

function fakeTopupPack(overrides: Partial<DbPricingTopupPack> = {}): DbPricingTopupPack {
  return {
    id: 'pack-1',
    pack_key: 'pack_small',
    status: 'published',
    provider: 'razorpay',
    name: 'Small pack',
    currency_code: 'INR',
    pricing_market_key: 'IN',
    price_minor: 500,
    beat_amount: 999, // deliberately different from any snapshot beatAmount, to prove which one wins
    provider_product_ref: null,
    provider_price_ref: null,
    extensions_json: {},
    published_at: null,
    published_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as DbPricingTopupPack;
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
    provider_price_ref: null,
    provider_price_ref_mode: null,
    extensions_json: {},
    published_at: null,
    published_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as DbPricingPlanVersion;
}

function fakeSubscription(overrides: Partial<RazorpaySubscription> = {}): RazorpaySubscription {
  return {
    id: 'sub_1',
    plan_id: 'plan_rzp_1',
    customer_id: 'cust_1',
    status: 'authenticated',
    current_start: 1_700_000_000,
    current_end: 1_702_592_000,
    charge_at: null,
    start_at: null,
    total_count: 1200,
    notes: { user_id: 'user-1' },
    ...overrides,
  };
}

function fakeInvoice(overrides: Partial<RazorpayInvoice> = {}): RazorpayInvoice {
  return {
    id: 'inv_1',
    status: 'paid',
    payment_id: 'pay_inv_1',
    billing_start: 1_700_000_000,
    billing_end: 1_702_592_000,
    paid_at: 1_700_000_100,
    amount_paid: 19900,
    ...overrides,
  };
}

describe('isUniqueViolation', () => {
  it('is true only for Postgres 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe('settleTopupOrder', () => {
  it('grants once when the hinted payment is already captured', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'verify',
    });

    expect(result).toEqual({ state: 'granted', grantedCoins: 500, paymentId: 'pay_1' });
    const grantCall = calls.find((call) => call.table === 'beat_grants' && call.op === 'insert');
    expect(grantCall?.payload).toMatchObject({
      user_id: 'user-1',
      source_type: 'topup',
      source_ref_id: 'order-1',
      beats_total: 50,
      beats_remaining: 50,
    });
    const orderUpdateCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdateCall?.payload).toMatchObject({ status: 'paid', provider_payment_id: 'pay_1' });
  });

  it('reports already_granted when the grant insert races into 23505 (verify + webhook)', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'webhook',
    });

    expect(result).toEqual({ state: 'already_granted', grantedCoins: 0, paymentId: 'pay_1' });
  });

  it('captures an authorized payment before granting', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ status: 'authorized' }));
    captureRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ status: 'captured' }));

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'verify',
    });

    expect(captureRazorpayPaymentMock).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      amountMinor: 500,
      currencyCode: 'INR',
    });
    expect(result.state).toBe('granted');
  });

  it('returns pending and inserts nothing when capture fails and the payment is still authorized', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ status: 'authorized' }));
    captureRazorpayPaymentMock.mockRejectedValueOnce(new Error('capture declined'));
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ status: 'authorized' }));

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'verify',
    });

    expect(result).toEqual({ state: 'pending', grantedCoins: 0, paymentId: 'pay_1' });
    expect(calls.some((call) => call.table === 'beat_grants')).toBe(false);
    expect(calls.some((call) => call.table === 'billing_orders' && call.op === 'update')).toBe(false);
  });

  it('throws when the hinted payment belongs to a different order', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ order_id: 'order_rzp_other' }));

    await expect(
      settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'verify' })
    ).rejects.toThrow('payment_order_mismatch');
    expect(calls.some((call) => call.op === 'insert' || call.op === 'update')).toBe(false);
  });

  it('throws when the captured amount does not match the order', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ amount_minor: 500 }), error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ status: 'captured', amount: 400 }));

    await expect(
      settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'verify' })
    ).rejects.toThrow('payment_amount_mismatch');
  });

  it('marks the order refunded and grants nothing when fully refunded', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(
      fakePayment({ status: 'captured', amount: 500, amount_refunded: 500 })
    );

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'reconcile',
    });

    expect(result).toEqual({ state: 'refunded', grantedCoins: 0, paymentId: 'pay_1' });
    expect(calls.some((call) => call.table === 'beat_grants')).toBe(false);
    const orderUpdateCall = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdateCall?.payload).toMatchObject({ status: 'refunded' });
  });

  it('uses the purchase snapshot beat amount over the (possibly since-changed) catalog pack', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', {
      data: fakeOrder({ purchase_snapshot_json: { kind: 'topup', beatAmount: 40 } }),
      error: null,
    });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'verify',
    });

    expect(result.grantedCoins).toBe(400); // 40 beats * 10 coins, not the pack's 999
    expect(calls.some((call) => call.table === 'pricing_topup_packs')).toBe(false);
  });

  it('falls back to the catalog pack and flags snapshotMissing when the order predates snapshots', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ purchase_snapshot_json: null }), error: null });
    enqueue('pricing_topup_packs', 'select', { data: fakeTopupPack({ beat_amount: 60 }), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    const result = await settleTopupOrder({
      supabase,
      billingOrderId: 'order-1',
      paymentIdHint: 'pay_1',
      source: 'verify',
    });

    expect(result.grantedCoins).toBe(600);
    const grantCall = calls.find((call) => call.table === 'beat_grants' && call.op === 'insert');
    expect((grantCall?.payload as any)?.metadata_json?.snapshotMissing).toBe(true);
  });

  it('picks the best payment from the order when no hint is given', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayOrderPaymentsMock.mockResolvedValueOnce({
      items: [fakePayment({ id: 'pay_failed', status: 'failed' }), fakePayment({ id: 'pay_captured', status: 'captured' })],
    });

    const result = await settleTopupOrder({ supabase, billingOrderId: 'order-1', source: 'reconcile' });

    expect(result).toEqual({ state: 'granted', grantedCoins: 500, paymentId: 'pay_captured' });
  });
});

describe('syncSubscriptionFromProvider', () => {
  it('syncs an authenticated subscription with no paid invoice yet: no grant, not confirmed', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(fakeSubscription({ status: 'authenticated' }));
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_subscriptions', 'insert', {
      data: { id: 'billing-sub-1', first_charge_confirmed_at: null },
      error: null,
    });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({ items: [] });

    const result = await syncSubscriptionFromProvider({
      supabase,
      userId: 'user-1',
      planVersion: fakePlanVersion(),
      providerSubscriptionId: 'sub_1',
      checkoutOrder: null,
      source: 'verify',
      rawPayload: {},
    });

    expect(result).toEqual({
      billingSubscriptionId: 'billing-sub-1',
      grantedCoins: 0,
      firstChargeConfirmed: false,
      status: 'authenticated',
    });
    expect(calls.some((call) => call.table === 'beat_grants')).toBe(false);
    const insertCall = calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ provider_mode: 'test' });
  });

  it('grants a cycle and records first_charge_confirmed_at once a paid invoice covers it', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(fakeSubscription({ status: 'authenticated' }));
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: null },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null }); // main sync
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({ items: [fakeInvoice()] });
    enqueue('billing_subscriptions', 'update', { data: null, error: null }); // confirm first charge
    enqueue('beat_grants', 'insert', { data: null, error: null });

    const result = await syncSubscriptionFromProvider({
      supabase,
      userId: 'user-1',
      planVersion: fakePlanVersion({ monthly_included_beats: 100 }),
      providerSubscriptionId: 'sub_1',
      checkoutOrder: null,
      source: 'webhook',
      rawPayload: { event: 'subscription.charged' },
    });

    expect(result).toEqual({
      billingSubscriptionId: 'billing-sub-1',
      grantedCoins: 1000,
      firstChargeConfirmed: true,
      status: 'authenticated',
    });

    const updateCalls = calls.filter((call) => call.table === 'billing_subscriptions' && call.op === 'update');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1].payload).toMatchObject({ first_charge_confirmed_at: expect.any(String) });

    const grantCall = calls.find((call) => call.table === 'beat_grants' && call.op === 'insert');
    expect(grantCall?.payload).toMatchObject({
      source_type: 'subscription',
      source_ref_id: 'sub_1:1700000000',
      beats_total: 100,
    });
  });

  it('grants a renewal cycle under its own source_ref_id, and only once for that cycle', async () => {
    const planVersion = fakePlanVersion({ monthly_included_beats: 100 });

    // First call: cycle 1 grants successfully.
    {
      const { supabase, enqueue, calls } = createFakeSupabase();
      fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
        fakeSubscription({ status: 'active', current_start: 1_700_000_000, current_end: 1_702_592_000 })
      );
      enqueue('billing_subscriptions', 'select', {
        data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
        error: null,
      });
      enqueue('billing_subscriptions', 'update', { data: null, error: null });
      fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
        items: [fakeInvoice({ billing_start: 1_700_000_000, billing_end: 1_702_592_000 })],
      });
      enqueue('beat_grants', 'insert', { data: null, error: null });

      const result = await syncSubscriptionFromProvider({
        supabase, userId: 'user-1', planVersion, providerSubscriptionId: 'sub_1',
        checkoutOrder: null, source: 'reconcile', rawPayload: {},
      });

      expect(result.grantedCoins).toBe(1000);
      const grantCall = calls.find((call) => call.table === 'beat_grants' && call.op === 'insert');
      expect(grantCall?.payload).toMatchObject({ source_ref_id: 'sub_1:1700000000' });
    }

    // Second call: a renewed cycle (new current_start) grants again, under a distinct source_ref_id.
    {
      const { supabase, enqueue, calls } = createFakeSupabase();
      fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
        fakeSubscription({ status: 'active', current_start: 1_702_592_000, current_end: 1_705_270_400 })
      );
      enqueue('billing_subscriptions', 'select', {
        data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
        error: null,
      });
      enqueue('billing_subscriptions', 'update', { data: null, error: null });
      fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
        items: [fakeInvoice({ id: 'inv_2', billing_start: 1_702_592_000, billing_end: 1_705_270_400 })],
      });
      enqueue('beat_grants', 'insert', { data: null, error: null });

      const result = await syncSubscriptionFromProvider({
        supabase, userId: 'user-1', planVersion, providerSubscriptionId: 'sub_1',
        checkoutOrder: null, source: 'reconcile', rawPayload: {},
      });

      expect(result.grantedCoins).toBe(1000);
      const grantCall = calls.find((call) => call.table === 'beat_grants' && call.op === 'insert');
      expect(grantCall?.payload).toMatchObject({ source_ref_id: 'sub_1:1702592000' });
    }

    // Third call: the same renewed cycle again (e.g. verify racing the webhook) → 23505 → no second grant.
    {
      const { supabase, enqueue } = createFakeSupabase();
      fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
        fakeSubscription({ status: 'active', current_start: 1_702_592_000, current_end: 1_705_270_400 })
      );
      enqueue('billing_subscriptions', 'select', {
        data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
        error: null,
      });
      enqueue('billing_subscriptions', 'update', { data: null, error: null });
      fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
        items: [fakeInvoice({ id: 'inv_2', billing_start: 1_702_592_000, billing_end: 1_705_270_400 })],
      });
      enqueue('beat_grants', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });

      const result = await syncSubscriptionFromProvider({
        supabase, userId: 'user-1', planVersion, providerSubscriptionId: 'sub_1',
        checkoutOrder: null, source: 'verify', rawPayload: {},
      });

      expect(result.grantedCoins).toBe(0);
      expect(result.firstChargeConfirmed).toBe(true);
    }
  });

  it('throws and updates nothing when the stored row belongs to a different user', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(fakeSubscription());
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'someone-else' },
      error: null,
    });

    await expect(
      syncSubscriptionFromProvider({
        supabase,
        userId: 'user-1',
        planVersion: fakePlanVersion(),
        providerSubscriptionId: 'sub_1',
        source: 'verify',
        rawPayload: {},
      })
    ).rejects.toThrow('subscription_owner_mismatch');

    expect(calls.some((call) => call.op === 'update' || call.op === 'insert')).toBe(false);
  });

  it('throws before any DB read when notes.user_id does not match the caller', async () => {
    const { supabase, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(fakeSubscription({ notes: { user_id: 'someone-else' } }));

    await expect(
      syncSubscriptionFromProvider({
        supabase,
        userId: 'user-1',
        planVersion: fakePlanVersion(),
        providerSubscriptionId: 'sub_1',
        source: 'verify',
        rawPayload: {},
      })
    ).rejects.toThrow('subscription_owner_mismatch');

    expect(calls).toHaveLength(0);
  });
});

describe('deprecated grant helpers treat 23505 as already-granted (adjustment for Unit A)', () => {
  it('grantTopupIfMissing returns 0 without throwing when the insert races into a duplicate', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('beat_grants', 'select', { data: null, error: null }); // no existing row seen yet
    enqueue('beat_grants', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });

    const grantedCoins = await grantTopupIfMissing({
      supabase,
      billingOrder: fakeOrder(),
      topupPack: fakeTopupPack({ beat_amount: 50 }),
      paymentId: 'pay_1',
      rawPayload: {},
    });

    expect(grantedCoins).toBe(0);
  });

  it('syncRazorpaySubscriptionState (deprecated) treats a racing grant insert as already-granted', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_subscriptions', 'insert', { data: { id: 'billing-sub-1' }, error: null });
    enqueue('beat_grants', 'select', { data: null, error: null });
    enqueue('beat_grants', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });

    const result = await syncRazorpaySubscriptionState({
      supabase,
      userId: 'user-1',
      pricingMarketKey: 'IN',
      countryCode: 'IN',
      planVersion: fakePlanVersion(),
      subscription: fakeSubscription({ status: 'active', customer_id: null }),
      rawPayload: {},
    });

    expect(result.grantedCoins).toBe(0);
  });
});
