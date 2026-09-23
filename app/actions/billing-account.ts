'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { checkoutStateFromOrder } from '@/lib/billing/checkout-status.shared';
import type { CheckoutOrderState } from '@/lib/billing/checkout-status.shared';
import type { DbBillingOrder } from '@/lib/types/database';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): the self-serve checkout-status
 * lookup useRazorpayCheckout's dismiss poll calls after the customer closes the Razorpay window
 * without the handler ever firing (defect 5 -- a UPI approval can still land after the window is
 * gone). No provider call: the webhook and verify already converge billing_orders, so this only reads
 * what is already recorded.
 */

export interface CheckoutStatusResult {
  state: CheckoutOrderState;
}

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Please sign in to check checkout status');
  }

  return user.id;
}

/** Scoped by id AND user_id, so a missing row and someone else's order both resolve to `abandoned` --
 * an unknown or foreign id leaks nothing about whether it exists. */
export async function getMyCheckoutStatus(internalOrderId: string): Promise<CheckoutStatusResult> {
  const userId = await getAuthenticatedUserId();
  const supabase = createAdminClient();

  const orderResult = await supabase
    .from('billing_orders')
    .select('*')
    .eq('id', internalOrderId)
    .eq('user_id', userId)
    .maybeSingle();

  const order = orderResult.error ? null : ((orderResult.data ?? null) as DbBillingOrder | null);
  if (!order) {
    return { state: 'abandoned' };
  }

  let firstChargeConfirmedAt: string | null = null;
  if (order.order_type === 'subscription_checkout' && order.provider_checkout_session_id) {
    const subscriptionResult = await supabase
      .from('billing_subscriptions')
      .select('first_charge_confirmed_at')
      .eq('provider', 'razorpay')
      .eq('provider_subscription_id', order.provider_checkout_session_id)
      .maybeSingle();

    firstChargeConfirmedAt = subscriptionResult.error
      ? null
      : ((subscriptionResult.data as { first_charge_confirmed_at: string | null } | null)?.first_charge_confirmed_at ?? null);
  }

  return {
    state: checkoutStateFromOrder({
      orderType: order.order_type,
      status: order.status,
      firstChargeConfirmedAt,
    }),
  };
}
