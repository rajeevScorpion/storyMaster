import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminState, processorState } = vi.hoisted(() => ({
  adminState: { client: null as any },
  processorState: { impl: null as any },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminState.client,
}));

vi.mock('@/lib/billing/notifications/processors', () => ({
  BILLING_JOB_PROCESSORS: new Proxy(
    {},
    {
      // Every kind dispatches to whatever the current test installed in processorState.impl, so a
      // single fake covers all seven kinds without listing them out.
      get: () => (...args: unknown[]) => processorState.impl(...args),
    }
  ),
}));

import {
  decideRetryOutcome,
  reclaimStaleBillingJobs,
  resetBillingJobsSchemaLatchForTests,
  runBillingJobsOnce,
} from './runner';
import { PermanentBillingJobError } from './types.shared';

// --- A tiny in-memory billing_notification_jobs table, closer to lib/account/deletion.test.ts's
// Postgrest-alike than a call-by-call recorder: runner.ts issues several different chained
// select/update sequences against the one table, and asserting on final row state is far less brittle
// than replaying the exact chain shape for each of them.
type Row = Record<string, any>;

class FakeBuilder implements PromiseLike<{ data: any; error: any; count?: number }> {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private ascending = true;
  private limitN: number | null = null;
  private wantCount = false;

  constructor(
    private readonly rows: Row[],
    private readonly mode: 'select' | 'update',
    private readonly patch: Row | null = null
  ) {}

  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  lt(col: string, val: string) { this.filters.push((r) => r[col] < val); return this; }
  lte(col: string, val: string) { this.filters.push((r) => r[col] <= val); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.ascending = opts?.ascending !== false;
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count === 'exact') this.wantCount = true;
    return this;
  }

  private matching(): Row[] {
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      matched = [...matched].sort((a, b) => {
        if (a[col] === b[col]) return 0;
        const cmp = a[col] < b[col] ? -1 : 1;
        return this.ascending ? cmp : -cmp;
      });
    }
    if (this.limitN != null) matched = matched.slice(0, this.limitN);
    return matched;
  }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: { data: any; error: any; count?: number }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    let result: { data: any; error: any; count?: number };
    if (this.mode === 'select') {
      const matched = this.matching();
      result = this.wantCount
        ? { data: null, error: null, count: matched.length }
        : { data: matched.map((r) => ({ ...r })), error: null };
    } else {
      const matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
      matched.forEach((r) => Object.assign(r, this.patch));
      result = { data: matched.map((r) => ({ ...r })), error: null };
    }
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

function makeFakeAdmin(rows: Row[]) {
  return {
    from(table: string) {
      if (table !== 'billing_notification_jobs') throw new Error(`unexpected table ${table}`);
      return {
        select: (cols?: string, opts?: { count?: string; head?: boolean }) =>
          new FakeBuilder(rows, 'select').select(cols, opts),
        update: (patch: Row) => new FakeBuilder(rows, 'update', patch),
      };
    },
  };
}

