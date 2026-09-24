import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchRazorpayPayment, getRazorpayMode } from '@/lib/billing/razorpay';
import {
  nextSubscriptionCheckoutOrderStatus,
  settleTopupOrder,
  syncSubscriptionFromProvider,
} from '@/lib/billing/razorpay-sync';
import { recordDispute, recordRefund } from '@/lib/billing/ledger';
import { endSubscriptionAfterFullRefund } from '@/lib/billing/subscription-refund-end';
import { splitRefundProportionally } from '@/lib/billing/tax.shared';
import { resolveDisputeOutcome } from '@/lib/billing/dispute-status.shared';
import type { DbBillingOrder, DbBillingPayment, DbBillingSubscription, DbPricingPlanVersion } from '@/lib/types/database';
import type { BillingPaymentStatus, BillingRefundStatus } from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RazorpayWebhookPayload {
  event: string;
  account_id?: string | null;
  payload?: {
    subscription?: { entity?: { id?: string } };
    order?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; order_id?: string | null } };
    /** `amount` is Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): the amount of THIS
     * refund event, in minor units -- Razorpay always sends it on refund.* webhooks. Used to split
     * the refund proportionally into net/tax; falls back to the payment's total refunded-to-date
     * when absent (an old/malformed payload), which is only accurate for a single full refund. */
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
    /** Same `amount` note as refund above -- a dispute normally covers the full payment amount, but
     * Razorpay's own figure is preferred when present. `status` is one of Razorpay's five dispute
     * statuses and is what actually says whether the money moved -- see dispute-status.shared.ts.
     * Optional because an older or partial payload may omit it, in which case the event name is
     * read instead. */
    dispute?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
  };
}

export interface ProcessRazorpayWebhookEventResult {
  status: 'processed' | 'ignored';
  outcome: string;
  relatedUserId: string | null;
  relatedSubscriptionId: string | null;
  /** Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit A2): the billing_refunds row this event
   * just wrote or updated, when it wrote one -- Unit C2 enqueues `refund_processed` off of it. Absent
   * (not just null) for every event that isn't a refund, or a refund that couldn't be matched. */
  relatedRefundId?: string | null;
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
        status: nextSubscriptionCheckoutOrderStatus(subscriptionOrder.status, syncResult.status),
        // The checkout order keeps its first payment; renewal payments must not overwrite it.
        provider_payment_id: subscriptionOrder.provider_payment_id ?? payload.payload?.payment?.entity?.id ?? null,
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
    settleResult.state === 'skipped_no_owner' ? 'topup_skipped_no_owner' :
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

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): matches through
 * billing_payments.provider_payment_id first -- this is what finally lets a renewal refund match
 * (Phase 1 could only match billing_orders, which never had a row for a renewal). Still updates the
 * legacy billing_orders.status when an order is linked, and writes a billing_refunds row (split
 * proportionally into net/tax off the ORIGINAL payment's own ratio) whenever a payment was matched.
 */
async function processRefundEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload
): Promise<ProcessRazorpayWebhookEventResult> {
  const providerPaymentId = payload.payload?.refund?.entity?.payment_id ?? null;
  if (!providerPaymentId) {
    return processedUnmatched('refund_unmatched');
  }

  const [payment, order] = await Promise.all([
    loadLedgerPaymentByProviderPaymentId(supabase, providerPaymentId),
    loadOrderByProviderPaymentId(supabase, providerPaymentId),
  ]);

  if (!payment && !order) {
    return processedUnmatched('refund_unmatched');
  }

  let refundedTotalMinor: number | null = null;
  if (payload.event !== 'refund.failed') {
    const providerPayment = await fetchRazorpayPayment(providerPaymentId);
    refundedTotalMinor = providerPayment.amount_refunded;
    const nextOrderStatus = providerPayment.amount_refunded >= providerPayment.amount ? 'refunded' : 'partially_refunded';

    if (order) {
      const updateResult = await supabase
        .from('billing_orders')
        .update({ status: nextOrderStatus, updated_at: new Date().toISOString() })
        .eq('id', order.id);

      throwIfQueryFailed(updateResult.error, 'Failed to update order for refund webhook');
    }
  }

  let outcome = 'refund_recorded';
  let refundRowId: string | null = null;
  const refundProviderId = payload.payload?.refund?.entity?.id ?? null;
  const refundAmountMinor = payload.payload?.refund?.entity?.amount ?? refundedTotalMinor ?? 0;

  if (payment && refundProviderId && refundAmountMinor > 0) {
    // Payments Phase 6 (docs/payments/phase-6-plan.md §1, §4 Unit A2): the fixed status mapping.
    // Previously every event but `refund.failed` was recorded 'processed' outright -- so a mere
    // `refund.created` stamped processed_at and flipped the payment to refunded before Razorpay had
    // actually returned the money.
    const rawEntityStatus = payload.payload?.refund?.entity?.status ?? null;
    const status = resolveRefundStatus(payload.event, rawEntityStatus);

    const applied = await applyRefundOutcome({
      supabase,
      payment,
      status,
      refundEntity: { id: refundProviderId, amount: refundAmountMinor, status: rawEntityStatus },
      refundedTotalMinor,
      source: 'webhook',
      rawPayload: payload as unknown as Record<string, unknown>,
    });

    outcome = applied.outcome;
    refundRowId = applied.refundId;
  }

  return {
    status: 'processed',
    outcome,
    relatedUserId: order?.user_id ?? payment?.user_id ?? null,
    relatedSubscriptionId: null,
    relatedRefundId: refundRowId,
  };
}

