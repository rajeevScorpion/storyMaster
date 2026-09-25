import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/documents/issue', () => ({
  issueInvoiceForPayment: vi.fn(),
  issueCreditNoteForRefund: vi.fn(),
  resolvePlanLineItemFields: vi.fn(),
}));

vi.mock('@/lib/billing/documents/storage', () => ({
  ensureDocumentPdf: vi.fn(),
}));

vi.mock('@/lib/billing/notifications/deliver', () => ({
  deliverJobEmail: vi.fn(),
}));

import { issueInvoiceForPayment, issueCreditNoteForRefund, resolvePlanLineItemFields } from '@/lib/billing/documents/issue';
import { ensureDocumentPdf } from '@/lib/billing/documents/storage';
import { deliverJobEmail } from '@/lib/billing/notifications/deliver';
import { BILLING_JOB_PROCESSORS, type BillingJobProcessorContext } from './processors';
import { PermanentBillingJobError, type BillingNotificationJobRow } from './types.shared';

const issueInvoiceForPaymentMock = vi.mocked(issueInvoiceForPayment);
const issueCreditNoteForRefundMock = vi.mocked(issueCreditNoteForRefund);
const resolvePlanLineItemFieldsMock = vi.mocked(resolvePlanLineItemFields);
const ensureDocumentPdfMock = vi.mocked(ensureDocumentPdf);
const deliverJobEmailMock = vi.mocked(deliverJobEmail);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<T1 = QueryResult, T2 = never>(
    onFulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

/** One canned response per table -- every test here queries a given table at most once, so a queue
 * (like razorpay-sync.test.ts's) would be overkill. */
function makeFakeAdmin(responses: Record<string, QueryResult>) {
  return {
    from(table: string) {
      return new FakeQueryBuilder(responses[table] ?? { data: null, error: null });
    },
  } as any;
}

function fakeJob(overrides: Partial<BillingNotificationJobRow> = {}): BillingNotificationJobRow {
  return {
    id: 'job-1',
    dedupe_key: 'payment:pay-1',
    kind: 'payment_receipt',
    subject_ref: 'user-1',
    user_id: 'user-1',
    payment_id: 'payment-1',
    refund_id: null,
    billing_subscription_id: null,
    document_id: null,
    payload_json: {},
    status: 'processing',
    attempt_count: 1,
    max_attempts: 5,
    next_attempt_at: '2020-01-01T00:00:00.000Z',
    claimed_at: '2020-01-01T00:00:00.000Z',
    document_outcome: null,
    email_status: null,
    provider_message_id: null,
    last_error: null,
    completed_at: null,
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeCtx(responses: Record<string, QueryResult> = {}): BillingJobProcessorContext {
  return { admin: makeFakeAdmin(responses), appUrl: 'https://kissago.cc' };
}

beforeEach(() => {
  vi.clearAllMocks();
  deliverJobEmailMock.mockResolvedValue({ emailStatus: 'sent', providerMessageId: 'msg-1' });
});

describe('payment_receipt', () => {
  const processor = BILLING_JOB_PROCESSORS.payment_receipt;

  it('issues the invoice, attaches its PDF, and sends the receipt (top-up)', async () => {
    issueInvoiceForPaymentMock.mockResolvedValueOnce({ outcome: 'issued', documentId: 'doc-1', documentNumber: 'KG/26-27/000001' });
    ensureDocumentPdfMock.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      row: { document_number: 'KG/26-27/000001' } as any,
    });
    const payment = {
      id: 'payment-1', kind: 'topup', gross_minor: 53100, plan_version_id: null,
      purchase_snapshot_json: { packName: '120 Coins' },
    };
    const ctx = fakeCtx({ billing_payments: { data: payment, error: null } });

    const result = await processor(fakeJob(), ctx);

    expect(issueInvoiceForPaymentMock).toHaveBeenCalledWith('payment-1');
    expect(deliverJobEmailMock).toHaveBeenCalledTimes(1);
    const [, content, attachment] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toContain('₹531.00');
    expect(content.html).toContain('120 Coins');
    expect(attachment).toEqual({ filename: 'Kissago-KG-26-27-000001.pdf', content: Buffer.from([1, 2, 3]).toString('base64') });
    expect(result).toEqual({
      documentId: 'doc-1',
      documentOutcome: 'issued',
      emailStatus: 'sent',
      providerMessageId: 'msg-1',
    });
  });

  it('uses the renewal copy and the resolved plan name for a subscription_renewal payment', async () => {
    issueInvoiceForPaymentMock.mockResolvedValueOnce({ outcome: 'already_issued', documentId: 'doc-2', documentNumber: 'KG/26-27/000002' });
    ensureDocumentPdfMock.mockResolvedValueOnce({ bytes: new Uint8Array([9]), row: { document_number: 'KG/26-27/000002' } as any });
    resolvePlanLineItemFieldsMock.mockResolvedValueOnce({ planName: 'Kissago Pro', billingInterval: 'monthly' });
    const payment = { id: 'payment-2', kind: 'subscription_renewal', gross_minor: 19900, plan_version_id: 'plan-version-1', purchase_snapshot_json: null };
    const ctx = fakeCtx({ billing_payments: { data: payment, error: null } });

    await processor(fakeJob({ payment_id: 'payment-2' }), ctx);

    expect(resolvePlanLineItemFieldsMock).toHaveBeenCalledWith(ctx.admin, 'plan-version-1');
    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toBe('Your Kissago Pro plan renewed');
    expect(content.html).toContain('Kissago Kissago Pro plan');
  });

  it('still emails, without an attachment, when issuing is disabled', async () => {
    issueInvoiceForPaymentMock.mockResolvedValueOnce({ outcome: 'issuing_disabled', documentId: null, documentNumber: null });
    const payment = { id: 'payment-1', kind: 'topup', gross_minor: 53100, plan_version_id: null, purchase_snapshot_json: { packName: '120 Coins' } };
    const ctx = fakeCtx({ billing_payments: { data: payment, error: null } });

    const result = await processor(fakeJob(), ctx);

    expect(ensureDocumentPdfMock).not.toHaveBeenCalled();
    const [, , attachment] = deliverJobEmailMock.mock.calls[0];
    expect(attachment).toBeUndefined();
    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.html).not.toContain('invoice is attached');
    expect(result.documentId).toBeNull();
    expect(result.documentOutcome).toBe('issuing_disabled');
  });

  it('does not claim an attachment when the issued document has no PDF', async () => {
    issueInvoiceForPaymentMock.mockResolvedValueOnce({ outcome: 'issued', documentId: 'doc-1', documentNumber: 'KG/26-27/000001' });
    ensureDocumentPdfMock.mockResolvedValueOnce(null);
    const payment = { id: 'payment-1', kind: 'topup', gross_minor: 53100, plan_version_id: null, purchase_snapshot_json: { packName: '120 Coins' } };
    const ctx = fakeCtx({ billing_payments: { data: payment, error: null } });

    const result = await processor(fakeJob(), ctx);

    const [, content, attachment] = deliverJobEmailMock.mock.calls[0];
    expect(attachment).toBeUndefined();
    expect(content.html).not.toContain('invoice is attached');
    expect(result.documentId).toBe('doc-1');
  });

  it('throws PermanentBillingJobError when the payment no longer exists', async () => {
    issueInvoiceForPaymentMock.mockResolvedValueOnce({ outcome: 'not_found', documentId: null, documentNumber: null });
    const ctx = fakeCtx({});

    await expect(processor(fakeJob(), ctx)).rejects.toBeInstanceOf(PermanentBillingJobError);
    expect(deliverJobEmailMock).not.toHaveBeenCalled();
  });

  it('throws PermanentBillingJobError with no payment_id on the job', async () => {
    const ctx = fakeCtx({});
    await expect(processor(fakeJob({ payment_id: null }), ctx)).rejects.toBeInstanceOf(PermanentBillingJobError);
    expect(issueInvoiceForPaymentMock).not.toHaveBeenCalled();
  });
});

