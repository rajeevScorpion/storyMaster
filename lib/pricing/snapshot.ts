import 'server-only';

import type {
  DbBeatGrant,
  DbBeatSpendReservation,
  DbBillingCustomer,
  DbBillingSubscription,
  DbPricingPlan,
  DbPricingPlanVersion,
} from '@/lib/types/database';
import {
  BILLING_PROVIDERS,
  PRICING_RUNTIME_SETTING_DEFINITIONS,
  normalizeVideoExportPreset,
  type BillingInterval,
  type BillingProvider,
  type EffectivePricingSnapshot,
  type PlanKey,
  type PricingMarketKey,
  type PricingRuntimeControls,
} from '@/lib/types/pricing';
import { computeWalletAvailability } from '@/lib/pricing/wallet';

interface RuntimeFlagRow {
  flag_key: string;
  enabled: boolean;
  value: string | null;
}

export interface BuildPricingRuntimeContextInput {
  pricingMarketKey?: PricingMarketKey | null;
  countryCode?: string | null;
  plans: DbPricingPlan[];
  planVersions: DbPricingPlanVersion[];
  featureFlags: RuntimeFlagRow[];
  billingCustomers?: DbBillingCustomer[];
  billingSubscriptions?: DbBillingSubscription[];
  beatGrants?: DbBeatGrant[];
  beatReservations?: DbBeatSpendReservation[];
  now?: Date;
}

interface SelectedPlanVariant {
  plan: DbPricingPlan;
  version: DbPricingPlanVersion;
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'authenticated']);
const GRACE_PERIOD_SUBSCRIPTION_STATUSES = new Set(['pending', 'halted']);

export function buildPricingRuntimeControls(
  featureFlags: RuntimeFlagRow[]
): PricingRuntimeControls {
  const rows = new Map(featureFlags.map((row) => [row.flag_key, row]));

  return {
    pricingAdminTabEnabled: getBooleanControl(rows, 'pricing_admin_tab_enabled'),
    pricingSnapshotEnabled: getBooleanControl(rows, 'pricing_snapshot_enabled'),
    pricingCheckoutEnabled: getBooleanControl(rows, 'pricing_checkout_enabled'),
    pricingShadowMeteringEnabled: getBooleanControl(rows, 'pricing_shadow_metering_enabled'),
    pricingHardEnforcementEnabled: getBooleanControl(rows, 'pricing_hard_enforcement_enabled'),
    pricingAdminBypassEnabled: getBooleanControl(rows, 'pricing_admin_bypass_enabled'),
    pricingStoryLengthUiLimitsEnabled: getBooleanControl(rows, 'pricing_story_length_ui_limits_enabled'),
    defaultGracePeriodDays: getIntegerControl(rows, 'pricing_default_grace_period_days'),
    defaultCarryForwardCapMultiplier: getIntegerControl(rows, 'pricing_default_carry_forward_cap_multiplier'),
    reservationTimeoutSeconds: getIntegerControl(rows, 'pricing_reservation_timeout_seconds'),
    migrationGrantBeats: getIntegerControl(rows, 'pricing_migration_grant_beats'),
    testerStudioDurationDays: getIntegerControl(rows, 'pricing_tester_studio_duration_days'),
    routingProviderIn: getProviderControl(rows, 'pricing_routing_provider_in'),
    routingProviderRow: getProviderControl(rows, 'pricing_routing_provider_row'),
    indiaOnlyBetaEnabled: getBooleanControl(rows, 'pricing_india_only_beta_enabled'),
  };
}

export function buildEffectivePricingSnapshot(
  input: BuildPricingRuntimeContextInput
): EffectivePricingSnapshot {
  const controls = buildPricingRuntimeControls(input.featureFlags);
  return buildEffectivePricingSnapshotWithControls(input, controls);
}

