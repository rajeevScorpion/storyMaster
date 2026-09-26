'use server';

import {
  ensureFreeWelcomeGrantForUser,
  expireStaleReservations,
  isAdminUserId,
  loadCachedPricingGlobals,
  loadEntitlementOverridePlanKey,
} from '@/lib/pricing/enforcement';
import { resolveMyReviewerStanding } from '@/lib/agentic/reviewers';
import {
  buildPricingRuntimeCacheKey,
  getCachedPricingRuntimeContext,
  setCachedPricingRuntimeContext,
} from '@/lib/pricing/runtime-context-cache';
import { buildPricingRuntimeContextData } from '@/lib/pricing/snapshot';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { isCheckoutOpenForUser } from '@/lib/billing/checkout-allowlist';
import { loadBillingProfile, toBillingProfileDTO } from '@/lib/billing/billing-profile';
import { getPublishedTaxRule, type TaxRuleLookupResult } from '@/lib/billing/tax-rules';
import { resolveActiveViewerProfile } from '@/lib/viewer-profile';
import { loadWalletActivityPage } from '@/lib/pricing/wallet-activity';
import { isWalletActivityCursor } from '@/lib/pricing/wallet-activity.shared';
import type {
  DbBeatGrant,
  DbBeatSpendReservation,
  DbBillingCustomer,
  DbBillingSubscription,
  DbPricingActionCost,
  DbPricingPlan,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import type {
  BillingProfileDTO,
  PlanKey,
  PricingMarketKey,
  PricingRuntimeContext,
  PricingRuntimeControls,
  PricingWalletActivityItem,
  WalletActivityCursor,
  WalletActivityPage,
  PricingWalletPageData,
  PricingPlanOfferCard,
  PricingTopupOfferCard,
  WalletTaxPreview,
} from '@/lib/types/pricing';
import { COINS_PER_BEAT, normalizeVideoExportPreset } from '@/lib/types/pricing';

export interface GetPricingRuntimeContextInput {
  pricingMarketKey?: PricingMarketKey | null;
  countryCode?: string | null;
  forceRefresh?: boolean;
}

export async function getPricingRuntimeContext(
  input: GetPricingRuntimeContextInput = {}
): Promise<PricingRuntimeContext> {
  const userId = await getCurrentUserId();
  const cacheKey = buildPricingRuntimeCacheKey(
    userId,
    input.pricingMarketKey ?? null,
    input.countryCode ?? null
  );

  if (!input.forceRefresh) {
    const cached = getCachedPricingRuntimeContext(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const supabase = createAdminClient();

  // Reservation expiry must land before the user-row reads below (pending
  // holds count against the balance), but it has no bearing on the globals.
  const [globals] = await Promise.all([
    loadCachedPricingGlobals(supabase),
    userId ? expireStaleReservations({ supabase }) : Promise.resolve(0),
  ]);

  let billingCustomers: DbBillingCustomer[] = [];
  let billingSubscriptions: DbBillingSubscription[] = [];
  let beatGrants: DbBeatGrant[] = [];
  let beatReservations: DbBeatSpendReservation[] = [];
  let entitlementOverridePlanKey: PlanKey | null = null;
  // D20 (docs/agentic-creator-phase9c-plan.md section 4.1): the current user's
  // reviewer standing rides this already-fetched, already-cached payload instead
  // of UserMenu making its own request. resolveMyReviewerStanding() never throws,
  // so it needs no throwIfQueryFailed companion -- it degrades to `null` on its
  // own for every failure mode (see lib/agentic/reviewers.ts).
  let reviewerStanding: PricingRuntimeContext['reviewer'] = null;

  if (userId) {
    const [customersResult, subscriptionsResult, grantsResult, reservationsResult, overridePlanKey, standing] = await Promise.all([
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
      loadEntitlementOverridePlanKey(supabase, userId),
      resolveMyReviewerStanding(userId),
    ]);

    throwIfQueryFailed(customersResult.error, 'Failed to load billing customers');
    throwIfQueryFailed(subscriptionsResult.error, 'Failed to load billing subscriptions');
    throwIfQueryFailed(grantsResult.error, 'Failed to load beat grants');
    throwIfQueryFailed(reservationsResult.error, 'Failed to load beat reservations');

    billingCustomers = (customersResult.data ?? []) as DbBillingCustomer[];
    billingSubscriptions = (subscriptionsResult.data ?? []) as DbBillingSubscription[];
    beatGrants = (grantsResult.data ?? []) as DbBeatGrant[];
    beatReservations = (reservationsResult.data ?? []) as DbBeatSpendReservation[];
    entitlementOverridePlanKey = overridePlanKey;
    reviewerStanding = standing;

    const withWalletBase = buildPricingRuntimeContextData({
      pricingMarketKey: input.pricingMarketKey ?? null,
      countryCode: input.countryCode ?? null,
      plans: globals.plans,
      planVersions: globals.planVersions,
      featureFlags: globals.featureFlags,
      billingCustomers,
      billingSubscriptions,
      beatGrants,
      beatReservations,
      entitlementOverridePlanKey,
      isAdmin: isAdminUserId(userId),
    });

    if (
      withWalletBase.controls.pricingSnapshotEnabled &&
      withWalletBase.snapshot.planKey === 'free'
    ) {
      const grantResult = await ensureFreeWelcomeGrantForUser(userId, {
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

        throwIfQueryFailed(grantsReload.error, 'Failed to reload beat grants after the welcome grant');
        throwIfQueryFailed(reservationsReload.error, 'Failed to reload beat reservations after the welcome grant');

        beatGrants = (grantsReload.data ?? []) as DbBeatGrant[];
        beatReservations = (reservationsReload.data ?? []) as DbBeatSpendReservation[];
      }
    }
  }

  const { controls: rawControls, snapshot } = buildPricingRuntimeContextData({
    pricingMarketKey: input.pricingMarketKey ?? null,
    countryCode: input.countryCode ?? null,
    plans: globals.plans,
    planVersions: globals.planVersions,
    featureFlags: globals.featureFlags,
    billingCustomers,
    billingSubscriptions,
    beatGrants,
    beatReservations,
    entitlementOverridePlanKey,
    isAdmin: isAdminUserId(userId),
  });

  // Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the named-account
  // rollout narrows the *global* pricingCheckoutEnabled control to this one user. Short-circuits on
  // the global flag first, so a listed user still sees checkout as closed while the kill switch is
  // off, and an unlisted/signed-out visitor never triggers the allowlist read once the kill switch
  // has already decided the answer. `rawControls` itself is left untouched -- it comes from
  // buildPricingRuntimeContextData, whose `featureFlags` input is the process-wide, non-per-user
  // cache in lib/pricing/enforcement.ts (loadCachedPricingGlobals). Baking a per-user decision into
  // that function's own output would leak one user's allowlist result into every other user's read.
  // `controls` below is a fresh object built per call and only cached under a userId-scoped key
  // (runtime-context-cache.ts's buildPricingRuntimeCacheKey), so overriding a field on the copy here
  // is safe.
  const controls: PricingRuntimeControls = {
    ...rawControls,
    pricingCheckoutEnabled: rawControls.pricingCheckoutEnabled && (await isCheckoutOpenForUser(userId)),
  };

  const context: PricingRuntimeContext = {
    userId,
    controls,
    snapshot,
    actionCosts: buildActionCostMap(globals.actionCosts),
    // Feature gates read the entitlement tier so a promoted account sees the
    // storyboard-image toggle unlocked; costs below stay on the same catalog.
    meterEntitlements: buildMeterEntitlementMap(globals.actionCosts, snapshot.entitlementPlanKey),
    reviewer: reviewerStanding,
  };

  setCachedPricingRuntimeContext(cacheKey, context);

  return context;
}

export interface GetPricingWalletPageDataInput {
  pricingMarketKey: PricingMarketKey;
  currentPlanKey?: PlanKey;
}

export async function getPricingWalletPageData(
  input: GetPricingWalletPageDataInput
): Promise<PricingWalletPageData> {
  const userId = await getCurrentUserId();
  const supabase = createAdminClient();
  const currentPlanKey: PlanKey = input.currentPlanKey ?? 'free';

  const [
    plansResult,
    planVersionsResult,
    topupsResult,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    viewerProfile,
  ] = await Promise.all([
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
      .eq('pricing_market_key', input.pricingMarketKey)
      .order('plan_id', { ascending: true }),
    supabase
      .from('pricing_topup_packs')
      .select('*')
      .eq('status', 'published')
      .eq('pricing_market_key', input.pricingMarketKey)
      .order('beat_amount', { ascending: true }),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner decision P6): resolveActiveViewerProfile
    // never throws -- it fails closed to the implicit 'all' default -- so this needs no try/catch of its own.
    resolveActiveViewerProfile(),
  ]);

  throwIfQueryFailed(plansResult.error, 'Failed to load wallet plan offers');
  throwIfQueryFailed(planVersionsResult.error, 'Failed to load wallet plan versions');
  throwIfQueryFailed(topupsResult.error, 'Failed to load wallet top-up offers');

  let recentActivity: PricingWalletActivityItem[] = [];
  let recentActivityNextCursor: WalletActivityCursor | null = null;
  let storyCount = 0;
  let storylineCount = 0;
  let billingProfile: BillingProfileDTO | null = null;
  let taxPreview: WalletTaxPreview | null = null;

  if (userId) {
    const [activityPage, storiesCountResult, storylinesCountResult, taxRuleResult, billingProfileResult] = await Promise.all([
      loadWalletActivityPage(supabase, userId, null),
      supabase
        .from('stories')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_archived', false),
      supabase
        .from('storylines')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      // Payments Phase 2, Unit B2a: the wallet's headline is top-ups, so that is the rule kind asked
      // for here; a market with different subscription rates can ask separately later. Neither of
      // these two lookups may throw out of the wallet load -- a missing tax line or billing profile
      // is far better than the whole wallet failing to open -- so both are wrapped and logged rather
      // than allowed to reject the Promise.all.
      getPublishedTaxRule(input.pricingMarketKey, 'topup').catch((err): TaxRuleLookupResult => {
        console.error('getPricingWalletPageData: getPublishedTaxRule threw:', err);
        return { status: 'unavailable' };
      }),
      loadBillingProfile(supabase, userId).catch((err) => {
        console.error('getPricingWalletPageData: loadBillingProfile threw:', err);
        return { status: 'unavailable' as const };
      }),
    ]);

    throwIfQueryFailed(storiesCountResult.error, 'Failed to load wallet story count');
    throwIfQueryFailed(storylinesCountResult.error, 'Failed to load wallet storyline count');

    recentActivity = activityPage.items;
    recentActivityNextCursor = activityPage.nextCursor;
    storyCount = storiesCountResult.count ?? 0;
    storylineCount = storylinesCountResult.count ?? 0;
    taxPreview = buildWalletTaxPreview(taxRuleResult);
    billingProfile = billingProfileResult.status === 'ok' && billingProfileResult.profile
      ? toBillingProfileDTO(billingProfileResult.profile)
      : null;
  }

  return {
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    storyCount,
    storylineCount,
    planOffers: buildPlanOffers(
      (plansResult.data ?? []) as DbPricingPlan[],
      (planVersionsResult.data ?? []) as DbPricingPlanVersion[],
      currentPlanKey
    ),
    topupOffers: buildTopupOffers((topupsResult.data ?? []) as DbPricingTopupPack[]),
    recentActivity,
    recentActivityNextCursor,
    billingProfile,
    taxPreview,
    audienceMode: viewerProfile.audienceMode,
  };
}

/**
 * Payments Phase 2, Unit B2a (docs/payments/phase-2-unit-b2-plan.md §3): maps a tax rule lookup to
 * what the wallet needs to know. 'unavailable' (migration 125 absent) becomes `null` so the wallet
 * renders exactly as it does today; 'not_found' (125 applied, nothing published) still reports the
 * label so a future "tax rules are being configured" message has somewhere to hang, but leaves
 * `requiresBillingState: false` since checkout's existing refusal for that case is not a new message
 * this unit should invent.
 */
function buildWalletTaxPreview(result: TaxRuleLookupResult): WalletTaxPreview | null {
  if (result.status === 'unavailable') {
    return null;
  }
  if (result.status === 'not_found') {
    return { ratePercent: null, taxLabel: 'GST', requiresBillingState: false };
  }
  return {
    ratePercent: result.rule.taxRegime === 'in_gst' ? result.rule.ratePercent : null,
    taxLabel: 'GST',
    requiresBillingState: true,
  };
}

/** The wallet's "Older" button: the page of activity after `cursor`, for the signed-in user only. */
export async function getWalletActivityPage(cursor: unknown): Promise<WalletActivityPage> {
  if (!isWalletActivityCursor(cursor)) return { items: [], nextCursor: null };
  const userId = await getCurrentUserId();
  if (!userId) return { items: [], nextCursor: null };
  return loadWalletActivityPage(createAdminClient(), userId, cursor);
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
      // Defaults true, not false -- see PricingPlanFeatureFlags.unlimitedWatching.
      unlimitedWatching: Boolean(plan.feature_flags_json?.unlimitedWatching ?? true),
      videoExportPreset: normalizeVideoExportPreset(plan.feature_flags_json?.videoExportPreset),
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

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

function asBeatAmount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildActionCostMap(rows: DbPricingActionCost[]): Record<string, number> {
  const now = Date.now();
  const costs = new Map<string, number>();

  for (const row of rows) {
    if (!row.is_active) {
      continue;
    }
    if (costs.has(row.action_key)) {
      continue;
    }

    const startsAt = new Date(row.effective_from).getTime();
    const endsAt = row.effective_to ? new Date(row.effective_to).getTime() : Number.POSITIVE_INFINITY;
    if (startsAt <= now && now < endsAt) {
      costs.set(row.action_key, asBeatAmount(row.beat_cost));
    }
  }

  return Object.fromEntries(costs);
}

function buildMeterEntitlementMap(
  rows: DbPricingActionCost[],
  planKey: PlanKey
): Record<string, boolean> {
  return Object.fromEntries(rows.map((row) => {
    const tierEnabled = planKey === 'studio'
      ? row.studio_enabled
      : planKey === 'plus'
      ? row.plus_enabled
      : row.free_enabled;
    return [row.action_key, row.is_active && tierEnabled !== false];
  }));
}