/** A2's corrected refund-status mapping (phase-6-plan.md §1, §4 Unit A2): `refund.failed` is
 * authoritative regardless of the entity; `refund.processed`, or the entity's own `status ===
 * 'processed'`, both mean processed; anything else -- including a bare `refund.created` -- is still
 * pending. `eventName` is null for the reconcile sweep (razorpay-reconcile.ts's
 * reconcilePendingRefunds), which has no webhook event, only a freshly-fetched refund entity whose
 * `status` is already one of Razorpay's three real values -- which is why `entityStatus === 'failed'`
 * is also checked here, one step beyond the plan's literal "refund.failed -> failed" wording: the two
 * only disagree on a malformed webhook payload, and 'failed' is the safer read of one. */
export function resolveRefundStatus(eventName: string | null, entityStatus: string | null): BillingRefundStatus {
  if (eventName === 'refund.failed' || entityStatus === 'failed') return 'failed';
  if (eventName === 'refund.processed' || entityStatus === 'processed') return 'processed';
  return 'pending';
}

export type RefundEventSource = 'webhook' | 'reconcile';

/** The refund fields applyRefundOutcome needs off a Razorpay refund entity -- shared shape between
 * the webhook's payload and razorpay.ts's fetchRazorpayRefund response (RazorpayRefund). */
export interface RefundOutcomeEntity {
  id: string;
  amount: number;
  status: string | null;
}

export interface ApplyRefundOutcomeInput {
  supabase: AdminClient;
  payment: DbBillingPayment;
  /** The already-resolved ledger status (resolveRefundStatus). Kept separate from
   * `refundEntity.status` below -- see decision 15's comment inside this function for why. */
  status: BillingRefundStatus;
  refundEntity: RefundOutcomeEntity;
  /** The payment's cumulative amount_refunded at Razorpay, when freshly known (the webhook always
   * fetches it before calling this -- see processRefundEvent above). The reconcile sweep doesn't
   * re-fetch the whole payment, so it passes null and this falls back to just this refund's own
   * amount: correct for the common full-refund case (decision 11), and only an underestimate for a
   * rare dashboard-initiated partial refund that the sweep, rather than the webhook, ends up settling. */
  refundedTotalMinor?: number | null;
  source: RefundEventSource;
  /** What billing_refunds.raw_payload_json keeps for audit: the whole webhook payload, or the
   * refund entity the reconcile fetched. Redacted by recordRefund. */
  rawPayload?: Record<string, unknown>;
}

