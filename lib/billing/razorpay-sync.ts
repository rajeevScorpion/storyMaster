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
} from '@/lib/billing/razorpay';
import { redactRazorpayPayload } from '@/lib/billing/razorpay-redact.shared';
import { recordPayment } from '@/lib/billing/ledger';
import { getPublishedTaxRule } from '@/lib/billing/tax-rules';
import { buildCustomerSnapshot, loadBillingProfile } from '@/lib/billing/billing-profile';
import { computeTaxFromGross, type TaxBreakdown } from '@/lib/billing/tax.shared';
import { enqueueBillingJob } from '@/lib/billing/notifications/queue';
import { subscriptionTransitionJobs } from '@/lib/billing/notifications/subscription-transition.shared';
import type {
  DbBillingOrder,
  DbBillingProfile,
  DbBillingSubscription,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import { COINS_PER_BEAT, type BillingPaymentStatus } from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;
type BillingSource = 'verify' | 'webhook' | 'reconcile';

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/** Same shape as lib/billing/ledger.ts's isMissingLedgerSchemaError -- used only to decide whether
 * an insert can carry `subject_ref` (migration 125), so a database without it doesn't 400 on an
 * unknown column. */
function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204' || error?.code === 'PGRST200';
}

const SETTLEMENT_EXCEPTION_ORDER_STATUSES = new Set(['refunded', 'partially_refunded', 'disputed']);

/** A later subscription sync must not erase a refund or dispute already recorded on the checkout order. */
export function nextSubscriptionCheckoutOrderStatus(currentStatus: string, providerStatus: string): string {
  return SETTLEMENT_EXCEPTION_ORDER_STATUSES.has(currentStatus) ? currentStatus : providerStatus;
}

const LIVE_SUBSCRIPTION_STATUSES = new Set(['authenticated', 'active', 'pending', 'halted']);

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): what the sync itself may write to
 * cancel_at_period_end, independent of status. Migration 134 (cancel_requested_at/by) is the only
 * writer of a *scheduled* cancel -- the sync only clears the flag once a subscription is terminal,
 * and otherwise leaves it alone so it survives a re-sync in between (the defect this unit fixes: the
 * old code derived it from status alone and cleared a cycle-end cancel on the very next webhook).
 * Returns {} (omit the field entirely) while the subscription is still live.
 */
export function cancelAtPeriodEndPatch(status: string): { cancel_at_period_end?: false } {
  return LIVE_SUBSCRIPTION_STATUSES.has(status) ? {} : { cancel_at_period_end: false };
}

export interface SettleTopupOrderResult {
  state: 'granted' | 'already_granted' | 'pending' | 'failed' | 'refunded' | 'skipped_no_owner';
  grantedCoins: number;
  paymentId: string | null;
}

/** Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the net/tax/gross a top-up payment
 * should be recorded at. A tax-aware checkout (this Unit) leaves net/tax/gross on the order's own
 * purchase_snapshot_json, computed once at checkout time -- a top-up is a one-shot charge, so unlike
 * a subscription renewal there is never a later cycle to re-derive from. An order predating Phase 2
 * tax (no such snapshot fields) charged no GST at all, so net = gross = what was actually charged. */
function deriveTopupPaymentMoney(
  order: DbBillingOrder,
  payment: RazorpayPayment
): { netMinor: number; taxMinor: number; grossMinor: number; taxBreakdown: TaxBreakdown | null } {
  const snapshot = order.purchase_snapshot_json as
    | { netMinor?: number; taxMinor?: number; grossMinor?: number; tax?: { breakdown?: TaxBreakdown } | null }
    | null;

  if (
    snapshot &&
    typeof snapshot.netMinor === 'number' &&
    typeof snapshot.taxMinor === 'number' &&
    typeof snapshot.grossMinor === 'number'
  ) {
    return {
      netMinor: snapshot.netMinor,
      taxMinor: snapshot.taxMinor,
      grossMinor: snapshot.grossMinor,
      taxBreakdown: snapshot.tax?.breakdown ?? null,
    };
  }

  return { netMinor: payment.amount, taxMinor: 0, grossMinor: payment.amount, taxBreakdown: null };
}

