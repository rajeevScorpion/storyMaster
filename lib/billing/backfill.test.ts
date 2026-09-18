import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { backfillHistoricalBillingPayments } from './backfill';
import type { DbBillingOrder } from '@/lib/types/database';

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeListQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  not() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  gt() { return this; }
  then<T1 = QueryResult, T2 = never>(
    onFulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

class FakeSingleQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<T1 = QueryResult, T2 = never>(
    onFulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function fakeOrder(overrides: Partial<DbBillingOrder> = {}): DbBillingOrder {
  return {
    id: 'order-1',
    user_id: 'user-1',
    subject_ref: 'user-1',
    provider: 'razorpay',
    order_type: 'topup_checkout',
    provider_checkout_session_id: null,
    provider_order_id: 'order_rzp_1',
    provider_payment_id: 'pay_1',
    currency_code: 'INR',
    amount_minor: 590,
    status: 'paid',
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

function fakeSupabase(orders: DbBillingOrder[], existingPaymentIds: Set<string> = new Set()) {
  const insertedRows: any[] = [];

  const supabase = {
    from(table: string) {
      if (table === 'billing_orders') {
        return new FakeListQueryBuilder({ data: orders, error: null });
      }
      if (table === 'billing_payments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: (_col: string, value: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: existingPaymentIds.has(value) ? { id: `existing-${value}` } : null, error: null }),
                }),
              }),
            }),
          }),
          insert: (row: any) => {
            insertedRows.push(row);
            return new FakeSingleQueryBuilder({ data: { id: `new-${row.provider_payment_id}` }, error: null });
          },
        };
      }
      throw new Error(`backfill.test: unexpected table "${table}"`);
    },
  };

  return { supabase: supabase as any, insertedRows };
}

