import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchRazorpayRefund, fetchRazorpaySubscription, getRazorpayMode, RazorpayConfigError, type RazorpayMode } from '@/lib/billing/razorpay';
import {
  nextSubscriptionCheckoutOrderStatus,
  settleTopupOrder,
  syncSubscriptionFromProvider,
} from '@/lib/billing/razorpay-sync';
import {
  applyRefundOutcome,
  processRazorpayWebhookEvent,
  resolveRefundStatus,
  type RazorpayWebhookPayload,
} from '@/lib/billing/razorpay-webhook';
import {
  MIN_AGE_MS,
  CHECKOUT_MAX_AGE_MS,
  TOPUP_MAX_AGE_MS,
  STUCK_SUBSCRIPTION_CHECKOUT_STATUSES,
  STUCK_TOPUP_STATUSES,
  RECONCILABLE_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_CHECKOUT_ORDER_TYPE,
  TOPUP_CHECKOUT_ORDER_TYPE,
  webhookIncidentOrFilter,
  subscriptionBoundaryOrFilter,
} from '@/lib/billing/billing-incidents.shared';
import type { DbBillingOrder, DbBillingPayment, DbBillingRefund, DbBillingSubscription, DbBillingWebhookEvent, DbPricingPlanVersion } from '@/lib/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;

const BUDGET_MS = 45_000;

export interface ReconcileRazorpayBillingResult {
  checkouts: number;
  subscriptions: number;
  topups: number;
  webhooks: number;
}

const ZERO_RESULT: ReconcileRazorpayBillingResult = { checkouts: 0, subscriptions: 0, topups: 0, webhooks: 0 };

/**
 * Daily backstop for Razorpay money that verify and the webhook missed (closed tab, dropped webhook
 * delivery, ...). Reuses the same idempotent core (settleTopupOrder / syncSubscriptionFromProvider /
 * processRazorpayWebhookEvent) so nothing here can grant differently than the live paths.
 */
export async function reconcileRazorpayBilling(): Promise<ReconcileRazorpayBillingResult> {
  if (!(await getFeatureFlag('billing_reconcile_enabled', false))) {
    return ZERO_RESULT;
  }

  let mode: RazorpayMode;
  try {
    mode = getRazorpayMode();
  } catch (err) {
    if (err instanceof RazorpayConfigError) {
      console.error('[razorpay.reconcile] config_error', { reason: err.reason });
      return ZERO_RESULT;
    }
    throw err;
  }

  const supabase = createAdminClient();
  const deadline = Date.now() + BUDGET_MS;

  const checkouts = await reconcileSubscriptionCheckouts(supabase, mode, deadline).catch((err) => {
    console.error('[razorpay.reconcile] checkouts failed', { message: errorMessage(err) });
    return 0;
  });

  const subscriptions = Date.now() < deadline
    ? await reconcileSubscriptions(supabase, mode, deadline).catch((err) => {
        console.error('[razorpay.reconcile] subscriptions failed', { message: errorMessage(err) });
        return 0;
      })
    : 0;

  const topups = Date.now() < deadline
    ? await reconcileTopups(supabase, mode, deadline).catch((err) => {
        console.error('[razorpay.reconcile] topups failed', { message: errorMessage(err) });
        return 0;
      })
    : 0;

  const webhooks = Date.now() < deadline
    ? await reconcileWebhooks(supabase, deadline).catch((err) => {
        console.error('[razorpay.reconcile] webhooks failed', { message: errorMessage(err) });
        return 0;
      })
    : 0;

  return { checkouts, subscriptions, topups, webhooks };
}

