import 'server-only';

import { fetchRazorpaySubscription } from '@/lib/billing/razorpay';
import { grantTopupIfMissing, syncRazorpaySubscriptionState } from '@/lib/billing/razorpay-sync';
import { buildPricingRuntimeContextData } from '@/lib/pricing/snapshot';
import { normalizeEntitlementPlanKey } from '@/lib/pricing/entitlement-tier.shared';
import {
  invalidateAllPricingRuntimeCaches,
  invalidatePricingRuntimeCacheForUser,
} from '@/lib/pricing/runtime-context-cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  DbBeatGrant,
  DbBeatSpendReservation,
  DbBeatUsageEvent,
  DbBillingCustomer,
  DbBillingOrder,
  DbBillingSubscription,
  DbPricingActionCost,
  DbPricingPlan,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import {
  COINS_PER_BEAT,
  PRICING_RUNTIME_SETTING_DEFINITIONS,
  type AuthorizeBillableActionInput,
  type FinalizeBillableActionInput,
  type FinalizeBillableActionResult,
  type PlanKey,
  type PricingActionKey,
  type PricingBillableActionAuthorization,
  type PricingMarketKey,
  type PricingRuntimeControls,
  type ReleaseBillableActionInput,
  type ReleaseBillableActionResult,
} from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;

interface RuntimeFlagRow {
  flag_key: string;
  enabled: boolean;
  value: string | null;
}

interface LoadedPricingState {
  plans: DbPricingPlan[];
  planVersions: DbPricingPlanVersion[];
  featureFlags: RuntimeFlagRow[];
  billingCustomers: DbBillingCustomer[];
  billingSubscriptions: DbBillingSubscription[];
  beatGrants: DbBeatGrant[];
  beatReservations: DbBeatSpendReservation[];
  controls: PricingRuntimeControls;
  snapshot: ReturnType<typeof buildPricingRuntimeContextData>['snapshot'];
}

interface EnsureFreeWelcomeGrantResult {
  granted: boolean;
  grantId: string | null;
  beatsGranted: number;
  expiresAt: string | null;
}

interface ApplyFreeWelcomeGrantRpcRow {
  grant_id: string | null;
  granted: boolean;
  beats_granted: number | string | null;
  expires_at: string | null;
}

interface RpcAuthorizeSpendRow {
  reservation_id: string | null;
  reservation_status: string;
  available_beats: number;
}

interface RpcFinalizeReservationRow {
  usage_event_id: string;
  finalized_beat_cost: number;
}

interface RpcReleaseReservationRow {
  released: boolean;
  final_status: string;
}

interface ReconcileRazorpaySubscriptionInput {
  providerSubscriptionId?: string | null;
  billingOrderId?: string | null;
}

interface ReconcileRazorpaySubscriptionResult {
  billingSubscriptionId: string | null;
  providerSubscriptionId: string;
  subscriptionStatus: string;
  grantedCoins: number;
}

interface ReconcileRazorpayTopupInput {
  billingOrderId: string;
  razorpayPaymentId?: string | null;
}

interface ReconcileRazorpayTopupResult {
  billingOrderId: string;
  grantedCoins: number;
  paymentId: string;
}

export interface CachedPricingGlobals {
  loadedAtMs: number;
  plans: DbPricingPlan[];
  planVersions: DbPricingPlanVersion[];
  featureFlags: RuntimeFlagRow[];
  actionCosts: DbPricingActionCost[];
}

const PRICING_GLOBAL_CACHE_TTL_MS = 60_000;
let cachedPricingGlobals: CachedPricingGlobals | null = null;

export function invalidatePricingGlobalsCache(): void {
  cachedPricingGlobals = null;
  invalidateAllPricingRuntimeCaches();
}

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

