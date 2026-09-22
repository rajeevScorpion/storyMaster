'use server';

/**
 * Payments Phase 4, Unit C (docs/payments/phase-4-plan.md §9): the first code in this codebase that
 * can move money OUT of the business. Kept in its own module rather than folded into
 * app/actions/admin-users.ts, per the plan's own instruction not to bloat that file.
 *
 * Every action here: re-checks verifyAdmin() server-side, refuses when `billing_admin_actions_enabled`
 * (lib/admin/operational-flags.shared.ts) is off, and derives every amount/owner/provider id from a
 * server-side read -- never from the caller's input beyond an id and a reason.
 *
 * Refund architecture follows the failure matrix (plan §5), not preference: claw back the purchase's
 * unspent coins FIRST, then call Razorpay (decision 12) -- "coins removed, refund failed" is visible
 * and fixable, "money refunded, coins still spendable" is a silent loss. The audit row for the
 * refund itself is written BEFORE either of those steps, with its outcome patched in after, so a
 * crash mid-flight leaves evidence an attempt happened. If the Razorpay call fails after a
 * successful clawback, the coins are explicitly restored (never left as "user owes coins" -- the
 * schema does not allow a negative beats_remaining, and none is invented here).
 *
 * The Razorpay `refund.processed` webhook remains the source of truth for billing_refunds
 * (lib/billing/ledger.ts recordRefund is idempotent on provider_refund_id); the best-effort call to
 * recordRefund below is a convergence write for faster admin visibility, never the record itself --
 * its failure is logged, never thrown, and never turns a real refund into a reported failure.
 *
 * Owner decisions 15-16 (2026-09-23, docs/payments/audit-progress.md): a full refund of a
 * subscription payment for the CURRENT cycle ends the subscription immediately
 * (lib/billing/subscription-refund-end.ts, shared with the refund.processed webhook path in
 * lib/billing/razorpay-webhook.ts -- same reasoning as recordRefund above, its own failure must
 * never turn a successful refund into a reported failure); a subscription purchase with no coin
 * grant proceeds with nothing to claw back when its plan genuinely included 0 coins
 * (lib/billing/subscription-included-beats.ts), rather than refusing every Audience refund.
 */

import { revalidatePath } from 'next/cache';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { cancelRazorpaySubscription, refundRazorpayPayment } from '@/lib/billing/razorpay';
import { recordRefund } from '@/lib/billing/ledger';
import {
  evaluateRefundClawbackEligibility,
  isRefundCapReached,
  resolvePurchaseGrantSourceRef,
  resolveRefundAttemptOutcome,
  resolveRefundCapPerAccount,
} from '@/lib/billing/refund-eligibility.shared';
import { endSubscriptionAfterFullRefund } from '@/lib/billing/subscription-refund-end';
import { isCurrentCycleSubscriptionPayment } from '@/lib/billing/subscription-refund-end.shared';
import { resolveSubscriptionIncludedBeats } from '@/lib/billing/subscription-included-beats';
import {
  reconcilePricingSubscription,
  reconcilePricingTopup,
} from '@/app/actions/pricing-admin';
import { processRazorpayWebhookEvent, type RazorpayWebhookPayload } from '@/lib/billing/razorpay-webhook';

type AdminClient = ReturnType<typeof createAdminClient>;

const BILLING_ADMIN_ACTIONS_FLAG_KEY = 'billing_admin_actions_enabled';
const REFUND_CAP_FLAG_KEY = 'billing_refund_cap_per_account';

async function ensureBillingAdminActionsEnabled(): Promise<void> {
  const enabled = await getFeatureFlag(BILLING_ADMIN_ACTIONS_FLAG_KEY, false);
  if (!enabled) {
    throw new Error(
      'Admin billing actions are turned off. Enable "Admin refunds, cancellations and re-syncs" under Settings first.'
    );
  }
}

/**
 * Whether the kill switch is on, for the admin UI to read at render time.
 *
 * This exists so the panel can tell someone the switch is off *before* they pick a payment and type
 * a refund reason, rather than after. It is display only and deliberately not a substitute for
 * anything: every mutating action above re-checks the flag server-side on its own, because a client
 * that renders an enabled button proves nothing about what the server will accept.
 */
