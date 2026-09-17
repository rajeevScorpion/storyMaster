import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchRazorpayPayment } from '@/lib/billing/razorpay';
import { settleTopupOrder, syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import type { DbBillingOrder, DbBillingSubscription, DbPricingPlanVersion } from '@/lib/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RazorpayWebhookPayload {
  event: string;
  account_id?: string | null;
  payload?: {
    subscription?: { entity?: { id?: string } };
    order?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; order_id?: string | null } };
    refund?: { entity?: { id?: string; payment_id?: string } };
    dispute?: { entity?: { id?: string; payment_id?: string } };
  };
}

export interface ProcessRazorpayWebhookEventResult {
  status: 'processed' | 'ignored';
  outcome: string;
  relatedUserId: string | null;
  relatedSubscriptionId: string | null;
}

/**
 * The idempotent webhook/reconcile core: figures out what a Razorpay event is about and hands it to
 * settleTopupOrder / syncSubscriptionFromProvider, which are themselves safe to call repeatedly for the
 * same money. Shared by the webhook route and the reconcile backstop so both stay in sync.
 */
export async function processRazorpayWebhookEvent(input: {
  supabase: AdminClient;
  payload: RazorpayWebhookPayload;
}): Promise<ProcessRazorpayWebhookEventResult> {
  const { supabase, payload } = input;
  const subscriptionId = payload.payload?.subscription?.entity?.id ?? null;

  if (subscriptionId) {
    return processSubscriptionEvent(supabase, payload, subscriptionId);
  }

  if (payload.event === 'payment.captured' || payload.event === 'order.paid') {
    return processTopupSuccessEvent(supabase, payload);
  }

  if (payload.event === 'payment.failed') {
    return processTopupFailureEvent(supabase, payload);
  }

  if (payload.event.startsWith('refund.')) {
    return processRefundEvent(supabase, payload);
  }

  if (payload.event.startsWith('payment.dispute.')) {
    return processDisputeEvent(supabase, payload);
  }

  return ignored('unhandled_event_type');
}

async function processSubscriptionEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload,
  subscriptionId: string
): Promise<ProcessRazorpayWebhookEventResult> {
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
    return ignored('no_matching_subscription');
  }

  const planVersion = await loadPlanVersion(supabase, planVersionId);
  const syncResult = await syncSubscriptionFromProvider({
    supabase,
    userId,
    planVersion,
    providerSubscriptionId: subscriptionId,
    checkoutOrder: subscriptionOrder,
    source: 'webhook',
    rawPayload: { event: payload.event },
  });

  if (subscriptionOrder) {
    const updateResult = await supabase
      .from('billing_orders')
      .update({
        status: syncResult.status,
        provider_payment_id: payload.payload?.payment?.entity?.id ?? subscriptionOrder.provider_payment_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionOrder.id);

    throwIfQueryFailed(updateResult.error, 'Failed to update subscription order from webhook');
  }

  return {
    status: 'processed',
    outcome: syncResult.grantedCoins > 0 ? 'cycle_granted' : 'subscription_synced',
    relatedUserId: userId,
    relatedSubscriptionId: syncResult.billingSubscriptionId,
  };
}

async function processTopupSuccessEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload
): Promise<ProcessRazorpayWebhookEventResult> {
  const providerOrderId = payload.payload?.order?.entity?.id ?? payload.payload?.payment?.entity?.order_id ?? null;
  const order = providerOrderId ? await loadTopupOrderByProviderOrderId(supabase, providerOrderId) : null;

  if (!order) {
    return ignored('no_matching_order');
  }

  const paymentId = payload.payload?.payment?.entity?.id ?? null;
  const settleResult = await settleTopupOrder({
    supabase,
    billingOrderId: order.id,
    paymentIdHint: paymentId,
    source: 'webhook',
  });

  const outcome =
    settleResult.state === 'granted' ? 'topup_granted' :
    settleResult.state === 'already_granted' ? 'topup_already_granted' :
    settleResult.state === 'refunded' ? 'refund_recorded' :
    settleResult.state === 'failed' ? 'topup_payment_failed' :
    'topup_pending';

  return { status: 'processed', outcome, relatedUserId: order.user_id, relatedSubscriptionId: null };
}

