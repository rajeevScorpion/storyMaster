import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { cancelRazorpaySubscription } from '@/lib/billing/razorpay';
import { enqueueBillingJob } from '@/lib/billing/notifications/queue';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { shouldEndSubscriptionAfterFullRefund } from '@/lib/billing/subscription-refund-end.shared';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface EndSubscriptionAfterFullRefundInput {
  supabase: AdminClient;
  kind: string;
  providerSubscriptionId: string | null;
  refundAmountMinor: number;
  paymentGrossMinor: number;
  cycleEnd: string | null;
  now?: Date;
}

export interface EndSubscriptionAfterFullRefundResult {
  /** True once decision 15's conditions are met and the subscription is (now, or already was)
   * cancelled. False whenever there was nothing to end -- not eligible, or already ended earlier. */
  ended: boolean;
  /** Set only when decision 15 DID apply and ending the subscription failed. Never set together with
   * `ended: true`. Both callers (the admin action, the webhook) must treat this as separate from
   * whether the refund itself succeeded -- see the module header of app/actions/admin-billing-actions.ts. */
  error: string | null;
}

/**
 * Payments Phase 4, owner decision 15: a full refund of the CURRENT cycle ends the subscription now.
 * Shared by refundBillingPayment (app/actions/admin-billing-actions.ts) and the refund.processed
 * webhook path (lib/billing/razorpay-webhook.ts) -- see both call sites for why each needs this to
 * never throw.
 *
 * Idempotent by construction:
 *  - a local billing_subscriptions row already `cancelled`/`completed` is a no-op success
 *    (shouldEndSubscriptionAfterFullRefund's own check, so a webhook replay or an admin reprocess
 *    changes nothing on a second pass);
 *  - Razorpay's own "already cancelled" response (it has no structured code for this, see
 *    razorpayRequest in lib/billing/razorpay.ts -- matching the message text is the only signal
 *    available) is treated as success too, converging the local row rather than surfacing a false
 *    failure when Razorpay's state is already ahead of ours.
 *
 * Never throws. Every failure -- a missing migration, a query error, a Razorpay error that isn't
 * "already cancelled" -- comes back as `{ ended: false, error }` for the caller to log/record without
 * ever turning a successful refund into a reported failure.
 */
export async function endSubscriptionAfterFullRefund(
  input: EndSubscriptionAfterFullRefundInput
): Promise<EndSubscriptionAfterFullRefundResult> {
  const { supabase, providerSubscriptionId } = input;
  if (!providerSubscriptionId) return { ended: false, error: null };

  try {
    const subscriptionResult = await supabase
      .from('billing_subscriptions')
      .select('id, status, user_id, subject_ref')
      .eq('provider', 'razorpay')
      .eq('provider_subscription_id', providerSubscriptionId)
      .maybeSingle();

    if (subscriptionResult.error) {
      if (isMissingBillingSchemaError(subscriptionResult.error)) return { ended: false, error: null };
      return { ended: false, error: `Failed to load the subscription: ${subscriptionResult.error.message}` };
    }

    const subscription = subscriptionResult.data as
      | { id: string; status: string; user_id: string | null; subject_ref: string | null }
      | null;
    if (!subscription) return { ended: false, error: null };

    const shouldEnd = shouldEndSubscriptionAfterFullRefund({
      kind: input.kind,
      refundAmountMinor: input.refundAmountMinor,
      paymentGrossMinor: input.paymentGrossMinor,
      cycleEnd: input.cycleEnd,
      localSubscriptionStatus: subscription.status,
      now: input.now,
    });
    if (!shouldEnd) return { ended: false, error: null };

    try {
      // Decision 15: end it now, not at cycle end -- atCycleEnd is always false here, never
      // client-controlled. This is deliberately a different call shape from decision 13's cancel
      // (cancelBillingSubscriptionAtCycleEnd in app/actions/admin-billing-actions.ts, always true).
      await cancelRazorpaySubscription({ subscriptionId: providerSubscriptionId, atCycleEnd: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isAlreadyCancelledAtProvider(message)) {
        return { ended: false, error: message };
      }
      // Razorpay already treats it as cancelled -- fall through and converge the local row.
    }

    const now = input.now ?? new Date();
    const updateResult = await supabase
      .from('billing_subscriptions')
      .update({ status: 'cancelled', cancel_at_period_end: false, updated_at: now.toISOString() })
      .eq('id', subscription.id);

    if (updateResult.error) {
      return {
        ended: false,
        error: `Cancelled at Razorpay but failed to update the local subscription row: ${updateResult.error.message}`,
      };
    }

    // The row went straight to `cancelled` here, so the sync's own status-transition rule never sees
    // the change and would never send "your plan has ended". Same kind and dedupe key as that rule, so
    // it is still sent at most once. enqueueBillingJob never throws.
    const subjectRef = subscription.subject_ref ?? subscription.user_id;
    if (subjectRef) {
      await enqueueBillingJob({
        kind: 'subscription_ended',
        dedupeKey: `sub_ended:${subscription.id}`,
        subjectRef,
        userId: subscription.user_id,
        billingSubscriptionId: subscription.id,
      });
    }

    return { ended: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[subscription-refund-end] unexpected failure ending a subscription after a full refund', {
      providerSubscriptionId,
      message,
    });
    return { ended: false, error: message };
  }
}

/** Razorpay's cancel endpoint has no structured error code for "this subscription is already
 * cancelled" (razorpayRequest in lib/billing/razorpay.ts only ever throws a plain Error built from
 * the provider's free-text `description`), so text matching is the only signal available -- a
 * judgment call, recorded in the payments handoff rather than invented silently. */
function isAlreadyCancelledAtProvider(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('cancel') && lower.includes('already');
}
