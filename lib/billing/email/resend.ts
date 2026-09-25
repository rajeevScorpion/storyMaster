import 'server-only';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §1 "Resend", §4 Unit C1): the thin fetch-based
 * Resend client. No SDK -- the plan's own fact-check found the API needs none (`POST
 * https://api.resend.com/emails`, bearer key, `{id}` back), and one fewer dependency is one fewer
 * thing to vendor/patch.
 *
 * Two typed failure shapes the runner (lib/billing/notifications/runner.ts) branches on without
 * parsing a message string:
 * - `EmailNotConfiguredError`: no RESEND_API_KEY. Distinct from a send failure because it means every
 *   job of this kind will fail the same way until an env var changes -- retrying on a timer cannot
 *   help, but it also isn't the caller's fault the way a bad address is.
 * - `EmailSendError.retryable`: a 429 (rate limit) or 5xx or a network failure never reached Resend's
 *   own validation, so the same request may well succeed later. Any other 4xx (bad address, bad
 *   payload) is Resend rejecting the request on its merits -- retrying the identical body cannot
 *   change the outcome.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Kissago Billing <billing@kissago.cc>';

export class EmailNotConfiguredError extends Error {
  constructor(message = 'RESEND_API_KEY is not configured.') {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

/** `status` is null only for a network failure (fetch itself rejected) -- there was no HTTP response
 * to carry a status code. */
export class EmailSendError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(message: string, options: { retryable: boolean; status: number | null }) {
    super(message);
    this.name = 'EmailSendError';
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file bytes, exactly as Resend's `attachments[].content` expects. */
  content: string;
}

export interface EmailTag {
  name: string;
  value: string;
}

export interface SendBillingEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Resend dedupes on this for 24h -- callers pass the job's dedupe_key so a retried worker run can
   * never double-send the same job. */
  idempotencyKey: string;
  tags?: EmailTag[];
}

export interface SendBillingEmailResult {
  id: string;
}

function resolveFrom(): string {
  return process.env.BILLING_EMAIL_FROM?.trim() || DEFAULT_FROM;
}

function resolveReplyTo(): string | null {
  return process.env.SUPPORT_EMAIL?.trim() || null;
}

interface ResendErrorBody {
  message?: string;
  name?: string;
}

/**
 * Sends one billing email through Resend. Throws `EmailNotConfiguredError` when no API key is set,
 * or `EmailSendError` (see its `retryable` flag) for anything else that goes wrong. Never returns a
 * "partial" result -- a caller either gets a provider message id back, or an exception to classify.
 */
export async function sendBillingEmail(input: SendBillingEmailInput): Promise<SendBillingEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailNotConfiguredError();
  }

  const replyTo = resolveReplyTo();
  const body: Record<string, unknown> = {
    from: resolveFrom(),
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  };

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // fetch itself rejected -- DNS, TLS, timeout, offline. No response to classify by status, but
    // always worth another attempt.
    throw new EmailSendError(
      `Resend request failed before a response arrived: ${error instanceof Error ? error.message : 'network error'}`,
      { retryable: true, status: null }
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    let message = `Resend request failed with status ${response.status}`;
    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as ResendErrorBody;
        if (parsed.message) message = `Resend request failed: ${parsed.message}`;
      } catch {
        message = `Resend request failed with status ${response.status}: ${rawBody.slice(0, 200)}`;
      }
    }
    // 429 is a 4xx but means "try again later", not "this request is wrong" -- so it's carved out of
    // the general 4xx-is-permanent rule alongside 5xx and the network case above.
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailSendError(message, { retryable, status: response.status });
  }

  const okBody = (await response.json().catch(() => null)) as { id?: string } | null;
  if (!okBody?.id) {
    throw new EmailSendError('Resend returned 200 with no message id.', { retryable: true, status: response.status });
  }
  return { id: okBody.id };
}