/**
 * Confirmed-money core for top-ups: fetches (and, if needed, captures) the payment at Razorpay, grants only
 * once it is actually captured and matches the order, and is safe to call from verify, the webhook and
 * reconcile for the same order without double-granting.
 *
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): also records the payment in the
 * durable ledger (billing_payments) whenever it observes a captured payment, independent of the
 * grant outcome -- "every charge recorded" -- and skips the coin grant (never the ledger record)
 * when the order's owner has been deleted, so a deleted customer's data never receives a new grant.
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

  const isFullyRefunded = payment.amount_refunded >= payment.amount;
  const isPartiallyRefunded = !isFullyRefunded && payment.amount_refunded > 0;
  const paymentStatus: BillingPaymentStatus = isFullyRefunded ? 'refunded' : isPartiallyRefunded ? 'partially_refunded' : 'captured';

  const subjectRef = order.subject_ref ?? order.user_id ?? null;
  if (subjectRef) {
    const money = deriveTopupPaymentMoney(order, payment);
    // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): frozen at checkout time into
    // the order's own snapshot -- there is no live profile to re-derive from here, and the ledger's
    // write-once guard means this only ever fills the row once anyway. Payments Phase 6 (§10, hook 1)
    // reuses this exact same snapshot as the receipt email's preferred address.
    const customerSnapshot =
      (order.purchase_snapshot_json as { customer?: Record<string, unknown> | null } | null)?.customer ?? null;
    const paymentRecordResult = await recordPayment({
      supabase: input.supabase,
      subjectRef,
      userId: order.user_id,
      provider: 'razorpay',
      providerMode: getRazorpayMode(),
      providerPaymentId: payment.id,
      providerOrderId: order.provider_order_id,
      billingOrderId: order.id,
      topupPackId: order.topup_pack_id,
      kind: 'topup',
      status: paymentStatus,
      currencyCode: order.currency_code,
      netMinor: money.netMinor,
      taxMinor: money.taxMinor,
      grossMinor: money.grossMinor,
      taxBreakdown: money.taxBreakdown,
      rawMethod: payment.method ?? null,
      providerFeeMinor: payment.fee ?? null,
      providerTaxMinor: payment.tax ?? null,
      purchaseSnapshot: order.purchase_snapshot_json,
      customerSnapshot,
      capturedAt: payment.created_at ? razorpayUnixToIso(payment.created_at) : new Date().toISOString(),
    });

    // Payments Phase 6 (docs/payments/phase-6-plan.md §10, hook 1): a brand-new payment row earns a
    // receipt email; a re-observed one (a verify/webhook race, or the daily reconcile re-seeing the
    // same captured payment) does not -- recordPayment's own idempotency already decided that via
    // `state`, so this hook just reads it rather than re-deriving "is this new" itself.
    if (paymentRecordResult.state === 'inserted') {
      await enqueueBillingJob({
        kind: 'payment_receipt',
        dedupeKey: `payment:${paymentRecordResult.id}`,
        subjectRef,
        userId: order.user_id,
        paymentId: paymentRecordResult.id,
        payload: {
          billingEmail: (customerSnapshot as { billingEmail?: string | null } | null)?.billingEmail ?? null,
        },
      });
    }
  }

  if (isFullyRefunded) {
    const refundedUpdate = await input.supabase
      .from('billing_orders')
      .update({
        status: 'refunded',
        provider_payment_id: payment.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    throwIfQueryFailed(refundedUpdate.error, 'Failed to mark top-up order refunded');
    if (order.user_id) invalidatePricingRuntimeCacheForUser(order.user_id);

    return { state: 'refunded', grantedCoins: 0, paymentId: payment.id };
  }

  if (!order.user_id) {
    // Deleted-customer safety (plan §4 Unit B): the payment above is already recorded, but there is
    // no one left to grant coins to -- never grant to nobody.
    console.warn('[razorpay-sync] skipping top-up coin grant: order has no owner', {
      orderId: order.id,
      paymentId: payment.id,
    });

    const ownerlessOrderUpdate = await input.supabase
      .from('billing_orders')
      .update({
        status: order.status === 'partially_refunded' ? order.status : 'paid',
        provider_payment_id: payment.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    throwIfQueryFailed(ownerlessOrderUpdate.error, 'Failed to update ownerless top-up order');

    return { state: 'skipped_no_owner', grantedCoins: 0, paymentId: payment.id };
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

interface SubscriptionPaymentMoney {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxBreakdown: TaxBreakdown | null;
  /** Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): the profile this call loaded to
   * derive the split, if it loaded one at all -- null on the first-charge fast path (the split comes
   * from the checkout snapshot, not a live read) and whenever no profile/rule was resolvable. The
   * caller reuses this same read to build the renewal's customer snapshot, so the tax split and the
   * snapshot are never derived from two different moments in time. */
  profile: DbBillingProfile | null;
}

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the net/tax/gross a subscription
 * charge should be recorded at. The first charge normally has a checkout order with a snapshot
 * computed at checkout time -- reuse it rather than re-deriving. A renewal has no such order at
 * all (Razorpay charges the fixed plan amount on its own schedule), so its split is derived from
 * the gross Razorpay actually charged, using the rule and the customer's billing-profile state in
 * force *now* -- the total is the plan's gross; tax is never added on top of it a second time. Any
 * failure to resolve a rule/state falls back to recording the whole gross as net (no invented tax),
 * because a bookkeeping gap must never block coins the customer already paid for.
 */
