import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { EmailNotConfiguredError, EmailSendError, sendBillingEmail } from './resend';

const ORIGINAL_ENV = { ...process.env };
const originalFetch = global.fetch;

const INPUT = { to: 'user@example.com', subject: 'Subject', html: '<p>Body</p>', text: 'Body', idempotencyKey: 'dedupe-1' };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, RESEND_API_KEY: 'test-key' };
  delete process.env.BILLING_EMAIL_FROM;
  delete process.env.SUPPORT_EMAIL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = originalFetch;
});

describe('sendBillingEmail', () => {
  it('throws EmailNotConfiguredError when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendBillingEmail(INPUT)).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('sends with the bearer key, Idempotency-Key header, and the default From', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) });
    global.fetch = fetchMock as any;

    const result = await sendBillingEmail(INPUT);

    expect(result).toEqual({ id: 'msg-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.headers['Idempotency-Key']).toBe('dedupe-1');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Kissago Billing <billing@kissago.cc>');
    expect(body.to).toEqual(['user@example.com']);
    expect(body.reply_to).toBeUndefined();
    expect(body.attachments).toBeUndefined();
    expect(body.tags).toBeUndefined();
  });

  it('uses BILLING_EMAIL_FROM and SUPPORT_EMAIL as reply_to when set', async () => {
    process.env.BILLING_EMAIL_FROM = 'Kissago <billing@kissago.cc>';
    process.env.SUPPORT_EMAIL = 'support@kissago.cc';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) });
    global.fetch = fetchMock as any;

    await sendBillingEmail(INPUT);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('Kissago <billing@kissago.cc>');
    expect(body.reply_to).toBe('support@kissago.cc');
  });

  it('passes attachments and tags through when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) });
    global.fetch = fetchMock as any;

    await sendBillingEmail({
      ...INPUT,
      attachments: [{ filename: 'invoice.pdf', content: 'YmFzZTY0' }],
      tags: [{ name: 'kind', value: 'payment_receipt' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attachments).toEqual([{ filename: 'invoice.pdf', content: 'YmFzZTY0' }]);
    expect(body.tags).toEqual([{ name: 'kind', value: 'payment_receipt' }]);
  });

  it('classifies a network failure as retryable with no status', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
    const error = await sendBillingEmail(INPUT).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).retryable).toBe(true);
    expect((error as EmailSendError).status).toBeNull();
  });

  it('classifies a 429 as retryable', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }) as any;
    const error = await sendBillingEmail(INPUT).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).retryable).toBe(true);
    expect((error as EmailSendError).status).toBe(429);
  });

  it('classifies a 5xx as retryable', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }) as any;
    const error = await sendBillingEmail(INPUT).catch((e) => e);
    expect((error as EmailSendError).retryable).toBe(true);
  });

  it('classifies any other 4xx as permanent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'Invalid `to` field' }),
    }) as any;
    const error = await sendBillingEmail(INPUT).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).retryable).toBe(false);
    expect((error as EmailSendError).status).toBe(400);
    expect((error as EmailSendError).message).toContain('Invalid `to` field');
  });

  it('treats a 200 with no id as a retryable error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    const error = await sendBillingEmail(INPUT).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).retryable).toBe(true);
  });
});
