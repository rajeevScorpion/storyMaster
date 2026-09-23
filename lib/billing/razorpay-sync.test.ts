import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('@/lib/billing/ledger', () => ({
  recordPayment: vi.fn(),
}));

vi.mock('@/lib/billing/tax-rules', () => ({
  getPublishedTaxRule: vi.fn(),
}));

vi.mock('@/lib/billing/billing-profile', async (importOriginal) => {
  // buildCustomerSnapshot (Payments Phase 5, Unit A) is left as the real, pure mapper so these tests
  // exercise the exact snapshot the sync freezes into billing_payments.customer_snapshot_json;
  // only the DB-backed loadBillingProfile is stubbed.
  const actual = await importOriginal<typeof import('@/lib/billing/billing-profile')>();
  return {
    ...actual,
    loadBillingProfile: vi.fn(),
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
import { recordPayment } from '@/lib/billing/ledger';
import { getPublishedTaxRule } from '@/lib/billing/tax-rules';
import { loadBillingProfile } from '@/lib/billing/billing-profile';
import {
  cancelAtPeriodEndPatch,
  isUniqueViolation,
  nextSubscriptionCheckoutOrderStatus,
  settleTopupOrder,
  syncSubscriptionFromProvider,
} from './razorpay-sync';
import type { DbBillingOrder, DbPricingPlanVersion, DbPricingTopupPack } from '@/lib/types/database';

const fetchRazorpayPaymentMock = vi.mocked(fetchRazorpayPayment);
const captureRazorpayPaymentMock = vi.mocked(captureRazorpayPayment);
const fetchRazorpayOrderPaymentsMock = vi.mocked(fetchRazorpayOrderPayments);
const fetchRazorpaySubscriptionMock = vi.mocked(fetchRazorpaySubscription);
const fetchRazorpaySubscriptionInvoicesMock = vi.mocked(fetchRazorpaySubscriptionInvoices);
const recordPaymentMock = vi.mocked(recordPayment);
const getPublishedTaxRuleMock = vi.mocked(getPublishedTaxRule);
const loadBillingProfileMock = vi.mocked(loadBillingProfile);

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

beforeEach(() => {
  // Payments Phase 2 defaults: no ledger schema / no tax rule / no profile, so every existing test
  // (written before Unit B) keeps exercising the exact same grant behaviour it always has. Tests
  // that exercise ledger recording or tax splitting override these with mockResolvedValueOnce.
  recordPaymentMock.mockResolvedValue({ state: 'inserted', id: 'payment-1' });
  getPublishedTaxRuleMock.mockResolvedValue({ status: 'unavailable' });
  loadBillingProfileMock.mockResolvedValue({ status: 'ok', profile: null });
});

describe('isUniqueViolation', () => {
  it('is true only for Postgres 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe('nextSubscriptionCheckoutOrderStatus', () => {
  it('follows the provider status for an ordinary checkout order', () => {
    expect(nextSubscriptionCheckoutOrderStatus('created', 'active')).toBe('active');
  });

  it('keeps a refund or dispute already recorded on the order', () => {
    expect(nextSubscriptionCheckoutOrderStatus('refunded', 'active')).toBe('refunded');
    expect(nextSubscriptionCheckoutOrderStatus('partially_refunded', 'active')).toBe('partially_refunded');
    expect(nextSubscriptionCheckoutOrderStatus('disputed', 'halted')).toBe('disputed');
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
    enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
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
      enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
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
      enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
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
      enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
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

describe('settleTopupOrder — ledger recording (Payments Phase 2, Unit B)', () => {
  it('stamps captured_at from Razorpay, not from the clock at settle time', async () => {
    // reconcile is a daily backstop, so it settles payments taken hours or days earlier. A wall-clock
    // stamp would misdate the tax point, and across 31 March put it in the wrong financial year.
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ created_at: 1774915200 })); // 2026-03-31T00:00:00Z

    await settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'reconcile' });

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ capturedAt: '2026-03-31T00:00:00.000Z' })
    );
  });

  it('falls back to now when Razorpay sent no created_at', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    await settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'verify' });

    const capturedAt = recordPaymentMock.mock.calls[0][0].capturedAt as string;
    expect(Number.isNaN(Date.parse(capturedAt))).toBe(false);
  });

  it('records the payment even when the grant races into already_granted', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder(), error: null });
    enqueue('beat_grants', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    await settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'webhook' });

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ subjectRef: 'user-1', userId: 'user-1', providerPaymentId: 'pay_1', kind: 'topup', status: 'captured' })
    );
  });

  it('records net/tax/gross from a tax-aware purchase snapshot instead of the legacy net=gross fallback', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_orders', 'select', {
      data: fakeOrder({
        amount_minor: 590,
        purchase_snapshot_json: { kind: 'topup', beatAmount: 50, netMinor: 500, taxMinor: 90, grossMinor: 590 },
      }),
      error: null,
    });
    enqueue('beat_grants', 'insert', { data: null, error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ amount: 590 }));

    await settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'verify' });

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ netMinor: 500, taxMinor: 90, grossMinor: 590 })
    );
  });

  it('skips the coin grant but still records the payment when the order has no owner (deleted customer)', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_orders', 'select', { data: fakeOrder({ user_id: null, subject_ref: 'subject-1' } as any), error: null });
    enqueue('billing_orders', 'update', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment());

    const result = await settleTopupOrder({ supabase, billingOrderId: 'order-1', paymentIdHint: 'pay_1', source: 'reconcile' });

    expect(result).toEqual({ state: 'skipped_no_owner', grantedCoins: 0, paymentId: 'pay_1' });
    expect(calls.some((call) => call.table === 'beat_grants')).toBe(false);
    expect(recordPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ subjectRef: 'subject-1', userId: null }));
    const orderUpdate = calls.find((call) => call.table === 'billing_orders' && call.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ status: 'paid' });
  });
});