export function buildPricingRuntimeContextData(
  input: BuildPricingRuntimeContextInput
): {
  controls: PricingRuntimeControls;
  snapshot: EffectivePricingSnapshot;
} {
  const controls = buildPricingRuntimeControls(input.featureFlags);
  return {
    controls,
    snapshot: buildEffectivePricingSnapshotWithControls(input, controls),
  };
}

function buildEffectivePricingSnapshotWithControls(
  input: BuildPricingRuntimeContextInput,
  controls: PricingRuntimeControls
): EffectivePricingSnapshot {
  const now = input.now ?? new Date();
  const activeSubscription = selectEntitledSubscription(input.billingSubscriptions ?? [], now);
  const planById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const versionById = new Map(input.planVersions.map((version) => [version.id, version]));

  const resolvedMarket = resolvePricingMarketKey({
    explicitPricingMarketKey: input.pricingMarketKey,
    explicitCountryCode: input.countryCode,
    activeSubscription,
    billingCustomers: input.billingCustomers ?? [],
    planVersionsById: versionById,
  });

  const selectedPlanVariant = selectPlanVariant({
    resolvedMarket,
    activeSubscription,
    planById,
    versionById,
    plans: input.plans,
    planVersions: input.planVersions,
  });

  const selectedPlan = selectedPlanVariant?.plan ?? null;
  const selectedVersion = selectedPlanVariant?.version ?? null;
  const currentCustomer = selectCurrentBillingCustomer(input.billingCustomers ?? [], resolvedMarket);
  const walletAvailability = computeWalletAvailability(
    input.beatGrants ?? [],
    input.beatReservations ?? [],
    now
  );
  const freeAllowanceResetAt = selectFreeAllowanceResetAt(input.beatGrants ?? [], now);

  if (!selectedPlan || !selectedVersion) {
    return buildFallbackFreeSnapshot(resolvedMarket, controls, currentCustomer?.country_code ?? input.countryCode ?? null);
  }

  const isInGracePeriod = activeSubscription ? isSubscriptionInGracePeriod(activeSubscription, now) : false;
  const billingInterval = selectedPlan.plan_key === 'free'
    ? null
    : (activeSubscription?.billing_interval ?? selectedVersion.billing_interval ?? null);

  return {
    pricingMarketKey: resolvedMarket,
    routingProvider: getRoutingProviderForMarket(controls, resolvedMarket),
    planKey: selectedPlan.plan_key,
    planTierRank: selectedPlan.tier_rank,
    planVersionId: selectedVersion.id,
    monthlyIncludedBeats: selectedVersion.monthly_included_beats,
    billingProvider: activeSubscription?.provider ?? null,
    billingInterval,
    billingCountryCode: currentCustomer?.country_code ?? input.countryCode ?? null,
    currencyCode: selectedVersion.currency_code,
    billingStatus: activeSubscription?.status ?? 'free',
    isInGracePeriod,
    currentPeriodEndsAt: activeSubscription?.current_period_end ?? null,
    gracePeriodEndsAt: activeSubscription?.grace_period_ends_at ?? null,
    nextResetAt: activeSubscription?.current_period_end ?? freeAllowanceResetAt,
    storyLengthCap: selectedVersion.story_length_cap,
    canAccessDownloads: Boolean(selectedPlan.feature_flags_json?.canAccessDownloads ?? false),
    canAccessUnbrandedExports: Boolean(selectedPlan.feature_flags_json?.canAccessUnbrandedExports ?? false),
    creatorControls: Boolean(selectedPlan.feature_flags_json?.creatorControls ?? false),
    videoExportPreset: normalizeVideoExportPreset(selectedPlan.feature_flags_json?.videoExportPreset),
    availablePromoBeats: walletAvailability.promo,
    availableSubscriptionBeats: walletAvailability.subscription,
    availableTopupBeats: walletAvailability.topup,
    availableTotalBeats: walletAvailability.total,
  };
}

