'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { resolveActiveViewerProfile } from '@/lib/viewer-profile';
import { assertCheckoutAllowed, CheckoutRefusalError } from '@/lib/billing/checkout-guard.shared';
import { checkoutStateFromOrder } from '@/lib/billing/checkout-status.shared';
import type { CheckoutOrderState } from '@/lib/billing/checkout-status.shared';
import { addBillingInterval, taxLinesFromBreakdown } from '@/lib/billing/checkout-quote.shared';
import type { CheckoutQuote } from '@/lib/billing/checkout-quote.shared';
import {
  assertBetaMarketAllowed,
  getAuthenticatedUser,
  loadPlanById,
  loadPlanVersionForCheckout,
  loadTopupPackForCheckout,
  resolveCheckoutTax,
} from '@/app/actions/pricing-checkout';
import { COINS_PER_BEAT } from '@/lib/types/pricing';
import type { PrepareRazorpayCheckoutInput, PricingMarketKey } from '@/lib/types/pricing';
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

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the checkout summary sheet's price.
 * Runs the same catalogue load, beta-market check and resolveCheckoutTax as
 * prepareRazorpayCheckoutInternal, and creates nothing -- no RPC, no Razorpay order or subscription,
 * no billing_orders row. Resolves its own audienceMode (unlike prepare's internal function, which
 * trusts its caller) because this export is itself the whole surface, reachable directly as a
 * `'use server'` action -- there is no separate route to resolve it first.
 */
export type QuoteCheckoutResult =
  | { ok: true; quote: CheckoutQuote }
  | { ok: false; needsBillingDetails: true }
  | { ok: false; error: string };

export async function quoteCheckout(
  input: PrepareRazorpayCheckoutInput,
  pricingMarketKey?: PricingMarketKey | null
): Promise<QuoteCheckoutResult> {
  try {
    if (!(await getFeatureFlag('pricing_checkout_enabled', false))) {
      throw new CheckoutRefusalError('Checkout is currently unavailable', 'checkout_disabled', 503);
    }

    // Owner decision P6: kids checkout refuses here too, even though the wallet already hides the
    // buttons in kids mode -- a stale or crafted client should learn nothing new. adultAttested is
    // always true for a quote: attestation is about paying, not about seeing a price.
    const { audienceMode } = await resolveActiveViewerProfile();
    const refusal = assertCheckoutAllowed({ audienceMode, adultAttested: true });
    if (refusal) {
      throw new CheckoutRefusalError(refusal.message, refusal.code, 403);
    }

    const auth = await getAuthenticatedUser();
    const supabase = createAdminClient();

    const quote =
      input.kind === 'subscription'
        ? await quoteSubscription(supabase, auth.userId, input.planVersionId, pricingMarketKey ?? null)
        : await quoteTopup(supabase, auth.userId, input.topupPackId, pricingMarketKey ?? null);

    return { ok: true, quote };
  } catch (err) {
    if (err instanceof CheckoutRefusalError) {
      if (err.code === 'billing_details_incomplete') {
        return { ok: false, needsBillingDetails: true };
      }
      return { ok: false, error: err.message };
    }
    console.error('[checkout.quote]', err);
    return { ok: false, error: "We couldn't load the price. Please try again in a moment." };
  }
}

async function quoteSubscription(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  planVersionId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<CheckoutQuote> {
  const version = await loadPlanVersionForCheckout(supabase, planVersionId, pricingMarketKey);
  await assertBetaMarketAllowed(version.pricing_market_key);
  const plan = await loadPlanById(supabase, version.plan_id);

  if (plan.plan_key === 'free' || version.price_minor <= 0) {
    throw new CheckoutRefusalError('This plan is not purchasable', 'not_purchasable', 400);
  }

  // Mirrors prepare's own annual refusal (pricing-checkout.ts) -- latent today since no annual
  // version is published, so loadPlanVersionForCheckout can't return one in practice yet.
  if (version.provider === 'razorpay' && version.billing_interval === 'annual') {
    throw new CheckoutRefusalError(
      'Yearly checkout is not available yet for the India market. Please use a monthly plan while we test monthly refills end to end.',
      'annual_unavailable',
      400
    );
  }

  const tax = await resolveCheckoutTax({ supabase, userId, appliesTo: 'subscription', netMinor: version.price_minor });

  return {
    kind: 'subscription',
    title: plan.name,
    currencyCode: version.currency_code,
    netMinor: tax.netMinor,
    taxMinor: tax.taxMinor,
    grossMinor: tax.grossMinor,
    ratePercent: tax.taxBreakdown?.ratePercent ?? null,
    taxLines: taxLinesFromBreakdown(tax.taxBreakdown),
    coins: beatsToCoins(version.monthly_included_beats),
    interval: version.billing_interval,
    nextChargeDate: addBillingInterval(new Date(), version.billing_interval).toISOString(),
  };
}

async function quoteTopup(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  topupPackId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<CheckoutQuote> {
  const topup = await loadTopupPackForCheckout(supabase, topupPackId, pricingMarketKey);
  await assertBetaMarketAllowed(topup.pricing_market_key);

  if (topup.price_minor <= 0) {
    throw new CheckoutRefusalError('This coin pack is not purchasable', 'not_purchasable', 400);
  }

  const tax = await resolveCheckoutTax({ supabase, userId, appliesTo: 'topup', netMinor: topup.price_minor });

  return {
    kind: 'topup',
    title: topup.name,
    currencyCode: topup.currency_code,
    netMinor: tax.netMinor,
    taxMinor: tax.taxMinor,
    grossMinor: tax.grossMinor,
    ratePercent: tax.taxBreakdown?.ratePercent ?? null,
    taxLines: taxLinesFromBreakdown(tax.taxBreakdown),
    coins: beatsToCoins(topup.beat_amount),
    interval: null,
    nextChargeDate: null,
  };
}

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}