describe('syncSubscriptionFromProvider — ledger recording (Payments Phase 2, Unit B)', () => {
  it('records the first charge with kind subscription_first, using the checkout order snapshot', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: 1_700_000_000, current_end: 1_702_592_000 })
    );
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_subscriptions', 'insert', { data: { id: 'billing-sub-1', first_charge_confirmed_at: null }, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
      items: [fakeInvoice({ billing_start: 1_700_000_000, billing_end: 1_702_592_000, amount_paid: 23482 })],
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null }); // confirm first charge
    enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
    enqueue('beat_grants', 'insert', { data: null, error: null });

    const checkoutOrder = {
      purchase_snapshot_json: { netMinor: 19900, taxMinor: 3582, grossMinor: 23482, tax: { ruleId: 'rule-1' } },
    } as any;

    await syncSubscriptionFromProvider({
      supabase,
      userId: 'user-1',
      planVersion: fakePlanVersion(),
      providerSubscriptionId: 'sub_1',
      checkoutOrder,
      source: 'webhook',
      rawPayload: {},
    });

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subscription_first',
        netMinor: 19900,
        taxMinor: 3582,
        grossMinor: 23482,
        providerInvoiceId: 'inv_1',
      })
    );
    expect(getPublishedTaxRuleMock).not.toHaveBeenCalled();
  });

  it('records a renewal with kind subscription_renewal, deriving the split from the current rule and profile state', async () => {
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
      items: [fakeInvoice({ id: 'inv_2', billing_start: 1_702_592_000, billing_end: 1_705_270_400, amount_paid: 23482 })],
    });
    enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
    enqueue('beat_grants', 'insert', { data: null, error: null });

    getPublishedTaxRuleMock.mockResolvedValueOnce({
      status: 'ok',
      rule: { id: 'rule-1', marketKey: 'IN', appliesTo: 'subscription', taxRegime: 'in_gst', ratePercent: 18, sacCode: '998439', supplierStateCode: '24' },
    } as any);
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: { state_code: '24' } } as any);

    await syncSubscriptionFromProvider({
      supabase,
      userId: 'user-1',
      planVersion: fakePlanVersion(),
      providerSubscriptionId: 'sub_1',
      checkoutOrder: null,
      source: 'reconcile',
      rawPayload: {},
    });

    // 23482 gross at 18% reverses to net 19900 / tax 3582 exactly.
    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'subscription_renewal', netMinor: 19900, taxMinor: 3582, grossMinor: 23482, providerInvoiceId: 'inv_2' })
    );
  });

  it('records the whole gross as net when no tax rule is available for a renewal, without failing the sync', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: 1_700_000_000, current_end: 1_702_592_000 })
    );
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({ items: [fakeInvoice({ amount_paid: 19900 })] });
    enqueue('billing_payments', 'select', { data: { id: 'existing-payment' }, error: null }); // method lookup: row exists, skip fetch
    enqueue('beat_grants', 'insert', { data: null, error: null });
    // beforeEach default: getPublishedTaxRuleMock resolves 'unavailable'.

    const result = await syncSubscriptionFromProvider({
      supabase,
      userId: 'user-1',
      planVersion: fakePlanVersion(),
      providerSubscriptionId: 'sub_1',
      checkoutOrder: null,
      source: 'reconcile',
      rawPayload: {},
    });

    expect(result.grantedCoins).toBe(1000);
    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ netMinor: 19900, taxMinor: 0, grossMinor: 19900, taxBreakdown: null })
    );
  });

  it('stamps subject_ref on a newly-inserted subscription row', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(fakeSubscription({ status: 'authenticated' }));
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_subscriptions', 'insert', { data: { id: 'billing-sub-1', first_charge_confirmed_at: null }, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({ items: [] });

    await syncSubscriptionFromProvider({
      supabase,
      userId: 'user-1',
      planVersion: fakePlanVersion(),
      providerSubscriptionId: 'sub_1',
      checkoutOrder: null,
      source: 'verify',
      rawPayload: {},
    });

    const insertCall = calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ subject_ref: 'user-1' });
  });
});

