import 'server-only';

import crypto from 'crypto';
import type { BillingInterval } from '@/lib/types/pricing';

export const RAZORPAY_CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

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
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  notes?: Record<string, string>;
}

export function getRazorpayKeyId(): string {
  return getRazorpayConfig().keyId;
}

export function ensureRazorpayWebhookSecret(): string {
  const secret = getRazorpayConfig().webhookSecret;

  if (!secret) {
    throw new Error('Missing RAZORPAY_WEBHOOK_SECRET');
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
        description: input.description,
        amount: input.amountMinor,
        currency: input.currencyCode,
      },
      notes: input.notes ?? {},
    }),
  });
}

export async function createRazorpaySubscription(input: {
  planId: string;
  interval: BillingInterval;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: input.planId,
      total_count: input.interval === 'annual' ? 100 : 1200,
      quantity: 1,
      customer_notify: 0,
      notes: input.notes ?? {},
    }),
  });
}

export async function fetchRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscription> {
  return razorpayRequest<RazorpaySubscription>(`/subscriptions/${subscriptionId}`, {
    method: 'GET',
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
    let message = `Razorpay request failed with status ${response.status}`;

    try {
      const body = (await response.json()) as RazorpayApiErrorBody;
      const description = body.error?.description ?? body.error?.reason;
      if (description) {
        message = `Razorpay request failed: ${description}`;
      }
    } catch {
      // ignore response parsing failures
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

function getRazorpayConfig(): RazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? null;

  if (!keyId || !keySecret) {
    throw new Error('Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
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