describe('backfillHistoricalBillingPayments', () => {
  it('inserts a payment row for an eligible paid order, marked backfilled/unknown_legacy', async () => {
    const { supabase, insertedRows } = fakeSupabase([fakeOrder()]);

    const result = await backfillHistoricalBillingPayments(supabase);

    expect(result).toMatchObject({ scanned: 1, inserted: 1, skippedAlreadyRecorded: 0, skippedIneligible: 0, hasMore: false });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      subject_ref: 'user-1',
      user_id: 'user-1',
      provider_payment_id: 'pay_1',
      kind: 'topup',
      status: 'captured',
      net_minor: 590,
      tax_minor: 0,
      gross_minor: 590,
      tax_breakdown_json: { taxStatus: 'unknown_legacy', backfilled: true },
    });
  });

  it('keeps the tax figures a Phase-2 order already carries, instead of stamping it unknown_legacy', async () => {
    // Reachable whenever a taxed order never got a payment row -- a settlement that failed, or one
    // that ran before 125 created the ledger tables. Recording tax_minor 0 on a charge that really
    // did collect GST would put a wrong number in the permanent record.
    const { supabase, insertedRows } = fakeSupabase([
      fakeOrder({
        amount_minor: 23482,
        purchase_snapshot_json: {
          kind: 'topup',
          beatAmount: 50,
          netMinor: 19900,
          taxMinor: 3582,
          grossMinor: 23482,
          tax: { breakdown: { ratePercent: 18, supplyType: 'intra_state', cgstMinor: 1791, sgstMinor: 1791, igstMinor: 0 } },
        },
      }),
    ]);

    await backfillHistoricalBillingPayments(supabase);

    expect(insertedRows[0]).toMatchObject({
      net_minor: 19900,
      tax_minor: 3582,
      gross_minor: 23482,
      tax_breakdown_json: { ratePercent: 18, supplyType: 'intra_state', backfilled: true },
    });
    expect(insertedRows[0].tax_breakdown_json).not.toHaveProperty('taxStatus');
  });

  it('maps a subscription_checkout order to kind subscription_first', async () => {
    const { supabase, insertedRows } = fakeSupabase([fakeOrder({ order_type: 'subscription_checkout' })]);

    await backfillHistoricalBillingPayments(supabase);

    expect(insertedRows[0]).toMatchObject({ kind: 'subscription_first' });
  });

  it('maps every eligible order status to its payment status', async () => {
    const { supabase, insertedRows } = fakeSupabase([
      fakeOrder({ id: 'o1', provider_payment_id: 'pay_paid', status: 'paid' }),
      fakeOrder({ id: 'o2', provider_payment_id: 'pay_refunded', status: 'refunded' }),
      fakeOrder({ id: 'o3', provider_payment_id: 'pay_partial', status: 'partially_refunded' }),
      fakeOrder({ id: 'o4', provider_payment_id: 'pay_disputed', status: 'disputed' }),
    ]);

    await backfillHistoricalBillingPayments(supabase);

    expect(insertedRows.map((r) => r.status)).toEqual(['captured', 'refunded', 'partially_refunded', 'disputed']);
  });

  it('skips an order with no provider_payment_id or an ineligible status', async () => {
    const { supabase, insertedRows } = fakeSupabase([
      fakeOrder({ id: 'o1', provider_payment_id: null, status: 'paid' }),
      fakeOrder({ id: 'o2', provider_payment_id: 'pay_created', status: 'created' }),
    ]);

    const result = await backfillHistoricalBillingPayments(supabase);

    expect(result).toMatchObject({ scanned: 2, inserted: 0, skippedIneligible: 2 });
    expect(insertedRows).toHaveLength(0);
  });

  describe('subscription_checkout orders', () => {
    // Regression coverage: billing_orders.status for a subscription_checkout order carries the
    // Razorpay SUBSCRIPTION's own provider status (nextSubscriptionCheckoutOrderStatus in
    // razorpay-sync.ts), never a payment status -- so a real, charged subscription order used to
    // read as ineligible for every one of these statuses (none of them is 'paid').
    it.each(['authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'])(
      'backfills a charged subscription order with status %s as subscription_first/captured',
      async (status) => {
        const { supabase, insertedRows } = fakeSupabase([
          fakeOrder({ order_type: 'subscription_checkout', provider_payment_id: 'pay_sub_1', status }),
        ]);

        const result = await backfillHistoricalBillingPayments(supabase);

        expect(result).toMatchObject({ inserted: 1, skippedIneligible: 0 });
        expect(insertedRows[0]).toMatchObject({ kind: 'subscription_first', status: 'captured' });
      }
    );

    it('maps a refunded/partially_refunded/disputed subscription order to its settlement status, not captured', async () => {
      const { supabase, insertedRows } = fakeSupabase([
        fakeOrder({ id: 's1', order_type: 'subscription_checkout', provider_payment_id: 'pay_s1', status: 'refunded' }),
        fakeOrder({ id: 's2', order_type: 'subscription_checkout', provider_payment_id: 'pay_s2', status: 'partially_refunded' }),
        fakeOrder({ id: 's3', order_type: 'subscription_checkout', provider_payment_id: 'pay_s3', status: 'disputed' }),
      ]);

      await backfillHistoricalBillingPayments(supabase);

      expect(insertedRows.map((r) => r.status)).toEqual(['refunded', 'partially_refunded', 'disputed']);
      expect(insertedRows.every((r) => r.kind === 'subscription_first')).toBe(true);
    });

    it('still treats an abandoned subscription checkout with no payment id as ineligible', async () => {
      const { supabase, insertedRows } = fakeSupabase([
        fakeOrder({ order_type: 'subscription_checkout', provider_payment_id: null, status: 'created' }),
        fakeOrder({ order_type: 'subscription_checkout', provider_payment_id: null, status: 'expired' }),
      ]);

      const result = await backfillHistoricalBillingPayments(supabase);

      expect(result).toMatchObject({ inserted: 0, skippedIneligible: 2 });
      expect(insertedRows).toHaveLength(0);
    });
  });

  it('skips an order whose payment is already recorded, without overwriting it', async () => {
    const { supabase, insertedRows } = fakeSupabase([fakeOrder()], new Set(['pay_1']));

    const result = await backfillHistoricalBillingPayments(supabase);

    expect(result).toMatchObject({ inserted: 0, skippedAlreadyRecorded: 1 });
    expect(insertedRows).toHaveLength(0);
  });

  it('falls back to user_id as the subject when subject_ref is absent (migration 125 not backfilled onto this row)', async () => {
    const { supabase, insertedRows } = fakeSupabase([fakeOrder({ subject_ref: undefined })]);

    await backfillHistoricalBillingPayments(supabase);

    expect(insertedRows[0]).toMatchObject({ subject_ref: 'user-1' });
  });

  it('skips an ownerless order with neither subject_ref nor user_id', async () => {
    const { supabase, insertedRows } = fakeSupabase([fakeOrder({ subject_ref: null, user_id: null })]);

    const result = await backfillHistoricalBillingPayments(supabase);

    expect(result.skippedIneligible).toBe(1);
    expect(insertedRows).toHaveLength(0);
  });

  it('reports hasMore and lastOrderId when the page is cut short by limit', async () => {
    const orders = [
      fakeOrder({ id: 'o1', provider_payment_id: 'pay_1' }),
      fakeOrder({ id: 'o2', provider_payment_id: 'pay_2' }),
      fakeOrder({ id: 'o3', provider_payment_id: 'pay_3' }),
    ];
    const { supabase } = fakeSupabase(orders);

    const result = await backfillHistoricalBillingPayments(supabase, { limit: 2 });

    expect(result.hasMore).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.lastOrderId).toBe('o2');
  });
});
