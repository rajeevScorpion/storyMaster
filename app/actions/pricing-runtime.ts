'use server';

import { buildPricingRuntimeContextData } from '@/lib/pricing/snapshot';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type {
  DbBeatGrant,
  DbBeatSpendReservation,
  DbBillingCustomer,
  DbBillingSubscription,
  DbPricingPlan,
  DbPricingPlanVersion,
} from '@/lib/types/database';
import type { PricingMarketKey, PricingRuntimeContext } from '@/lib/types/pricing';
import { PRICING_RUNTIME_SETTING_DEFINITIONS } from '@/lib/types/pricing';

interface RuntimeFlagRow {
  flag_key: string;
  enabled: boolean;
  value: string | null;
}

export interface GetPricingRuntimeContextInput {
  pricingMarketKey?: PricingMarketKey | null;
  countryCode?: string | null;
}

export async function getPricingRuntimeContext(
  input: GetPricingRuntimeContextInput = {}
): Promise<PricingRuntimeContext> {
  const userId = await getCurrentUserId();
  const supabase = createAdminClient();

  const [plansResult, versionsResult, runtimeFlagsResult] = await Promise.all([
    supabase.from('pricing_plans').select('*').order('tier_rank', { ascending: true }),
    supabase.from('pricing_plan_versions').select('*').order('created_at', { ascending: false }),
    supabase
      .from('feature_flags')
      .select('flag_key, enabled, value')
      .in('flag_key', PRICING_RUNTIME_SETTING_DEFINITIONS.map((definition) => definition.key)),
  ]);

  throwIfQueryFailed(plansResult.error, 'Failed to load pricing plans');
  throwIfQueryFailed(versionsResult.error, 'Failed to load pricing plan versions');
  throwIfQueryFailed(runtimeFlagsResult.error, 'Failed to load pricing runtime flags');

  let billingCustomers: DbBillingCustomer[] = [];
  let billingSubscriptions: DbBillingSubscription[] = [];
  let beatGrants: DbBeatGrant[] = [];
  let beatReservations: DbBeatSpendReservation[] = [];

  if (userId) {
    const [customersResult, subscriptionsResult, grantsResult, reservationsResult] = await Promise.all([
      supabase
        .from('billing_customers')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('billing_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('beat_grants')
        .select('*')
        .eq('user_id', userId)
        .order('granted_at', { ascending: false }),
      supabase
        .from('beat_spend_reservations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    throwIfQueryFailed(customersResult.error, 'Failed to load billing customers');
    throwIfQueryFailed(subscriptionsResult.error, 'Failed to load billing subscriptions');
    throwIfQueryFailed(grantsResult.error, 'Failed to load beat grants');
    throwIfQueryFailed(reservationsResult.error, 'Failed to load beat reservations');

    billingCustomers = (customersResult.data ?? []) as DbBillingCustomer[];
    billingSubscriptions = (subscriptionsResult.data ?? []) as DbBillingSubscription[];
    beatGrants = (grantsResult.data ?? []) as DbBeatGrant[];
    beatReservations = (reservationsResult.data ?? []) as DbBeatSpendReservation[];
  }

  const { controls, snapshot } = buildPricingRuntimeContextData({
    pricingMarketKey: input.pricingMarketKey ?? null,
    countryCode: input.countryCode ?? null,
    plans: (plansResult.data ?? []) as DbPricingPlan[],
    planVersions: (versionsResult.data ?? []) as DbPricingPlanVersion[],
    featureFlags: (runtimeFlagsResult.data ?? []) as RuntimeFlagRow[],
    billingCustomers,
    billingSubscriptions,
    beatGrants,
    beatReservations,
  });

  return {
    userId,
    controls,
    snapshot,
  };
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data.user?.id ?? null;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