describe('refund_processed', () => {
  const processor = BILLING_JOB_PROCESSORS.refund_processed;

  it('issues the credit note, attaches its PDF, and sends the refund email', async () => {
    issueCreditNoteForRefundMock.mockResolvedValueOnce({ outcome: 'issued', documentId: 'doc-3', documentNumber: 'KGC/26-27/000001' });
    ensureDocumentPdfMock.mockResolvedValueOnce({ bytes: new Uint8Array([7]), row: { document_number: 'KGC/26-27/000001' } as any });
    const refund = { id: 'refund-1', amount_minor: 53100 };
    const ctx = fakeCtx({ billing_refunds: { data: refund, error: null } });

    const result = await processor(fakeJob({ kind: 'refund_processed', payment_id: null, refund_id: 'refund-1' }), ctx);

    expect(issueCreditNoteForRefundMock).toHaveBeenCalledWith('refund-1');
    const [, content, attachment] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toContain('₹531.00');
    expect(content.html).toContain('The credit note is attached');
    expect(attachment).toEqual({ filename: 'Kissago-KGC-26-27-000001.pdf', content: Buffer.from([7]).toString('base64') });
    expect(result).toEqual({ documentId: 'doc-3', documentOutcome: 'issued', emailStatus: 'sent', providerMessageId: 'msg-1' });
  });

  it('still emails, without a credit note, when the payment was never invoiced', async () => {
    issueCreditNoteForRefundMock.mockResolvedValueOnce({ outcome: 'skipped_no_original', documentId: null, documentNumber: null });
    const refund = { id: 'refund-1', amount_minor: 53100 };
    const ctx = fakeCtx({ billing_refunds: { data: refund, error: null } });

    const result = await processor(fakeJob({ kind: 'refund_processed', payment_id: null, refund_id: 'refund-1' }), ctx);

    const [, content, attachment] = deliverJobEmailMock.mock.calls[0];
    expect(attachment).toBeUndefined();
    expect(content.html).not.toContain('credit note is attached');
    expect(result.documentOutcome).toBe('skipped_no_original');
  });

  it('throws PermanentBillingJobError when the refund no longer exists', async () => {
    issueCreditNoteForRefundMock.mockResolvedValueOnce({ outcome: 'not_found', documentId: null, documentNumber: null });
    const ctx = fakeCtx({});

    await expect(processor(fakeJob({ kind: 'refund_processed', payment_id: null, refund_id: 'refund-1' }), ctx))
      .rejects.toBeInstanceOf(PermanentBillingJobError);
  });
});