export async function getBillingAdminActionsEnabled(): Promise<boolean> {
  await verifyAdmin();
  return getFeatureFlag(BILLING_ADMIN_ACTIONS_FLAG_KEY, false);
}

function assertUuid(value: string, label = 'id'): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`A valid ${label} is required.`);
  }
  return normalized;
}

function assertRequestKey(value: string): string {
  const normalized = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(normalized)) {
    throw new Error('A valid request key is required.');
  }
  return normalized;
}

function normalizeReason(value: string): string {
  const reason = String(value ?? '').trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error('Reason must be between 3 and 500 characters.');
  }
  return reason;
}

function throwOnBillingQueryError(error: { code?: string; message: string } | null, action: string): void {
  if (!error) return;
  if (isMissingBillingSchemaError(error)) {
    throw new Error(`${action} is not available on this environment yet -- the billing migration has not been applied here.`);
  }
  throw new Error(`${action}: ${error.message}`);
}

async function patchAuditOutcome(
  admin: AdminClient,
  auditEventId: string,
  after: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from('admin_user_audit_events').update({ after_json: after }).eq('id', auditEventId);
  if (error) {
    // A refund whose outcome-patch failed already happened (or already failed) at Razorpay -- never
    // let this failure change what is reported to the admin. See module header.
    console.error('[admin-billing-actions] failed to patch audit outcome', { auditEventId, message: error.message });
  }
}

// ---------------------------------------------------------------------------------------------
// Refund (decisions 11 and 12): full refunds only, clawback-then-provider-call, capped per account.
// ---------------------------------------------------------------------------------------------

export interface RefundBillingPaymentResult {
  providerRefundId: string;
  refundedAmountMinor: number;
  beatsClawedBack: number;
  alreadyApplied: boolean;
  /** Decision 15: true once a full refund of the current cycle has ended the subscription (now, or
   * already had, on a replay). Always false for a top-up. */
  subscriptionEnded: boolean;
  /** Set only when decision 15 applied and ending the subscription failed -- the refund above still
   * succeeded; never let this turn a successful refund into a reported failure. */
  subscriptionEndError: string | null;
  /** The refund is still pending at Razorpay, so the subscription is left for the refund.processed
   * webhook to end. */
  subscriptionEndPending: boolean;
}

