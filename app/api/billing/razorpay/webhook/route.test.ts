import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/billing/razorpay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/razorpay')>();
  return {
    ...actual,
    verifyRazorpayWebhookSignature: vi.fn(),
  };
});

vi.mock('@/lib/billing/razorpay-webhook', () => ({
  processRazorpayWebhookEvent: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { RazorpayConfigError, verifyRazorpayWebhookSignature } from '@/lib/billing/razorpay';
import { processRazorpayWebhookEvent } from '@/lib/billing/razorpay-webhook';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST } from './route';

const verifyRazorpayWebhookSignatureMock = vi.mocked(verifyRazorpayWebhookSignature);
const processRazorpayWebhookEventMock = vi.mocked(processRazorpayWebhookEvent);
const createAdminClientMock = vi.mocked(createAdminClient);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
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

function createFakeAdmin() {
  const queues: Record<string, QueryResult[]> = {};
  const calls: RecordedCall[] = [];

  function enqueue(table: string, op: RecordedCall['op'], result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: RecordedCall['op']): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`webhook route test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const admin = {
    from(table: string) {
      return {
        select: () => {
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
  };

  return { admin: admin as any, enqueue, calls };
}

function fakeWebhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    provider: 'razorpay',
    event_type: 'payment.captured',
    provider_event_id: 'evt_1',
    provider_account_id: null,
    status: 'received',
    related_user_id: null,
    related_subscription_id: null,
    payload_json: {},
    received_at: '2026-01-01T00:00:00.000Z',
    processed_at: null,
    error_message: null,
    attempt_count: 1,
    last_attempt_at: null,
    outcome: null,
    ...overrides,
  };
}

function postWebhook(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/billing/razorpay/webhook', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'x-razorpay-signature': 'sig_1',
      'x-razorpay-event-id': 'evt_1',
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/billing/razorpay/webhook — signature and config', () => {
  it('rejects requests missing the required headers', async () => {
    const response = await POST(
      new Request('http://localhost/api/billing/razorpay/webhook', { method: 'POST', body: '{}' })
    );
    expect(response.status).toBe(400);
    expect(verifyRazorpayWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(false);
    const response = await POST(postWebhook({ event: 'payment.captured' }));
    expect(response.status).toBe(400);
  });

  it('logs a config_error and returns 500 without touching the database when the secret is missing', async () => {
    verifyRazorpayWebhookSignatureMock.mockImplementationOnce(() => {
      throw new RazorpayConfigError('missing_webhook_secret');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(postWebhook({ event: 'payment.captured' }));

    expect(response.status).toBe(500);
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[razorpay.webhook] config_error', { reason: 'missing_webhook_secret' });
    errorSpy.mockRestore();
  });
});

describe('POST /api/billing/razorpay/webhook — dedup and bookkeeping', () => {
  it('processes a brand-new event and stores its outcome', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(true);
    const { admin, enqueue, calls } = createFakeAdmin();
    createAdminClientMock.mockReturnValue(admin);
    enqueue('billing_webhook_events', 'select', { data: null, error: null });
    enqueue('billing_webhook_events', 'insert', { data: { id: 'event-1' }, error: null });
    enqueue('billing_webhook_events', 'update', { data: null, error: null });
    processRazorpayWebhookEventMock.mockResolvedValueOnce({
      status: 'processed', outcome: 'topup_granted', relatedUserId: 'user-1', relatedSubscriptionId: null,
    });

    const response = await POST(postWebhook({ event: 'payment.captured' }));

    expect(response.status).toBe(200);
    const insertCall = calls.find((call) => call.table === 'billing_webhook_events' && call.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ provider_event_id: 'evt_1', status: 'received' });
    const updateCall = calls.find((call) => call.table === 'billing_webhook_events' && call.op === 'update');
    expect(updateCall?.payload).toMatchObject({ status: 'processed', outcome: 'topup_granted', related_user_id: 'user-1' });
  });

  it('short-circuits as a duplicate for an already-processed event', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(true);
    const { admin, enqueue } = createFakeAdmin();
    createAdminClientMock.mockReturnValue(admin);
    enqueue('billing_webhook_events', 'select', { data: fakeWebhookEvent({ status: 'processed' }), error: null });

    const response = await POST(postWebhook({ event: 'payment.captured' }));
    const json = await response.json();

    expect(json).toEqual({ ok: true, duplicate: true });
    expect(processRazorpayWebhookEventMock).not.toHaveBeenCalled();
  });

  it('short-circuits as a duplicate for a "received" event inside the 5 minute window', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(true);
    const { admin, enqueue } = createFakeAdmin();
    createAdminClientMock.mockReturnValue(admin);
    enqueue('billing_webhook_events', 'select', {
      data: fakeWebhookEvent({ status: 'received', received_at: new Date().toISOString() }),
      error: null,
    });

    const response = await POST(postWebhook({ event: 'payment.captured' }));
    const json = await response.json();

    expect(json).toEqual({ ok: true, duplicate: true });
    expect(processRazorpayWebhookEventMock).not.toHaveBeenCalled();
  });

  it('reprocesses a stuck failed event and bumps attempt_count', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(true);
    const { admin, enqueue, calls } = createFakeAdmin();
    createAdminClientMock.mockReturnValue(admin);
    enqueue('billing_webhook_events', 'select', { data: fakeWebhookEvent({ status: 'failed', attempt_count: 1 }), error: null });
    enqueue('billing_webhook_events', 'update', { data: null, error: null }); // reopen
    enqueue('billing_webhook_events', 'update', { data: null, error: null }); // processed result
    processRazorpayWebhookEventMock.mockResolvedValueOnce({
      status: 'processed', outcome: 'topup_granted', relatedUserId: 'user-1', relatedSubscriptionId: null,
    });

    const response = await POST(postWebhook({ event: 'payment.captured' }));

    expect(response.status).toBe(200);
    const updateCalls = calls.filter((call) => call.table === 'billing_webhook_events' && call.op === 'update');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].payload).toMatchObject({ status: 'received', attempt_count: 2 });
    expect(processRazorpayWebhookEventMock).toHaveBeenCalledTimes(1);
  });

  it('treats a concurrent first-delivery unique violation on insert as a duplicate', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(true);
    const { admin, enqueue } = createFakeAdmin();
    createAdminClientMock.mockReturnValue(admin);
    enqueue('billing_webhook_events', 'select', { data: null, error: null });
    enqueue('billing_webhook_events', 'insert', { data: null, error: { code: '23505', message: 'duplicate key' } });

    const response = await POST(postWebhook({ event: 'payment.captured' }));
    const json = await response.json();

    expect(json).toEqual({ ok: true, duplicate: true });
    expect(processRazorpayWebhookEventMock).not.toHaveBeenCalled();
  });

  it('marks the event failed with a truncated message and returns 500 when processing throws', async () => {
    verifyRazorpayWebhookSignatureMock.mockReturnValueOnce(true);
    const { admin, enqueue, calls } = createFakeAdmin();
    createAdminClientMock.mockReturnValue(admin);
    enqueue('billing_webhook_events', 'select', { data: null, error: null });
    enqueue('billing_webhook_events', 'insert', { data: { id: 'event-1' }, error: null });
    enqueue('billing_webhook_events', 'update', { data: null, error: null });
    processRazorpayWebhookEventMock.mockRejectedValueOnce(new Error('x'.repeat(600)));

    const response = await POST(postWebhook({ event: 'payment.captured' }));

    expect(response.status).toBe(500);
    const updateCall = calls.find((call) => call.table === 'billing_webhook_events' && call.op === 'update');
    expect((updateCall?.payload as any).status).toBe('failed');
    expect((updateCall?.payload as any).error_message.length).toBe(500);
  });
});
