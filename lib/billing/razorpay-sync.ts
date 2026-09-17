import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { invalidatePricingRuntimeCacheForUser } from '@/lib/pricing/runtime-context-cache';
import {
  captureRazorpayPayment,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  fetchRazorpaySubscription,
  fetchRazorpaySubscriptionInvoices,
  getRazorpayMode,
  razorpayUnixToIso,
  type RazorpayPayment,
  type RazorpaySubscription,
} from '@/lib/billing/razorpay';
import { redactRazorpayPayload } from '@/lib/billing/razorpay-redact.shared';
import type {
  DbBillingOrder,
  DbBillingSubscription,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import { COINS_PER_BEAT, type PricingMarketKey } from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;
type BillingSource = 'verify' | 'webhook' | 'reconcile';

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/** @deprecated removed in Phase 1 Unit B — replaced by syncSubscriptionFromProvider */
export async function syncRazorpaySubscriptionState(input: {
  supabase: AdminClient;
  userId: string;
  pricingMarketKey: PricingMarketKey;
  countryCode: string | null;
  planVersion: DbPricingPlanVersion;
  subscription: RazorpaySubscription;
  rawPayload: Record<string, unknown>;
}): Promise<{
  billingSubscriptionId: string | null;
  grantedCoins: number;
}> {
  const providerCustomerId = input.subscription.customer_id ?? `pending_${input.subscription.id}`;

  if (input.subscription.customer_id) {
    const { error } = await input.supabase.from('billing_customers').upsert({
      user_id: input.userId,
      provider: 'razorpay',
      provider_customer_id: input.subscription.customer_id,
      pricing_market_key: input.pricingMarketKey,
      country_code: input.countryCode,
      currency_code: input.planVersion.currency_code,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,provider',
    });

    throwIfQueryFailed(error, 'Failed to upsert Razorpay customer');
  }

  const currentPeriodStart = razorpayUnixToIso(input.subscription.current_start);
  const currentPeriodEnd = razorpayUnixToIso(input.subscription.current_end);
  const gracePeriodEndsAt = shouldApplyGracePeriod(input.subscription.status)
    ? computeGracePeriodEnd(currentPeriodEnd, input.planVersion.grace_period_days)
    : null;

  const existingResult = await input.supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_subscription_id', input.subscription.id)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to load existing Razorpay subscription');

  const existing = (existingResult.data ?? null) as DbBillingSubscription | null;
  let billingSubscriptionId: string | null = existing?.id ?? null;

  if (existing) {
    const { error } = await input.supabase
      .from('billing_subscriptions')
      .update({
        user_id: input.userId,
        plan_version_id: input.planVersion.id,
        provider_customer_id: providerCustomerId,
        status: input.subscription.status,
        billing_interval: input.planVersion.billing_interval,
        currency_code: input.planVersion.currency_code,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: input.subscription.status === 'cancelled',
        grace_period_ends_at: gracePeriodEndsAt,
        last_webhook_at: new Date().toISOString(),
        raw_provider_state_json: input.rawPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    throwIfQueryFailed(error, 'Failed to update Razorpay subscription');
  } else {
    const insertResult = await input.supabase
      .from('billing_subscriptions')
      .insert({
        user_id: input.userId,
        plan_version_id: input.planVersion.id,
        provider: 'razorpay',
        provider_subscription_id: input.subscription.id,
        provider_customer_id: providerCustomerId,
        // 124 dropped this column's default; a fresh row must set it explicitly even on this deprecated path.
        provider_mode: getRazorpayMode(),
        status: input.subscription.status,
        billing_interval: input.planVersion.billing_interval,
        currency_code: input.planVersion.currency_code,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: input.subscription.status === 'cancelled',
        grace_period_ends_at: gracePeriodEndsAt,
        last_webhook_at: new Date().toISOString(),
        raw_provider_state_json: input.rawPayload,
      })
      .select('id')
      .single();

    throwIfQueryFailed(insertResult.error, 'Failed to insert Razorpay subscription');
    billingSubscriptionId = insertResult.data?.id ?? null;
  }

  const grantedBeats = await grantSubscriptionCycleIfMissing({
    supabase: input.supabase,
    userId: input.userId,
    planVersion: input.planVersion,
    subscription: input.subscription,
    currencyCode: input.planVersion.currency_code,
  });

  invalidatePricingRuntimeCacheForUser(input.userId);

  return {
    billingSubscriptionId,
    grantedCoins: grantedBeats * COINS_PER_BEAT,
  };
}

/** @deprecated removed in Phase 1 Unit B — replaced by settleTopupOrder */
export async function grantTopupIfMissing(input: {
  supabase: AdminClient;
  billingOrder: DbBillingOrder;
  topupPack: DbPricingTopupPack;
  paymentId: string;
  rawPayload: Record<string, unknown>;
}): Promise<number> {
  const sourceRefId = input.billingOrder.id;

  const existingResult = await input.supabase
    .from('beat_grants')
    .select('id')
    .eq('user_id', input.billingOrder.user_id)
    .eq('source_type', 'topup')
    .eq('source_ref_id', sourceRefId)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to check existing top-up grant');

  if (existingResult.data) {
    return 0;
  }

  const { error } = await input.supabase
    .from('beat_grants')
    .insert({
      user_id: input.billingOrder.user_id,
      source_type: 'topup',
      source_ref_id: sourceRefId,
      currency_code: input.billingOrder.currency_code,
      beats_total: input.topupPack.beat_amount,
      beats_remaining: input.topupPack.beat_amount,
      metadata_json: {
        billingOrderId: input.billingOrder.id,
        providerOrderId: input.billingOrder.provider_order_id,
        providerPaymentId: input.paymentId,
        topupPackId: input.topupPack.id,
        provider: 'razorpay',
        rawPayload: input.rawPayload,
      },
    });

  // 124 added a unique index on (source_type, source_ref_id): a race with another caller granting the
  // same order lands here as 23505, not as a thrown error.
  if (error) {
    if (isUniqueViolation(error)) {
      return 0;
    }
    throw new Error(`Failed to grant top-up beats: ${error.message}`);
  }

  invalidatePricingRuntimeCacheForUser(input.billingOrder.user_id);

  return input.topupPack.beat_amount * COINS_PER_BEAT;
}

async function grantSubscriptionCycleIfMissing(input: {
  supabase: AdminClient;
  userId: string;
  planVersion: DbPricingPlanVersion;
  subscription: RazorpaySubscription;
  currencyCode: string;
}): Promise<number> {
  if (!input.subscription.current_start || !input.subscription.current_end) {
    return 0;
  }

  if (!['active', 'authenticated'].includes(input.subscription.status)) {
    return 0;
  }

  const sourceRefId = `${input.subscription.id}:${input.subscription.current_start}`;
  const existingResult = await input.supabase
    .from('beat_grants')
    .select('id')
    .eq('user_id', input.userId)
    .eq('source_type', 'subscription')
    .eq('source_ref_id', sourceRefId)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to check existing subscription grant');

  if (existingResult.data) {
    return 0;
  }

  const expiresAt = razorpayUnixToIso(input.subscription.current_end);

  const { error } = await input.supabase
    .from('beat_grants')
    .insert({
      user_id: input.userId,
      source_type: 'subscription',
      source_ref_id: sourceRefId,
      currency_code: input.currencyCode,
      beats_total: input.planVersion.monthly_included_beats,
      beats_remaining: input.planVersion.monthly_included_beats,
      expires_at: expiresAt,
      metadata_json: {
        provider: 'razorpay',
        providerSubscriptionId: input.subscription.id,
        planVersionId: input.planVersion.id,
        currentStartUnix: input.subscription.current_start,
        currentEndUnix: input.subscription.current_end,
      },
    });

  if (error) {
    if (isUniqueViolation(error)) {
      return 0;
    }
    throw new Error(`Failed to grant subscription beats: ${error.message}`);
  }

  return input.planVersion.monthly_included_beats;
}

export interface SettleTopupOrderResult {
  state: 'granted' | 'already_granted' | 'pending' | 'failed' | 'refunded';
  grantedCoins: number;
  paymentId: string | null;
}

/**
 * Confirmed-money core for top-ups: fetches (and, if needed, captures) the payment at Razorpay, grants only
 * once it is actually captured and matches the order, and is safe to call from verify, the webhook and
 * reconcile for the same order without double-granting.
 */
export async function settleTopupOrder(input: {
  supabase: AdminClient;
  billingOrderId: string;
  paymentIdHint?: string | null;
  source: BillingSource;
}): Promise<SettleTopupOrderResult> {
  const orderResult = await input.supabase
    .from('billing_orders')
    .select('*')
    .eq('id', input.billingOrderId)
    .maybeSingle();

  throwIfQueryFailed(orderResult.error, 'Failed to load billing order');

  const order = (orderResult.data ?? null) as DbBillingOrder | null;
  if (!order) {
    throw new Error('Billing order not found');
  }

  if (order.order_type !== 'topup_checkout' || !order.provider_order_id) {
    throw new Error('Billing order is not a top-up checkout');
  }

  let payment: RazorpayPayment | null;

  if (input.paymentIdHint) {
    payment = await fetchRazorpayPayment(input.paymentIdHint);
    if (payment.order_id !== order.provider_order_id) {
      throw new Error('payment_order_mismatch');
    }
  } else {
    const { items } = await fetchRazorpayOrderPayments(order.provider_order_id);
    payment =
      items.find((item) => item.status === 'captured') ??
      items.find((item) => item.status === 'authorized') ??
      items.find((item) => item.status === 'failed') ??
      null;
  }

  if (!payment) {
    return { state: 'pending', grantedCoins: 0, paymentId: null };
  }

  if (payment.status === 'authorized') {
    try {
      payment = await captureRazorpayPayment({
        paymentId: payment.id,
        amountMinor: order.amount_minor,
        currencyCode: order.currency_code,
      });
    } catch {
      const refetched = await fetchRazorpayPayment(payment.id);
      if (refetched.status !== 'captured') {
        return { state: 'pending', grantedCoins: 0, paymentId: payment.id };
      }
      payment = refetched;
    }
  }

  if (payment.status === 'failed') {
    return { state: 'failed', grantedCoins: 0, paymentId: payment.id };
  }

  if (payment.status !== 'captured') {
    return { state: 'pending', grantedCoins: 0, paymentId: payment.id };
  }

  if (
    payment.amount !== order.amount_minor ||
    payment.currency.toUpperCase() !== order.currency_code.toUpperCase()
  ) {
    throw new Error('payment_amount_mismatch');
  }

  if (payment.amount_refunded >= payment.amount) {
    const refundedUpdate = await input.supabase
      .from('billing_orders')
      .update({
        status: 'refunded',
        provider_payment_id: payment.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    throwIfQueryFailed(refundedUpdate.error, 'Failed to mark top-up order refunded');
    invalidatePricingRuntimeCacheForUser(order.user_id);

    return { state: 'refunded', grantedCoins: 0, paymentId: payment.id };
  }

  let beatAmount: number;
  let snapshotMissing = false;
  const snapshot = order.purchase_snapshot_json as { beatAmount?: number } | null;

  if (snapshot && typeof snapshot.beatAmount === 'number') {
    beatAmount = snapshot.beatAmount;
  } else {
    if (!order.topup_pack_id) {
      throw new Error('Billing order is missing a top-up pack');
    }

    const packResult = await input.supabase
      .from('pricing_topup_packs')
      .select('*')
      .eq('id', order.topup_pack_id)
      .maybeSingle();

    throwIfQueryFailed(packResult.error, 'Failed to load top-up pack');

    const pack = (packResult.data ?? null) as DbPricingTopupPack | null;
    if (!pack) {
      throw new Error('Top-up pack not found');
    }

    beatAmount = pack.beat_amount;
    snapshotMissing = true;
  }

  const grantResult = await input.supabase
    .from('beat_grants')
    .insert({
      user_id: order.user_id,
      source_type: 'topup',
      source_ref_id: order.id,
      currency_code: order.currency_code,
      beats_total: beatAmount,
      beats_remaining: beatAmount,
      metadata_json: redactRazorpayPayload({
        billingOrderId: order.id,
        providerOrderId: order.provider_order_id,
        providerPaymentId: payment.id,
        topupPackId: order.topup_pack_id,
        provider: 'razorpay',
        source: input.source,
        ...(snapshotMissing ? { snapshotMissing: true } : {}),
      }),
    });

  let state: SettleTopupOrderResult['state'] = 'granted';
  if (grantResult.error) {
    if (!isUniqueViolation(grantResult.error)) {
      throw new Error(`Failed to grant top-up beats: ${grantResult.error.message}`);
    }
    state = 'already_granted';
  }

  const nextOrderStatus =
    order.status === 'refunded' || order.status === 'partially_refunded' ? order.status : 'paid';

  const orderUpdate = await input.supabase
    .from('billing_orders')
    .update({
      status: nextOrderStatus,
      provider_payment_id: payment.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  if (orderUpdate.error && !isUniqueViolation(orderUpdate.error)) {
    throw new Error(`Failed to update top-up order: ${orderUpdate.error.message}`);
  }
  // A 23505 here means uq_billing_orders_provider_payment already saw this payment id from another
  // caller (verify/webhook race) — the order row is already correct, nothing left to reconcile.

  invalidatePricingRuntimeCacheForUser(order.user_id);

  return {
    state,
    grantedCoins: state === 'granted' ? beatAmount * COINS_PER_BEAT : 0,
    paymentId: payment.id,
  };
}

export interface SyncSubscriptionFromProviderResult {
  billingSubscriptionId: string | null;
  grantedCoins: number;
  firstChargeConfirmed: boolean;
  status: string;
}

/**
 * Confirmed-money core for subscriptions: upserts the mirrored row from Razorpay's own state, then grants a
 * cycle's beats only once Razorpay lists a paid invoice covering it. Safe to call repeatedly for the same
 * cycle from verify, the webhook and reconcile.
 */
export async function syncSubscriptionFromProvider(input: {
  supabase: AdminClient;
  userId: string;
  planVersion: DbPricingPlanVersion;
  providerSubscriptionId: string;
  checkoutOrder?: DbBillingOrder | null;
  source: BillingSource;
  rawPayload: Record<string, unknown>;
}): Promise<SyncSubscriptionFromProviderResult> {
  const subscription = await fetchRazorpaySubscription(input.providerSubscriptionId);

  const notesUserId = subscription.notes?.user_id;
  if (notesUserId && notesUserId !== input.userId) {
    throw new Error('subscription_owner_mismatch');
  }

  const existingResult = await input.supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_subscription_id', subscription.id)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to load existing Razorpay subscription');

  const existing = (existingResult.data ?? null) as DbBillingSubscription | null;
  if (existing && existing.user_id !== input.userId) {
    throw new Error('subscription_owner_mismatch');
  }

  const providerCustomerId = subscription.customer_id ?? `pending_${subscription.id}`;
  const currentPeriodStart = razorpayUnixToIso(subscription.current_start);
  const currentPeriodEnd = razorpayUnixToIso(subscription.current_end);
  const gracePeriodEndsAt = shouldApplyGracePeriod(subscription.status)
    ? computeGracePeriodEnd(currentPeriodEnd, input.planVersion.grace_period_days)
    : null;
  const redactedPayload = redactRazorpayPayload(input.rawPayload);

  let billingSubscriptionId: string | null = existing?.id ?? null;
  let firstChargeConfirmedAt = existing?.first_charge_confirmed_at ?? null;

  if (existing) {
    const { error } = await input.supabase
      .from('billing_subscriptions')
      .update({
        plan_version_id: input.planVersion.id,
        provider_customer_id: providerCustomerId,
        status: subscription.status,
        billing_interval: input.planVersion.billing_interval,
        currency_code: input.planVersion.currency_code,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: subscription.status === 'cancelled',
        grace_period_ends_at: gracePeriodEndsAt,
        last_webhook_at: new Date().toISOString(),
        raw_provider_state_json: redactedPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    throwIfQueryFailed(error, 'Failed to update Razorpay subscription');
  } else {
    const insertResult = await input.supabase
      .from('billing_subscriptions')
      .insert({
        user_id: input.userId,
        plan_version_id: input.planVersion.id,
        provider: 'razorpay',
        provider_subscription_id: subscription.id,
        provider_customer_id: providerCustomerId,
        provider_mode: getRazorpayMode(),
        status: subscription.status,
        billing_interval: input.planVersion.billing_interval,
        currency_code: input.planVersion.currency_code,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: subscription.status === 'cancelled',
        grace_period_ends_at: gracePeriodEndsAt,
        last_webhook_at: new Date().toISOString(),
        raw_provider_state_json: redactedPayload,
      })
      .select('*')
      .single();

    throwIfQueryFailed(insertResult.error, 'Failed to insert Razorpay subscription');
    billingSubscriptionId = insertResult.data?.id ?? null;
  }

  let grantedBeats = 0;
  let firstChargeConfirmed = Boolean(firstChargeConfirmedAt);

  const currentStart = subscription.current_start;
  const currentEnd = subscription.current_end;

  if (
    currentStart &&
    currentEnd &&
    ['active', 'authenticated', 'pending', 'halted'].includes(subscription.status)
  ) {
    const { items: invoices } = await fetchRazorpaySubscriptionInvoices(subscription.id);
    const paidInvoice = invoices.find((invoice) =>
      invoice.status === 'paid' &&
      invoice.billing_start !== null &&
      invoice.billing_end !== null &&
      invoice.billing_start <= currentStart &&
      currentStart < invoice.billing_end
    ) ?? null;

    if (paidInvoice) {
      if (!firstChargeConfirmedAt && billingSubscriptionId) {
        const confirmResult = await input.supabase
          .from('billing_subscriptions')
          .update({ first_charge_confirmed_at: new Date().toISOString() })
          .eq('id', billingSubscriptionId)
          .is('first_charge_confirmed_at', null);

        throwIfQueryFailed(confirmResult.error, 'Failed to record first charge confirmation');
      }
      firstChargeConfirmed = true;

      let includedBeats = input.planVersion.monthly_included_beats;
      let snapshotMissing = false;
      const checkoutOrder =
        input.checkoutOrder !== undefined
          ? input.checkoutOrder
          : await loadCheckoutOrderBySessionId(input.supabase, subscription.id);
      const snapshot = checkoutOrder?.purchase_snapshot_json as { includedBeats?: number } | null;

      if (snapshot && typeof snapshot.includedBeats === 'number') {
        includedBeats = snapshot.includedBeats;
      } else {
        snapshotMissing = true;
      }

      if (includedBeats > 0) {
        const sourceRefId = `${subscription.id}:${currentStart}`;
        const grantResult = await input.supabase
          .from('beat_grants')
          .insert({
            user_id: input.userId,
            source_type: 'subscription',
            source_ref_id: sourceRefId,
            currency_code: input.planVersion.currency_code,
            beats_total: includedBeats,
            beats_remaining: includedBeats,
            expires_at: razorpayUnixToIso(currentEnd),
            metadata_json: redactRazorpayPayload({
              provider: 'razorpay',
              providerSubscriptionId: subscription.id,
              planVersionId: input.planVersion.id,
              currentStartUnix: currentStart,
              currentEndUnix: currentEnd,
              invoiceId: paidInvoice.id,
              paymentId: paidInvoice.payment_id,
              source: input.source,
              ...(snapshotMissing ? { snapshotMissing: true } : {}),
            }),
          });

        if (grantResult.error) {
          if (!isUniqueViolation(grantResult.error)) {
            throw new Error(`Failed to grant subscription beats: ${grantResult.error.message}`);
          }
        } else {
          grantedBeats = includedBeats;
        }
      }
    }
  }

  invalidatePricingRuntimeCacheForUser(input.userId);

  return {
    billingSubscriptionId,
    grantedCoins: grantedBeats * COINS_PER_BEAT,
    firstChargeConfirmed,
    status: subscription.status,
  };
}

async function loadCheckoutOrderBySessionId(
  supabase: AdminClient,
  providerCheckoutSessionId: string
): Promise<DbBillingOrder | null> {
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_checkout_session_id', providerCheckoutSessionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load subscription checkout order');
  return (result.data ?? null) as DbBillingOrder | null;
}

function computeGracePeriodEnd(currentPeriodEnd: string | null, gracePeriodDays: number): string | null {
  if (!currentPeriodEnd || gracePeriodDays <= 0) {
    return null;
  }

  const date = new Date(currentPeriodEnd);
  date.setUTCDate(date.getUTCDate() + gracePeriodDays);
  return date.toISOString();
}

function shouldApplyGracePeriod(status: string | null | undefined): boolean {
  const normalizedStatus = status?.trim().toLowerCase();
  return normalizedStatus === 'pending' || normalizedStatus === 'halted';
}

function throwIfQueryFailed(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