async function resolveSubscriptionPaymentMoney(input: {
  supabase: AdminClient;
  isFirstCharge: boolean;
  checkoutOrder: DbBillingOrder | null;
  grossMinor: number;
  userId: string;
}): Promise<SubscriptionPaymentMoney> {
  if (input.isFirstCharge) {
    const snapshot = input.checkoutOrder?.purchase_snapshot_json as
      | { netMinor?: number; taxMinor?: number; grossMinor?: number; tax?: { breakdown?: TaxBreakdown } | null }
      | null
      | undefined;

    if (
      snapshot &&
      typeof snapshot.netMinor === 'number' &&
      typeof snapshot.taxMinor === 'number' &&
      typeof snapshot.grossMinor === 'number'
    ) {
      return {
        netMinor: snapshot.netMinor,
        taxMinor: snapshot.taxMinor,
        grossMinor: snapshot.grossMinor,
        taxBreakdown: snapshot.tax?.breakdown ?? null,
        profile: null,
      };
    }
  }

  try {
    const ruleResult = await getPublishedTaxRule('IN', 'subscription');
    if (ruleResult.status === 'ok') {
      const profileResult = await loadBillingProfile(input.supabase, input.userId);
      const profile = profileResult.status === 'ok' ? profileResult.profile : null;
      const stateCode = profile?.state_code ?? null;

      if (stateCode) {
        const result = computeTaxFromGross({
          grossMinor: input.grossMinor,
          rule: ruleResult.rule,
          supplierStateCode: ruleResult.rule.supplierStateCode,
          placeOfSupplyStateCode: stateCode,
        });
        return {
          netMinor: result.netMinor,
          taxMinor: result.taxMinor,
          grossMinor: result.grossMinor,
          taxBreakdown: result.breakdown,
          profile,
        };
      }
    }
  } catch (err) {
    console.error('[razorpay-sync] failed to derive a subscription charge tax split; recording gross as net', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { netMinor: input.grossMinor, taxMinor: 0, grossMinor: input.grossMinor, taxBreakdown: null, profile: null };
}

interface SubscriptionPaymentMethod {
  rawMethod: string | null;
  providerFeeMinor: number | null;
  providerTaxMinor: number | null;
}

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): the payment method to record for a
 * subscription charge. Fetching the actual Razorpay payment gives the real method plus its fee/tax,
 * but costs an API call, so it only happens once per payment -- the first time this sync observes it
 * (no billing_payments row recorded for it yet). The daily reconcile re-observing an already-recorded
 * payment must not re-fetch it every day: it reuses the subscription entity's own `payment_method`
 * (present on every subscription webhook/fetch, e.g. "card"), which cost nothing extra to have. The
 * same fallback covers a fetch failure. Never throws -- a payment method is not worth failing a
 * coin grant over.
 */
async function resolveSubscriptionPaymentMethod(input: {
  supabase: AdminClient;
  providerPaymentId: string;
  providerMode: 'test' | 'live';
  subscriptionPaymentMethod: string | null | undefined;
}): Promise<SubscriptionPaymentMethod> {
  const fallback: SubscriptionPaymentMethod = {
    rawMethod: input.subscriptionPaymentMethod ?? null,
    providerFeeMinor: null,
    providerTaxMinor: null,
  };

  const existing = await input.supabase
    .from('billing_payments')
    .select('id')
    .eq('provider', 'razorpay')
    .eq('provider_mode', input.providerMode)
    .eq('provider_payment_id', input.providerPaymentId)
    .maybeSingle();

  // A query error here (including a missing-schema shape, e.g. 125 not applied) is treated the same
  // as "the row already exists": skip the fetch rather than let an unrelated read failure burn an
  // API call. recordPayment below independently re-checks its own schema availability regardless.
  if (existing.error || existing.data) {
    return fallback;
  }

  try {
    const payment = await fetchRazorpayPayment(input.providerPaymentId);
    return {
      rawMethod: payment.method ?? fallback.rawMethod,
      providerFeeMinor: payment.fee ?? null,
      providerTaxMinor: payment.tax ?? null,
    };
  } catch (err) {
    console.error(
      '[razorpay-sync] failed to fetch a subscription payment for its method; falling back to the subscription entity',
      { paymentId: input.providerPaymentId, message: err instanceof Error ? err.message : String(err) }
    );
    return fallback;
  }
}

/** Inserts a new billing_subscriptions row, dropping `subject_ref` and retrying once if the column
 * doesn't exist yet (migration 125 absent) -- the same "fail closed, don't break checkout" contract
 * as everywhere else in this file. */
async function insertBillingSubscriptionRow(supabase: AdminClient, row: Record<string, unknown>) {
  const attempt = await supabase.from('billing_subscriptions').insert(row).select('*').single();
  if (!attempt.error) return attempt;

  if (isMissingColumnError(attempt.error) && 'subject_ref' in row) {
    const { subject_ref: _omit, ...withoutSubjectRef } = row;
    return supabase.from('billing_subscriptions').insert(withoutSubjectRef).select('*').single();
  }

  return attempt;
}

/**
 * Confirmed-money core for subscriptions: upserts the mirrored row from Razorpay's own state, then grants a
 * cycle's beats only once Razorpay lists a paid invoice covering it. Safe to call repeatedly for the same
 * cycle from verify, the webhook and reconcile.
 *
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): also records each paid invoice in
 * the durable ledger, keyed `subscription_first` or `subscription_renewal`, independent of whether
 * the coin grant itself is new -- "every charge recorded".
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
  const subjectRef = existing?.subject_ref ?? input.userId;

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
        // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): the sync never derives a
        // scheduled cancel from status -- see cancelAtPeriodEndPatch. Only a cancel action (migration
        // 134's cancel_requested_at/by) sets it true.
        ...cancelAtPeriodEndPatch(subscription.status),
        grace_period_ends_at: gracePeriodEndsAt,
        last_webhook_at: new Date().toISOString(),
        raw_provider_state_json: redactedPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    throwIfQueryFailed(error, 'Failed to update Razorpay subscription');
  } else {
    const insertResult = await insertBillingSubscriptionRow(input.supabase, {
      user_id: input.userId,
      subject_ref: subjectRef,
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
      // A brand-new subscription is never already scheduled to cancel.
      cancel_at_period_end: false,
      grace_period_ends_at: gracePeriodEndsAt,
      last_webhook_at: new Date().toISOString(),
      raw_provider_state_json: redactedPayload,
    });

    throwIfQueryFailed(insertResult.error, 'Failed to insert Razorpay subscription');
    billingSubscriptionId = insertResult.data?.id ?? null;
  }

  // Payments Phase 6 (docs/payments/phase-6-plan.md §10, hook 3): the pure transition rule decides
  // whether this status change (verify/webhook/reconcile all land here) earns a "payment failed" or
  // "plan ended" email -- see subscription-transition.shared.ts's own header for why `existing?.status
  // ?? null` is the right `prev` even on a brand-new insert. Skipped with no billingSubscriptionId
  // (an insert that somehow returned no id) since every job kind below needs one to process.
  if (billingSubscriptionId) {
    const transitionJob = subscriptionTransitionJobs(existing?.status ?? null, subscription.status);
    if (transitionJob === 'subscription_payment_failed') {
      await enqueueBillingJob({
        kind: 'subscription_payment_failed',
        dedupeKey: `sub_failed:${billingSubscriptionId}:${currentPeriodEnd}`,
        subjectRef,
        userId: input.userId,
        billingSubscriptionId,
        payload: { graceEndsAt: gracePeriodEndsAt, shortUrl: subscription.short_url ?? null },
      });
    } else if (transitionJob === 'subscription_ended') {
      await enqueueBillingJob({
        kind: 'subscription_ended',
        dedupeKey: `sub_ended:${billingSubscriptionId}`,
        subjectRef,
        userId: input.userId,
        billingSubscriptionId,
      });
    }
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
      const isFirstCharge = !firstChargeConfirmedAt;

      if (!firstChargeConfirmedAt && billingSubscriptionId) {
        const confirmResult = await input.supabase
          .from('billing_subscriptions')
          .update({ first_charge_confirmed_at: new Date().toISOString() })
          .eq('id', billingSubscriptionId)
          .is('first_charge_confirmed_at', null);

        throwIfQueryFailed(confirmResult.error, 'Failed to record first charge confirmation');
      }
      firstChargeConfirmed = true;

      const checkoutOrder =
        input.checkoutOrder !== undefined
          ? input.checkoutOrder
          : await loadCheckoutOrderBySessionId(input.supabase, subscription.id);

      if (paidInvoice.payment_id) {
        const money = await resolveSubscriptionPaymentMoney({
          supabase: input.supabase,
          isFirstCharge,
          checkoutOrder,
          grossMinor: paidInvoice.amount_paid,
          userId: input.userId,
        });

        const method = await resolveSubscriptionPaymentMethod({
          supabase: input.supabase,
          providerPaymentId: paidInvoice.payment_id,
          providerMode: getRazorpayMode(),
          subscriptionPaymentMethod: subscription.payment_method,
        });

        // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): who was billed, frozen the
        // moment this charge is first recorded -- recordPayment's write-once guard means it is never
        // rewritten by a later profile edit. A first charge's customer was already frozen into the
        // checkout order's snapshot at checkout time; an order that predates this unit (no `customer`
        // key) falls back to the live profile, same source a renewal uses, so the payment still gets
        // *some* snapshot rather than none. A renewal reuses the exact profile resolveSubscription-
        // PaymentMoney already read for the tax split above -- one read, not two.
        let customerSnapshot: Record<string, unknown> | null;
        if (isFirstCharge) {
          const orderCustomer =
            (checkoutOrder?.purchase_snapshot_json as { customer?: Record<string, unknown> | null } | null)
              ?.customer ?? null;
          if (orderCustomer) {
            customerSnapshot = orderCustomer;
          } else {
            const fallbackProfileResult = await loadBillingProfile(input.supabase, input.userId);
            const fallbackProfile = fallbackProfileResult.status === 'ok' ? fallbackProfileResult.profile : null;
            customerSnapshot = buildCustomerSnapshot(fallbackProfile) as Record<string, unknown> | null;
          }
        } else {
          customerSnapshot = buildCustomerSnapshot(money.profile) as Record<string, unknown> | null;
        }

        const paymentRecordResult = await recordPayment({
          supabase: input.supabase,
          subjectRef,
          userId: input.userId,
          provider: 'razorpay',
          providerMode: getRazorpayMode(),
          providerPaymentId: paidInvoice.payment_id,
          providerSubscriptionId: subscription.id,
          providerInvoiceId: paidInvoice.id,
          billingSubscriptionId,
          planVersionId: input.planVersion.id,
          kind: isFirstCharge ? 'subscription_first' : 'subscription_renewal',
          status: 'captured',
          currencyCode: input.planVersion.currency_code,
          netMinor: money.netMinor,
          taxMinor: money.taxMinor,
          grossMinor: money.grossMinor,
          taxBreakdown: money.taxBreakdown,
          rawMethod: method.rawMethod,
          providerFeeMinor: method.providerFeeMinor,
          providerTaxMinor: method.providerTaxMinor,
          // Only the first charge's own checkout order describes what was actually sold at that
          // sitting -- a renewal has no order of its own (Razorpay charges the fixed plan amount on
          // its own schedule), and `checkoutOrder` here is still the original checkout order, so
          // attaching it to a renewal would misrepresent it as that renewal's purchase context.
          purchaseSnapshot: isFirstCharge ? (checkoutOrder?.purchase_snapshot_json ?? null) : null,
          customerSnapshot,
          cycleStart: razorpayUnixToIso(paidInvoice.billing_start),
          cycleEnd: razorpayUnixToIso(paidInvoice.billing_end),
          capturedAt: paidInvoice.paid_at ? razorpayUnixToIso(paidInvoice.paid_at) : new Date().toISOString(),
        });

        // Payments Phase 6 (docs/payments/phase-6-plan.md §10, hook 2): same "only a brand-new row
        // earns an email" rule as hook 1 (settleTopupOrder) -- the processor itself decides the
        // 'renewal' vs 'receipt' copy variant off billing_payments.kind, so this always enqueues the
        // one `payment_receipt` kind regardless of isFirstCharge.
        if (paymentRecordResult.state === 'inserted' && billingSubscriptionId) {
          await enqueueBillingJob({
            kind: 'payment_receipt',
            dedupeKey: `payment:${paymentRecordResult.id}`,
            subjectRef,
            userId: input.userId,
            paymentId: paymentRecordResult.id,
            billingSubscriptionId,
            payload: {
              billingEmail: (customerSnapshot as { billingEmail?: string | null } | null)?.billingEmail ?? null,
            },
          });
        }
      }

      let includedBeats = input.planVersion.monthly_included_beats;
      let snapshotMissing = false;
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
