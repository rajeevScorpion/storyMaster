import 'server-only';

import crypto from 'crypto';
import type { BillingInterval } from '@/lib/types/pricing';

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

interface RazorpayApiErrorBody {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
    field?: string;
    source?: string;
    step?: string;
  };
}

export interface RazorpayPlan {
  id: string;
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  item: {
    id: string;
    name: string;
    description: string | null;
    amount: number;
    currency: string;
  };
  notes?: Record<string, string>;
}

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  customer_id: string | null;
  status: string;
  current_start: number | null;
  current_end: number | null;
  charge_at: number | null;
  start_at: number | null;
  total_count: number;
  notes?: Record<string, string>;
  /** Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): Razorpay sends this on the
   * subscription entity itself (e.g. "card"), separate from any individual payment/invoice. Used as
   * the fallback rawMethod for a renewal when fetching the actual payment is skipped (a row already
   * exists) or fails. */
  payment_method?: string | null;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  notes?: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  status: string;
  amount: number;
  currency: string;
  amount_refunded: number;
  refund_status: string | null;
  invoice_id: string | null;
  captured: boolean;
  /** Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit A): received but deliberately not
   * stored verbatim -- lib/billing/ledger.ts derives a coarse method_category from this instead.
   * `card`/`bank_account`/`vpa`/etc. are intentionally absent from this type: they are never read. */
  method?: string;
  /** Razorpay's fee and tax on its fee, in minor units. Stored as provider_fee_minor/provider_tax_minor. */
  fee?: number;
  tax?: number;
  /** Epoch seconds, from Razorpay. The tax point of a top-up is when the money was taken, not when
   * we happened to observe it -- reconcile can settle an order days later, and a wall-clock stamp
   * would put the payment in the wrong financial year across a 31 March boundary. */
  created_at?: number;
}

export interface RazorpayInvoice {
  id: string;
  status: string;
  payment_id: string | null;
  billing_start: number | null;
  billing_end: number | null;
  paid_at: number | null;
  amount_paid: number;
}

export type RazorpayMode = 'test' | 'live';

/** Thrown for config problems the caller should classify by `reason`, never by parsing `message`. */
export class RazorpayConfigError extends Error {
  reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = 'RazorpayConfigError';
    this.reason = reason;
  }
}

export function getRazorpayKeyId(): string {
  return getRazorpayConfig().keyId;
}

/** Derives test/live from the key ID prefix so orders, subscriptions and plan refs never mix providers' sandboxes. */
export function getRazorpayMode(): RazorpayMode {
  const keyId = getRazorpayConfig().keyId;

  if (keyId.startsWith('rzp_test_')) {
    return 'test';
  }

  if (keyId.startsWith('rzp_live_')) {
    return 'live';
  }

  throw new RazorpayConfigError('unknown_key_prefix');
}

export function ensureRazorpayWebhookSecret(): string {
  const secret = getRazorpayConfig().webhookSecret;

  if (!secret) {
    throw new RazorpayConfigError('missing_webhook_secret', 'Missing RAZORPAY_WEBHOOK_SECRET');
  }

  return secret;
}

export async function createRazorpayPlan(input: {
  interval: BillingInterval;
  amountMinor: number;
  currencyCode: string;
  name: string;
  description: string | null;
  notes?: Record<string, string>;
}): Promise<RazorpayPlan> {
  const period = input.interval === 'annual' ? 'yearly' : 'monthly';

  return razorpayRequest<RazorpayPlan>('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period,
      interval: 1,
      item: {
        name: input.name,
        amount: input.amountMinor,
        currency: input.currencyCode,
        ...(input.description ? { description: input.description } : {}),
      },
      notes: input.notes ?? {},
    }),
  });
}

export async function createRazorpaySubscription(input: {
  planId: string;
  interval: BillingInterval;
  /** Unix seconds. Owner-approved D5: an unpaid checkout can't be resumed and paid after the modal is abandoned. */
  expireByUnix?: number;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: input.planId,
      total_count: input.interval === 'annual' ? 100 : 1200,
      quantity: 1,
      customer_notify: 1,
      ...(input.expireByUnix ? { expire_by: input.expireByUnix } : {}),
      notes: input.notes ?? {},
    }),
  });
}

export async function fetchRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>(`/subscriptions/${subscriptionId}`, {
    method: 'GET',
  });
}

export async function cancelRazorpaySubscription(input: {
  subscriptionId: string;
  atCycleEnd: boolean;
}): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>(`/subscriptions/${input.subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({
      cancel_at_cycle_end: input.atCycleEnd ? 1 : 0,
    }),
  });
}

export async function createRazorpayOrder(input: {
  amountMinor: number;
  currencyCode: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currencyCode,
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  });
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${paymentId}`, {
    method: 'GET',
  });
}

