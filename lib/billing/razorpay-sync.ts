import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { razorpayUnixToIso, type RazorpaySubscription } from '@/lib/billing/razorpay';
import type {
  DbBillingOrder,
  DbBillingSubscription,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import { COINS_PER_BEAT, type PricingMarketKey } from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;

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
  const gracePeriodEndsAt = computeGracePeriodEnd(currentPeriodEnd, input.planVersion.grace_period_days);

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

  return {
    billingSubscriptionId,
    grantedCoins: grantedBeats * COINS_PER_BEAT,
  };
}

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

  throwIfQueryFailed(error, 'Failed to grant top-up beats');
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

  throwIfQueryFailed(error, 'Failed to grant subscription beats');
  return input.planVersion.monthly_included_beats;
}

function computeGracePeriodEnd(currentPeriodEnd: string | null, gracePeriodDays: number): string | null {
  if (!currentPeriodEnd || gracePeriodDays <= 0) {
    return null;
  }

  const date = new Date(currentPeriodEnd);
  date.setUTCDate(date.getUTCDate() + gracePeriodDays);
  return date.toISOString();
}

function throwIfQueryFailed(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