export async function refundBillingPayment(input: {
  paymentId: string;
  reason: string;
  requestKey: string;
}): Promise<RefundBillingPaymentResult> {
  const { user: actor } = await verifyAdmin();
  await ensureBillingAdminActionsEnabled();

  const paymentId = assertUuid(input.paymentId, 'payment id');
  const requestKey = assertRequestKey(input.requestKey);
  const reason = normalizeReason(input.reason);
  const admin = createAdminClient();

  // Idempotent replay: the DB's own unique index on request_key is the real guard (the insert below
  // hits 23505 on a genuine race); this up-front check gives a clean replay instead of a raw conflict.
  const existingByKey = await admin
    .from('admin_user_audit_events')
    .select('id, action_type, after_json')
    .eq('request_key', requestKey)
    .maybeSingle();

  if (existingByKey.data) {
    return replayRefundOutcome(existingByKey.data as { action_type: string; after_json: Record<string, unknown> | null });
  }

  // 1. Load the payment server-side. Amount, currency, owner and provider ids all come from here --
  // never from the caller.
  const paymentResult = await admin
    .from('billing_payments')
    .select(
      'id, user_id, provider_payment_id, provider_mode, status, gross_minor, currency_code, kind, billing_order_id, provider_subscription_id, cycle_start, cycle_end, plan_version_id'
    )
    .eq('id', paymentId)
    .maybeSingle();
  throwOnBillingQueryError(paymentResult.error, 'Refund');
  const payment = paymentResult.data;
  if (!payment) throw new Error('Payment not found.');
  if (payment.status !== 'captured') {
    throw new Error(`This payment is "${payment.status}", not "captured", so it cannot be refunded.`);
  }
  if (!payment.user_id) {
    throw new Error(
      'This payment has no live account attached (the account was deleted), so there is no wallet to claw back from. Refusing rather than refunding blind.'
    );
  }

  // 2. Resolve and load the purchase's own grant (migration 124's uq_beat_grants_purchase_source).
  const sourceRef = resolvePurchaseGrantSourceRef({
    kind: payment.kind,
    billingOrderId: payment.billing_order_id,
    providerSubscriptionId: payment.provider_subscription_id,
    cycleStart: payment.cycle_start,
  });
  if (!sourceRef) {
    throw new Error('Could not determine which coin grant this purchase funded. Refusing to refund without being able to claw back.');
  }

  const grantResult = await admin
    .from('beat_grants')
    .select('id, beats_total, beats_remaining')
    .eq('user_id', payment.user_id)
    .eq('source_type', sourceRef.sourceType)
    .eq('source_ref_id', sourceRef.sourceRefId)
    .maybeSingle();
  if (grantResult.error) throw new Error(`Failed to load the purchase's coin grant: ${grantResult.error.message}`);
  const grant = grantResult.data as { id: string; beats_total: number; beats_remaining: number } | null;

  const NO_GRANT_ERROR = 'No coin grant was found for this purchase. Refusing to refund without being able to claw back.';

  // 3. Eligibility (decision 12: refuse above ~20% used).
  //
  // Decision 16: a missing grant on a SUBSCRIPTION purchase is not automatically a refusal -- some
  // plans (Audience) genuinely include 0 coins, and there is nothing to claw back from those. Proceed
  // with a trivial "nothing to claw" eligibility only once that is proven (resolveSubscriptionIncludedBeats
  // returns exactly 0); a coin-bearing purchase whose grant is merely missing still refuses exactly as
  // before, and so does every top-up (a top-up is never zero-coin).
  let eligibility: ReturnType<typeof evaluateRefundClawbackEligibility>;
  if (!grant) {
    if (sourceRef.sourceType !== 'subscription') {
      throw new Error(NO_GRANT_ERROR);
    }
    const includedBeats = await resolveSubscriptionIncludedBeats({
      supabase: admin,
      providerSubscriptionId: payment.provider_subscription_id,
      planVersionId: payment.plan_version_id,
    });
    if (includedBeats !== 0) {
      throw new Error(NO_GRANT_ERROR);
    }
    eligibility = { eligible: true, usedFraction: 0, beatsToClaw: 0, reason: null };
  } else {
    eligibility = evaluateRefundClawbackEligibility({
      beatsTotal: Number(grant.beats_total),
      beatsRemaining: Number(grant.beats_remaining),
    });
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? 'This purchase is not eligible for a refund.');
    }
  }

  // 4. Per-account refund cap. Counted from this module's own audit rows (outcome === 'refunded'),
  // not from billing_refunds, since that table's write is convergence-only and may lag the webhook.
  const capValue = await getFeatureFlagValue(REFUND_CAP_FLAG_KEY);
  const cap = resolveRefundCapPerAccount(capValue);
  const priorRefundsResult = await admin
    .from('admin_user_audit_events')
    .select('after_json')
    .eq('target_user_id', payment.user_id)
    .eq('action_type', 'payment_refunded');
  if (priorRefundsResult.error) throw new Error(`Failed to check the refund cap: ${priorRefundsResult.error.message}`);
  const priorSuccessfulRefunds = (priorRefundsResult.data ?? []).filter(
    (row) => (row.after_json as Record<string, unknown> | null)?.outcome === 'refunded'
  ).length;
  if (isRefundCapReached(priorSuccessfulRefunds, cap)) {
    throw new Error(`This account has already reached its refund cap (${cap} lifetime). Escalate rather than refunding again.`);
  }

  // 5. Write the "attempting" audit row BEFORE any mutation, so a crash mid-flight leaves evidence.
  const insertAuditResult = await admin
    .from('admin_user_audit_events')
    .insert({
      target_user_id: payment.user_id,
      actor_user_id: actor.id,
      action_type: 'payment_refunded',
      reason,
      request_key: requestKey,
      before_json: {
        paymentId: payment.id,
        providerPaymentId: payment.provider_payment_id,
        grossMinor: payment.gross_minor,
        currencyCode: payment.currency_code,
        grantId: grant?.id ?? null,
        usedFraction: eligibility.usedFraction,
      },
      after_json: { outcome: 'attempting' },
      metadata_json: { grantId: grant?.id ?? null },
    })
    .select('id')
    .single();
  if (insertAuditResult.error) {
    if (insertAuditResult.error.code === '23505') {
      throw new Error('This request key has already been used. Refusing to start a second attempt.');
    }
    throw new Error(`Failed to record the refund attempt: ${insertAuditResult.error.message}`);
  }
  const auditEventId = (insertAuditResult.data as { id: string }).id;

  // 6. Claw back the coins FIRST (decision 12) -- skipped entirely for decision 16's zero-coin
  // purchase, where there is no grant id to target and beatsToClaw is 0 by construction.
  if (grant) {
    const clawbackResult = await admin.rpc('admin_adjust_purchase_grant_beats', {
      p_target_user_id: payment.user_id,
      p_actor_user_id: actor.id,
      p_grant_id: grant.id,
      p_delta_beats: -eligibility.beatsToClaw,
      p_direction: 'clawback',
      p_reason: reason,
      p_request_key: `${requestKey}:clawback`,
    });

    if (clawbackResult.error) {
      const message = isMissingBillingSchemaError(clawbackResult.error)
        ? 'Coins could not be clawed back -- migration 132 has not been applied on this environment. Refusing to refund without being able to claw back.'
        : `Failed to claw back coins: ${clawbackResult.error.message}`;
      await patchAuditOutcome(admin, auditEventId, {
        outcome: resolveRefundAttemptOutcome({ clawbackSucceeded: false, providerCallSucceeded: false }),
        error: message,
      });
      throw new Error(message);
    }
  }

  // 7. Call Razorpay. A failure here must restore the coins before anything else.
  let refund: Awaited<ReturnType<typeof refundRazorpayPayment>>;
  try {
    refund = await refundRazorpayPayment({
      paymentId: payment.provider_payment_id,
      notes: { reason, actorUserId: actor.id, requestKey },
    });
  } catch (err) {
    const providerError = err instanceof Error ? err.message : String(err);
    // Decision 16: no grant means nothing was ever clawed back, so there is nothing to compensate --
    // trivially "succeeded" rather than an RPC call with no grant id to target.
    let compensateSucceeded = true;
    if (grant) {
      const restoreResult = await admin.rpc('admin_adjust_purchase_grant_beats', {
        p_target_user_id: payment.user_id,
        p_actor_user_id: actor.id,
        p_grant_id: grant.id,
        p_delta_beats: eligibility.beatsToClaw,
        p_direction: 'restore',
        p_reason: `Compensating restore after a failed refund attempt: ${reason}`,
        p_request_key: `${requestKey}:compensate`,
      });
      compensateSucceeded = !restoreResult.error;
      if (restoreResult.error) {
        console.error('[admin-billing-actions] compensating restore failed', {
          paymentId: payment.id,
          grantId: grant.id,
          message: restoreResult.error.message,
        });
      }
    }
    const outcome = resolveRefundAttemptOutcome({
      clawbackSucceeded: true,
      providerCallSucceeded: false,
      compensateSucceeded,
    });
    await patchAuditOutcome(admin, auditEventId, { outcome, error: providerError });

    if (outcome === 'provider_call_failed_compensation_failed') {
      throw new Error(
        `Refund failed at Razorpay (${providerError}) AND the compensating coin restore also failed. ` +
        `Coins may be inconsistent for this account -- check audit event ${auditEventId} and fix by hand before retrying.`
      );
    }
    throw new Error(`Refund failed at Razorpay: ${providerError}. The clawed-back coins have been restored; no money was refunded.`);
  }

  // 8. Success. Decision 15: a full refund of the CURRENT cycle ends the subscription now -- this is
  // deliberately separate from "did the refund succeed", so its failure never turns a real refund
  // into a reported failure (module header, and see endSubscriptionAfterFullRefund's own contract:
  // it never throws).
  // Only once Razorpay says 'processed': a still-pending refund may yet fail, and the refund.processed
  // webhook ends the subscription through the same helper when it lands.
  const subscriptionEndPending = refund.status !== 'processed' && isCurrentCycleSubscriptionPayment({
    kind: payment.kind,
    cycleEnd: payment.cycle_end,
  });
  const subscriptionEndResult = refund.status === 'processed'
    ? await endSubscriptionAfterFullRefund({
        supabase: admin,
        kind: payment.kind,
        providerSubscriptionId: payment.provider_subscription_id,
        refundAmountMinor: refund.amount,
        paymentGrossMinor: payment.gross_minor,
        cycleEnd: payment.cycle_end,
      })
    : { ended: false, error: null };
  if (subscriptionEndResult.error) {
    console.error('[admin-billing-actions] ending the subscription after a full refund failed', {
      paymentId: payment.id,
      providerSubscriptionId: payment.provider_subscription_id,
      message: subscriptionEndResult.error,
    });
  }

  // Patch the audit row and best-effort write the ledger for immediate visibility -- the webhook
  // remains the record either way (see module header).
  await patchAuditOutcome(admin, auditEventId, {
    outcome: resolveRefundAttemptOutcome({ clawbackSucceeded: true, providerCallSucceeded: true }),
    providerRefundId: refund.id,
    refundedAmountMinor: refund.amount,
    beatsClawedBack: eligibility.beatsToClaw,
    subscriptionEnded: subscriptionEndResult.ended,
    subscriptionEndError: subscriptionEndResult.error,
    subscriptionEndPending,
  });

  try {
    await recordRefund({
      supabase: admin,
      subjectRef: payment.user_id,
      paymentId: payment.id,
      providerPaymentId: payment.provider_payment_id,
      providerMode: payment.provider_mode,
      providerRefundId: refund.id,
      amountMinor: refund.amount,
      currencyCode: refund.currency,
      status: refund.status === 'processed' ? 'processed' : 'pending',
      reason,
      initiatedBy: 'admin',
      actorUserRef: actor.id,
      coinAdjustment: { beatsClawedBack: eligibility.beatsToClaw, grantId: grant?.id ?? null },
      rawPayload: refund as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.error('[admin-billing-actions] best-effort ledger write for refund failed (webhook remains the record)', {
      paymentId: payment.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${payment.user_id}`);

  return {
    providerRefundId: refund.id,
    refundedAmountMinor: refund.amount,
    beatsClawedBack: eligibility.beatsToClaw,
    alreadyApplied: false,
    subscriptionEnded: subscriptionEndResult.ended,
    subscriptionEndError: subscriptionEndResult.error,
    subscriptionEndPending,
  };
}

function replayRefundOutcome(existing: {
  action_type: string;
  after_json: Record<string, unknown> | null;
}): RefundBillingPaymentResult {
  if (existing.action_type !== 'payment_refunded') {
    throw new Error('This request key has already been used for a different operation.');
  }
  const after = existing.after_json ?? {};
  const outcome = after.outcome;

  if (outcome === 'refunded') {
    return {
      providerRefundId: String(after.providerRefundId ?? ''),
      refundedAmountMinor: Number(after.refundedAmountMinor ?? 0),
      beatsClawedBack: Number(after.beatsClawedBack ?? 0),
      alreadyApplied: true,
      subscriptionEnded: Boolean(after.subscriptionEnded),
      subscriptionEndError: after.subscriptionEndError ? String(after.subscriptionEndError) : null,
      subscriptionEndPending: Boolean(after.subscriptionEndPending),
    };
  }
  if (outcome === 'provider_call_failed_compensated') {
    throw new Error('This exact refund attempt already failed at Razorpay and its coins were already restored. No money was refunded.');
  }
  if (outcome === 'provider_call_failed_compensation_failed') {
    throw new Error('This exact refund attempt already failed at Razorpay AND its compensating coin restore also failed. Check the audit trail before doing anything else.');
  }
  if (outcome === 'clawback_failed') {
    throw new Error('This exact refund attempt already failed before reaching Razorpay (coins were never clawed back). No money was refunded.');
  }
  throw new Error('A previous attempt with this request key is in an unknown state. Check the audit trail before retrying.');
}

// ---------------------------------------------------------------------------------------------
// Cancel (decision 13): exactly ONE cancel action -- stop the renewal, keep access to period end.
// ---------------------------------------------------------------------------------------------

export interface CancelBillingSubscriptionResult {
  providerSubscriptionId: string;
  status: string;
  alreadyApplied: boolean;
}

export async function cancelBillingSubscriptionAtCycleEnd(input: {
  subscriptionId: string;
  reason: string;
  requestKey: string;
}): Promise<CancelBillingSubscriptionResult> {
  const { user: actor } = await verifyAdmin();
  await ensureBillingAdminActionsEnabled();

  const subscriptionId = assertUuid(input.subscriptionId, 'subscription id');
  const requestKey = assertRequestKey(input.requestKey);
  const reason = normalizeReason(input.reason);
  const admin = createAdminClient();

  const existingByKey = await admin
    .from('admin_user_audit_events')
    .select('action_type, after_json')
    .eq('request_key', requestKey)
    .maybeSingle();
  if (existingByKey.data) {
    if (existingByKey.data.action_type !== 'subscription_cancelled_at_cycle_end') {
      throw new Error('This request key has already been used for a different operation.');
    }
    const after = (existingByKey.data.after_json ?? {}) as Record<string, unknown>;
    return {
      providerSubscriptionId: String(after.providerSubscriptionId ?? ''),
      status: String(after.status ?? 'unknown'),
      alreadyApplied: true,
    };
  }

  const subscriptionResult = await admin
    .from('billing_subscriptions')
    .select('id, user_id, provider_subscription_id, status, cancel_at_period_end')
    .eq('id', subscriptionId)
    .maybeSingle();
  throwOnBillingQueryError(subscriptionResult.error, 'Cancel');
  const subscription = subscriptionResult.data;
  if (!subscription) throw new Error('Subscription not found.');
  if (['cancelled', 'expired', 'completed'].includes(subscription.status)) {
    throw new Error(`This subscription is already "${subscription.status}"; there is nothing to cancel.`);
  }

  const auditInsert = await admin
    .from('admin_user_audit_events')
    .insert({
      target_user_id: subscription.user_id,
      actor_user_id: actor.id,
      action_type: 'subscription_cancelled_at_cycle_end',
      reason,
      request_key: requestKey,
      before_json: { subscriptionId: subscription.id, status: subscription.status },
      after_json: { outcome: 'attempting' },
    })
    .select('id')
    .single();
  if (auditInsert.error) {
    if (auditInsert.error.code === '23505') throw new Error('This request key has already been used.');
    throw new Error(`Failed to record the cancellation attempt: ${auditInsert.error.message}`);
  }
  const auditEventId = (auditInsert.data as { id: string }).id;

  let cancelled: Awaited<ReturnType<typeof cancelRazorpaySubscription>>;
  try {
    // Decision 13: exactly one cancel action. atCycleEnd is always true -- never client-controlled.
    cancelled = await cancelRazorpaySubscription({
      subscriptionId: subscription.provider_subscription_id,
      atCycleEnd: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchAuditOutcome(admin, auditEventId, { outcome: 'failed', error: message });
    throw new Error(`Cancellation failed at Razorpay: ${message}`);
  }

  await patchAuditOutcome(admin, auditEventId, {
    outcome: 'cancelled_at_cycle_end',
    providerSubscriptionId: cancelled.id,
    status: cancelled.status,
  });

  // Best-effort immediate convergence -- the webhook/reconcile backstop still owns the real state.
  try {
    await reconcilePricingSubscription({ providerSubscriptionId: cancelled.id });
  } catch (err) {
    console.error('[admin-billing-actions] best-effort re-sync after cancellation failed', {
      subscriptionId: subscription.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (subscription.user_id) {
    revalidatePath('/admin/users');
    revalidatePath(`/admin/users/${subscription.user_id}`);
  }

  return { providerSubscriptionId: cancelled.id, status: cancelled.status, alreadyApplied: false };
}

// ---------------------------------------------------------------------------------------------
// Re-sync / reprocess: thin, audited wrappers around existing idempotent reconcile paths. These
// never move money themselves -- they force the same convergence the daily cron already performs.
// ---------------------------------------------------------------------------------------------

export async function resyncBillingSubscriptionFromProvider(input: {
  providerSubscriptionId: string;
}): Promise<{ subscriptionStatus: string; grantedCoins: number }> {
  const { user: actor } = await verifyAdmin();
  await ensureBillingAdminActionsEnabled();
  const providerSubscriptionId = String(input.providerSubscriptionId ?? '').trim();
  if (!providerSubscriptionId) throw new Error('A provider subscription id is required.');

  const result = await reconcilePricingSubscription({ providerSubscriptionId });
  await auditResyncBestEffort({
    actorUserId: actor.id,
    actionType: 'subscription_resynced',
    reason: `Admin re-sync of subscription ${providerSubscriptionId} from the user record`,
    metadata: { resourceType: 'subscription', providerSubscriptionId, result },
  });
  return { subscriptionStatus: result.subscriptionStatus, grantedCoins: result.grantedCoins };
}

export async function resyncBillingTopupFromProvider(input: {
  billingOrderId: string;
}): Promise<{ grantedCoins: number }> {
  const { user: actor } = await verifyAdmin();
  await ensureBillingAdminActionsEnabled();
  const billingOrderId = assertUuid(input.billingOrderId, 'billing order id');

  const result = await reconcilePricingTopup({ billingOrderId });
  await auditResyncBestEffort({
    actorUserId: actor.id,
    actionType: 'subscription_resynced',
    reason: `Admin re-sync of top-up order ${billingOrderId} from the user record`,
    metadata: { resourceType: 'topup', billingOrderId, result },
  });
  return { grantedCoins: result.grantedCoins };
}

export async function reprocessBillingWebhookEventById(input: {
  eventId: string;
}): Promise<{ status: string; outcome: string }> {
  const { user: actor } = await verifyAdmin();
  await ensureBillingAdminActionsEnabled();
  const eventId = assertUuid(input.eventId, 'webhook event id');
  const admin = createAdminClient();

  const eventResult = await admin
    .from('billing_webhook_events')
    .select('id, related_user_id, payload_json, attempt_count')
    .eq('id', eventId)
    .maybeSingle();
  throwOnBillingQueryError(eventResult.error, 'Reprocess');
  const event = eventResult.data;
  if (!event) throw new Error('Webhook event not found.');

  const reopenResult = await admin
    .from('billing_webhook_events')
    .update({
      status: 'received',
      attempt_count: (event.attempt_count ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', event.id);
  throwOnBillingQueryError(reopenResult.error, 'Reprocess');

  let status: string;
  let outcome: string;
  try {
    const processResult = await processRazorpayWebhookEvent({
      supabase: admin,
      payload: event.payload_json as unknown as RazorpayWebhookPayload,
    });
    status = processResult.status;
    outcome = processResult.outcome;
    const updateResult = await admin
      .from('billing_webhook_events')
      .update({
        status: processResult.status,
        outcome: processResult.outcome,
        related_user_id: processResult.relatedUserId,
        related_subscription_id: processResult.relatedSubscriptionId,
        processed_at: new Date().toISOString(),
      })
      .eq('id', event.id);
    throwOnBillingQueryError(updateResult.error, 'Reprocess');
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await admin
      .from('billing_webhook_events')
      .update({ status: 'failed', error_message: message, processed_at: new Date().toISOString() })
      .eq('id', event.id);
    status = 'failed';
    outcome = message;
  }

  await auditResyncBestEffort({
    targetUserId: event.related_user_id,
    actorUserId: actor.id,
    actionType: 'webhook_reprocessed',
    reason: `Admin reprocess of webhook event ${eventId}`,
    metadata: { eventId, status, outcome },
  });

  return { status, outcome };
}

async function auditResyncBestEffort(input: {
  targetUserId?: string | null;
  actorUserId: string;
  actionType: 'subscription_resynced' | 'webhook_reprocessed';
  reason: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('admin_user_audit_events').insert({
      target_user_id: input.targetUserId ?? null,
      actor_user_id: input.actorUserId,
      action_type: input.actionType,
      reason: input.reason,
      metadata_json: input.metadata,
    });
    if (error) {
      console.error('[admin-billing-actions] failed to record resync/reprocess audit row', { message: error.message });
    }
  } catch (err) {
    // A reconcile that already succeeded (or already failed on its own terms) must not be reported
    // as failed just because its audit row could not be written -- same reasoning as
    // setAdminUserEntitlementTier's tier-change audit (app/actions/admin-users.ts:360).
    console.error('[admin-billing-actions] resync/reprocess audit failed', { message: err instanceof Error ? err.message : String(err) });
  }
}