const PENDING_REFUND_MIN_AGE_MS = 60 * 60 * 1000; // 1 hour (phase-6-plan.md §4 Unit A2)
const PENDING_REFUND_BATCH_LIMIT = 50;

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit A2): the pending-refund backstop. A refund
 * the webhook never confirmed -- dropped delivery, or Razorpay settling it slower than an hour -- sits
 * `pending` in billing_refunds; this re-fetches it directly by id and pushes it through
 * applyRefundOutcome, the exact same tail a redelivered webhook would run (resolveRefundStatus fed
 * Razorpay's own three-valued entity.status, with no event name of its own to consult). Gated behind
 * the same `billing_reconcile_enabled` flag as reconcileRazorpayBilling -- this is the same kind of
 * Razorpay money backstop, just scoped to refunds -- and called separately from the batch reconcile
 * route (app/api/batch/reconcile/route.ts), not from inside reconcileRazorpayBilling above.
 */
export async function reconcilePendingRefunds(): Promise<number> {
  if (!(await getFeatureFlag('billing_reconcile_enabled', false))) {
    return 0;
  }

  let mode: RazorpayMode;
  try {
    mode = getRazorpayMode();
  } catch (err) {
    if (err instanceof RazorpayConfigError) {
      console.error('[razorpay.reconcile] refunds config_error', { reason: err.reason });
      return 0;
    }
    throw err;
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - PENDING_REFUND_MIN_AGE_MS).toISOString();

  const result = await supabase
    .from('billing_refunds')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(PENDING_REFUND_BATCH_LIMIT);

  throwIfQueryFailed(result.error, 'Failed to load pending refunds to reconcile');

  const refunds = (result.data ?? []) as DbBillingRefund[];
  let processed = 0;

  for (const refund of refunds) {
    // A refund not yet matched to a local payment (an unmatched renewal refund -- see
    // razorpay-webhook.ts's loadLedgerPaymentByProviderPaymentId) has nothing here for
    // applyRefundOutcome to update the payment/subscription state of; leave it for a future match.
    if (!refund.payment_id || !refund.provider_payment_id) continue;

    try {
      const payment = await loadPaymentById(supabase, refund.payment_id);
      if (!payment) continue;

      const refundEntity = await fetchRazorpayRefund(refund.provider_payment_id, refund.provider_refund_id);
      const status = resolveRefundStatus(null, refundEntity.status ?? null);
      if (status === 'pending') continue; // still not settled at Razorpay -- leave it for the next sweep

      await applyRefundOutcome({
        supabase,
        payment,
        status,
        refundEntity: { id: refundEntity.id, amount: refundEntity.amount, status: refundEntity.status ?? null },
        refundedTotalMinor: null,
        source: 'reconcile',
      });

      processed += 1;
    } catch (err) {
      console.error('[razorpay.reconcile] pending refund item failed', {
        refundId: refund.id,
        message: errorMessage(err),
      });
    }
  }

  return processed;
}

async function loadPaymentById(supabase: AdminClient, paymentId: string): Promise<DbBillingPayment | null> {
  const result = await supabase.from('billing_payments').select('*').eq('id', paymentId).maybeSingle();
  throwIfQueryFailed(result.error, 'Failed to load payment for pending refund reconcile');
  return (result.data ?? null) as DbBillingPayment | null;
}

async function reconcileSubscriptionCheckouts(
  supabase: AdminClient,
  mode: RazorpayMode,
  deadline: number
): Promise<number> {
  const now = Date.now();
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('order_type', SUBSCRIPTION_CHECKOUT_ORDER_TYPE)
    // Abandoned/superseded checkouts are included: their Razorpay subscription may still have been paid.
    .in('status', STUCK_SUBSCRIPTION_CHECKOUT_STATUSES)
    .not('provider_checkout_session_id', 'is', null)
    .lte('created_at', new Date(now - MIN_AGE_MS).toISOString())
    .gte('created_at', new Date(now - CHECKOUT_MAX_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(50);

  throwIfQueryFailed(result.error, 'Failed to load subscription checkouts to reconcile');

  const orders = (result.data ?? []) as DbBillingOrder[];
  let processed = 0;

  for (const order of orders) {
    if (Date.now() >= deadline) break;
    if (!order.provider_checkout_session_id || !order.plan_version_id) continue;

    try {
      const subscription = await fetchRazorpaySubscription(order.provider_checkout_session_id);
      if (subscription.status === 'created') {
        continue;
      }

      // An abandoned or superseded checkout that Razorpay expired or we cancelled never took money: close it
      // out so it leaves future scans, without creating a subscription row.
      if (order.status !== 'created' && ['expired', 'cancelled'].includes(subscription.status)) {
        const closeResult = await supabase
          .from('billing_orders')
          .update({ status: subscription.status, updated_at: new Date().toISOString() })
          .eq('id', order.id);

        throwIfQueryFailed(closeResult.error, 'Failed to close unpaid subscription checkout order');
        continue;
      }

      if (!order.user_id) {
        // Deleted-customer safety (payments Phase 2, plan §4 Unit B): see the identical guard in
        // reconcileSubscriptions below.
        console.warn('[razorpay.reconcile] skipping subscription checkout order with no owner', { orderId: order.id });
        continue;
      }

      const planVersion = await loadPlanVersion(supabase, order.plan_version_id);
      await syncSubscriptionFromProvider({
        supabase,
        userId: order.user_id,
        planVersion,
        providerSubscriptionId: order.provider_checkout_session_id,
        checkoutOrder: order,
        source: 'reconcile',
        rawPayload: { source: 'reconcile_checkout' },
      });

      const updateResult = await supabase
        .from('billing_orders')
        .update({
          status: nextSubscriptionCheckoutOrderStatus(order.status, subscription.status),
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update reconciled subscription checkout order');
      processed += 1;
    } catch (err) {
      console.error('[razorpay.reconcile] subscription checkout item failed', {
        orderId: order.id,
        message: errorMessage(err),
      });
    }
  }

  return processed;
}

async function reconcileSubscriptions(
  supabase: AdminClient,
  mode: RazorpayMode,
  deadline: number
): Promise<number> {
  const result = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .in('status', RECONCILABLE_SUBSCRIPTION_STATUSES)
    .or(subscriptionBoundaryOrFilter(Date.now()))
    .order('updated_at', { ascending: true })
    .limit(100);

  throwIfQueryFailed(result.error, 'Failed to load subscriptions to reconcile');

  const subscriptions = (result.data ?? []) as DbBillingSubscription[];
  let processed = 0;

  for (const subscription of subscriptions) {
    if (Date.now() >= deadline) break;

    // Deleted-customer safety (payments Phase 2, plan §4 Unit B): a subscription surviving
    // migration 125's SET NULL has no one left to grant coins to -- and should already have been
    // cancelled at Razorpay before deletion (plan §2 decision 12), so there is nothing to reconcile.
    if (!subscription.user_id) {
      console.warn('[razorpay.reconcile] skipping subscription with no owner', { subscriptionId: subscription.id });
      continue;
    }

    try {
      const planVersion = await loadPlanVersion(supabase, subscription.plan_version_id);
      await syncSubscriptionFromProvider({
        supabase,
        userId: subscription.user_id,
        planVersion,
        providerSubscriptionId: subscription.provider_subscription_id,
        source: 'reconcile',
        rawPayload: { source: 'reconcile_subscription' },
      });

      processed += 1;
    } catch (err) {
      console.error('[razorpay.reconcile] subscription item failed', {
        subscriptionId: subscription.id,
        message: errorMessage(err),
      });
    }
  }

  return processed;
}

async function reconcileTopups(
  supabase: AdminClient,
  mode: RazorpayMode,
  deadline: number
): Promise<number> {
  const now = Date.now();
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('order_type', TOPUP_CHECKOUT_ORDER_TYPE)
    .in('status', STUCK_TOPUP_STATUSES)
    .gte('created_at', new Date(now - TOPUP_MAX_AGE_MS).toISOString())
    .lte('created_at', new Date(now - MIN_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(50);

  throwIfQueryFailed(result.error, 'Failed to load top-ups to reconcile');

  const orders = (result.data ?? []) as DbBillingOrder[];
  let processed = 0;

  for (const order of orders) {
    if (Date.now() >= deadline) break;

    try {
      await settleTopupOrder({ supabase, billingOrderId: order.id, source: 'reconcile' });
      processed += 1;
    } catch (err) {
      console.error('[razorpay.reconcile] top-up item failed', {
        orderId: order.id,
        message: errorMessage(err),
      });
    }
  }

  // Orders older than 7 days still `created` with no payment are dead ends; free them from future scans.
  const abandonResult = await supabase
    .from('billing_orders')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('order_type', TOPUP_CHECKOUT_ORDER_TYPE)
    .eq('status', 'created')
    .lt('created_at', new Date(now - TOPUP_MAX_AGE_MS).toISOString());

  if (abandonResult.error) {
    console.error('[razorpay.reconcile] failed to abandon stale top-up orders', { message: abandonResult.error.message });
  }

  return processed;
}

async function reconcileWebhooks(supabase: AdminClient, deadline: number): Promise<number> {
  const result = await supabase
    .from('billing_webhook_events')
    .select('*')
    .eq('provider', 'razorpay')
    .or(webhookIncidentOrFilter(Date.now()))
    .order('received_at', { ascending: true })
    .limit(50);

  throwIfQueryFailed(result.error, 'Failed to load webhook events to reconcile');

  const events = (result.data ?? []) as DbBillingWebhookEvent[];
  let processed = 0;

  for (const event of events) {
    if (Date.now() >= deadline) break;

    try {
      const reopenResult = await supabase
        .from('billing_webhook_events')
        .update({
          status: 'received',
          attempt_count: event.attempt_count + 1,
          last_attempt_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', event.id);

      throwIfQueryFailed(reopenResult.error, 'Failed to mark webhook event for reprocessing');

      const payload = event.payload_json as unknown as RazorpayWebhookPayload;
      const processResult = await processRazorpayWebhookEvent({ supabase, payload });

      const updateResult = await supabase
        .from('billing_webhook_events')
        .update({
          status: processResult.status,
          outcome: processResult.outcome,
          related_user_id: processResult.relatedUserId,
          related_subscription_id: processResult.relatedSubscriptionId,
          processed_at: new Date().toISOString(),
        })
        .eq('id', event.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update reprocessed webhook event');
      processed += 1;
    } catch (err) {
      const message = errorMessage(err).slice(0, 500);
      const failResult = await supabase
        .from('billing_webhook_events')
        .update({ status: 'failed', error_message: message, processed_at: new Date().toISOString() })
        .eq('id', event.id);

      if (failResult.error) {
        console.error('[razorpay.reconcile] failed to mark webhook event failed', {
          eventId: event.id,
          message: failResult.error.message,
        });
      }
    }
  }

  return processed;
}

async function loadPlanVersion(supabase: AdminClient, planVersionId: string): Promise<DbPricingPlanVersion> {
  const result = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', planVersionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan version for reconcile');

  const version = (result.data ?? null) as DbPricingPlanVersion | null;
  if (!version) {
    throw new Error('Plan version not found for reconcile');
  }

  return version;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function throwIfQueryFailed(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
