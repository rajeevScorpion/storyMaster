import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

const { adminState } = vi.hoisted(() => ({ adminState: { client: null as any } }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => adminState.client),
}));

const afterMock = vi.fn();
vi.mock('next/server', () => ({
  after: (cb: () => void) => afterMock(cb),
}));

import { getFeatureFlag } from '@/lib/ai/model-config';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  enqueueBillingJob,
  kickBillingJobs,
  resetBillingJobsQueueSchemaLatchForTests,
  shouldEnqueue,
} from './queue';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const createAdminClientMock = vi.mocked(createAdminClient);

interface UpsertCall {
  row: unknown;
  options: unknown;
}

function makeFakeAdmin(result: { error: { code?: string; message: string } | null }) {
  const upsertCalls: UpsertCall[] = [];
  const client = {
    from: (_table: string) => ({
      upsert: (row: unknown, options: unknown) => {
        upsertCalls.push({ row, options });
        return Promise.resolve(result);
      },
    }),
  };
  return { client, upsertCalls };
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  resetBillingJobsQueueSchemaLatchForTests();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('shouldEnqueue', () => {
  it('is true when only billing_emails_enabled is on', async () => {
    getFeatureFlagMock.mockImplementation(async (key) => key === 'billing_emails_enabled');
    expect(await shouldEnqueue()).toBe(true);
  });

  it('is true when only billing_document_issuing_enabled is on', async () => {
    getFeatureFlagMock.mockImplementation(async (key) => key === 'billing_document_issuing_enabled');
    expect(await shouldEnqueue()).toBe(true);
  });

  it('is false when both are off', async () => {
    getFeatureFlagMock.mockResolvedValue(false);
    expect(await shouldEnqueue()).toBe(false);
  });
});

describe('enqueueBillingJob', () => {
  it('does not touch the database when both switches are off', async () => {
    getFeatureFlagMock.mockResolvedValue(false);

    await enqueueBillingJob({ kind: 'payment_receipt', dedupeKey: 'payment:pay-1', subjectRef: 'user-1', userId: 'user-1' });

    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('upserts with ON CONFLICT (dedupe_key) DO NOTHING and the mapped row, then kicks the worker', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { client, upsertCalls } = makeFakeAdmin({ error: null });
    adminState.client = client;
    afterMock.mockImplementation((cb: () => void) => cb());

    await enqueueBillingJob({
      kind: 'refund_processed',
      dedupeKey: 'refund:refund-1',
      subjectRef: 'user-1',
      userId: 'user-1',
      refundId: 'refund-1',
      payload: { note: 'test' },
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].options).toEqual({ onConflict: 'dedupe_key', ignoreDuplicates: true });
    expect(upsertCalls[0].row).toMatchObject({
      dedupe_key: 'refund:refund-1',
      kind: 'refund_processed',
      subject_ref: 'user-1',
      user_id: 'user-1',
      refund_id: 'refund-1',
      payment_id: null,
      billing_subscription_id: null,
      document_id: null,
      payload_json: { note: 'test' },
    });
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/jobs/run'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('never throws when the insert fails with a real database error', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { client } = makeFakeAdmin({ error: { code: '23505', message: 'boom' } });
    adminState.client = client;

    await expect(
      enqueueBillingJob({ kind: 'payment_receipt', dedupeKey: 'payment:pay-1', subjectRef: 'user-1', userId: 'user-1' })
    ).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never throws when createAdminClient itself throws', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    createAdminClientMock.mockImplementationOnce(() => {
      throw new Error('no service role key');
    });

    await expect(
      enqueueBillingJob({ kind: 'payment_receipt', dedupeKey: 'payment:pay-1', subjectRef: 'user-1', userId: 'user-1' })
    ).resolves.toBeUndefined();
  });

  it('latches off after a missing-schema error and skips the database on the next call', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const { client, upsertCalls } = makeFakeAdmin({ error: { code: '42P01', message: 'no table' } });
    adminState.client = client;

    await enqueueBillingJob({ kind: 'payment_receipt', dedupeKey: 'payment:pay-1', subjectRef: 'user-1', userId: 'user-1' });
    expect(upsertCalls).toHaveLength(1);

    createAdminClientMock.mockClear();
    await enqueueBillingJob({ kind: 'payment_receipt', dedupeKey: 'payment:pay-2', subjectRef: 'user-1', userId: 'user-1' });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});

describe('kickBillingJobs', () => {
  it('uses after() when it is available', () => {
    afterMock.mockImplementation(() => {});
    kickBillingJobs();
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to a bare fetch when after() throws (no request scope)', () => {
    afterMock.mockImplementation(() => {
      throw new Error('after() was called outside a request scope');
    });
    kickBillingJobs();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/jobs/run'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