describe('subscription_payment_failed', () => {
  const processor = BILLING_JOB_PROCESSORS.subscription_payment_failed;

  it('uses the payload graceEndsAt/shortUrl when present', async () => {
    resolvePlanLineItemFieldsMock.mockResolvedValueOnce({ planName: 'Kissago Pro', billingInterval: 'monthly' });
    const sub = { id: 'sub-1', plan_version_id: 'plan-version-1', grace_period_ends_at: null, current_period_end: '2026-09-01T00:00:00.000Z' };
    const ctx = fakeCtx({ billing_subscriptions: { data: sub, error: null } });
    const job = fakeJob({
      kind: 'subscription_payment_failed', payment_id: null, billing_subscription_id: 'sub-1',
      payload_json: { graceEndsAt: '2026-09-10T00:00:00.000Z', shortUrl: 'https://rzp.io/i/abc' },
    });

    await processor(job, ctx);

    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.html).toContain('https://rzp.io/i/abc');
    expect(content.subject).toBe("We couldn't renew your Kissago Pro plan");
  });

  it('falls back to the subscription row when the payload carries neither field', async () => {
    resolvePlanLineItemFieldsMock.mockResolvedValueOnce({ planName: 'Kissago Pro', billingInterval: 'monthly' });
    const sub = { id: 'sub-1', plan_version_id: 'plan-version-1', grace_period_ends_at: '2026-09-15T00:00:00.000Z', current_period_end: '2026-09-01T00:00:00.000Z' };
    const ctx = fakeCtx({ billing_subscriptions: { data: sub, error: null } });
    const job = fakeJob({ kind: 'subscription_payment_failed', payment_id: null, billing_subscription_id: 'sub-1', payload_json: {} });

    await processor(job, ctx);

    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.html).not.toContain('rzp.io');
  });

  it('throws PermanentBillingJobError when the subscription no longer exists', async () => {
    const ctx = fakeCtx({ billing_subscriptions: { data: null, error: null } });
    const job = fakeJob({ kind: 'subscription_payment_failed', payment_id: null, billing_subscription_id: 'sub-gone' });

    await expect(processor(job, ctx)).rejects.toBeInstanceOf(PermanentBillingJobError);
  });
});

