import { NextResponse } from 'next/server';
import { RazorpayConfigError, verifyRazorpayWebhookSignature } from '@/lib/billing/razorpay';
import { redactRazorpayPayload } from '@/lib/billing/razorpay-redact.shared';
import { isUniqueViolation } from '@/lib/billing/razorpay-sync';
import { processRazorpayWebhookEvent, type RazorpayWebhookPayload } from '@/lib/billing/razorpay-webhook';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DbBillingWebhookEvent } from '@/lib/types/database';

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  const eventId = request.headers.get('x-razorpay-event-id');

  if (!signature || !eventId) {
    return NextResponse.json({ error: 'Missing Razorpay webhook headers' }, { status: 400 });
  }

  let signatureValid: boolean;
  try {
    signatureValid = verifyRazorpayWebhookSignature(rawBody, signature);
  } catch (err) {
    if (err instanceof RazorpayConfigError) {
      console.error('[razorpay.webhook] config_error', { reason: err.reason });
      return NextResponse.json({ error: 'Webhook is not configured' }, { status: 500 });
    }
    throw err;
  }

  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid Razorpay webhook signature' }, { status: 400 });
  }

  const payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  const admin = createAdminClient();

  const existingResult = await admin
    .from('billing_webhook_events')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_event_id', eventId)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to check existing webhook');

  const existing = (existingResult.data ?? null) as DbBillingWebhookEvent | null;
  let webhookEventId: string;

  if (existing) {
    if (existing.status === 'processed' || existing.status === 'ignored') {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const receivedRecently = Date.now() - new Date(existing.received_at).getTime() < DUPLICATE_WINDOW_MS;
    if (existing.status === 'received' && receivedRecently) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const reopenResult = await admin
      .from('billing_webhook_events')
      .update({
        status: 'received',
        attempt_count: existing.attempt_count + 1,
        last_attempt_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', existing.id);

    throwIfQueryFailed(reopenResult.error, 'Failed to reopen webhook event for reprocessing');
    webhookEventId = existing.id;
  } else {
    const insertResult = await admin
      .from('billing_webhook_events')
      .insert({
        provider: 'razorpay',
        event_type: payload.event,
        provider_event_id: eventId,
        provider_account_id: payload.account_id ?? null,
        status: 'received',
        payload_json: redactRazorpayPayload(payload as unknown as Record<string, unknown>),
        last_attempt_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertResult.error) {
      if (isUniqueViolation(insertResult.error)) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      throwIfQueryFailed(insertResult.error, 'Failed to insert webhook event');
    }

    webhookEventId = insertResult.data!.id;
  }

  try {
    const processResult = await processRazorpayWebhookEvent({ supabase: admin, payload });

    const updateResult = await admin
      .from('billing_webhook_events')
      .update({
        status: processResult.status,
        outcome: processResult.outcome,
        related_user_id: processResult.relatedUserId,
        related_subscription_id: processResult.relatedSubscriptionId,
        processed_at: new Date().toISOString(),
      })
      .eq('id', webhookEventId);

    throwIfQueryFailed(updateResult.error, 'Failed to update processed webhook event');

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = String(err?.message ?? 'Webhook processing failed').slice(0, 500);
    const failResult = await admin
      .from('billing_webhook_events')
      .update({
        status: 'failed',
        error_message: message,
        processed_at: new Date().toISOString(),
      })
      .eq('id', webhookEventId);

    throwIfQueryFailed(failResult.error, 'Failed to update failed webhook event');

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