function buildFallbackFreeSnapshot(
  pricingMarketKey: PricingMarketKey,
  controls: PricingRuntimeControls,
  billingCountryCode: string | null
): EffectivePricingSnapshot {
  const currencyCode = pricingMarketKey === 'IN' ? 'INR' : 'USD';

  return {
    pricingMarketKey,
    routingProvider: getRoutingProviderForMarket(controls, pricingMarketKey),
    planKey: 'free',
    planTierRank: 1,
    planVersionId: null,
    monthlyIncludedBeats: 12,
    billingProvider: null,
    billingInterval: null,
    billingCountryCode,
    currencyCode,
    billingStatus: 'free',
    isInGracePeriod: false,
    currentPeriodEndsAt: null,
    gracePeriodEndsAt: null,
    nextResetAt: null,
    storyLengthCap: 4,
    canAccessDownloads: false,
    canAccessUnbrandedExports: false,
    creatorControls: false,
    videoExportPreset: normalizeVideoExportPreset(null),
    availablePromoBeats: 0,
    availableSubscriptionBeats: 0,
    availableTopupBeats: 0,
    availableTotalBeats: 0,
  };
}

function selectPlanVariant({
  resolvedMarket,
  activeSubscription,
  planById,
  versionById,
  plans,
  planVersions,
}: {
  resolvedMarket: PricingMarketKey;
  activeSubscription: DbBillingSubscription | null;
  planById: Map<string, DbPricingPlan>;
  versionById: Map<string, DbPricingPlanVersion>;
  plans: DbPricingPlan[];
  planVersions: DbPricingPlanVersion[];
}): SelectedPlanVariant | null {
  if (activeSubscription) {
    const activeVersion = versionById.get(activeSubscription.plan_version_id);
    const activePlan = activeVersion ? planById.get(activeVersion.plan_id) : null;
    if (activeVersion && activePlan) {
      return { plan: activePlan, version: activeVersion };
    }
  }

  return findPublishedPlanVariant(plans, planVersions, 'free', resolvedMarket, 'monthly');
}

function findPublishedPlanVariant(
  plans: DbPricingPlan[],
  planVersions: DbPricingPlanVersion[],
  planKey: PlanKey,
  pricingMarketKey: PricingMarketKey,
  billingInterval: BillingInterval
): SelectedPlanVariant | null {
  const plan = plans.find((candidate) => candidate.plan_key === planKey);
  if (!plan) {
    return null;
  }

  const version = planVersions.find((candidate) =>
    candidate.plan_id === plan.id &&
    candidate.status === 'published' &&
    candidate.pricing_market_key === pricingMarketKey &&
    candidate.billing_interval === billingInterval
  );

  if (!version) {
    return null;
  }

  return { plan, version };
}

function resolvePricingMarketKey({
  explicitPricingMarketKey,
  explicitCountryCode,
  activeSubscription,
  billingCustomers,
  planVersionsById,
}: {
  explicitPricingMarketKey?: PricingMarketKey | null;
  explicitCountryCode?: string | null;
  activeSubscription: DbBillingSubscription | null;
  billingCustomers: DbBillingCustomer[];
  planVersionsById: Map<string, DbPricingPlanVersion>;
}): PricingMarketKey {
  if (explicitPricingMarketKey) {
    return explicitPricingMarketKey;
  }

  if (normalizeCountryCode(explicitCountryCode) === 'IN') {
    return 'IN';
  }

  if (activeSubscription) {
    const planVersion = planVersionsById.get(activeSubscription.plan_version_id);
    if (planVersion) {
      return planVersion.pricing_market_key;
    }
  }

  const currentCustomer = selectCurrentBillingCustomer(billingCustomers);
  if (currentCustomer) {
    return currentCustomer.pricing_market_key;
  }

  return 'IN';
}

function selectCurrentBillingCustomer(
  billingCustomers: DbBillingCustomer[],
  pricingMarketKey?: PricingMarketKey
): DbBillingCustomer | null {
  const filtered = pricingMarketKey
    ? billingCustomers.filter((customer) => customer.pricing_market_key === pricingMarketKey)
    : billingCustomers;

  if (filtered.length === 0) {
    return null;
  }

  return [...filtered].sort((left, right) =>
    new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  )[0] ?? null;
}