export interface ApplyRefundOutcomeResult {
  outcome: string;
  refundId: string | null;
}

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit A2): the shared tail of processRefundEvent,
 * extracted so the pending-refund reconcile sweep (razorpay-reconcile.ts's reconcilePendingRefunds)
 * runs exactly the same recordRefund + payment-status + decision-15 logic a redelivered webhook would
 * -- "both paths run identical code" per the plan.
 */
export async function applyRefundOutcome(input: ApplyRefundOutcomeInput): Promise<ApplyRefundOutcomeResult> {
  const { supabase, payment, status, refundEntity, source } = input;

  const split = splitRefundProportionally(refundEntity.amount, payment.net_minor, payment.gross_minor);

  const recordResult = await recordRefund({
    supabase,
    subjectRef: payment.subject_ref,
    paymentId: payment.id,
    providerMode: payment.provider_mode,
    providerRefundId: refundEntity.id,
    providerPaymentId: payment.provider_payment_id,
    amountMinor: refundEntity.amount,
    netMinor: split.netMinor,
    taxMinor: split.taxMinor,
    currencyCode: payment.currency_code,
    status,
    initiatedBy: 'provider',
    rawPayload: input.rawPayload ?? { source, refund: refundEntity },
    processedAt: status === 'processed' ? new Date().toISOString() : null,
  });

  if (recordResult.state === 'unavailable') {
    return { outcome: 'refund_recorded_ledger_unavailable', refundId: null };
  }

  let outcome = 'refund_recorded';

  if (status === 'processed') {
    // Against the payment's refunded-to-date, not this one event's amount -- see refundedTotalMinor's
    // own comment above.
    const refundedToDateMinor = Math.max(input.refundedTotalMinor ?? 0, refundEntity.amount);
    const nextPaymentStatus: BillingPaymentStatus = refundedToDateMinor >= payment.gross_minor ? 'refunded' : 'partially_refunded';
    await markLedgerPaymentStatus(supabase, payment.id, nextPaymentStatus);

    // Decision 15 (docs/payments/audit-progress.md, 2026-09-23): a refund arriving straight from the
    // Razorpay dashboard (not through the admin action) must end a current-cycle subscription's full
    // refund too. Gated on kind before calling, purely to skip the helper's own query for every
    // top-up refund. Deliberately NOT gated by billing_admin_actions_enabled -- that switch gates
    // admin-INITIATED actions; this refund already happened at Razorpay. Must fail closed: any error
    // here is logged and folded into this event's own outcome, never thrown in a way that would mark
    // the refund itself unrecorded (endSubscriptionAfterFullRefund never throws -- see its contract).
    // This gate is kept exactly as it was before this extraction: it reads Razorpay's own literal
    // entity status, never the ledger `status` resolved above -- which can also become 'processed'
    // purely from the event name (`refund.processed`) on a payload whose entity carries something
    // else, and a still-pending refund.created must never end a plan whose money may never go back.
    if (
      refundEntity.status === 'processed' &&
      (payment.kind === 'subscription_first' || payment.kind === 'subscription_renewal')
    ) {
      const subscriptionEndResult = await endSubscriptionAfterFullRefund({
        supabase,
        kind: payment.kind,
        providerSubscriptionId: payment.provider_subscription_id,
        refundAmountMinor: refundEntity.amount,
        paymentGrossMinor: payment.gross_minor,
        cycleEnd: payment.cycle_end,
      });
      if (subscriptionEndResult.error) {
        console.error(`[${source === 'webhook' ? 'razorpay-webhook' : 'razorpay.reconcile'}] failed to end subscription after a full refund`, {
          paymentId: payment.id,
          providerSubscriptionId: payment.provider_subscription_id,
          message: subscriptionEndResult.error,
        });
        outcome = 'refund_recorded_subscription_end_failed';
      } else if (subscriptionEndResult.ended) {
        outcome = 'refund_recorded_subscription_ended';
      }
    }
  }

  return { outcome, refundId: recordResult.id };
}

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): same billing_payments-first matching
 * as processRefundEvent, using recordDispute (a billing_refunds row with initiated_by='dispute').
 *
 * Phase 3 fix: this used to treat every `payment.dispute.*` event identically, so a dispute the
 * merchant WON left the order and payment marked `disputed` and the refund row `pending` for good.
 * Razorpay debits the merchant only when a dispute is LOST, so the outcome now decides what is
 * written (see dispute-status.shared.ts).
 */
