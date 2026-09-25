import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  verifyAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

vi.mock('@/lib/billing/notifications/queue', () => ({
  enqueueBillingJob: vi.fn(),
  kickBillingJobs: vi.fn(),
}));

// lib/billing/schema-availability.shared.ts is NOT mocked -- isMissingBillingSchemaError is used for
// real here, the same way admin-billing-actions.test.ts leaves its own pure collaborators unmocked.

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { enqueueBillingJob, kickBillingJobs } from '@/lib/billing/notifications/queue';
import {
  retryBillingJob,
  resendBillingDocument,
  retryBillingJobSettled,
  resendBillingDocumentSettled,
} from './admin-billing-jobs';

const verifyAdminMock = vi.mocked(verifyAdmin);
const createAdminClientMock = vi.mocked(createAdminClient);
const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const enqueueBillingJobMock = vi.mocked(enqueueBillingJob);
const kickBillingJobsMock = vi.mocked(kickBillingJobs);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

type Op = 'select' | 'insert' | 'update';

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  eqCalls: [string, unknown][] = [];
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq(column: string, value: unknown) {
    this.eqCalls.push([column, value]);
    return this;
  }
  insert(_row: unknown) { return this; }
  update(_row: unknown) { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  single(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

/**
 * Fake admin client for admin-billing-jobs.ts's two actions -- modeled on
 * admin-billing-actions.test.ts's createFakeSupabase (same queue-per-table+op, FIFO, "peek the last
 * one forever" shape), plus an `auth.admin.getUserById` stub that resendBillingDocument needs and
 * refundBillingPayment's fake never did.
 */
function createFakeSupabase() {
  const queues: Record<string, QueryResult[]> = {};
  const calls: { table: string; op: Op; payload?: unknown; builder: FakeQueryBuilder }[] = [];

  function enqueue(table: string, op: Op, result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: Op): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`admin-billing-jobs.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

  const supabase = {
    from(table: string) {
      return {
        select: () => {
          const builder = new FakeQueryBuilder(dequeue(table, 'select'));
          calls.push({ table, op: 'select', builder });
          return builder;
        },
        insert: (row: unknown) => {
          const builder = new FakeQueryBuilder(dequeue(table, 'insert'));
          calls.push({ table, op: 'insert', payload: row, builder });
          return builder;
        },
        update: (row: unknown) => {
          const builder = new FakeQueryBuilder(dequeue(table, 'update'));
          calls.push({ table, op: 'update', payload: row, builder });
          return builder;
        },
      };
    },
    auth: { admin: { getUserById } },
  };

  return { supabase: supabase as any, enqueue, calls, getUserById };
}

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    kind: 'document_issued',
    status: 'failed',
    subject_ref: USER_ID,
    user_id: USER_ID,
    payload_json: {},
    ...overrides,
  };
}

function fakeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    subject_ref: USER_ID,
    status: 'issued',
    document_number: 'INV-0001',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyAdminMock.mockResolvedValue({ user: { id: 'admin-1' } } as any);
  getFeatureFlagMock.mockResolvedValue(true); // billing_emails_enabled: on by default
});

describe('retryBillingJob', () => {
  it('throws when verifyAdmin rejects, and never touches the database', async () => {
    verifyAdminMock.mockRejectedValueOnce(new Error('Forbidden'));
    const fake = createFakeSupabase();
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(retryBillingJob({ jobId: JOB_ID })).rejects.toThrow('Forbidden');
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it('throws on an invalid job id before creating an admin client', async () => {
    await expect(retryBillingJob({ jobId: 'not-a-uuid' })).rejects.toThrow(/valid job id/);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('throws when the job does not exist', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', { data: null, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(retryBillingJob({ jobId: JOB_ID })).rejects.toThrow(/not found/);
  });

  it('throws with the job\'s current status when it is not "failed"', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', { data: fakeJob({ status: 'pending' }), error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(retryBillingJob({ jobId: JOB_ID })).rejects.toThrow(/is "pending", not "failed"/);
  });

  it('reports "not available on this environment" when the job lookup fails with a missing-schema error', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', {
      data: null,
      error: { code: '42P01', message: 'relation "billing_notification_jobs" does not exist' },
    });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(retryBillingJob({ jobId: JOB_ID })).rejects.toThrow(/not available on this environment/);
  });

  it('resets a failed job to pending, stamps adminRetryAt, guards the update, audits, and kicks the worker', async () => {
    const fake = createFakeSupabase();
    const job = fakeJob({ status: 'failed', payload_json: { existingKey: 'kept' } });
    fake.enqueue('billing_notification_jobs', 'select', { data: job, error: null });
    fake.enqueue('billing_notification_jobs', 'update', { data: { id: JOB_ID }, error: null });
    fake.enqueue('admin_user_audit_events', 'insert', { data: { id: 'audit-1' }, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await retryBillingJob({ jobId: JOB_ID });

    expect(result).toEqual({ retried: true });

    const update = fake.calls.find((c) => c.table === 'billing_notification_jobs' && c.op === 'update');
    expect(update).toBeDefined();
    expect(update!.payload).toMatchObject({
      status: 'pending',
      attempt_count: 0,
      last_error: null,
    });
    const updatePayload = update!.payload as Record<string, unknown>;
    expect(updatePayload.next_attempt_at).toEqual(expect.any(String));
    expect(updatePayload.payload_json).toMatchObject({
      existingKey: 'kept',
      adminRetryAt: expect.any(String),
    });
    // Guarded update: .eq('id', jobId).eq('status', 'failed').
    expect(update!.builder.eqCalls).toEqual([
      ['id', JOB_ID],
      ['status', 'failed'],
    ]);

    const audit = fake.calls.find((c) => c.table === 'admin_user_audit_events' && c.op === 'insert');
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({
      action_type: 'billing_job_retried',
      target_user_id: job.user_id,
      actor_user_id: 'admin-1',
    });

    expect(kickBillingJobsMock).toHaveBeenCalledTimes(1);
  });

  it('throws "no longer failed" when the guarded update matches no row', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', { data: fakeJob({ status: 'failed' }), error: null });
    fake.enqueue('billing_notification_jobs', 'update', { data: null, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(retryBillingJob({ jobId: JOB_ID })).rejects.toThrow(/no longer failed/);
  });

  it('does not fail the retry when the audit insert errors (e.g. a CHECK violation)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', { data: fakeJob({ status: 'failed' }), error: null });
    fake.enqueue('billing_notification_jobs', 'update', { data: { id: JOB_ID }, error: null });
    fake.enqueue('admin_user_audit_events', 'insert', {
      data: null,
      error: { code: '23514', message: 'new row for relation violates check constraint' },
    });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await retryBillingJob({ jobId: JOB_ID });

    expect(result).toEqual({ retried: true });
    expect(kickBillingJobsMock).toHaveBeenCalledTimes(1);
  });
});

describe('resendBillingDocument', () => {
  it('throws when the document does not exist', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: null, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(resendBillingDocument({ documentId: DOC_ID })).rejects.toThrow(/not found/);
  });

  it('throws when the document is not "issued"', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc({ status: 'draft' }), error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(resendBillingDocument({ documentId: DOC_ID })).rejects.toThrow(/is "draft", not "issued"/);
  });

  it('throws when billing emails are switched off, and enqueues nothing', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc(), error: null });
    getFeatureFlagMock.mockResolvedValueOnce(false);
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(resendBillingDocument({ documentId: DOC_ID })).rejects.toThrow(/Billing emails are switched off/);
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });

  it('treats a 404 from the auth lookup as a deleted account', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc(), error: null });
    fake.getUserById.mockResolvedValue({ data: { user: null }, error: { status: 404, message: 'User not found' } });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(resendBillingDocument({ documentId: DOC_ID })).rejects.toThrow('This account was deleted.');
  });

  it('treats a successful lookup with no user as a deleted account', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc(), error: null });
    fake.getUserById.mockResolvedValue({ data: { user: null }, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(resendBillingDocument({ documentId: DOC_ID })).rejects.toThrow('This account was deleted.');
  });

  it('reports a non-404 auth lookup error as a check failure, not a deletion', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc(), error: null });
    fake.getUserById.mockResolvedValue({ data: { user: null }, error: { status: 500, message: 'upstream timeout' } });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(resendBillingDocument({ documentId: DOC_ID })).rejects.toThrow(/Could not check the account/);
    try {
      await resendBillingDocument({ documentId: DOC_ID });
      throw new Error('expected resendBillingDocument to throw');
    } catch (err) {
      expect((err as Error).message).not.toMatch(/deleted/i);
    }
  });

  it('enqueues a resend, audits, and kicks the worker for a happy-path resend', async () => {
    const fake = createFakeSupabase();
    const doc = fakeDoc({ subject_ref: USER_ID, document_number: 'INV-0042' });
    fake.enqueue('billing_documents', 'select', { data: doc, error: null });
    fake.getUserById.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    fake.enqueue('admin_user_audit_events', 'insert', { data: { id: 'audit-2' }, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await resendBillingDocument({ documentId: DOC_ID });

    expect(result).toEqual({ enqueued: true });
    expect(enqueueBillingJobMock).toHaveBeenCalledTimes(1);
    const [enqueueArg] = enqueueBillingJobMock.mock.calls[0]!;
    expect(enqueueArg).toMatchObject({
      kind: 'document_resend',
      documentId: DOC_ID,
      subjectRef: USER_ID,
      userId: USER_ID,
    });
    expect(enqueueArg.dedupeKey).toMatch(new RegExp(`^resend:${DOC_ID}:`));

    const audit = fake.calls.find((c) => c.table === 'admin_user_audit_events' && c.op === 'insert');
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({
      action_type: 'billing_document_resent',
      target_user_id: USER_ID,
      actor_user_id: 'admin-1',
    });

    expect(kickBillingJobsMock).toHaveBeenCalledTimes(1);
  });
});

describe('settled wrappers', () => {
  it('retryBillingJobSettled turns a refusal into { ok: false, error }', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', { data: null, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await retryBillingJobSettled({ jobId: JOB_ID });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not found/) });
  });

  it('retryBillingJobSettled returns { ok: true, result } on success', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_notification_jobs', 'select', { data: fakeJob({ status: 'failed' }), error: null });
    fake.enqueue('billing_notification_jobs', 'update', { data: { id: JOB_ID }, error: null });
    fake.enqueue('admin_user_audit_events', 'insert', { data: { id: 'audit-3' }, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await retryBillingJobSettled({ jobId: JOB_ID });

    expect(result).toEqual({ ok: true, result: { retried: true } });
  });

  it('resendBillingDocumentSettled turns a refusal into { ok: false, error }', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc({ status: 'draft' }), error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await resendBillingDocumentSettled({ documentId: DOC_ID });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/is "draft", not "issued"/) });
  });

  it('resendBillingDocumentSettled returns { ok: true, result } on success', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('billing_documents', 'select', { data: fakeDoc(), error: null });
    fake.getUserById.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    fake.enqueue('admin_user_audit_events', 'insert', { data: { id: 'audit-4' }, error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await resendBillingDocumentSettled({ documentId: DOC_ID });

    expect(result).toEqual({ ok: true, result: { enqueued: true } });
  });
});
