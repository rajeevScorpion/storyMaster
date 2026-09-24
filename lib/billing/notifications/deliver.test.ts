import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
}));

const { adminState } = vi.hoisted(() => ({ adminState: { client: null as any } }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminState.client,
}));

vi.mock('@/lib/billing/email/resend', () => ({
  sendBillingEmail: vi.fn(),
}));

import { getFeatureFlag } from '@/lib/ai/model-config';
import { sendBillingEmail } from '@/lib/billing/email/resend';
import { deliverJobEmail } from './deliver';
import type { BillingNotificationJobRow } from './types.shared';

const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const sendBillingEmailMock = vi.mocked(sendBillingEmail);

const CONTENT = { subject: 'Subject', html: '<p>Body</p>', text: 'Body' };

function fakeJob(overrides: Partial<BillingNotificationJobRow> = {}): BillingNotificationJobRow {
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
    status: 'processing',
    attempt_count: 1,
    max_attempts: 5,
    next_attempt_at: new Date().toISOString(),
    claimed_at: new Date().toISOString(),
    document_outcome: null,
    email_status: null,
    provider_message_id: null,
    last_error: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeAdmin(options: { profileEmail?: string | null; authEmail?: string | null } = {}) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.profileEmail === undefined ? null : { billing_email: options.profileEmail },
                error: null,
              }),
            }),
          }),
        };
      },
      auth: {
        admin: {
          getUserById: async (_id: string) => {
            calls.push('auth.getUserById');
            return { data: { user: options.authEmail ? { email: options.authEmail } : null }, error: null };
          },
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendBillingEmailMock.mockResolvedValue({ id: 'msg-1' });
});

describe('deliverJobEmail', () => {
  it('skips with skipped_disabled when billing_emails_enabled is off', async () => {
    getFeatureFlagMock.mockResolvedValue(false);
    const result = await deliverJobEmail(fakeJob(), CONTENT);
    expect(result).toEqual({ emailStatus: 'skipped_disabled', providerMessageId: null });
    expect(sendBillingEmailMock).not.toHaveBeenCalled();
  });

  it('skips with skipped_deleted when the job has no user_id', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const result = await deliverJobEmail(fakeJob({ user_id: null }), CONTENT);
    expect(result).toEqual({ emailStatus: 'skipped_deleted', providerMessageId: null });
    expect(sendBillingEmailMock).not.toHaveBeenCalled();
  });

  it('skips with skipped_stale when the job is older than 72 hours', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const oldCreatedAt = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    const result = await deliverJobEmail(fakeJob({ created_at: oldCreatedAt }), CONTENT);
    expect(result).toEqual({ emailStatus: 'skipped_stale', providerMessageId: null });
    expect(sendBillingEmailMock).not.toHaveBeenCalled();
  });

  it('does not skip as stale at exactly 71 hours old', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    adminState.client = makeFakeAdmin({ profileEmail: undefined, authEmail: 'user@example.com' }).client;
    const recentCreatedAt = new Date(Date.now() - 71 * 60 * 60 * 1000).toISOString();
    const result = await deliverJobEmail(fakeJob({ created_at: recentCreatedAt, payload_json: {} }), CONTENT);
    expect(result.emailStatus).toBe('sent');
  });

  it('skips with skipped_no_address when no source has an email', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    adminState.client = makeFakeAdmin({ profileEmail: undefined, authEmail: undefined }).client;
    const result = await deliverJobEmail(fakeJob({ payload_json: {} }), CONTENT);
    expect(result).toEqual({ emailStatus: 'skipped_no_address', providerMessageId: null });
    expect(sendBillingEmailMock).not.toHaveBeenCalled();
  });

  it('prefers the payload snapshot email and skips the database entirely', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const fakeAdmin = makeFakeAdmin({ profileEmail: 'profile@example.com' });
    adminState.client = fakeAdmin.client;

    const result = await deliverJobEmail(
      fakeJob({ payload_json: { billingEmail: 'snapshot@example.com' } }),
      CONTENT
    );

    expect(result.emailStatus).toBe('sent');
    expect(fakeAdmin.calls).toHaveLength(0);
    expect(sendBillingEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'snapshot@example.com' }));
  });

  it('falls back to the live billing_profiles email when there is no snapshot email', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    adminState.client = makeFakeAdmin({ profileEmail: 'profile@example.com' }).client;

    const result = await deliverJobEmail(fakeJob({ payload_json: {} }), CONTENT);

    expect(result.emailStatus).toBe('sent');
    expect(sendBillingEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'profile@example.com' }));
  });

  it('falls back to the auth user email when the profile has none', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    adminState.client = makeFakeAdmin({ profileEmail: null, authEmail: 'auth@example.com' }).client;

    const result = await deliverJobEmail(fakeJob({ payload_json: {} }), CONTENT);

    expect(result.emailStatus).toBe('sent');
    expect(sendBillingEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'auth@example.com' }));
  });

  it('sends with the dedupe key as the Idempotency-Key, the kind tag, and an attachment when given', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const job = fakeJob({ payload_json: { billingEmail: 'user@example.com' }, dedupe_key: 'payment:pay-42', kind: 'refund_processed' });
    const attachment = { filename: 'credit-note.pdf', content: 'YmFzZTY0' };

    const result = await deliverJobEmail(job, CONTENT, attachment);

    expect(result).toEqual({ emailStatus: 'sent', providerMessageId: 'msg-1' });
    expect(sendBillingEmailMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: CONTENT.subject,
      html: CONTENT.html,
      text: CONTENT.text,
      attachments: [attachment],
      idempotencyKey: 'payment:pay-42',
      tags: [{ name: 'kind', value: 'refund_processed' }],
    });
  });

  it('sends with no attachments array when none is given', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const job = fakeJob({ payload_json: { billingEmail: 'user@example.com' } });

    await deliverJobEmail(job, CONTENT);

    expect(sendBillingEmailMock).toHaveBeenCalledWith(expect.objectContaining({ attachments: undefined }));
  });

  it('propagates a thrown send error to the caller (the runner classifies it)', async () => {
    getFeatureFlagMock.mockResolvedValue(true);
    const job = fakeJob({ payload_json: { billingEmail: 'user@example.com' } });
    sendBillingEmailMock.mockRejectedValue(new Error('resend down'));

    await expect(deliverJobEmail(job, CONTENT)).rejects.toThrow('resend down');
  });
});