describe('cancelAtPeriodEndPatch (Payments Phase 5, Unit A)', () => {
  it('omits the field entirely while the subscription is still live', () => {
    expect(cancelAtPeriodEndPatch('authenticated')).toEqual({});
    expect(cancelAtPeriodEndPatch('active')).toEqual({});
    expect(cancelAtPeriodEndPatch('pending')).toEqual({});
    expect(cancelAtPeriodEndPatch('halted')).toEqual({});
  });

  it('writes false once the subscription is terminal', () => {
    expect(cancelAtPeriodEndPatch('cancelled')).toEqual({ cancel_at_period_end: false });
    expect(cancelAtPeriodEndPatch('completed')).toEqual({ cancel_at_period_end: false });
    expect(cancelAtPeriodEndPatch('expired')).toEqual({ cancel_at_period_end: false });
  });
});

describe('syncSubscriptionFromProvider — cancel_at_period_end (Payments Phase 5, Unit A)', () => {
  it('omits cancel_at_period_end from the update while the subscription is live', async () => {
    // No current_start/current_end -- keeps this test focused on the subscription row's own update,
    // without also exercising the invoice/payment machinery below.
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: null, current_end: null })
    );
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null });

    await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder: null, source: 'webhook', rawPayload: {},
    });

    const updateCall = calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'update');
    expect(updateCall?.payload).not.toHaveProperty('cancel_at_period_end');
  });

  it('writes cancel_at_period_end: false once the subscription has gone terminal', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'cancelled', current_start: null, current_end: null })
    );
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null });

    await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder: null, source: 'webhook', rawPayload: {},
    });

    const updateCall = calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'update');
    expect(updateCall?.payload).toMatchObject({ cancel_at_period_end: false });
  });

  it('always inserts a brand-new subscription row with cancel_at_period_end: false', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'authenticated', current_start: null, current_end: null })
    );
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_subscriptions', 'insert', { data: { id: 'billing-sub-1', first_charge_confirmed_at: null }, error: null });

    await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder: null, source: 'verify', rawPayload: {},
    });

    const insertCall = calls.find((call) => call.table === 'billing_subscriptions' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ cancel_at_period_end: false });
  });
});