export async function captureRazorpayPayment(input: {
  paymentId: string;
  amountMinor: number;
  currencyCode: string;
}): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${input.paymentId}/capture`, {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currencyCode,
    }),
  });
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  speed_processed?: string;
  notes?: Record<string, string>;
}

/**
 * Payments Phase 4, Unit C: full refunds only (decision 11). `amount` is deliberately never sent --
 * Razorpay then refunds whatever it actually captured, rather than this app trusting its own
 * possibly-stale billing_payments row. The response's own `amount` is what the caller should record,
 * not anything computed beforehand.
 */
export async function refundRazorpayPayment(input: {
  paymentId: string;
  notes?: Record<string, string>;
}): Promise<RazorpayRefund> {
  return razorpayRequest<RazorpayRefund>(`/payments/${input.paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify({
      ...(input.notes ? { notes: input.notes } : {}),
    }),
  });
}

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit A2): fetches one refund directly by id --
 * used by the pending-refund reconcile sweep (razorpay-reconcile.ts) to re-check a refund the webhook
 * never confirmed, without re-fetching the whole payment.
 */
export async function fetchRazorpayRefund(paymentId: string, refundId: string): Promise<RazorpayRefund> {
  return razorpayRequest<RazorpayRefund>(`/payments/${paymentId}/refunds/${refundId}`, {
    method: 'GET',
  });
}

export async function fetchRazorpayOrderPayments(orderId: string): Promise<{ items: RazorpayPayment[] }> {
  return razorpayRequest<{ items: RazorpayPayment[] }>(`/orders/${orderId}/payments`, {
    method: 'GET',
  });
}

export async function fetchRazorpaySubscriptionInvoices(subscriptionId: string): Promise<{ items: RazorpayInvoice[] }> {
  return razorpayRequest<{ items: RazorpayInvoice[] }>(
    `/invoices?subscription_id=${encodeURIComponent(subscriptionId)}&count=100`,
    { method: 'GET' }
  );
}

export function verifyRazorpayOrderSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = createHmac(`${input.orderId}|${input.paymentId}`, getRazorpayConfig().keySecret);
  return timingSafeEquals(expected, input.signature);
}

export function verifyRazorpaySubscriptionSignature(input: {
  subscriptionId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = createHmac(`${input.paymentId}|${input.subscriptionId}`, getRazorpayConfig().keySecret);
  return timingSafeEquals(expected, input.signature);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = createHmac(rawBody, ensureRazorpayWebhookSecret());
  return timingSafeEquals(expected, signature);
}

export function razorpayUnixToIso(value: number | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

async function razorpayRequest<T>(path: string, init: RequestInit): Promise<T> {
  const { keyId, keySecret } = getRazorpayConfig();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let message = `Razorpay request failed with status ${response.status}`;

    if (rawBody) {
      try {
        const body = JSON.parse(rawBody) as RazorpayApiErrorBody;
        const description = body.error?.description ?? body.error?.reason;
        if (description) {
          message = `Razorpay request failed: ${description}`;
        } else {
          message = `Razorpay request failed with status ${response.status}: ${rawBody}`;
        }
      } catch {
        message = `Razorpay request failed with status ${response.status}: ${rawBody}`;
      }
    }

    if (
      response.status === 400 &&
      path === '/plans' &&
      message.includes('The requested URL was not found on the server.')
    ) {
      message = 'Razorpay Subscriptions is not enabled on this account yet. Enable the Subscriptions product in the Razorpay dashboard before testing monthly plans.';
    }

    if (
      response.status === 400 &&
      path === '/subscriptions' &&
      message.includes('The requested URL was not found on the server.')
    ) {
      message = 'Razorpay Subscriptions is not enabled on this account yet. Enable the Subscriptions product in the Razorpay dashboard before testing monthly plans.';
    }

    console.error('[razorpayRequest]', {
      path,
      status: response.status,
      message,
    });

    throw new Error(message);
  }

  return (await response.json()) as T;
}

function getRazorpayConfig(): RazorpayConfig {
  const keyId = normalizeEnvValue(process.env.RAZORPAY_KEY_ID);
  const keySecret = normalizeEnvValue(process.env.RAZORPAY_KEY_SECRET);
  const webhookSecret = normalizeEnvValue(process.env.RAZORPAY_WEBHOOK_SECRET);

  if (!keyId || !keySecret) {
    throw new RazorpayConfigError('missing_keys', 'Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
  }

  return {
    keyId,
    keySecret,
    webhookSecret,
  };
}

function createHmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEnvValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped || null;
  }

  return trimmed;
}
