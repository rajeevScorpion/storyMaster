import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/billing/razorpay', () => ({
  verifyRazorpayOrderSignature: vi.fn(),
  verifyRazorpaySubscriptionSignature: vi.fn(),
}));

vi.mock('@/lib/billing/razorpay-sync', () => ({
  settleTopupOrder: vi.fn(),
  syncSubscriptionFromProvider: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { verifyRazorpayOrderSignature, verifyRazorpaySubscriptionSignature } from '@/lib/billing/razorpay';
import { settleTopupOrder, syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';

const verifyRazorpayOrderSignatureMock = vi.mocked(verifyRazorpayOrderSignature);
const verifyRazorpaySubscriptionSignatureMock = vi.mocked(verifyRazorpaySubscriptionSignature);
const settleTopupOrderMock = vi.mocked(settleTopupOrder);
const syncSubscriptionFromProviderMock = vi.mocked(syncSubscriptionFromProvider);
const createAdminClientMock = vi.mocked(createAdminClient);
const createClientMock = vi.mocked(createClient);

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

function createFakeAdmin(queues: Record<string, QueryResult[]>) {
  function dequeue(table: string, op: string): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`verify route test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  return {
    from(table: string) {
      return {
        select: () => new FakeQueryBuilder(dequeue(table, 'select')),
        update: () => new FakeQueryBuilder(dequeue(table, 'update')),
      };
    },
  } as any;
}

function fakeBillingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    user_id: 'user-1',
    provider: 'razorpay',
    order_type: 'subscription_checkout',
    provider_checkout_session_id: 'sub_stored',
    provider_order_id: null,
    provider_payment_id: null,
    currency_code: 'INR',
    amount_minor: 19900,
    status: 'created',
    plan_version_id: 'plan-version-1',
    topup_pack_id: null,
    raw_provider_payload_json: {},
    provider_mode: 'test',
    purchase_snapshot_json: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function signedIn() {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
  } as any);
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/billing/razorpay/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe('POST /api/billing/razorpay/verify — subscription', () => {
  it('rejects a client-supplied subscription id that does not match the checkout, with no signature check', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeAdmin({ 'billing_orders:select': [{ data: fakeBillingOrder(), error: null }] })
    );

    const response = await POST(
      postRequest({
        kind: 'subscription',
        internalOrderId: 'order-1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'sig_1',
        razorpaySubscriptionId: 'sub_other',
      })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Subscription does not match this checkout');
    expect(verifyRazorpaySubscriptionSignatureMock).not.toHaveBeenCalled();
    expect(syncSubscriptionFromProviderMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid subscription signature without syncing', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeAdmin({ 'billing_orders:select': [{ data: fakeBillingOrder(), error: null }] })
    );
    verifyRazorpaySubscriptionSignatureMock.mockReturnValueOnce(false);

    const response = await POST(
      postRequest({
        kind: 'subscription',
        internalOrderId: 'order-1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'bad_sig',
        razorpaySubscriptionId: 'sub_stored',
      })
    );

    expect(response.status).toBe(400);
    expect(syncSubscriptionFromProviderMock).not.toHaveBeenCalled();
  });

  it('reports coins granted once the sync core confirms them', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeAdmin({
        'billing_orders:select': [{ data: fakeBillingOrder(), error: null }],
        'pricing_plan_versions:select': [{ data: { id: 'plan-version-1' }, error: null }],
        'billing_orders:update': [{ data: null, error: null }],
      })
    );
    verifyRazorpaySubscriptionSignatureMock.mockReturnValueOnce(true);
    syncSubscriptionFromProviderMock.mockResolvedValueOnce({
      billingSubscriptionId: 'billing-sub-1',
      grantedCoins: 1000,
      firstChargeConfirmed: true,
      status: 'active',
    });

    const response = await POST(
      postRequest({
        kind: 'subscription',
        internalOrderId: 'order-1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'sig_1',
        razorpaySubscriptionId: 'sub_stored',
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.grantedCoins).toBe(1000);
    expect(json.message).toContain('1,000 coins');
  });
});

describe('POST /api/billing/razorpay/verify — top-up', () => {
  const topupOrder = () => fakeBillingOrder({ order_type: 'topup_checkout', provider_order_id: 'order_rzp_1', provider_checkout_session_id: null });

  it('returns a confirming message while the payment is still pending', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeAdmin({ 'billing_orders:select': [{ data: topupOrder(), error: null }] })
    );
    verifyRazorpayOrderSignatureMock.mockReturnValueOnce(true);
    settleTopupOrderMock.mockResolvedValueOnce({ state: 'pending', grantedCoins: 0, paymentId: 'pay_1' });

    const response = await POST(
      postRequest({
        kind: 'topup',
        internalOrderId: 'order-1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'sig_1',
        razorpayOrderId: 'order_rzp_1',
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/confirming/i);
  });

  it('returns 409 when the payment was refunded', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeAdmin({ 'billing_orders:select': [{ data: topupOrder(), error: null }] })
    );
    verifyRazorpayOrderSignatureMock.mockReturnValueOnce(true);
    settleTopupOrderMock.mockResolvedValueOnce({ state: 'refunded', grantedCoins: 0, paymentId: 'pay_1' });

    const response = await POST(
      postRequest({
        kind: 'topup',
        internalOrderId: 'order-1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'sig_1',
        razorpayOrderId: 'order_rzp_1',
      })
    );

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toBe('This payment was refunded.');
  });
});

describe('POST /api/billing/razorpay/verify — error handling', () => {
  it('never leaks a raw provider/DB error message to the client', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeAdmin({
        'billing_orders:select': [{ data: fakeBillingOrder(), error: null }],
        'pricing_plan_versions:select': [{ data: { id: 'plan-version-1' }, error: null }],
      })
    );
    verifyRazorpaySubscriptionSignatureMock.mockReturnValueOnce(true);
    syncSubscriptionFromProviderMock.mockRejectedValueOnce(new Error('secret-internal-db-detail'));

    const response = await POST(
      postRequest({
        kind: 'subscription',
        internalOrderId: 'order-1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'sig_1',
        razorpaySubscriptionId: 'sub_stored',
      })
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('secret-internal-db-detail');
    expect(text).toContain("couldn't confirm this payment yet");
  });
});
