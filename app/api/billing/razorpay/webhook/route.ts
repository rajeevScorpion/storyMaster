import { NextResponse } from 'next/server';
import { fetchRazorpaySubscription, verifyRazorpayWebhookSignature } from '@/lib/billing/razorpay';
import { grantTopupIfMissing, syncRazorpaySubscriptionState } from '@/lib/billing/razorpay-sync';
import { createAdminClient } from '@/lib/supabase/admin';
import type { DbBillingOrder, DbBillingSubscription, DbPricingPlanVersion, DbPricingTopupPack } from '@/lib/types/database';

interface RazorpayWebhookPayload {
  event: string;
  account_id?: string | null;
  payload?: {
    subscription?: {
      entity?: {
        id?: string;
      };
    };
    order?: {
      entity?: {
        id?: string;
      };
    };
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
      };
    };
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  const eventId = request.headers.get('x-razorpay-event-id');

  if (!signature || !eventId) {
    return NextResponse.json({ error: 'Missing Razorpay webhook headers' }, { status: 400 });
  }

  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid Razorpay webhook signature' }, { status: 400 });
  }

  const payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  const admin = createAdminClient();

  const existingResult = await admin
    .from('billing_webhook_events')
    .select('id, status')
    .eq('provider', 'razorpay')
    .eq('provider_event_id', eventId)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to check existing webhook');

  if (existingResult.data) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const insertResult = await admin
    .from('billing_webhook_events')
    .insert({
      provider: 'razorpay',
      event_type: payload.event,
      provider_event_id: eventId,
      provider_account_id: payload.account_id ?? null,
      status: 'received',
      payload_json: payload as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();

  throwIfQueryFailed(insertResult.error, 'Failed to insert webhook event');

  const webhookEventId = insertResult.data!.id;

  try {
    const processResult = await processWebhookPayload(admin, payload);

    const updateResult = await admin
      .from('billing_webhook_events')
      .update({
        status: processResult.status,
        related_user_id: processResult.relatedUserId,
        related_subscription_id: processResult.relatedSubscriptionId,
        processed_at: new Date().toISOString(),
      })
      .eq('id', webhookEventId);

    throwIfQueryFailed(updateResult.error, 'Failed to update processed webhook event');

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const failResult = await admin
      .from('billing_webhook_events')
      .update({
        status: 'failed',
        error_message: err?.message ?? 'Webhook processing failed',
        processed_at: new Date().toISOString(),
      })
      .eq('id', webhookEventId);

    throwIfQueryFailed(failResult.error, 'Failed to update failed webhook event');

    return NextResponse.json({ error: err?.message ?? 'Webhook processing failed' }, { status: 500 });
  }
}

async function processWebhookPayload(
  supabase: ReturnType<typeof createAdminClient>,
  payload: RazorpayWebhookPayload
): Promise<{
  status: 'processed' | 'ignored';
  relatedUserId: string | null;
  relatedSubscriptionId: string | null;
}> {
  const subscriptionId = payload.payload?.subscription?.entity?.id ?? null;
  if (subscriptionId) {
    const existingSubscriptionResult = await supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('provider', 'razorpay')
      .eq('provider_subscription_id', subscriptionId)
      .maybeSingle();

    throwIfQueryFailed(existingSubscriptionResult.error, 'Failed to load existing subscription for webhook');

    const existingSubscription = (existingSubscriptionResult.data ?? null) as DbBillingSubscription | null;
    const orderResult = await supabase
      .from('billing_orders')
      .select('*')
      .eq('provider', 'razorpay')
      .eq('provider_checkout_session_id', subscriptionId)
      .maybeSingle();

    throwIfQueryFailed(orderResult.error, 'Failed to load Razorpay subscription order');

    const subscriptionOrder = (orderResult.data ?? null) as DbBillingOrder | null;
    const userId = existingSubscription?.user_id ?? subscriptionOrder?.user_id ?? null;
    const planVersionId = existingSubscription?.plan_version_id ?? subscriptionOrder?.plan_version_id ?? null;

    if (!userId || !planVersionId) {
      return { status: 'ignored', relatedUserId: null, relatedSubscriptionId: null };
    }

    const planVersion = await loadPlanVersion(supabase, planVersionId);
    const subscription = await fetchRazorpaySubscription(subscriptionId);
    const syncResult = await syncRazorpaySubscriptionState({
      supabase,
      userId,
      pricingMarketKey: planVersion.pricing_market_key,
      countryCode: planVersion.pricing_market_key === 'IN' ? 'IN' : null,
      planVersion,
      subscription,
      rawPayload: {
        kind: 'subscription_webhook',
        event: payload.event,
        payload,
      },
    });

    if (subscriptionOrder) {
      const updateResult = await supabase
        .from('billing_orders')
        .update({
          status: subscription.status,
          provider_payment_id:
            payload.payload?.payment?.entity?.id ?? subscriptionOrder.provider_payment_id,
          raw_provider_payload_json: {
            ...(subscriptionOrder.raw_provider_payload_json ?? {}),
            webhookEvent: payload.event,
            latestSubscription: subscription,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', subscriptionOrder.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update subscription order from webhook');
    }

    return {
      status: 'processed',
      relatedUserId: userId,
      relatedSubscriptionId: syncResult.billingSubscriptionId,
    };
  }

  const providerOrderId = payload.payload?.order?.entity?.id ?? payload.payload?.payment?.entity?.order_id ?? null;
  if (providerOrderId) {
    const orderResult = await supabase
      .from('billing_orders')
      .select('*')
      .eq('provider', 'razorpay')
      .eq('provider_order_id', providerOrderId)
      .maybeSingle();

    throwIfQueryFailed(orderResult.error, 'Failed to load Razorpay order for webhook');

    const billingOrder = (orderResult.data ?? null) as DbBillingOrder | null;
    if (!billingOrder) {
      return { status: 'ignored', relatedUserId: null, relatedSubscriptionId: null };
    }

    if (billingOrder.order_type === 'topup_checkout' && billingOrder.topup_pack_id) {
      const topupPack = await loadTopupPack(supabase, billingOrder.topup_pack_id);
      const grantedCoins = await grantTopupIfMissing({
        supabase,
        billingOrder,
        topupPack,
        paymentId: payload.payload?.payment?.entity?.id ?? billingOrder.provider_payment_id ?? 'webhook',
        rawPayload: payload as unknown as Record<string, unknown>,
      });

      const updateResult = await supabase
        .from('billing_orders')
        .update({
          provider_payment_id:
            payload.payload?.payment?.entity?.id ?? billingOrder.provider_payment_id,
          status: grantedCoins > 0 ? 'paid' : billingOrder.status,
          raw_provider_payload_json: {
            ...(billingOrder.raw_provider_payload_json ?? {}),
            webhookEvent: payload.event,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', billingOrder.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update top-up order from webhook');
    }

    return {
      status: 'processed',
      relatedUserId: billingOrder.user_id,
      relatedSubscriptionId: null,
    };
  }

  return { status: 'ignored', relatedUserId: null, relatedSubscriptionId: null };
}

async function loadPlanVersion(
  supabase: ReturnType<typeof createAdminClient>,
  planVersionId: string
): Promise<DbPricingPlanVersion> {
  const result = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', planVersionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan version for webhook');

  const version = (result.data ?? null) as DbPricingPlanVersion | null;
  if (!version) {
    throw new Error('Plan version not found for webhook');
  }

  return version;
}

async function loadTopupPack(
  supabase: ReturnType<typeof createAdminClient>,
  topupPackId: string
): Promise<DbPricingTopupPack> {
  const result = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('id', topupPackId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load top-up pack for webhook');

  const topup = (result.data ?? null) as DbPricingTopupPack | null;
  if (!topup) {
    throw new Error('Top-up pack not found for webhook');
  }

  return topup;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