describe('syncSubscriptionFromProvider — subscription payment method & customer snapshot (Payments Phase 5, Unit A)', () => {
  it("a first charge takes the customer frozen into the checkout order's own snapshot, and the fetched payment's method", async () => {
    const { supabase, enqueue } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: 1_700_000_000, current_end: 1_702_592_000, payment_method: 'upi' })
    );
    enqueue('billing_subscriptions', 'select', { data: null, error: null });
    enqueue('billing_subscriptions', 'insert', { data: { id: 'billing-sub-1', first_charge_confirmed_at: null }, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
      items: [fakeInvoice({ billing_start: 1_700_000_000, billing_end: 1_702_592_000, amount_paid: 23482 })],
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null }); // confirm first charge
    enqueue('billing_payments', 'select', { data: null, error: null }); // no row yet -> fetch the payment
    enqueue('beat_grants', 'insert', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ id: 'pay_inv_1', method: 'card', fee: 40, tax: 6 }));

    const orderCustomer = { profileType: 'personal', legalName: 'Jane Doe', stateCode: '24' };
    const checkoutOrder = {
      purchase_snapshot_json: {
        netMinor: 19900, taxMinor: 3582, grossMinor: 23482, tax: { ruleId: 'rule-1' }, customer: orderCustomer,
      },
    } as any;

    await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder, source: 'webhook', rawPayload: {},
    });

    expect(fetchRazorpayPaymentMock).toHaveBeenCalledWith('pay_inv_1');
    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subscription_first',
        rawMethod: 'card',
        providerFeeMinor: 40,
        providerTaxMinor: 6,
        customerSnapshot: orderCustomer,
        purchaseSnapshot: checkoutOrder.purchase_snapshot_json,
      })
    );
  });

  it('a renewal takes the live billing profile at the moment of this sync, from the same read used for the tax split', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: 1_702_592_000, current_end: 1_705_270_400, payment_method: 'card' })
    );
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
      items: [fakeInvoice({ id: 'inv_2', billing_start: 1_702_592_000, billing_end: 1_705_270_400, amount_paid: 23482 })],
    });
    enqueue('billing_payments', 'select', { data: null, error: null }); // no row yet -> fetch the payment
    enqueue('beat_grants', 'insert', { data: null, error: null });
    fetchRazorpayPaymentMock.mockResolvedValueOnce(fakePayment({ id: 'pay_renewal_1', method: 'upi' }));

    getPublishedTaxRuleMock.mockResolvedValueOnce({
      status: 'ok',
      rule: { id: 'rule-1', marketKey: 'IN', appliesTo: 'subscription', taxRegime: 'in_gst', ratePercent: 18, sacCode: '998439', supplierStateCode: '24' },
    } as any);
    const liveProfile = {
      legal_name: 'Jane Doe', billing_email: 'jane@example.com', phone: '+919876543210', company_name: null,
      gstin: null, state_code: '24', country_code: 'IN', address_line_1: null, address_line_2: null,
      city: 'Gandhinagar', postal_code: '382016', updated_at: '2026-09-01T00:00:00.000Z',
    };
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: liveProfile } as any);

    await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder: null, source: 'reconcile', rawPayload: {},
    });

    // loadBillingProfile is called exactly once -- the same read that produced the tax split also
    // produces the customer snapshot below (plan §5 Unit A: "one read, not two").
    expect(loadBillingProfileMock).toHaveBeenCalledTimes(1);
    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subscription_renewal',
        rawMethod: 'upi',
        purchaseSnapshot: null,
        customerSnapshot: expect.objectContaining({ profileType: 'personal', legalName: 'Jane Doe', stateCode: '24', stateName: 'Gujarat' }),
      })
    );
  });

  it('skips the Razorpay payment fetch when a ledger row already exists, and uses the subscription entity method instead', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: 1_702_592_000, current_end: 1_705_270_400, payment_method: 'netbanking' })
    );
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
      items: [fakeInvoice({ id: 'inv_2', billing_start: 1_702_592_000, billing_end: 1_705_270_400, amount_paid: 19900 })],
    });
    enqueue('billing_payments', 'select', { data: { id: 'already-recorded' }, error: null }); // row exists
    enqueue('beat_grants', 'insert', { data: null, error: null });

    await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder: null, source: 'reconcile', rawPayload: {},
    });

    expect(fetchRazorpayPaymentMock).not.toHaveBeenCalled();
    expect(recordPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ rawMethod: 'netbanking' }));
  });

  it("falls back to the subscription entity's payment_method, and never throws, when the payment fetch fails", async () => {
    const { supabase, enqueue } = createFakeSupabase();
    fetchRazorpaySubscriptionMock.mockResolvedValueOnce(
      fakeSubscription({ status: 'active', current_start: 1_702_592_000, current_end: 1_705_270_400, payment_method: 'wallet' })
    );
    enqueue('billing_subscriptions', 'select', {
      data: { id: 'billing-sub-1', user_id: 'user-1', first_charge_confirmed_at: '2026-08-01T00:00:00.000Z' },
      error: null,
    });
    enqueue('billing_subscriptions', 'update', { data: null, error: null });
    fetchRazorpaySubscriptionInvoicesMock.mockResolvedValueOnce({
      items: [fakeInvoice({ id: 'inv_2', billing_start: 1_702_592_000, billing_end: 1_705_270_400, amount_paid: 19900 })],
    });
    enqueue('billing_payments', 'select', { data: null, error: null }); // no row yet -> attempt the fetch
    enqueue('beat_grants', 'insert', { data: null, error: null });
    fetchRazorpayPaymentMock.mockRejectedValueOnce(new Error('Razorpay request failed: network error'));

    const result = await syncSubscriptionFromProvider({
      supabase, userId: 'user-1', planVersion: fakePlanVersion(), providerSubscriptionId: 'sub_1',
      checkoutOrder: null, source: 'reconcile', rawPayload: {},
    });

    expect(result.grantedCoins).toBe(1000);
    expect(recordPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ rawMethod: 'wallet' }));
  });
});