describe('cancel_scheduled', () => {
  const processor = BILLING_JOB_PROCESSORS.cancel_scheduled;

  it('uses the payload accessUntil, falling back to the subscription row', async () => {
    const sub = { id: 'sub-1', current_period_end: '2026-10-24T00:00:00.000Z' };
    const ctx = fakeCtx({ billing_subscriptions: { data: sub, error: null } });
    const job = fakeJob({ kind: 'cancel_scheduled', payment_id: null, billing_subscription_id: 'sub-1', payload_json: {} });

    await processor(job, ctx);

    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toContain('24 Oct 2026');
  });
});

describe('subscription_ended', () => {
  const processor = BILLING_JOB_PROCESSORS.subscription_ended;

  it('resolves the plan name and sends the ended email', async () => {
    resolvePlanLineItemFieldsMock.mockResolvedValueOnce({ planName: 'Kissago Pro', billingInterval: 'monthly' });
    const sub = { id: 'sub-1', plan_version_id: 'plan-version-1' };
    const ctx = fakeCtx({ billing_subscriptions: { data: sub, error: null } });
    const job = fakeJob({ kind: 'subscription_ended', payment_id: null, billing_subscription_id: 'sub-1' });

    await processor(job, ctx);

    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toBe('Your Kissago Pro plan has ended');
  });
});

describe('renewal_reminder', () => {
  const processor = BILLING_JOB_PROCESSORS.renewal_reminder;

  it('quotes the latest charged amount for this subscription', async () => {
    resolvePlanLineItemFieldsMock.mockResolvedValueOnce({ planName: 'Kissago Pro', billingInterval: 'annual' });
    const sub = { id: 'sub-1', plan_version_id: 'plan-version-1', current_period_end: '2026-12-25T00:00:00.000Z' };
    const ctx = fakeCtx({
      billing_subscriptions: { data: sub, error: null },
      billing_payments: { data: { gross_minor: 199900 }, error: null },
    });
    const job = fakeJob({ kind: 'renewal_reminder', payment_id: null, billing_subscription_id: 'sub-1', payload_json: {} });

    await processor(job, ctx);

    const [, content] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toBe('Your Kissago Pro plan renews on 25 Dec 2026 for ₹1,999.00');
  });

  it('throws PermanentBillingJobError when there is no charged payment to quote', async () => {
    resolvePlanLineItemFieldsMock.mockResolvedValueOnce({ planName: 'Kissago Pro', billingInterval: 'annual' });
    const sub = { id: 'sub-1', plan_version_id: 'plan-version-1', current_period_end: '2026-12-25T00:00:00.000Z' };
    const ctx = fakeCtx({
      billing_subscriptions: { data: sub, error: null },
      billing_payments: { data: null, error: null },
    });
    const job = fakeJob({ kind: 'renewal_reminder', payment_id: null, billing_subscription_id: 'sub-1', payload_json: {} });

    await expect(processor(job, ctx)).rejects.toBeInstanceOf(PermanentBillingJobError);
    expect(deliverJobEmailMock).not.toHaveBeenCalled();
  });
});

describe('document_resend', () => {
  const processor = BILLING_JOB_PROCESSORS.document_resend;

  it('re-sends the document PDF as an attachment', async () => {
    ensureDocumentPdfMock.mockResolvedValueOnce({ bytes: new Uint8Array([5, 6]), row: { document_number: 'KG/26-27/000001' } as any });
    const job = fakeJob({ kind: 'document_resend', payment_id: null, document_id: 'doc-1' });

    const result = await processor(job, fakeCtx({}));

    const [, content, attachment] = deliverJobEmailMock.mock.calls[0];
    expect(content.subject).toBe('Your document KG/26-27/000001');
    expect(attachment).toEqual({ filename: 'Kissago-KG-26-27-000001.pdf', content: Buffer.from([5, 6]).toString('base64') });
    expect(result.documentId).toBe('doc-1');
  });

  it('throws PermanentBillingJobError when the document no longer exists', async () => {
    ensureDocumentPdfMock.mockResolvedValueOnce(null);
    const job = fakeJob({ kind: 'document_resend', payment_id: null, document_id: 'doc-gone' });

    await expect(processor(job, fakeCtx({}))).rejects.toBeInstanceOf(PermanentBillingJobError);
  });
});