async function processTopupFailureEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload
): Promise<ProcessRazorpayWebhookEventResult> {
  const providerOrderId = payload.payload?.payment?.entity?.order_id ?? null;
  const order = providerOrderId ? await loadTopupOrderByProviderOrderId(supabase, providerOrderId) : null;

  if (!order) {
    return ignored('no_matching_order');
  }

  if (order.status !== 'paid') {
    const paymentId = payload.payload?.payment?.entity?.id ?? null;
    const updateResult = await supabase
      .from('billing_orders')
      .update({
        status: 'failed',
        provider_payment_id: paymentId ?? order.provider_payment_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    throwIfQueryFailed(updateResult.error, 'Failed to mark top-up order failed from webhook');
  }

  return { status: 'processed', outcome: 'payment_failed_recorded', relatedUserId: order.user_id, relatedSubscriptionId: null };
}

async function processRefundEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload
): Promise<ProcessRazorpayWebhookEventResult> {
  const paymentId = payload.payload?.refund?.entity?.payment_id ?? null;
  const order = paymentId ? await loadOrderByProviderPaymentId(supabase, paymentId) : null;

  if (!paymentId || !order) {
    return { status: 'processed', outcome: 'refund_unmatched', relatedUserId: null, relatedSubscriptionId: null };
  }

  if (payload.event !== 'refund.failed') {
    const payment = await fetchRazorpayPayment(paymentId);
    const nextStatus = payment.amount_refunded >= payment.amount ? 'refunded' : 'partially_refunded';

    const updateResult = await supabase
      .from('billing_orders')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', order.id);

    throwIfQueryFailed(updateResult.error, 'Failed to update order for refund webhook');
  }

  return { status: 'processed', outcome: 'refund_recorded', relatedUserId: order.user_id, relatedSubscriptionId: null };
}

async function processDisputeEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload
): Promise<ProcessRazorpayWebhookEventResult> {
  const paymentId = payload.payload?.dispute?.entity?.payment_id ?? null;
  const order = paymentId ? await loadOrderByProviderPaymentId(supabase, paymentId) : null;

  if (!order) {
    return { status: 'processed', outcome: 'dispute_unmatched', relatedUserId: null, relatedSubscriptionId: null };
  }

  const updateResult = await supabase
    .from('billing_orders')
    .update({ status: 'disputed', updated_at: new Date().toISOString() })
    .eq('id', order.id);

  throwIfQueryFailed(updateResult.error, 'Failed to update order for dispute webhook');

  return { status: 'processed', outcome: 'dispute_recorded', relatedUserId: order.user_id, relatedSubscriptionId: null };
}

async function loadTopupOrderByProviderOrderId(
  supabase: AdminClient,
  providerOrderId: string
): Promise<DbBillingOrder | null> {
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('order_type', 'topup_checkout')
    .eq('provider_order_id', providerOrderId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load Razorpay top-up order for webhook');
  return (result.data ?? null) as DbBillingOrder | null;
}

async function loadOrderByProviderPaymentId(
  supabase: AdminClient,
  providerPaymentId: string
): Promise<DbBillingOrder | null> {
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_payment_id', providerPaymentId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load Razorpay order for webhook');
  return (result.data ?? null) as DbBillingOrder | null;
}

async function loadPlanVersion(
  supabase: AdminClient,
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

function ignored(outcome: string): ProcessRazorpayWebhookEventResult {
  return { status: 'ignored', outcome, relatedUserId: null, relatedSubscriptionId: null };
}

function throwIfQueryFailed(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
