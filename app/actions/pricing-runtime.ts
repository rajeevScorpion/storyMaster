'use server';

import { ensureFreeAllowanceForUser, expireStaleReservations } from '@/lib/pricing/enforcement';
import { buildPricingRuntimeContextData } from '@/lib/pricing/snapshot';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getFeatureFlag } from '@/lib/ai/model-config';
import type {
  DbBeatGrant,
  DbBeatSpendReservation,
  DbBillingCustomer,
  DbBillingSubscription,
  DbPricingActionCost,
  DbPricingPlan,
  DbPricingPlanVersion,
  DbPricingTopupPack,
  DbBeatUsageEvent,
} from '@/lib/types/database';
import type {
  PricingMarketKey,
  PricingRuntimeContext,
  PricingWalletActivityItem,
  PricingWalletPageData,
  PricingPlanOfferCard,
  PricingTopupOfferCard,
} from '@/lib/types/pricing';
import { COINS_PER_BEAT, PRICING_RUNTIME_SETTING_DEFINITIONS } from '@/lib/types/pricing';

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

  if (userId) {
    await expireStaleReservations({ supabase });
  }

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

    const withWalletBase = buildPricingRuntimeContextData({
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

    if (
      withWalletBase.controls.pricingSnapshotEnabled &&
      withWalletBase.snapshot.planKey === 'free'
    ) {
      const grantResult = await ensureFreeAllowanceForUser(userId, {
        pricingMarketKey: input.pricingMarketKey ?? null,
        countryCode: input.countryCode ?? null,
        supabase,
      });

      if (grantResult.granted) {
        const [grantsReload, reservationsReload] = await Promise.all([
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

        throwIfQueryFailed(grantsReload.error, 'Failed to reload beat grants after free allowance');
        throwIfQueryFailed(reservationsReload.error, 'Failed to reload beat reservations after free allowance');

        beatGrants = (grantsReload.data ?? []) as DbBeatGrant[];
        beatReservations = (reservationsReload.data ?? []) as DbBeatSpendReservation[];
      }
    }
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

  const actionCosts = await loadActionCosts(supabase);

  return {
    userId,
    controls,
    snapshot,
    actionCosts,
  };
}

export async function getPricingWalletPageData(
  input: GetPricingRuntimeContextInput = {}
): Promise<PricingWalletPageData> {
  const context = await getPricingRuntimeContext(input);
  const supabase = createAdminClient();

  const [plansResult, planVersionsResult, topupsResult, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled] = await Promise.all([
    supabase
      .from('pricing_plans')
      .select('*')
      .eq('is_active', true)
      .eq('is_public', true)
      .order('tier_rank', { ascending: true }),
    supabase
      .from('pricing_plan_versions')
      .select('*')
      .eq('status', 'published')
      .eq('pricing_market_key', context.snapshot.pricingMarketKey)
      .order('plan_id', { ascending: true }),
    supabase
      .from('pricing_topup_packs')
      .select('*')
      .eq('status', 'published')
      .eq('pricing_market_key', context.snapshot.pricingMarketKey)
      .order('beat_amount', { ascending: true }),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
  ]);

  throwIfQueryFailed(plansResult.error, 'Failed to load wallet plan offers');
  throwIfQueryFailed(planVersionsResult.error, 'Failed to load wallet plan versions');
  throwIfQueryFailed(topupsResult.error, 'Failed to load wallet top-up offers');

  let recentActivity: PricingWalletActivityItem[] = [];

  if (context.userId) {
    const [grantsResult, usageResult] = await Promise.all([
      supabase
        .from('beat_grants')
        .select('*')
        .eq('user_id', context.userId)
        .order('granted_at', { ascending: false })
        .limit(10),
      supabase
        .from('beat_usage_events')
        .select('*')
        .eq('user_id', context.userId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    throwIfQueryFailed(grantsResult.error, 'Failed to load wallet grant activity');
    throwIfQueryFailed(usageResult.error, 'Failed to load wallet spend activity');

    recentActivity = buildWalletActivity(
      (grantsResult.data ?? []) as DbBeatGrant[],
      (usageResult.data ?? []) as DbBeatUsageEvent[]
    );
  }

  return {
    pricingMarketKey: context.snapshot.pricingMarketKey,
    checkoutEnabled: context.controls.pricingCheckoutEnabled,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    planOffers: buildPlanOffers(
      (plansResult.data ?? []) as DbPricingPlan[],
      (planVersionsResult.data ?? []) as DbPricingPlanVersion[],
      context.snapshot.planKey
    ),
    topupOffers: buildTopupOffers((topupsResult.data ?? []) as DbPricingTopupPack[]),
    recentActivity,
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

function buildPlanOffers(
  plans: DbPricingPlan[],
  versions: DbPricingPlanVersion[],
  currentPlanKey: PricingRuntimeContext['snapshot']['planKey']
): PricingPlanOfferCard[] {
  return plans.map((plan) => {
    const monthly = versions.find((version) =>
      version.plan_id === plan.id &&
      version.billing_interval === 'monthly'
    ) ?? null;
    const annual = versions.find((version) =>
      version.plan_id === plan.id &&
      version.billing_interval === 'annual'
    ) ?? null;
    const primary = monthly ?? annual;

    return {
      planKey: plan.plan_key,
      name: plan.name,
      description: plan.description,
      tierRank: plan.tier_rank,
      currencyCode: primary?.currency_code ?? 'USD',
      monthlyPlanVersionId: monthly?.id ?? null,
      annualPlanVersionId: annual?.id ?? null,
      monthlyProvider: monthly?.provider ?? null,
      annualProvider: annual?.provider ?? null,
      monthlyPriceMinor: monthly?.price_minor ?? null,
      annualPriceMinor: annual?.price_minor ?? null,
      monthlyCoins: beatsToCoins(primary?.monthly_included_beats ?? 0),
      storyLengthCap: primary?.story_length_cap ?? 4,
      canAccessDownloads: Boolean(plan.feature_flags_json?.canAccessDownloads ?? false),
      canAccessUnbrandedExports: Boolean(plan.feature_flags_json?.canAccessUnbrandedExports ?? false),
      creatorControls: Boolean(plan.feature_flags_json?.creatorControls ?? false),
      isCurrentPlan: plan.plan_key === currentPlanKey,
    };
  });
}

function buildTopupOffers(topups: DbPricingTopupPack[]): PricingTopupOfferCard[] {
  return topups.map((pack) => ({
    topupPackId: pack.id,
    packKey: pack.pack_key,
    name: pack.name,
    currencyCode: pack.currency_code,
    priceMinor: pack.price_minor,
    coinAmount: beatsToCoins(pack.beat_amount),
    provider: pack.provider,
  }));
}

function buildWalletActivity(
  grants: DbBeatGrant[],
  usageEvents: DbBeatUsageEvent[]
): PricingWalletActivityItem[] {
  const grantItems: PricingWalletActivityItem[] = grants.map((grant) => ({
    id: `grant:${grant.id}`,
    kind: 'grant',
    title: getGrantTitle(grant.source_type),
    subtitle: getGrantSubtitle(grant.source_type),
    coinsDelta: beatsToCoins(grant.beats_total),
    occurredAt: grant.granted_at,
  }));

  const spendItems: PricingWalletActivityItem[] = usageEvents.map((event) => ({
    id: `spend:${event.id}`,
    kind: 'spend',
    title: getSpendTitle(event.action_key),
    subtitle: 'Used while creating in Kissago',
    coinsDelta: -beatsToCoins(event.beat_cost),
    occurredAt: event.created_at,
  }));

  return [...grantItems, ...spendItems]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 20);
}

function getGrantTitle(sourceType: DbBeatGrant['source_type']): string {
  switch (sourceType) {
    case 'free_allowance':
      return 'Free monthly refill';
    case 'subscription':
    case 'carry_forward':
      return 'Monthly refill';
    case 'topup':
      return 'Top-up added';
    case 'promotion':
      return 'Bonus coins added';
    case 'migration_grant':
      return 'Welcome coins added';
    case 'admin_adjustment':
      return 'Coins adjusted';
    default:
      return 'Coins added';
  }
}

function getGrantSubtitle(sourceType: DbBeatGrant['source_type']): string {
  switch (sourceType) {
    case 'free_allowance':
      return 'Included with your free plan';
    case 'subscription':
      return 'Included with your active plan';
    case 'carry_forward':
      return 'Unused coins carried into the new period';
    case 'topup':
      return 'Purchased coin pack';
    case 'promotion':
      return 'Campaign or bonus reward';
    case 'migration_grant':
      return 'Internal rollout goodwill grant';
    case 'admin_adjustment':
      return 'Manual support adjustment';
    default:
      return 'Wallet credit';
  }
}

function getSpendTitle(actionKey: string): string {
  switch (actionKey) {
    case 'start_story_initial_beat':
      return 'Started a story';
    case 'continue_story_new_beat':
      return 'Added a new beat';
    case 'regenerate_image':
      return 'Regenerated an image';
    case 'regenerate_narration':
      return 'Regenerated narration';
    case 'export_video_future':
      return 'Exported a video';
    default:
      return 'Used coins in Kissago';
  }
}

function beatsToCoins(value: number): number {
  return value * COINS_PER_BEAT;
}

async function loadActionCosts(
  supabase: ReturnType<typeof createAdminClient>
): Promise<Record<string, number>> {
  const result = await supabase
    .from('pricing_action_costs')
    .select('*')
    .eq('is_active', true)
    .order('effective_from', { ascending: false });

  throwIfQueryFailed(result.error, 'Failed to load active pricing action costs');

  const rows = (result.data ?? []) as DbPricingActionCost[];
  const now = Date.now();
  const costs = new Map<string, number>();

  for (const row of rows) {
    if (costs.has(row.action_key)) {
      continue;
    }

    const startsAt = new Date(row.effective_from).getTime();
    const endsAt = row.effective_to ? new Date(row.effective_to).getTime() : Number.POSITIVE_INFINITY;
    if (startsAt <= now && now < endsAt) {
      costs.set(row.action_key, row.beat_cost);
    }
  }

  return Object.fromEntries(costs);
}
