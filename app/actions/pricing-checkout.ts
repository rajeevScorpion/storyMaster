'use server';

import { createRazorpayOrder, createRazorpayPlan, createRazorpaySubscription, getRazorpayKeyId } from '@/lib/billing/razorpay';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type {
  DbBillingSubscription,
  DbPricingPlan,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import type {
  PrepareRazorpayCheckoutInput,
  PreparedRazorpayCheckout,
  PricingMarketKey,
} from '@/lib/types/pricing';

interface PrepareCheckoutOptions {
  pricingMarketKey?: PricingMarketKey | null;
}

export async function prepareRazorpayCheckout(
  input: PrepareRazorpayCheckoutInput,
  options: PrepareCheckoutOptions = {}
): Promise<PreparedRazorpayCheckout> {
  const auth = await getAuthenticatedUser();
  const supabase = createAdminClient();

  if (input.kind === 'subscription') {
    const version = await loadPlanVersionForCheckout(supabase, input.planVersionId, options.pricingMarketKey ?? null);
    const plan = await loadPlanById(supabase, version.plan_id);

    if (plan.plan_key === 'free' || version.price_minor <= 0) {
      throw new Error('This plan is not purchasable');
    }

    if (version.provider === 'razorpay' && version.billing_interval === 'annual') {
      throw new Error('Yearly checkout is not available yet for the India market. Please use a monthly plan while we test monthly refills end to end.');
    }

    const blockingSubscriptionsResult = await supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('user_id', auth.userId)
      .eq('provider', 'razorpay')
      .order('updated_at', { ascending: false });

    throwIfQueryFailed(blockingSubscriptionsResult.error, 'Failed to check existing subscriptions');

    const blocking = ((blockingSubscriptionsResult.data ?? []) as DbBillingSubscription[]).find((subscription) =>
      ['created', 'authenticated', 'active', 'pending', 'halted'].includes(subscription.status)
    );

    if (blocking) {
      throw new Error('You already have a Razorpay subscription in progress. Subscription changes will stay manual until account management is live.');
    }

    const razorpayPlanId = await ensureRazorpayPlanRef(supabase, version, plan);
    const subscription = await createRazorpaySubscription({
      planId: razorpayPlanId,
      interval: version.billing_interval,
      notes: {
        user_id: auth.userId,
        plan_version_id: version.id,
        pricing_market_key: version.pricing_market_key,
      },
    });

    const orderInsertResult = await supabase
      .from('billing_orders')
      .insert({
        user_id: auth.userId,
        provider: 'razorpay',
        order_type: 'subscription_checkout',
        provider_checkout_session_id: subscription.id,
        currency_code: version.currency_code,
        amount_minor: version.price_minor,
        status: subscription.status,
        plan_version_id: version.id,
        raw_provider_payload_json: {
          kind: 'subscription',
          subscription,
        },
      })
      .select('id')
      .single();

    throwIfQueryFailed(orderInsertResult.error, 'Failed to create subscription checkout order');

    return {
      kind: 'subscription',
      keyId: getRazorpayKeyId(),
      internalOrderId: orderInsertResult.data!.id,
      razorpaySubscriptionId: subscription.id,
      displayName: 'Kissago',
      description: `${plan.name} plan · ${labelInterval(version.billing_interval)}`,
      userName: auth.userName,
      userEmail: auth.userEmail,
    };
  }

  const topup = await loadTopupPackForCheckout(supabase, input.topupPackId, options.pricingMarketKey ?? null);
  if (topup.price_minor <= 0) {
    throw new Error('This coin pack is not purchasable');
  }

  const receipt = `kissago_${topup.pack_key}_${Date.now()}`;
  const order = await createRazorpayOrder({
    amountMinor: topup.price_minor,
    currencyCode: topup.currency_code,
    receipt,
    notes: {
      user_id: auth.userId,
      topup_pack_id: topup.id,
      pricing_market_key: topup.pricing_market_key,
    },
  });

  const orderInsertResult = await supabase
    .from('billing_orders')
    .insert({
      user_id: auth.userId,
      provider: 'razorpay',
      order_type: 'topup_checkout',
      provider_order_id: order.id,
      currency_code: topup.currency_code,
      amount_minor: topup.price_minor,
      status: order.status,
      topup_pack_id: topup.id,
      raw_provider_payload_json: {
        kind: 'topup',
        order,
      },
    })
    .select('id')
    .single();

  throwIfQueryFailed(orderInsertResult.error, 'Failed to create top-up checkout order');

  return {
    kind: 'topup',
    keyId: getRazorpayKeyId(),
    internalOrderId: orderInsertResult.data!.id,
    razorpayOrderId: order.id,
    amountMinor: topup.price_minor,
    currencyCode: topup.currency_code,
    displayName: 'Kissago',
    description: topup.name,
    userName: auth.userName,
    userEmail: auth.userEmail,
  };
}

async function getAuthenticatedUser(): Promise<{
  userId: string;
  userEmail: string | null;
  userName: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Please sign in before starting checkout');
  }

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    userName:
      (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.length > 0
        ? user.user_metadata.full_name
        : null) ??
      (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.length > 0
        ? user.user_metadata.name
        : null),
  };
}

