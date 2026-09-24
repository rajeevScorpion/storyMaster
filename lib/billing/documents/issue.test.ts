import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/ledger', () => ({
  issueDocumentIfEnabled: vi.fn(),
}));

vi.mock('@/lib/billing/billing-profile', () => ({
  loadBillingProfile: vi.fn(),
  buildCustomerSnapshot: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { issueDocumentIfEnabled } from '@/lib/billing/ledger';
import { loadBillingProfile, buildCustomerSnapshot } from '@/lib/billing/billing-profile';
import { issueCreditNoteForRefund, issueInvoiceForPayment } from './issue';

const createAdminClientMock = vi.mocked(createAdminClient);
const issueDocumentIfEnabledMock = vi.mocked(issueDocumentIfEnabled);
const loadBillingProfileMock = vi.mocked(loadBillingProfile);
const buildCustomerSnapshotMock = vi.mocked(buildCustomerSnapshot);

// A minimal, generic stand-in for the supabase-js query builder, copied from ledger.test.ts's
// FakeQueryBuilder: every chain method is a no-op passthrough, and the builder is directly awaitable.
interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
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

function createFakeSupabase() {
  const queues: Record<string, QueryResult[]> = {};
  const calls: string[] = [];

  function enqueue(table: string, result: QueryResult) {
    (queues[table] ??= []).push(result);
  }

  function dequeue(table: string): QueryResult {
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(`issue.test: no queued result for table "${table}"`);
    }
    calls.push(table);
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const supabase = {
    from(table: string) {
      return { select: () => new FakeQueryBuilder(dequeue(table)) };
    },
  };

  return { supabase: supabase as any, enqueue, calls };
}

function fakePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    subject_ref: 'user-1',
    user_id: 'user-1',
    provider: 'razorpay',
    provider_mode: 'test',
    provider_payment_id: 'pay_1',
    kind: 'topup',
    status: 'captured',
    currency_code: 'INR',
    net_minor: 1000,
    tax_minor: 180,
    gross_minor: 1180,
    tax_breakdown_json: { sacCode: '998439', placeOfSupplyStateCode: '24' },
    plan_version_id: null,
    cycle_start: null,
    cycle_end: null,
    purchase_snapshot_json: { packName: '120 Coins' },
    customer_snapshot_json: { legalName: 'Jane Doe', stateCode: '24' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('issueInvoiceForPayment', () => {
  it('returns not_found without ever calling issueDocumentIfEnabled', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: null, error: null });

    const result = await issueInvoiceForPayment('payment-1');

    expect(result).toEqual({ outcome: 'not_found', documentId: null, documentNumber: null });
    expect(issueDocumentIfEnabledMock).not.toHaveBeenCalled();
  });

  it('returns unavailable when the ledger schema is missing, without throwing', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: null, error: { code: '42P01', message: 'missing' } });

    const result = await issueInvoiceForPayment('payment-1');
    expect(result).toEqual({ outcome: 'unavailable', documentId: null, documentNumber: null });
  });

  it('skips a payment that was never captured', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment({ status: 'failed' }), error: null });

    const result = await issueInvoiceForPayment('payment-1');

    expect(result).toEqual({ outcome: 'skipped_not_captured', documentId: null, documentNumber: null });
    expect(issueDocumentIfEnabledMock).not.toHaveBeenCalled();
  });

  it('still invoices a refunded payment -- the original sale was still captured', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment({ status: 'refunded' }), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000001', alreadyIssued: false });

    const result = await issueInvoiceForPayment('payment-1');
    expect(result.outcome).toBe('issued');
  });

  it('builds a top-up line item from the purchase snapshot and issues using the payment snapshot as customer', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment(), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000001', alreadyIssued: false });

    const result = await issueInvoiceForPayment('payment-1');

    expect(result).toEqual({ outcome: 'issued', documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000001' });
    expect(loadBillingProfileMock).not.toHaveBeenCalled(); // the payment already carries a customer snapshot
    const call = issueDocumentIfEnabledMock.mock.calls[0][0];
    expect(call.documentType).toBe('tax_invoice');
    expect(call.providerMode).toBe('test');
    expect(call.paymentId).toBe('payment-1');
    expect(call.refundId).toBeNull();
    expect(call.lineItems).toEqual([
      { description: '120 Coins — Kissago coins top-up', sac: '998439', quantity: 1, unit: 'NOS', netMinor: 1000 },
    ]);
    expect(call.customerSnapshot).toEqual({ legalName: 'Jane Doe', stateCode: '24' });
  });

  it('reports the already_issued outcome the RPC reports, rather than issuing twice', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment(), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000001', alreadyIssued: true });

    const result = await issueInvoiceForPayment('payment-1');
    expect(result.outcome).toBe('already_issued');
  });

  it('passes through issuing_disabled from issueDocumentIfEnabled', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment(), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: false, reason: 'issuing_disabled' });

    const result = await issueInvoiceForPayment('payment-1');
    expect(result).toEqual({ outcome: 'issuing_disabled', documentId: null, documentNumber: null });
  });

  it('resolves the plan name and interval for a subscription payment via the embedded join', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', {
      data: fakePayment({
        kind: 'subscription_renewal',
        plan_version_id: 'plan-version-1',
        cycle_start: '2026-09-24T04:00:00.000Z',
        cycle_end: '2026-10-24T04:00:00.000Z',
        net_minor: 45000,
      }),
      error: null,
    });
    enqueue('pricing_plan_versions', { data: { billing_interval: 'monthly', pricing_plans: { name: 'Plus' } }, error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000002', alreadyIssued: false });

    const result = await issueInvoiceForPayment('payment-1');

    expect(result.outcome).toBe('issued');
    const call = issueDocumentIfEnabledMock.mock.calls[0][0];
    expect(call.lineItems).toEqual([
      {
        description: 'Kissago Plus plan — monthly subscription, 24 Sep 2026 to 24 Oct 2026',
        sac: '998439',
        quantity: 1,
        unit: 'NOS',
        netMinor: 45000,
      },
    ]);
  });

  it('falls back to a generic plan name when the plan-version join fails, without blocking the invoice', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment({ kind: 'subscription_first', plan_version_id: 'plan-version-1' }), error: null });
    enqueue('pricing_plan_versions', { data: null, error: { message: 'boom' } });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000003', alreadyIssued: false });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await issueInvoiceForPayment('payment-1');

    expect(result.outcome).toBe('issued');
    const call = issueDocumentIfEnabledMock.mock.calls[0][0];
    expect(call.lineItems[0].description).toContain('Kissago Kissago plan');
    errorSpy.mockRestore();
  });

  it('loads the live billing profile when the payment has no customer snapshot of its own', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment({ customer_snapshot_json: null }), error: null });
    loadBillingProfileMock.mockResolvedValueOnce({ status: 'ok', profile: { id: 'profile-1' } as any });
    buildCustomerSnapshotMock.mockReturnValueOnce({ legalName: 'Live Profile', stateCode: '24' } as any);
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000004', alreadyIssued: false });

    const result = await issueInvoiceForPayment('payment-1');

    expect(result.outcome).toBe('issued');
    expect(loadBillingProfileMock).toHaveBeenCalledWith(supabase, 'user-1');
    const call = issueDocumentIfEnabledMock.mock.calls[0][0];
    expect(call.customerSnapshot).toEqual({ legalName: 'Live Profile', stateCode: '24' });
  });

  it('falls back to the minimal place-of-supply shape when neither a snapshot nor a live profile exists', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_payments', { data: fakePayment({ customer_snapshot_json: null, user_id: null }), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-1', documentNumber: 'TEST-KG/26-27/000005', alreadyIssued: false });

    const result = await issueInvoiceForPayment('payment-1');

    expect(result.outcome).toBe('issued');
    expect(loadBillingProfileMock).not.toHaveBeenCalled();
    const call = issueDocumentIfEnabledMock.mock.calls[0][0];
    expect(call.customerSnapshot).toEqual({ stateCode: '24', profileType: 'personal' });
  });
});