function fakeJob(overrides: Partial<Row> = {}): Row {
  return {
    id: 'job-1',
    dedupe_key: 'payment:pay-1',
    kind: 'payment_receipt',
    subject_ref: 'user-1',
    user_id: 'user-1',
    payment_id: 'pay-1',
    refund_id: null,
    billing_subscription_id: null,
    document_id: null,
    payload_json: {},
    status: 'pending',
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: '2020-01-01T00:00:00.000Z',
    claimed_at: null,
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

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  resetBillingJobsSchemaLatchForTests();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('decideRetryOutcome', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('backs off 2, 4, 8, 16 minutes for attempts 1-4 of 5', () => {
    expect(decideRetryOutcome({ attemptCount: 1, maxAttempts: 5, permanent: false, now })).toEqual({
      outcome: 'retry',
      nextAttemptAt: new Date('2026-01-01T00:02:00.000Z'),
    });
    expect(decideRetryOutcome({ attemptCount: 2, maxAttempts: 5, permanent: false, now })).toEqual({
      outcome: 'retry',
      nextAttemptAt: new Date('2026-01-01T00:04:00.000Z'),
    });
    expect(decideRetryOutcome({ attemptCount: 3, maxAttempts: 5, permanent: false, now })).toEqual({
      outcome: 'retry',
      nextAttemptAt: new Date('2026-01-01T00:08:00.000Z'),
    });
    expect(decideRetryOutcome({ attemptCount: 4, maxAttempts: 5, permanent: false, now })).toEqual({
      outcome: 'retry',
      nextAttemptAt: new Date('2026-01-01T00:16:00.000Z'),
    });
  });

  it('fails outright once attemptCount reaches maxAttempts', () => {
    expect(decideRetryOutcome({ attemptCount: 5, maxAttempts: 5, permanent: false, now })).toEqual({ outcome: 'fail' });
  });

  it('fails immediately on a permanent error regardless of attempts remaining', () => {
    expect(decideRetryOutcome({ attemptCount: 1, maxAttempts: 5, permanent: true, now })).toEqual({ outcome: 'fail' });
  });
});

describe('reclaimStaleBillingJobs', () => {
  it('returns a stale processing row to pending', async () => {
    const staleClaim = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const rows = [fakeJob({ id: 'stale', status: 'processing', claimed_at: staleClaim })];
    const admin = makeFakeAdmin(rows) as any;
    const count = await reclaimStaleBillingJobs(admin);
    expect(count).toBe(1);
    expect(rows[0].status).toBe('pending');
  });

  it('leaves a fresh processing row alone', async () => {
    const freshClaim = new Date().toISOString();
    const rows = [fakeJob({ id: 'fresh', status: 'processing', claimed_at: freshClaim })];
    const admin = makeFakeAdmin(rows) as any;
    const count = await reclaimStaleBillingJobs(admin);
    expect(count).toBe(0);
    expect(rows[0].status).toBe('processing');
  });
});

describe('runBillingJobsOnce', () => {
  it('claims a ready job, runs the processor, and marks it done with the returned fields', async () => {
    const rows = [fakeJob({ id: 'job-1' })];
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockResolvedValue({
      documentId: 'doc-1',
      documentOutcome: 'issued',
      emailStatus: 'sent',
      providerMessageId: 'msg-1',
    });

    const result = await runBillingJobsOnce();

    expect(result).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(rows[0].status).toBe('done');
    expect(rows[0].document_id).toBe('doc-1');
    expect(rows[0].document_outcome).toBe('issued');
    expect(rows[0].email_status).toBe('sent');
    expect(rows[0].provider_message_id).toBe('msg-1');
    expect(rows[0].attempt_count).toBe(1);
  });

  it('retries a job on an ordinary error, scheduling the next attempt with backoff', async () => {
    const rows = [fakeJob({ id: 'job-1', attempt_count: 0, max_attempts: 5 })];
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockRejectedValue(new Error('resend down'));

    const result = await runBillingJobsOnce();

    expect(result.failed).toBe(0);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempt_count).toBe(1);
    expect(rows[0].last_error).toBe('resend down');
    expect(new Date(rows[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('fails a job outright once attempts are exhausted', async () => {
    const rows = [fakeJob({ id: 'job-1', attempt_count: 4, max_attempts: 5 })];
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockRejectedValue(new Error('still down'));

    const result = await runBillingJobsOnce();

    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempt_count).toBe(5);
  });

  it('fails a job immediately on a PermanentBillingJobError, even on the first attempt', async () => {
    const rows = [fakeJob({ id: 'job-1', attempt_count: 0, max_attempts: 5 })];
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockRejectedValue(new PermanentBillingJobError('bad address'));

    const result = await runBillingJobsOnce();

    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].last_error).toBe('bad address');
  });

  it('truncates a very long error message to 500 characters', async () => {
    const rows = [fakeJob({ id: 'job-1', attempt_count: 4, max_attempts: 5 })];
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockRejectedValue(new Error('x'.repeat(1000)));

    await runBillingJobsOnce();

    expect(rows[0].last_error).toHaveLength(500);
  });

  it('does not re-kick when this pass cleared every ready row', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const rows = [
      fakeJob({ id: 'job-1', next_attempt_at: past }),
      fakeJob({ id: 'job-2', dedupe_key: 'payment:pay-2', next_attempt_at: past }),
    ];
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockResolvedValue({});

    const result = await runBillingJobsOnce();

    expect(result.processed).toBe(2);
    expect(result.remaining).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('re-kicks the worker when more ready rows remain than one batch (20) could claim', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const rows = Array.from({ length: 21 }, (_, i) =>
      fakeJob({ id: `job-${i}`, dedupe_key: `payment:pay-${i}`, next_attempt_at: past })
    );
    adminState.client = makeFakeAdmin(rows);
    processorState.impl = vi.fn().mockResolvedValue({});

    const result = await runBillingJobsOnce();

    expect(result.processed).toBe(20);
    expect(result.remaining).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/jobs/run'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does nothing and never throws once the schema-missing latch is set', async () => {
    const admin = {
      from() {
        return {
          update() {
            return {
              eq() { return this; },
              lt() { return this; },
              select: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'no table' } }),
            };
          },
        };
      },
    };
    adminState.client = admin;

    const result = await runBillingJobsOnce();
    expect(result).toEqual({ processed: 0, failed: 0, remaining: 0 });

    // The latch is now set process-wide -- a second call must short-circuit before touching the
    // admin client at all (it would throw if `from` were called again with this stub).
    adminState.client = null;
    await expect(runBillingJobsOnce()).resolves.toEqual({ processed: 0, failed: 0, remaining: 0 });
  });
});
