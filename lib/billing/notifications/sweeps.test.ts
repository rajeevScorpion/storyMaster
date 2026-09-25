import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/notifications/queue', () => ({
  enqueueBillingJob: vi.fn(),
  shouldEnqueue: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueBillingJob, shouldEnqueue } from '@/lib/billing/notifications/queue';
import { sweepMissingReceiptJobs, sweepRenewalReminders } from './sweeps';

const createAdminClientMock = vi.mocked(createAdminClient);
const enqueueBillingJobMock = vi.mocked(enqueueBillingJob);
const shouldEnqueueMock = vi.mocked(shouldEnqueue);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

/** A minimal chainable stand-in: every filter method is a no-op passthrough, and the builder itself
 * is awaitable, matching the other billing test files' FakeQueryBuilder. */
class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  gte() { return this; }
  lte() { return this; }
  in() { return this; }
  limit() { return this; }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function fakeAdmin(result: QueryResult) {
  return { from: (_table: string) => new FakeQueryBuilder(result) } as any;
}

beforeEach(() => {
  shouldEnqueueMock.mockResolvedValue(true);
});

describe('sweepMissingReceiptJobs', () => {
  it('returns 0 and never queries when both billing switches are off', async () => {
    shouldEnqueueMock.mockResolvedValue(false);

    const count = await sweepMissingReceiptJobs();

    expect(count).toBe(0);
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });

  it('enqueues payment_receipt for every settled payment in the window, with its frozen billing email', async () => {
    createAdminClientMock.mockReturnValue(
      fakeAdmin({
        data: [
          { id: 'payment-1', subject_ref: 'user-1', user_id: 'user-1', customer_snapshot_json: { billingEmail: 'a@example.com' } },
          { id: 'payment-2', subject_ref: 'user-2', user_id: 'user-2', customer_snapshot_json: null },
        ],
        error: null,
      })
    );

    const count = await sweepMissingReceiptJobs();

    expect(count).toBe(2);
    expect(enqueueBillingJobMock).toHaveBeenCalledWith({
      kind: 'payment_receipt',
      dedupeKey: 'payment:payment-1',
      subjectRef: 'user-1',
      userId: 'user-1',
      paymentId: 'payment-1',
      payload: { billingEmail: 'a@example.com' },
    });
    expect(enqueueBillingJobMock).toHaveBeenCalledWith({
      kind: 'payment_receipt',
      dedupeKey: 'payment:payment-2',
      subjectRef: 'user-2',
      userId: 'user-2',
      paymentId: 'payment-2',
      payload: { billingEmail: null },
    });
  });

  it('skips a row with neither subject_ref nor user_id', async () => {
    createAdminClientMock.mockReturnValue(
      fakeAdmin({ data: [{ id: 'payment-3', subject_ref: null, user_id: null, customer_snapshot_json: null }], error: null })
    );

    const count = await sweepMissingReceiptJobs();

    expect(count).toBe(0);
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });

  it('fails closed (returns 0, never throws) when the ledger schema is missing', async () => {
    createAdminClientMock.mockReturnValue(fakeAdmin({ data: null, error: { code: '42P01', message: 'relation does not exist' } }));

    const count = await sweepMissingReceiptJobs();

    expect(count).toBe(0);
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });

  it('fails closed on an unrelated query error too, without throwing', async () => {
    createAdminClientMock.mockReturnValue(fakeAdmin({ data: null, error: { code: '55000', message: 'could not obtain lock' } }));

    await expect(sweepMissingReceiptJobs()).resolves.toBe(0);
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });
});

describe('sweepRenewalReminders', () => {
  it('enqueues renewal_reminder for every matching annual subscription', async () => {
    createAdminClientMock.mockReturnValue(
      fakeAdmin({
        data: [
          { id: 'sub-1', subject_ref: 'user-1', user_id: 'user-1', current_period_end: '2026-10-01T00:00:00.000Z' },
        ],
        error: null,
      })
    );

    const count = await sweepRenewalReminders();

    expect(count).toBe(1);
    expect(enqueueBillingJobMock).toHaveBeenCalledWith({
      kind: 'renewal_reminder',
      dedupeKey: 'renew:sub-1:2026-10-01T00:00:00.000Z',
      subjectRef: 'user-1',
      userId: 'user-1',
      billingSubscriptionId: 'sub-1',
      payload: { renewsAt: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('skips a row with no subject_ref and no user_id', async () => {
    createAdminClientMock.mockReturnValue(
      fakeAdmin({ data: [{ id: 'sub-2', subject_ref: null, user_id: null, current_period_end: '2026-10-01T00:00:00.000Z' }], error: null })
    );

    const count = await sweepRenewalReminders();

    expect(count).toBe(0);
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });

  it('fails closed when billing_subscriptions.billing_interval or subject_ref is missing', async () => {
    createAdminClientMock.mockReturnValue(fakeAdmin({ data: null, error: { code: '42703', message: 'column does not exist' } }));

    const count = await sweepRenewalReminders();

    expect(count).toBe(0);
    expect(enqueueBillingJobMock).not.toHaveBeenCalled();
  });

  it('returns 0 with no matching subscriptions', async () => {
    createAdminClientMock.mockReturnValue(fakeAdmin({ data: [], error: null }));

    await expect(sweepRenewalReminders()).resolves.toBe(0);
  });
});