describe('issueCreditNoteForRefund', () => {
  function fakeRefund(overrides: Record<string, unknown> = {}) {
    return {
      id: 'refund-1',
      subject_ref: 'user-1',
      payment_id: 'payment-1',
      provider: 'razorpay',
      provider_mode: 'test',
      provider_refund_id: 'rfnd_1',
      amount_minor: 1180,
      net_minor: 1000,
      tax_minor: 180,
      currency_code: 'INR',
      status: 'processed',
      ...overrides,
    };
  }

  it('returns not_found when the refund itself does not exist', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', { data: null, error: null });

    const result = await issueCreditNoteForRefund('refund-1');
    expect(result).toEqual({ outcome: 'not_found', documentId: null, documentNumber: null });
  });

  it('skips a refund with no local payment match, without querying billing_documents', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', { data: fakeRefund({ payment_id: null }), error: null });

    const result = await issueCreditNoteForRefund('refund-1');

    expect(result).toEqual({ outcome: 'skipped_no_original', documentId: null, documentNumber: null });
    expect(calls).not.toContain('billing_documents');
  });

  it('skips when no issued tax invoice exists for the payment', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', { data: fakeRefund(), error: null });
    enqueue('billing_documents', { data: null, error: null });

    const result = await issueCreditNoteForRefund('refund-1');
    expect(result).toEqual({ outcome: 'skipped_no_original', documentId: null, documentNumber: null });
    expect(issueDocumentIfEnabledMock).not.toHaveBeenCalled();
  });

  it('issues a credit note referencing the original invoice, with the refund net as the line amount', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', { data: fakeRefund(), error: null });
    enqueue('billing_documents', {
      data: {
        id: 'doc-1',
        document_number: 'TEST-KG/26-27/000001',
        line_items_json: [{ description: '120 Coins — Kissago coins top-up', sac: '998439', quantity: 1, unit: 'NOS', netMinor: 1000 }],
      },
      error: null,
    });
    enqueue('billing_payments', { data: fakePayment(), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-2', documentNumber: 'TEST-KGC/26-27/000001', alreadyIssued: false });

    const result = await issueCreditNoteForRefund('refund-1');

    expect(result).toEqual({ outcome: 'issued', documentId: 'doc-2', documentNumber: 'TEST-KGC/26-27/000001' });
    const call = issueDocumentIfEnabledMock.mock.calls[0][0];
    expect(call.documentType).toBe('credit_note');
    expect(call.refundId).toBe('refund-1');
    expect(call.paymentId).toBeNull();
    expect(call.originalDocumentId).toBe('doc-1');
    expect(call.netMinor).toBe(1000);
    expect(call.lineItems[0].description).toContain('Refund against invoice TEST-KG/26-27/000001');
  });

  it('reports already_issued rather than issuing a second credit note', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', { data: fakeRefund(), error: null });
    enqueue('billing_documents', { data: { id: 'doc-1', document_number: 'TEST-KG/26-27/000001', line_items_json: [] }, error: null });
    enqueue('billing_payments', { data: fakePayment(), error: null });
    issueDocumentIfEnabledMock.mockResolvedValueOnce({ issued: true, documentId: 'doc-2', documentNumber: 'TEST-KGC/26-27/000001', alreadyIssued: true });

    const result = await issueCreditNoteForRefund('refund-1');
    expect(result.outcome).toBe('already_issued');
  });

  it('fails closed with unavailable when the schema is missing on the refund lookup', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    createAdminClientMock.mockReturnValue(supabase);
    enqueue('billing_refunds', { data: null, error: { code: 'PGRST205', message: 'missing' } });

    const result = await issueCreditNoteForRefund('refund-1');
    expect(result).toEqual({ outcome: 'unavailable', documentId: null, documentNumber: null });
  });
});