function selectEntitledSubscription(
  billingSubscriptions: DbBillingSubscription[],
  now: Date
): DbBillingSubscription | null {
  if (billingSubscriptions.length === 0) {
    return null;
  }

  const sorted = [...billingSubscriptions].sort((left, right) => {
    const leftTime = left.current_period_end ? new Date(left.current_period_end).getTime() : 0;
    const rightTime = right.current_period_end ? new Date(right.current_period_end).getTime() : 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });

  return sorted.find((subscription) => isSubscriptionEntitled(subscription, now)) ?? null;
}

function isSubscriptionEntitled(
  subscription: DbBillingSubscription,
  now: Date
): boolean {
  if (isSubscriptionInGracePeriod(subscription, now)) {
    return true;
  }

  const normalizedStatus = subscription.status.trim().toLowerCase();
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
    return false;
  }

  if (!subscription.current_period_end) {
    return true;
  }

  return new Date(subscription.current_period_end).getTime() > now.getTime();
}

function isSubscriptionInGracePeriod(
  subscription: DbBillingSubscription,
  now: Date
): boolean {
  const normalizedStatus = subscription.status.trim().toLowerCase();
  if (!GRACE_PERIOD_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
    return false;
  }

  if (!subscription.grace_period_ends_at) {
    return false;
  }

  return new Date(subscription.grace_period_ends_at).getTime() > now.getTime();
}

function getRoutingProviderForMarket(
  controls: PricingRuntimeControls,
  pricingMarketKey: PricingMarketKey
): BillingProvider {
  return pricingMarketKey === 'IN'
    ? controls.routingProviderIn
    : controls.routingProviderRow;
}

function selectFreeAllowanceResetAt(
  beatGrants: DbBeatGrant[],
  now: Date
): string | null {
  const activeFreeGrants = beatGrants
    .filter((grant) =>
      grant.source_type === 'free_allowance' &&
      grant.expires_at &&
      new Date(grant.expires_at).getTime() > now.getTime()
    )
    .sort((left, right) =>
      new Date(left.expires_at!).getTime() - new Date(right.expires_at!).getTime()
    );

  return activeFreeGrants[0]?.expires_at ?? null;
}

function getBooleanControl(
  rows: Map<string, RuntimeFlagRow>,
  key: string
): boolean {
  const definition = PRICING_RUNTIME_SETTING_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`Missing pricing runtime definition for ${key}`);
  }

  return rows.get(key)?.enabled ?? definition.defaultEnabled;
}

function getIntegerControl(
  rows: Map<string, RuntimeFlagRow>,
  key: string
): number {
  const definition = PRICING_RUNTIME_SETTING_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`Missing pricing runtime definition for ${key}`);
  }

  const sourceValue = rows.get(key)?.enabled
    ? rows.get(key)?.value
    : definition.defaultValue;
  const parsed = Number(sourceValue);

  return Number.isInteger(parsed) ? parsed : Number(definition.defaultValue ?? '0');
}

function getProviderControl(
  rows: Map<string, RuntimeFlagRow>,
  key: string
): BillingProvider {
  const definition = PRICING_RUNTIME_SETTING_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`Missing pricing runtime definition for ${key}`);
  }

  const sourceValue = rows.get(key)?.enabled
    ? rows.get(key)?.value
    : definition.defaultValue;

  if (sourceValue && BILLING_PROVIDERS.includes(sourceValue as BillingProvider)) {
    return sourceValue as BillingProvider;
  }

  return (definition.defaultValue as BillingProvider | null) ?? 'stripe';
}

function normalizeCountryCode(countryCode?: string | null): string | null {
  const next = countryCode?.trim().toUpperCase();
  return next ? next : null;
}