async function processDisputeEvent(
  supabase: AdminClient,
  payload: RazorpayWebhookPayload
): Promise<ProcessRazorpayWebhookEventResult> {
  const providerPaymentId = payload.payload?.dispute?.entity?.payment_id ?? null;
  if (!providerPaymentId) {
    return processedUnmatched('dispute_unmatched');
  }

  const [payment, order] = await Promise.all([
    loadLedgerPaymentByProviderPaymentId(supabase, providerPaymentId),
    loadOrderByProviderPaymentId(supabase, providerPaymentId),
  ]);

  if (!payment && !order) {
    return processedUnmatched('dispute_unmatched');
  }

  const relatedUserId = order?.user_id ?? payment?.user_id ?? null;
  const outcomeKind = resolveDisputeOutcome(payload.event, payload.payload?.dispute?.entity?.status);

  // A close carries no money information of its own and normally arrives AFTER the won/lost event
  // that did. Writing anything here would either restate that outcome or, worse, overwrite it with
  // a `pending` the close does not actually assert -- so the close is recorded in
  // billing_webhook_events (every event is) and changes nothing else.
  if (outcomeKind === 'closed') {
    return { status: 'processed', outcome: 'dispute_closed', relatedUserId, relatedSubscriptionId: null };
  }

  const disputeProviderId = payload.payload?.dispute?.entity?.id ?? null;
  const disputeAmountMinor = payload.payload?.dispute?.entity?.amount ?? payment?.gross_minor ?? 0;

  // What the order and the ledger payment should say once this event is applied.
  //  - open: contested, funds still with us, but the payment is not ordinarily spendable -- disputed.
  //  - lost: the funds are gone. Sized against the payment, exactly as a refund is, because a
  //    dispute can cover less than the whole payment.
  //  - won: nothing was ever reversed by the dispute. The payment returns to what Razorpay says it
  //    is today, which is NOT necessarily `captured`/`paid`: an ordinary partial refund may have
  //    been issued alongside the dispute, and asserting `paid` would erase it.
  let nextOrderStatus: string;
  let nextPaymentStatus: BillingPaymentStatus;
  let refundStatus: BillingRefundStatus;

  if (outcomeKind === 'lost') {
    const fullyReversed = payment ? disputeAmountMinor >= payment.gross_minor : true;
    nextOrderStatus = fullyReversed ? 'refunded' : 'partially_refunded';
    nextPaymentStatus = fullyReversed ? 'refunded' : 'partially_refunded';
    refundStatus = 'processed';
  } else if (outcomeKind === 'won') {
    const providerPayment = await fetchRazorpayPayment(providerPaymentId);
    if (providerPayment.amount_refunded <= 0) {
      nextOrderStatus = 'paid';
      nextPaymentStatus = 'captured';
    } else {
      const fullyRefunded = providerPayment.amount_refunded >= providerPayment.amount;
      nextOrderStatus = fullyRefunded ? 'refunded' : 'partially_refunded';
      nextPaymentStatus = fullyRefunded ? 'refunded' : 'partially_refunded';
    }
    // Not an error: `failed` is this vocabulary's word for "this reversal did not happen", which is
    // exactly what winning a dispute means. There is no 'cancelled' in BILLING_REFUND_STATUSES.
    refundStatus = 'failed';
  } else {
    nextOrderStatus = 'disputed';
    nextPaymentStatus = 'disputed';
    refundStatus = 'pending';
  }

  // Webhooks retry and can arrive out of order, so a late `created` can land after the `lost` that
  // settled the dispute. Re-opening a settled dispute row -- and with it a settled payment -- on the
  // strength of a redelivery would be a money error, so a still-`pending` event never overwrites a
  // resolution already recorded.
  if (refundStatus === 'pending' && disputeProviderId) {
    const settled = await loadRecordedDisputeStatus(supabase, payment?.provider_mode ?? getRazorpayMode(), disputeProviderId);
    if (settled === 'processed' || settled === 'failed') {
      return { status: 'processed', outcome: 'dispute_already_settled', relatedUserId, relatedSubscriptionId: null };
    }
  }

  if (order) {
    const updateResult = await supabase
      .from('billing_orders')
      .update({ status: nextOrderStatus, updated_at: new Date().toISOString() })
      .eq('id', order.id);

    throwIfQueryFailed(updateResult.error, 'Failed to update order for dispute webhook');
  }

  let outcome = outcomeKind === 'open' ? 'dispute_recorded' : `dispute_${outcomeKind}`;

  if (payment && disputeProviderId) {
    const split = splitRefundProportionally(disputeAmountMinor, payment.net_minor, payment.gross_minor);

    const recordResult = await recordDispute({
      supabase,
      subjectRef: payment.subject_ref,
      paymentId: payment.id,
      providerMode: payment.provider_mode,
      providerRefundId: disputeProviderId,
      providerPaymentId,
      amountMinor: disputeAmountMinor,
      netMinor: split.netMinor,
      taxMinor: split.taxMinor,
      currencyCode: payment.currency_code,
      status: refundStatus,
      actorUserRef: payment.user_id,
      rawPayload: payload as unknown as Record<string, unknown>,
      processedAt: refundStatus === 'processed' ? new Date().toISOString() : null,
    });

    if (recordResult.state === 'unavailable') {
      outcome = `${outcome}_ledger_unavailable`;
    } else {
      await markLedgerPaymentStatus(supabase, payment.id, nextPaymentStatus);
    }
  }

  return { status: 'processed', outcome, relatedUserId, relatedSubscriptionId: null };
}

