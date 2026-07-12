import 'server-only';

import { fetchRazorpaySubscription } from '@/lib/billing/razorpay';
import { grantTopupIfMissing, syncRazorpaySubscriptionState } from '@/lib/billing/razorpay-sync';
import { buildPricingRuntimeContextData } from '@/lib/pricing/snapshot';
import { invalidatePricingRuntimeCacheForUser } from '@/lib/pricing/runtime-context-cache';
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
  type BillingInterval,
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

interface EnsureFreeAllowanceResult {
  granted: boolean;
  grantId: string | null;
  beatsGranted: number;
  expiresAt: string | null;
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

export async function ensureFreeAllowanceForUser(
  userId: string,
  options: {
    pricingMarketKey?: PricingMarketKey | null;
    countryCode?: string | null;
    supabase?: AdminClient;
    preloadedState?: LoadedPricingState | null;
  } = {}
): Promise<EnsureFreeAllowanceResult> {
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

  const freeVersion = findPublishedPlanVersion(
    state.plans,
    state.planVersions,
    'free',
    state.snapshot.pricingMarketKey,
    'monthly'
  );

  if (!freeVersion) {
    return {
      granted: false,
      grantId: null,
      beatsGranted: 0,
      expiresAt: null,
    };
  }

  const authUserResult = await supabase.auth.admin.getUserById(userId);
  if (authUserResult.error || !authUserResult.data.user) {
    throw new Error(`Failed to load auth user for free allowance: ${authUserResult.error?.message || 'missing user'}`);
  }

  const cycle = computeCurrentMonthlyCycle(authUserResult.data.user.created_at, new Date());
  const sourceRefId = `free_allowance:${cycle.start.toISOString()}`;

  const existingResult = await supabase
    .from('beat_grants')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('source_type', 'free_allowance')
    .eq('source_ref_id', sourceRefId)
    .maybeSingle();

  throwIfQueryFailed(existingResult.error, 'Failed to check current free allowance grant');

  if (existingResult.data) {
    return {
      granted: false,
      grantId: existingResult.data.id,
      beatsGranted: 0,
      expiresAt: existingResult.data.expires_at,
    };
  }

  const insertResult = await supabase
    .from('beat_grants')
    .insert({
      user_id: userId,
      source_type: 'free_allowance',
      source_ref_id: sourceRefId,
      currency_code: freeVersion.currency_code,
      beats_total: freeVersion.monthly_included_beats,
      beats_remaining: freeVersion.monthly_included_beats,
      expires_at: cycle.end.toISOString(),
      metadata_json: {
        planVersionId: freeVersion.id,
        pricingMarketKey: state.snapshot.pricingMarketKey,
        cycleStart: cycle.start.toISOString(),
        cycleEnd: cycle.end.toISOString(),
      },
    })
    .select('id')
    .single();

  throwIfQueryFailed(insertResult.error, 'Failed to create free allowance grant');

  invalidatePricingRuntimeCacheForUser(userId);

  return {
    granted: true,
    grantId: insertResult.data?.id ?? null,
    beatsGranted: freeVersion.monthly_included_beats,
    expiresAt: cycle.end.toISOString(),
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

      const shouldEnsureFreeAllowance =
        state.snapshot.planKey === 'free' &&
        (
          state.controls.pricingSnapshotEnabled ||
          state.controls.pricingShadowMeteringEnabled ||
          state.controls.pricingHardEnforcementEnabled
        );

      if (shouldEnsureFreeAllowance) {
        const grantResult = await ensureFreeAllowanceForUser(input.userId, {
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
      const [globalConfig, customersResult, subscriptionsResult, grantsResult, reservationsResult] = await Promise.all([
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
      .eq('is_active', true)
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

function findPublishedPlanVersion(
  plans: DbPricingPlan[],
  versions: DbPricingPlanVersion[],
  planKey: PlanKey,
  pricingMarketKey: PricingMarketKey,
  billingInterval: BillingInterval
): DbPricingPlanVersion | null {
  const plan = plans.find((candidate) => candidate.plan_key === planKey);
  if (!plan) {
    return null;
  }

  return versions.find((candidate) =>
    candidate.plan_id === plan.id &&
    candidate.status === 'published' &&
    candidate.pricing_market_key === pricingMarketKey &&
    candidate.billing_interval === billingInterval
  ) ?? null;
}

function computeCurrentMonthlyCycle(anchorIso: string, now: Date): { start: Date; end: Date } {
  const anchor = new Date(anchorIso);
  const monthOffset = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());

  let cycleStart = addUtcMonths(anchor, monthOffset);
  if (cycleStart.getTime() > now.getTime()) {
    cycleStart = addUtcMonths(anchor, monthOffset - 1);
  }

  const cycleEnd = addUtcMonths(cycleStart, 1);
  return { start: cycleStart, end: cycleEnd };
}

function addUtcMonths(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const day = anchor.getUTCDate();
  const hours = anchor.getUTCHours();
  const minutes = anchor.getUTCMinutes();
  const seconds = anchor.getUTCSeconds();
  const milliseconds = anchor.getUTCMilliseconds();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(year, month, safeDay, hours, minutes, seconds, milliseconds));
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
