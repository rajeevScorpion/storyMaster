import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

import { getFeatureFlag } from '@/lib/ai/model-config';
import {
  deriveMethodCategory,
  issueDocumentIfEnabled,
  recordDispute,
  recordPayment,
  recordRefund,
  resetLedgerSchemaLatchForTests,
} from './ledger';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);

// --- A minimal, generic stand-in for the supabase-js query builder, copied from
// razorpay-sync.test.ts's FakeQueryBuilder: every chain method is a no-op passthrough, and the
// builder is directly awaitable so callers that stop chaining early still get a resolved result.
interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
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
  op: 'select' | 'insert' | 'update';
  payload?: unknown;
}

function createFakeSupabase() {
  const queues: Record<string, QueryResult[]> = {};
  const calls: RecordedCall[] = [];
  const rpcQueue: QueryResult[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  function enqueue(table: string, op: RecordedCall['op'], result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: RecordedCall['op']): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`ledger.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  function enqueueRpc(result: QueryResult) {
    rpcQueue.push(result);
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
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (rpcQueue.length === 0) throw new Error('ledger.test: no queued rpc result');
      const result = rpcQueue.length > 1 ? rpcQueue.shift()! : rpcQueue[0];
      return new FakeQueryBuilder(result);
    },
  };

  return { supabase: supabase as any, enqueue, enqueueRpc, calls, rpcCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLedgerSchemaLatchForTests();
});

describe('deriveMethodCategory', () => {
  it('maps every known Razorpay method to its category, case-insensitively', () => {
    expect(deriveMethodCategory('card')).toBe('card');
    expect(deriveMethodCategory('UPI')).toBe('upi');
    expect(deriveMethodCategory('netbanking')).toBe('netbanking');
    expect(deriveMethodCategory('wallet')).toBe('wallet');
    expect(deriveMethodCategory('emi')).toBe('emi');
    expect(deriveMethodCategory('paylater')).toBe('paylater');
  });

  it('falls back to other for an unrecognized method and unknown for none at all', () => {
    expect(deriveMethodCategory('bank_transfer')).toBe('other');
    expect(deriveMethodCategory(null)).toBe('unknown');
    expect(deriveMethodCategory(undefined)).toBe('unknown');
  });
});

function basePaymentInput(supabase: any, overrides: Partial<Parameters<typeof recordPayment>[0]> = {}) {
  return {
    supabase,
    subjectRef: 'user-1',
    userId: 'user-1',
    provider: 'razorpay' as const,
    providerMode: 'test' as const,
    providerPaymentId: 'pay_1',
    kind: 'topup' as const,
    status: 'captured' as const,
    currencyCode: 'INR',
    netMinor: 1000,
    taxMinor: 180,
    grossMinor: 1180,
    ...overrides,
  };
}

describe('recordPayment', () => {
  it('inserts a new payment row with totals that add up', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'insert', { data: { id: 'payment-1' }, error: null });

    const result = await recordPayment(basePaymentInput(supabase, { rawMethod: 'upi' }));

    expect(result).toEqual({ state: 'inserted', id: 'payment-1' });
    const insertCall = calls.find((call) => call.table === 'billing_payments' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      subject_ref: 'user-1',
      net_minor: 1000,
      tax_minor: 180,
      gross_minor: 1180,
      method_category: 'upi',
      provider_payment_id: 'pay_1',
    });
    expect((insertCall?.payload as any).net_minor + (insertCall?.payload as any).tax_minor).toBe(
      (insertCall?.payload as any).gross_minor
    );
  });

  it('is idempotent on the provider id: a 23505 on insert updates the existing row instead of duplicating', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });
    enqueue('billing_payments', 'update', { data: { id: 'payment-1' }, error: null });

    const result = await recordPayment(basePaymentInput(supabase, { status: 'refunded' }));

    expect(result).toEqual({ state: 'already_recorded', id: 'payment-1' });
    const updateCall = calls.find((call) => call.table === 'billing_payments' && call.op === 'update');
    expect(updateCall?.payload).toMatchObject({ status: 'refunded' });
    expect(calls.filter((call) => call.op === 'insert')).toHaveLength(1); // never a second insert
  });

  it('never moves captured_at on a payment it has already recorded', async () => {
    // captured_at is the tax point. Verify, the webhook and the daily reconcile all re-observe the
    // same payment, so re-stamping it would walk an immutable financial record's date forward every
    // time -- and across 31 March, into the wrong financial year.
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });
    enqueue('billing_payments', 'update', { data: { id: 'payment-1' }, error: null });

    await recordPayment(basePaymentInput(supabase, { capturedAt: '2026-04-01T00:00:00.000Z' }));

    const updateCalls = calls.filter((call) => call.table === 'billing_payments' && call.op === 'update');
    // The main patch must not carry captured_at at all...
    expect(updateCalls[0]?.payload).not.toHaveProperty('captured_at');
    // ...and the only write that does is the separate one narrowed to rows where it is still null.
    expect(updateCalls[1]?.payload).toEqual({ captured_at: '2026-04-01T00:00:00.000Z' });
  });

  it('does not attempt the captured_at fill-in when no capture time was supplied', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });
    enqueue('billing_payments', 'update', { data: { id: 'payment-1' }, error: null });

    await recordPayment(basePaymentInput(supabase));

    expect(calls.filter((call) => call.table === 'billing_payments' && call.op === 'update')).toHaveLength(1);
  });

  it('fails closed (does not throw) when migration 125 is absent, and latches for later calls', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_payments', 'insert', {
      data: null,
      error: { code: '42P01', message: 'relation "billing_payments" does not exist' },
    });

    const first = await recordPayment(basePaymentInput(supabase));
    expect(first).toEqual({ state: 'unavailable' });

    // A second call must not hit the database at all -- the latch is permanent for the process.
    const second = await recordPayment(basePaymentInput(supabase));
    expect(second).toEqual({ state: 'unavailable' });
    expect(calls.filter((call) => call.table === 'billing_payments')).toHaveLength(1);
  });

  it('rethrows a real (non-23505, non-schema) insert error', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_payments', 'insert', { data: null, error: { code: '23503', message: 'fk violation' } });

    await expect(recordPayment(basePaymentInput(supabase))).rejects.toThrow('fk violation');
  });
});

function baseRefundInput(supabase: any, overrides: Partial<Parameters<typeof recordRefund>[0]> = {}) {
  return {
    supabase,
    providerMode: 'test' as const,
    providerRefundId: 'rfnd_1',
    amountMinor: 1180,
    currencyCode: 'INR',
    status: 'processed' as const,
    ...overrides,
  };
}

describe('recordRefund', () => {
  it('inserts a new refund row, redacting the raw payload', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_refunds', 'insert', { data: { id: 'refund-1' }, error: null });

    const result = await recordRefund(
      baseRefundInput(supabase, { rawPayload: { id: 'rfnd_1', email: 'user@example.com' } })
    );

    expect(result).toEqual({ state: 'inserted', id: 'refund-1' });
    const insertCall = calls.find((call) => call.table === 'billing_refunds' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ provider_refund_id: 'rfnd_1', amount_minor: 1180 });
    expect((insertCall?.payload as any).raw_payload_json.email).toBe('[redacted]');
  });

  it('matches a renewal refund through provider_payment_id alone when the local payment_id is not yet resolved', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_refunds', 'insert', { data: { id: 'refund-1' }, error: null });

    await recordRefund(baseRefundInput(supabase, { paymentId: null, providerPaymentId: 'pay_renewal_2' }));

    const insertCall = calls.find((call) => call.table === 'billing_refunds' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ payment_id: null, provider_payment_id: 'pay_renewal_2' });
  });

  it('is idempotent on the provider refund id: a 23505 updates instead of duplicating', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_refunds', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });
    enqueue('billing_refunds', 'update', { data: { id: 'refund-1' }, error: null });

    const result = await recordRefund(baseRefundInput(supabase, { status: 'processed' }));

    expect(result).toEqual({ state: 'already_recorded', id: 'refund-1' });
    expect(calls.filter((call) => call.op === 'insert')).toHaveLength(1);
  });

  it('fails closed when migration 125 is absent', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_refunds', 'insert', { data: null, error: { code: 'PGRST205', message: 'missing' } });

    const result = await recordRefund(baseRefundInput(supabase));
    expect(result).toEqual({ state: 'unavailable' });
  });
});

describe('recordDispute', () => {
  it('records into billing_refunds with initiated_by forced to dispute', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_refunds', 'insert', { data: { id: 'refund-1' }, error: null });

    await recordDispute(baseRefundInput(supabase, { providerRefundId: 'disp_1', status: 'pending' }));

    const insertCall = calls.find((call) => call.table === 'billing_refunds' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ initiated_by: 'dispute', provider_refund_id: 'disp_1' });
  });
});

function baseDocumentInput(supabase: any, overrides: Partial<Parameters<typeof issueDocumentIfEnabled>[0]> = {}) {
  return {
    supabase,
    subjectRef: 'user-1',
    documentType: 'receipt' as const,
    financialYear: '2026-27',
    paymentId: 'payment-1',
    currencyCode: 'INR',
    netMinor: 1000,
    taxMinor: 180,
    grossMinor: 1180,
    customerSnapshot: { legalName: 'Test User' },
    businessSnapshot: { legalName: 'Aavriti Design Studio' },
    ...overrides,
  };
}

describe('issueDocumentIfEnabled', () => {
  it('does nothing, and touches no table, when the issuing switch is off (the default)', async () => {
    getFeatureFlagMock.mockResolvedValue(false);
    const { supabase, calls, rpcCalls } = createFakeSupabase();

    const result = await issueDocumentIfEnabled(baseDocumentInput(supabase));

    expect(result).toEqual({ issued: false, reason: 'issuing_disabled' });
    expect(calls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it('issues a document using the number the database function returns, once switched on', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { supabase, enqueue, enqueueRpc, calls, rpcCalls } = createFakeSupabase();
    enqueue('billing_documents', 'select', { data: null, error: null }); // no existing document
    enqueueRpc({ data: 'RCPT/2026-27/000001', error: null });
    enqueue('billing_documents', 'insert', { data: { id: 'doc-1' }, error: null });

    const result = await issueDocumentIfEnabled(baseDocumentInput(supabase));

    expect(result).toEqual({ issued: true, documentId: 'doc-1', documentNumber: 'RCPT/2026-27/000001' });
    expect(rpcCalls).toEqual([
      { name: 'billing_next_document_number', args: { p_financial_year: '2026-27', p_document_type: 'receipt' } },
    ]);
    const insertCall = calls.find((call) => call.table === 'billing_documents' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ document_number: 'RCPT/2026-27/000001', payment_id: 'payment-1' });
  });

  it('never invents its own number across repeated calls -- each document gets exactly what the database returned', async () => {
    getFeatureFlagMock.mockResolvedValue(true);

    const { supabase: firstSupabase, enqueue: enqueueFirst, enqueueRpc: enqueueRpcFirst } = createFakeSupabase();
    enqueueFirst('billing_documents', 'select', { data: null, error: null });
    enqueueRpcFirst({ data: 'RCPT/2026-27/000001', error: null });
    enqueueFirst('billing_documents', 'insert', { data: { id: 'doc-1' }, error: null });
    const first = await issueDocumentIfEnabled(baseDocumentInput(firstSupabase, { paymentId: 'payment-1' }));

    const { supabase: secondSupabase, enqueue: enqueueSecond, enqueueRpc: enqueueRpcSecond } = createFakeSupabase();
    enqueueSecond('billing_documents', 'select', { data: null, error: null });
    enqueueRpcSecond({ data: 'RCPT/2026-27/000002', error: null });
    enqueueSecond('billing_documents', 'insert', { data: { id: 'doc-2' }, error: null });
    const second = await issueDocumentIfEnabled(baseDocumentInput(secondSupabase, { paymentId: 'payment-2' }));

    expect(first).toMatchObject({ documentNumber: 'RCPT/2026-27/000001' });
    expect(second).toMatchObject({ documentNumber: 'RCPT/2026-27/000002' });
  });

  it('does not double-issue: an already-issued document short-circuits before allocating a number', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { supabase, enqueue, rpcCalls } = createFakeSupabase();
    enqueue('billing_documents', 'select', { data: { id: 'doc-1', document_number: 'RCPT/2026-27/000001' }, error: null });

    const result = await issueDocumentIfEnabled(baseDocumentInput(supabase));

    expect(result).toEqual({ issued: false, reason: 'already_issued' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('requires exactly one of paymentId or refundId', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { supabase } = createFakeSupabase();

    await expect(
      issueDocumentIfEnabled(baseDocumentInput(supabase, { paymentId: null, refundId: null }))
    ).rejects.toThrow();
    await expect(
      issueDocumentIfEnabled(baseDocumentInput(supabase, { paymentId: 'payment-1', refundId: 'refund-1' }))
    ).rejects.toThrow();
  });

  it('fails closed when migration 125 is absent', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_documents', 'select', { data: null, error: { code: '42P01', message: 'missing' } });

    const result = await issueDocumentIfEnabled(baseDocumentInput(supabase));
    expect(result).toEqual({ issued: false, reason: 'unavailable' });
  });
});