function asBeatAmount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function enforcementNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function timeEnforcementStep<T>(
  scope: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = enforcementNowMs();
  try {
    const result = await fn();
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(enforcementNowMs() - startedAt),
      success: true,
      ...meta,
    });
    return result;
  } catch (error) {
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(enforcementNowMs() - startedAt),
      success: false,
      ...meta,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export async function ensureFreeWelcomeGrantForUser(
  userId: string,
  options: {
    pricingMarketKey?: PricingMarketKey | null;
    countryCode?: string | null;
    supabase?: AdminClient;
    preloadedState?: LoadedPricingState | null;
  } = {}
): Promise<EnsureFreeWelcomeGrantResult> {
  const supabase = options.supabase ?? createAdminClient();
  const state = options.preloadedState ?? await loadPricingState(supabase, userId, options);

  if (state.snapshot.planKey !== 'free') {
    return {
      granted: false,
      grantId: null,
      beatsGranted: 0,
      expiresAt: null,
    };
  }

  const result = await supabase.rpc('apply_free_welcome_grant', {
    p_user_id: userId,
  });

  throwIfQueryFailed(result.error, 'Failed to apply the free welcome grant policy');

  const row = ((result.data as ApplyFreeWelcomeGrantRpcRow[] | null)?.[0] ?? null);
  if (!row) {
    throw new Error('Free welcome grant policy did not return a result');
  }

  if (row.granted) {
    invalidatePricingRuntimeCacheForUser(userId);
  }

  return {
    granted: Boolean(row.granted),
    grantId: row.grant_id ?? null,
    beatsGranted: asBeatAmount(row.beats_granted),
    expiresAt: row.expires_at ?? null,
  };
}

export async function authorizeBillableAction(input: {
  userId: string | null;
  actionKey: PricingActionKey;
  idempotencyKey: string;
  relatedStoryId?: string | null;
  relatedNodeId?: string | null;
  relatedStorylineId?: string | null;
  metadata?: Record<string, unknown>;
  pricingMarketKey?: PricingMarketKey | null;
  countryCode?: string | null;
  requestedBeatCostOverride?: number | null;
}): Promise<PricingBillableActionAuthorization> {
  return timeEnforcementStep(
    'pricing.authorize_billable_action',
    {
      actionKey: input.actionKey,
      hasUser: Boolean(input.userId),
    },
    async () => {
      const actionCost = await loadActionCost(input.actionKey);
      const overrideBeatCost = Number(input.requestedBeatCostOverride ?? NaN);
      const beatCost = Number.isFinite(overrideBeatCost) && overrideBeatCost >= 0
        ? Number(overrideBeatCost.toFixed(2))
        : asBeatAmount(actionCost?.beat_cost);
      const coinCost = beatsToCoins(beatCost);

      if (!input.userId) {
        return {
          status: 'denied',
          reason: 'sign_in_required',
          beatCost,
          coinCost,
          availableBeats: 0,
          availableCoins: 0,
        };
      }

      const supabase = createAdminClient();
      let state = await loadPricingState(supabase, input.userId, {
        pricingMarketKey: input.pricingMarketKey,
        countryCode: input.countryCode,
      });

      const shouldEnsureFreeWelcomeGrant =
        state.snapshot.planKey === 'free' &&
        (
          state.controls.pricingSnapshotEnabled ||
          state.controls.pricingShadowMeteringEnabled ||
          state.controls.pricingHardEnforcementEnabled
        );

      if (shouldEnsureFreeWelcomeGrant) {
        const grantResult = await ensureFreeWelcomeGrantForUser(input.userId, {
          pricingMarketKey: input.pricingMarketKey,
          countryCode: input.countryCode,
          supabase,
          preloadedState: state,
        });

        if (grantResult.granted) {
          state = await loadPricingState(supabase, input.userId, {
            pricingMarketKey: input.pricingMarketKey,
            countryCode: input.countryCode,
          });
        }
      }

      if (isAdminBypassEnabledForUser(input.userId, state.controls)) {
        return {
          status: 'bypassed',
          reason: 'admin_bypass',
          beatCost,
          coinCost,
        };
      }

      if (beatCost <= 0) {
        return {
          status: 'allowed',
          mode: 'soft',
          reservationId: null,
          beatCost,
          coinCost,
          availableBeats: state.snapshot.availableTotalBeats,
          availableCoins: beatsToCoins(state.snapshot.availableTotalBeats),
          expiresAt: null,
        };
      }

      const availableBeats = state.snapshot.availableTotalBeats;
      const availableCoins = beatsToCoins(availableBeats);

      if (!state.controls.pricingHardEnforcementEnabled) {
        if (state.controls.pricingShadowMeteringEnabled) {
          await logShadowMeteringAttempt(supabase, input.userId, {
            actionKey: input.actionKey,
            beatCost,
            idempotencyKey: input.idempotencyKey,
            relatedStoryId: input.relatedStoryId ?? null,
            relatedNodeId: input.relatedNodeId ?? null,
            relatedStorylineId: input.relatedStorylineId ?? null,
            metadata: {
              ...(input.metadata ?? {}),
              shadowOutcome: availableBeats >= beatCost ? 'would_allow' : 'would_deny',
            },
            status: availableBeats >= beatCost ? 'released' : 'failed',
          });
        }

        return {
          status: 'allowed',
          mode: state.controls.pricingShadowMeteringEnabled ? 'shadow' : 'soft',
          reservationId: null,
          beatCost,
          coinCost,
          availableBeats,
          availableCoins,
          expiresAt: null,
        };
      }

      if (availableBeats < beatCost) {
        return {
          status: 'denied',
          reason: state.controls.pricingCheckoutEnabled ? 'insufficient_balance' : 'checkout_unavailable',
          beatCost,
          coinCost,
          availableBeats,
          availableCoins,
        };
      }

      const expiresAt = new Date(Date.now() + state.controls.reservationTimeoutSeconds * 1000).toISOString();
      const authorizeResult = await supabase.rpc('pricing_authorize_spend', {
        p_user_id: input.userId,
        p_action_key: input.actionKey,
        p_requested_beat_cost: beatCost,
        p_idempotency_key: input.idempotencyKey,
        p_related_story_id: input.relatedStoryId ?? null,
        p_related_node_id: input.relatedNodeId ?? null,
        p_related_storyline_id: input.relatedStorylineId ?? null,
        p_expires_at: expiresAt,
        p_metadata_json: {
          ...(input.metadata ?? {}),
          authorizationMode: 'hard',
        },
      });

      throwIfQueryFailed(authorizeResult.error, 'Failed to reserve coins for billable action');

      const row = (authorizeResult.data?.[0] ?? null) as RpcAuthorizeSpendRow | null;
      if (!row || row.reservation_status !== 'pending' || !row.reservation_id) {
        return {
          status: 'denied',
          reason: state.controls.pricingCheckoutEnabled ? 'insufficient_balance' : 'checkout_unavailable',
          beatCost,
          coinCost,
          availableBeats,
          availableCoins,
        };
      }

      invalidatePricingRuntimeCacheForUser(input.userId);

      return {
        status: 'allowed',
        mode: 'hard',
        reservationId: row.reservation_id,
        beatCost,
        coinCost,
        availableBeats: asBeatAmount(row.available_beats),
        availableCoins: beatsToCoins(asBeatAmount(row.available_beats)),
        expiresAt,
      };
    }
  );
}

export async function finalizeBillableAction(input: {
  userId: string;
} & FinalizeBillableActionInput): Promise<FinalizeBillableActionResult> {
  const supabase = createAdminClient();
  const result = await supabase.rpc('pricing_finalize_reservation', {
    p_reservation_id: input.reservationId,
    p_user_id: input.userId,
    p_story_id: input.storyId ?? null,
    p_storyline_id: input.storylineId ?? null,
    p_related_entity_id: input.relatedEntityId ?? null,
    p_metadata_json: input.metadata ?? {},
  });

  throwIfQueryFailed(result.error, 'Failed to finalize reservation');

  const row = (result.data?.[0] ?? null) as RpcFinalizeReservationRow | null;
  if (!row?.usage_event_id) {
    throw new Error('Reservation finalize did not return a usage event');
  }

  invalidatePricingRuntimeCacheForUser(input.userId);

  return {
    reservationId: input.reservationId,
    usageEventId: row.usage_event_id,
    beatCost: asBeatAmount(row.finalized_beat_cost),
    coinCost: beatsToCoins(asBeatAmount(row.finalized_beat_cost)),
  };
}

export async function releaseBillableAction(input: {
  userId: string;
} & ReleaseBillableActionInput): Promise<ReleaseBillableActionResult> {
  const supabase = createAdminClient();
  const result = await supabase.rpc('pricing_release_reservation', {
    p_reservation_id: input.reservationId,
    p_user_id: input.userId,
    p_release_status: input.releaseStatus ?? 'released',
    p_reason: input.reason,
    p_metadata_json: input.metadata ?? {},
  });

  throwIfQueryFailed(result.error, 'Failed to release reservation');

  invalidatePricingRuntimeCacheForUser(input.userId);

  const row = (result.data?.[0] ?? null) as RpcReleaseReservationRow | null;
  return {
    reservationId: input.reservationId,
    released: Boolean(row?.released),
    finalStatus: row?.final_status ?? 'unknown',
  };
}

export async function expireStaleReservations(options: { supabase?: AdminClient } = {}): Promise<number> {
  const supabase = options.supabase ?? createAdminClient();
  const result = await supabase.rpc('pricing_expire_stale_reservations');
  throwIfQueryFailed(result.error, 'Failed to expire stale reservations');
  return Number(result.data ?? 0);
}

export async function reconcileRazorpaySubscription(
  input: ReconcileRazorpaySubscriptionInput
): Promise<ReconcileRazorpaySubscriptionResult> {
  const supabase = createAdminClient();
  const subscriptionId = input.providerSubscriptionId ?? await getProviderSubscriptionIdFromBillingOrder(supabase, input.billingOrderId ?? null);

  if (!subscriptionId) {
    throw new Error('Provide a Razorpay subscription id or a billing order id.');
  }

  const [existingSubscription, billingOrder] = await Promise.all([
    loadBillingSubscriptionByProviderId(supabase, subscriptionId),
    loadBillingOrderByProviderSubscriptionId(supabase, subscriptionId),
  ]);

  const userId = existingSubscription?.user_id ?? billingOrder?.user_id ?? null;
  const planVersionId = existingSubscription?.plan_version_id ?? billingOrder?.plan_version_id ?? null;
  if (!userId || !planVersionId) {
    throw new Error('Unable to determine the user and plan version for this subscription.');
  }

  const planVersion = await loadPlanVersion(supabase, planVersionId);
  const subscription = await fetchRazorpaySubscription(subscriptionId);
  const syncResult = await syncRazorpaySubscriptionState({
    supabase,
    userId,
    pricingMarketKey: planVersion.pricing_market_key,
    countryCode: planVersion.pricing_market_key === 'IN' ? 'IN' : null,
    planVersion,
    subscription,
    rawPayload: {
      kind: 'admin_manual_reconcile',
      billingOrderId: billingOrder?.id ?? input.billingOrderId ?? null,
      providerSubscriptionId: subscriptionId,
      subscription,
    },
  });

  if (billingOrder) {
    const { error } = await supabase
      .from('billing_orders')
      .update({
        status: subscription.status,
        raw_provider_payload_json: {
          ...(billingOrder.raw_provider_payload_json ?? {}),
          manualReconcileAt: new Date().toISOString(),
          latestSubscription: subscription,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', billingOrder.id);

    throwIfQueryFailed(error, 'Failed to update billing order during subscription reconcile');
  }

  return {
    billingSubscriptionId: syncResult.billingSubscriptionId,
    providerSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    grantedCoins: syncResult.grantedCoins,
  };
}

export async function reconcileRazorpayTopup(
  input: ReconcileRazorpayTopupInput
): Promise<ReconcileRazorpayTopupResult> {
  const supabase = createAdminClient();
  const billingOrder = await loadBillingOrderById(supabase, input.billingOrderId);

  if (billingOrder.order_type !== 'topup_checkout' || !billingOrder.topup_pack_id) {
    throw new Error('This billing order is not a top-up checkout.');
  }

  const paymentId =
    normalizeText(input.razorpayPaymentId) ??
    normalizeText(billingOrder.provider_payment_id) ??
    extractPaymentIdFromBillingOrder(billingOrder);

  if (!paymentId) {
    throw new Error('Provide the Razorpay payment id to reconcile this top-up.');
  }

  const topupPack = await loadTopupPack(supabase, billingOrder.topup_pack_id);
  const grantedCoins = await grantTopupIfMissing({
    supabase,
    billingOrder,
    topupPack,
    paymentId,
    rawPayload: {
      kind: 'admin_manual_reconcile',
      billingOrderId: billingOrder.id,
      providerPaymentId: paymentId,
    },
  });

  const { error } = await supabase
    .from('billing_orders')
    .update({
      provider_payment_id: paymentId,
      status: 'paid',
      raw_provider_payload_json: {
        ...(billingOrder.raw_provider_payload_json ?? {}),
        manualReconcileAt: new Date().toISOString(),
        manualPaymentId: paymentId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', billingOrder.id);

  throwIfQueryFailed(error, 'Failed to update billing order during top-up reconcile');

  return {
    billingOrderId: billingOrder.id,
    grantedCoins,
    paymentId,
  };
}

/**
 * Cookieless plan lookup for background workers: resolves the user's
 * effective plan key from the same pricing state the enforcement paths use.
 * Falls back to 'free' on any failure.
 *
 * This is billing truth. Anything gating a *feature* wants
 * `resolveEntitlementPlanKeyForUser` instead, so admin promotions are honoured.
 */
export async function resolvePlanKeyForUser(userId: string): Promise<PlanKey> {
  try {
    const supabase = createAdminClient();
    const state = await loadPricingState(supabase, userId);
    return state.snapshot.planKey;
  } catch (error) {
    console.error('resolvePlanKeyForUser failed, defaulting to free:', error instanceof Error ? error.message : error);
    return 'free';
  }
}

/**
 * The tier every free/plus/studio feature gate should read: the billing plan
 * lifted by any admin promotion. Never affects coin cost or wallet balance.
 */
export async function resolveEntitlementPlanKeyForUser(userId: string): Promise<PlanKey> {
  try {
    const supabase = createAdminClient();
    const state = await loadPricingState(supabase, userId);
    return state.snapshot.entitlementPlanKey;
  } catch (error) {
    console.error(
      'resolveEntitlementPlanKeyForUser failed, defaulting to free:',
      error instanceof Error ? error.message : error
    );
    return 'free';
  }
}

export async function getPricingPolicyContextForUser(userId: string | null): Promise<{
  planKey: PlanKey;
  entitlementPlanKey: PlanKey;
  availableBeats: number;
  actionCosts: DbPricingActionCost[];
}> {
  const supabase = createAdminClient();
  const globals = await loadCachedPricingGlobals(supabase);
  if (!userId) {
    return {
      planKey: 'free',
      entitlementPlanKey: 'free',
      availableBeats: 0,
      actionCosts: globals.actionCosts,
    };
  }

  const state = await loadPricingState(supabase, userId);
  return {
    planKey: state.snapshot.planKey,
    entitlementPlanKey: state.snapshot.entitlementPlanKey,
    availableBeats: state.snapshot.availableTotalBeats,
    actionCosts: globals.actionCosts,
  };
}

export function isAdminUserId(userId: string | null): boolean {
  const adminUserId = process.env.ADMIN_USER_ID;
  return Boolean(adminUserId && userId && adminUserId === userId);
}

/**
 * Reads the admin-granted entitlement tier. A missing row (the common case) and
 * a read failure both mean "no promotion" — this must never widen access by
 * accident, and must never block generation when the table is unreachable.
 */
export async function loadEntitlementOverridePlanKey(
  supabase: AdminClient,
  userId: string
): Promise<PlanKey | null> {
  const { data, error } = await supabase
    .from('user_entitlement_overrides')
    .select('entitlement_plan_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load entitlement override, treating as none:', error.message);
    return null;
  }

  return normalizeEntitlementPlanKey(data?.entitlement_plan_key);
}

async function loadPricingState(
  supabase: AdminClient,
  userId: string,
  options: {
    pricingMarketKey?: PricingMarketKey | null;
    countryCode?: string | null;
  } = {}
): Promise<LoadedPricingState> {
  return timeEnforcementStep(
    'pricing.load_state',
    { userId, pricingMarketKey: options.pricingMarketKey ?? null },
    async () => {
      const [
        globalConfig,
        customersResult,
        subscriptionsResult,
        grantsResult,
        reservationsResult,
        entitlementOverridePlanKey,
      ] = await Promise.all([
        loadCachedPricingGlobals(supabase),
        supabase
          .from('billing_customers')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false }),
        // A handful of latest subscriptions is enough to resolve the entitled one.
        supabase
          .from('billing_subscriptions')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(8),
        supabase
          .from('beat_grants')
          .select('*')
          .eq('user_id', userId)
          .order('granted_at', { ascending: false }),
        supabase
          .from('beat_spend_reservations')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
        loadEntitlementOverridePlanKey(supabase, userId),
      ]);
      throwIfQueryFailed(customersResult.error, 'Failed to load billing customers');
      throwIfQueryFailed(subscriptionsResult.error, 'Failed to load billing subscriptions');
      throwIfQueryFailed(grantsResult.error, 'Failed to load beat grants');
      throwIfQueryFailed(reservationsResult.error, 'Failed to load beat reservations');

      const plans = globalConfig.plans;
      const planVersions = globalConfig.planVersions;
      const featureFlags = globalConfig.featureFlags;
      const billingCustomers = (customersResult.data ?? []) as DbBillingCustomer[];
      const billingSubscriptions = (subscriptionsResult.data ?? []) as DbBillingSubscription[];
      const beatGrants = (grantsResult.data ?? []) as DbBeatGrant[];
      const beatReservations = (reservationsResult.data ?? []) as DbBeatSpendReservation[];

      const { controls, snapshot } = buildPricingRuntimeContextData({
        pricingMarketKey: options.pricingMarketKey ?? null,
        countryCode: options.countryCode ?? null,
        plans,
        planVersions,
        featureFlags,
        billingCustomers,
        billingSubscriptions,
        beatGrants,
        beatReservations,
        entitlementOverridePlanKey,
        isAdmin: isAdminUserId(userId),
      });

      return {
        plans,
        planVersions,
        featureFlags,
        billingCustomers,
        billingSubscriptions,
        beatGrants,
        beatReservations,
        controls,
        snapshot,
      };
    }
  );
}

async function loadActionCost(actionKey: PricingActionKey): Promise<DbPricingActionCost | null> {
  const supabase = createAdminClient();
  const now = Date.now();
  const rows = (await loadCachedPricingGlobals(supabase)).actionCosts
    .filter((row) => row.action_key === actionKey && row.is_active);
  return rows.find((row) => {
    const startsAt = new Date(row.effective_from).getTime();
    const endsAt = row.effective_to ? new Date(row.effective_to).getTime() : Number.POSITIVE_INFINITY;
    return startsAt <= now && now < endsAt;
  }) ?? null;
}

export async function loadCachedPricingGlobals(supabase: AdminClient): Promise<CachedPricingGlobals> {
  const now = Date.now();
  if (cachedPricingGlobals && (now - cachedPricingGlobals.loadedAtMs) < PRICING_GLOBAL_CACHE_TTL_MS) {
    return cachedPricingGlobals;
  }

  const [plansResult, planVersionsResult, featureFlagsResult, actionCostsResult] = await Promise.all([
    supabase.from('pricing_plans').select('*').order('tier_rank', { ascending: true }),
    supabase.from('pricing_plan_versions').select('*').order('created_at', { ascending: false }),
    supabase
      .from('feature_flags')
      .select('flag_key, enabled, value')
      .in('flag_key', PRICING_RUNTIME_SETTING_DEFINITIONS.map((definition) => definition.key)),
    supabase
      .from('pricing_action_costs')
      .select('*')
      .order('effective_from', { ascending: false }),
  ]);

  throwIfQueryFailed(plansResult.error, 'Failed to load pricing plans');
  throwIfQueryFailed(planVersionsResult.error, 'Failed to load pricing plan versions');
  throwIfQueryFailed(featureFlagsResult.error, 'Failed to load pricing runtime flags');
  throwIfQueryFailed(actionCostsResult.error, 'Failed to load pricing action costs');

  cachedPricingGlobals = {
    loadedAtMs: now,
    plans: (plansResult.data ?? []) as DbPricingPlan[],
    planVersions: (planVersionsResult.data ?? []) as DbPricingPlanVersion[],
    featureFlags: (featureFlagsResult.data ?? []) as RuntimeFlagRow[],
    actionCosts: (actionCostsResult.data ?? []) as DbPricingActionCost[],
  };

  return cachedPricingGlobals;
}

async function logShadowMeteringAttempt(
  supabase: AdminClient,
  userId: string,
  input: {
    actionKey: PricingActionKey;
    beatCost: number;
    idempotencyKey: string;
    relatedStoryId: string | null;
    relatedNodeId: string | null;
    relatedStorylineId: string | null;
    metadata: Record<string, unknown>;
    status: 'released' | 'failed';
  }
): Promise<void> {
  const { error } = await supabase
    .from('beat_spend_reservations')
    .upsert({
      user_id: userId,
      action_key: input.actionKey,
      requested_beat_cost: input.beatCost,
      status: input.status,
      idempotency_key: input.idempotencyKey,
      related_story_id: input.relatedStoryId,
      related_node_id: input.relatedNodeId,
      related_storyline_id: input.relatedStorylineId,
      expires_at: new Date().toISOString(),
      metadata_json: {
        ...input.metadata,
        shadowOnly: true,
      },
    }, {
      onConflict: 'idempotency_key',
    });

  throwIfQueryFailed(error, 'Failed to log shadow metering attempt');
}

function isAdminBypassEnabledForUser(userId: string, controls: PricingRuntimeControls): boolean {
  const adminUserId = process.env.ADMIN_USER_ID;
  return Boolean(controls.pricingAdminBypassEnabled && adminUserId && adminUserId === userId);
}

async function getProviderSubscriptionIdFromBillingOrder(
  supabase: AdminClient,
  billingOrderId: string | null
): Promise<string | null> {
  if (!billingOrderId) {
    return null;
  }

  const order = await loadBillingOrderById(supabase, billingOrderId);
  return order.provider_checkout_session_id;
}

async function loadBillingOrderById(supabase: AdminClient, billingOrderId: string): Promise<DbBillingOrder> {
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('id', billingOrderId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load billing order');

  const order = (result.data ?? null) as DbBillingOrder | null;
  if (!order) {
    throw new Error('Billing order not found');
  }

  return order;
}

async function loadBillingOrderByProviderSubscriptionId(
  supabase: AdminClient,
  providerSubscriptionId: string
): Promise<DbBillingOrder | null> {
  const result = await supabase
    .from('billing_orders')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_checkout_session_id', providerSubscriptionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load billing order for subscription');
  return (result.data ?? null) as DbBillingOrder | null;
}

async function loadBillingSubscriptionByProviderId(
  supabase: AdminClient,
  providerSubscriptionId: string
): Promise<DbBillingSubscription | null> {
  const result = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('provider', 'razorpay')
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load billing subscription');
  return (result.data ?? null) as DbBillingSubscription | null;
}

async function loadPlanVersion(supabase: AdminClient, planVersionId: string): Promise<DbPricingPlanVersion> {
  const result = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', planVersionId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan version');

  const version = (result.data ?? null) as DbPricingPlanVersion | null;
  if (!version) {
    throw new Error('Plan version not found');
  }

  return version;
}

async function loadTopupPack(supabase: AdminClient, topupPackId: string): Promise<DbPricingTopupPack> {
  const result = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('id', topupPackId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load top-up pack');

  const pack = (result.data ?? null) as DbPricingTopupPack | null;
  if (!pack) {
    throw new Error('Top-up pack not found');
  }

  return pack;
}

function extractPaymentIdFromBillingOrder(order: DbBillingOrder): string | null {
  const raw = order.raw_provider_payload_json ?? {};
  const verification = asRecord(raw.verification);
  const manual = asRecord(raw.manualPaymentId);

  return (
    normalizeText(order.provider_payment_id) ??
    normalizeText(verification?.razorpayPaymentId) ??
    normalizeText(verification?.razorpay_payment_id) ??
    normalizeText(raw.manualPaymentId) ??
    normalizeText(manual?.id)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