async function loadPlanVersionForCheckout(
  supabase: ReturnType<typeof createAdminClient>,
  planVersionId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<DbPricingPlanVersion> {
  const result = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', planVersionId)
    .eq('status', 'published')
    .eq('provider', 'razorpay')
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan version');

  const version = (result.data ?? null) as DbPricingPlanVersion | null;
  if (!version) {
    throw new Error('This plan checkout is not available yet');
  }

  if (pricingMarketKey && version.pricing_market_key !== pricingMarketKey) {
    throw new Error('This plan does not belong to the selected market');
  }

  return version;
}

async function loadPlanById(
  supabase: ReturnType<typeof createAdminClient>,
  planId: string
): Promise<DbPricingPlan> {
  const result = await supabase
    .from('pricing_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan');

  const plan = (result.data ?? null) as DbPricingPlan | null;
  if (!plan) {
    throw new Error('Plan not found');
  }

  return plan;
}

async function loadTopupPackForCheckout(
  supabase: ReturnType<typeof createAdminClient>,
  topupPackId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<DbPricingTopupPack> {
  const result = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('id', topupPackId)
    .eq('status', 'published')
    .eq('provider', 'razorpay')
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load top-up pack');

  const topup = (result.data ?? null) as DbPricingTopupPack | null;
  if (!topup) {
    throw new Error('This top-up is not available yet');
  }

  if (pricingMarketKey && topup.pricing_market_key !== pricingMarketKey) {
    throw new Error('This coin pack does not belong to the selected market');
  }

  return topup;
}

async function ensureRazorpayPlanRef(
  supabase: ReturnType<typeof createAdminClient>,
  version: DbPricingPlanVersion,
  plan: DbPricingPlan
): Promise<string> {
  if (version.provider_price_ref) {
    return version.provider_price_ref;
  }

  const createdPlan = await createRazorpayPlan({
    interval: version.billing_interval,
    amountMinor: version.price_minor,
    currencyCode: version.currency_code,
    name: `${plan.name} ${labelInterval(version.billing_interval)}`,
    description: plan.description,
    notes: {
      plan_key: plan.plan_key,
      plan_version_id: version.id,
      pricing_market_key: version.pricing_market_key,
    },
  });

  const updateResult = await supabase
    .from('pricing_plan_versions')
    .update({
      provider_product_ref: createdPlan.item.id,
      provider_price_ref: createdPlan.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', version.id);

  throwIfQueryFailed(updateResult.error, 'Failed to persist Razorpay plan reference');

  return createdPlan.id;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function labelInterval(value: DbPricingPlanVersion['billing_interval']): string {
  return value === 'annual' ? 'Yearly' : 'Monthly';
}