/** The status already recorded for this dispute, or null when nothing is recorded (or the Phase 2
 * ledger tables are absent -- recordDispute's own latch reports that, so a failure here is simply
 * "nothing known" and never blocks the webhook). */
async function loadRecordedDisputeStatus(
  supabase: AdminClient,
  providerMode: string,
  providerDisputeId: string
): Promise<BillingRefundStatus | null> {
  const result = await supabase
    .from('billing_refunds')
    .select('status')
    .eq('provider', 'razorpay')
    .eq('provider_mode', providerMode)
    .eq('provider_refund_id', providerDisputeId)
    .maybeSingle();

  if (result.error) return null;
  return ((result.data as { status?: BillingRefundStatus } | null)?.status) ?? null;
}

/** Best-effort status sync on the payment row itself -- the refund/dispute row just written is the
 * authoritative record either way, so a failure here is logged, never thrown. */
async function markLedgerPaymentStatus(supabase: AdminClient, paymentId: string, status: BillingPaymentStatus): Promise<void> {
  const updateResult = await supabase
    .from('billing_payments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', paymentId);

  if (updateResult.error) {
    console.error('[razorpay-webhook] failed to update billing_payments status', {
      paymentId,
      status,
      message: updateResult.error.message,
    });
  }
}

async function loadLedgerPaymentByProviderPaymentId(
  supabase: AdminClient,
  providerPaymentId: string
): Promise<DbBillingPayment | null> {
  let mode: 'test' | 'live';
  try {
    mode = getRazorpayMode();
  } catch {
    return null;
  }

  const result = await supabase
    .from('billing_payments')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('provider_payment_id', providerPaymentId)
    .maybeSingle();

  if (result.error) {
    if (isMissingLedgerColumnError(result.error)) return null;
    throwIfQueryFailed(result.error, 'Failed to load billing payment for webhook');
  }

  return (result.data ?? null) as DbBillingPayment | null;
}

function isMissingLedgerColumnError(error: { code?: string } | null | undefined): boolean {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.code === '42703' ||
    error?.code === 'PGRST200' ||
    error?.code === 'PGRST204'
  );
}

/** Refunds/disputes that can't be matched to anything are still "processed" (there is nothing to
 * retry), just with an outcome that says so -- distinct from the generic `ignored()` below, which
 * is for event types this module doesn't handle at all. */
function processedUnmatched(outcome: string): ProcessRazorpayWebhookEventResult {
  return { status: 'processed', outcome, relatedUserId: null, relatedSubscriptionId: null };
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
