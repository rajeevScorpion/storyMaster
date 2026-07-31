'use server';

import {
  ensureFreeWelcomeGrantForUser,
  expireStaleReservations,
  invalidatePricingGlobalsCache,
  reconcileRazorpaySubscription,
  reconcileRazorpayTopup,
} from '@/lib/pricing/enforcement';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import type {
  DbPricingActionCost,
  DbPricingPlan,
  DbPricingPlanVersion,
  DbPricingPromotion,
  DbPricingPublishAudit,
  DbPricingTopupPack,
} from '@/lib/types/database';
import {
  BILLING_INTERVALS,
  BILLING_PROVIDERS,
  PLAN_KEYS,
  PRICING_CATALOG_STATUSES,
  PRICING_MARKET_KEYS,
  PRICING_RUNTIME_SETTING_DEFINITIONS,
  PROMOTION_MARKET_SCOPES,
  COINS_PER_BEAT,
  type BillingInterval,
  type BillingProvider,
  type PlanKey,
  type PricingActionKey,
  type PricingCatalogStatus,
  type PricingMarketKey,
  type PricingPlanFeatureFlags,
  type PricingRuntimeFlagKey,
  type PricingRuntimeSettingDefinition,
  type PricingRuntimeSettingKind,
  type PromotionMarketScope,
  normalizeVideoExportPreset,
} from '@/lib/types/pricing';
import { listImageModelRegistry } from '@/lib/ai/image-models';
import type { ImageModelRegistryRecord } from '@/lib/ai/image-models.shared';

type JsonRecord = Record<string, unknown>;

type AdminClient = ReturnType<typeof createAdminClient>;

const LEGACY_TOPUP_PACK_KEYS = ['beats_25', 'beats_80', 'beats_200'] as const;

export interface PricingAdminRuntimeSetting {
  key: PricingRuntimeFlagKey;
  kind: PricingRuntimeSettingKind;
  label: string;
  description: string;
  enabledHelp: string;
  disabledHelp: string;
  enabled: boolean;
  value: string | null;
  defaultEnabled: boolean;
  defaultValue: string | null;
}

export interface PricingAdminPlanRecord {
  plan: DbPricingPlan;
  versions: DbPricingPlanVersion[];
}

export interface PricingAdminState {
  plans: PricingAdminPlanRecord[];
  topupPacks: DbPricingTopupPack[];
  actionCosts: DbPricingActionCost[];
  promotions: DbPricingPromotion[];
  runtimeSettings: PricingAdminRuntimeSetting[];
  imageModelRates: ImageModelRegistryRecord[];
}

export interface PricingAuditPageInput {
  page?: number;
  pageSize?: number;
}

export interface PricingAuditPageResult {
  entries: DbPricingPublishAudit[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface SavePricingPlanDraftInput {
  planKey: PlanKey | string;
  name: string;
  tierRank: number;
  isActive: boolean;
  isPublic: boolean;
  description?: string | null;
  featureFlags?: PricingPlanFeatureFlags;
  provider?: BillingProvider | null;
  billingInterval: BillingInterval;
  currencyCode: string;
  pricingMarketKey: PricingMarketKey;
  priceMinor: number;
  monthlyIncludedBeats: number;
  carryForwardCapMultiplier: number;
  storyLengthCap: number;
  gracePeriodDays: number;
  providerProductRef?: string | null;
  providerPriceRef?: string | null;
  extensions?: JsonRecord;
}

export interface SavePricingTopupDraftInput {
  topupId?: string | null;
  packKey?: string | null;
  name: string;
  provider: BillingProvider;
  currencyCode: string;
  pricingMarketKey: PricingMarketKey;
  priceMinor: number;
  beatAmount: number;
  providerProductRef?: string | null;
  providerPriceRef?: string | null;
  extensions?: JsonRecord;
}

export interface SavePricingTopupDraftResult {
  state: PricingAdminState;
  topupId: string;
  packKey: string;
}

export interface ArchiveLegacyTopupPacksResult {
  state: PricingAdminState;
  archivedCount: number;
}

export interface SavePricingActionCostInput {
  actionKey: PricingActionKey | string;
  beatCost: number;
  isActive: boolean;
  displayName?: string | null;
  costFamily?: DbPricingActionCost['cost_family'];
  billingUnit?: string;
  freeEnabled?: boolean;
  plusEnabled?: boolean;
  studioEnabled?: boolean;
  metadata?: JsonRecord;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export interface SavePricingPromotionInput {
  promoKey: string;
  name: string;
  status: PricingCatalogStatus;
  pricingMarketScope: PromotionMarketScope;
  targetPlanKey?: PlanKey | null;
  targetUserSegment?: string | null;
  bonusBeats: number;
  startsAt?: string | null;
  endsAt?: string | null;
  promoConfig?: JsonRecord;
}

export interface UpdatePricingRuntimeSettingInput {
  key: PricingRuntimeFlagKey;
  enabled?: boolean;
  value?: string | null;
}

export interface ReconcilePricingSubscriptionInput {
  providerSubscriptionId?: string | null;
  billingOrderId?: string | null;
}

export interface ReconcilePricingSubscriptionResult {
  billingSubscriptionId: string | null;
  providerSubscriptionId: string;
  subscriptionStatus: string;
  grantedCoins: number;
}

export interface ReconcilePricingTopupInput {
  billingOrderId: string;
  razorpayPaymentId?: string | null;
}

export interface ReconcilePricingTopupResult {
  billingOrderId: string;
  paymentId: string;
  grantedCoins: number;
}

export interface EnsureFreeWelcomeGrantInput {
  userId: string;
  pricingMarketKey?: PricingMarketKey | null;
  countryCode?: string | null;
}

export interface EnsureFreeWelcomeGrantResult {
  granted: boolean;
  grantId: string | null;
  grantedCoins: number;
  expiresAt: string | null;
}

export interface ExpirePricingReservationsResult {
  expiredCount: number;
}

export async function getPricingAdminState(): Promise<PricingAdminState> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return getPricingAdminStateInternal(supabase);
}

export async function getPricingAuditPage(input: PricingAuditPageInput = {}): Promise<PricingAuditPageResult> {
  await verifyAdmin();
  const supabase = createAdminClient();
  const pageSize = normalizeAuditPageSize(input.pageSize);
  let page = normalizeAuditPage(input.page);
  let from = (page - 1) * pageSize;
  let to = from + pageSize - 1;

  let { data, error, count } = await supabase
    .from('pricing_publish_audit')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  throwIfQueryFailed(error, 'Failed to load pricing audit log');

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (totalCount > 0 && page > totalPages) {
    page = totalPages;
    from = (page - 1) * pageSize;
    to = from + pageSize - 1;

    const retry = await supabase
      .from('pricing_publish_audit')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    throwIfQueryFailed(retry.error, 'Failed to load pricing audit log');
    data = retry.data;
  }

  return {
    entries: (data ?? []) as DbPricingPublishAudit[],
    page,
    pageSize,
    totalCount,
    totalPages,
  };
}

export async function savePricingPlanDraft(input: SavePricingPlanDraftInput): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  validatePlanDraftInput(input);

  const supabase = createAdminClient();
  const plan = await upsertPricingPlanBase(supabase, input);
  const existingDraft = await getPlanVersionByStatus(
    supabase,
    plan.id,
    input.billingInterval,
    input.pricingMarketKey,
    input.currencyCode,
    'draft'
  );

  const timestamp = new Date().toISOString();
  const versionPayload = {
    plan_id: plan.id,
    status: 'draft',
    provider: input.provider ?? null,
    billing_interval: input.billingInterval,
    currency_code: input.currencyCode.trim().toUpperCase(),
    pricing_market_key: input.pricingMarketKey,
    price_minor: input.priceMinor,
    monthly_included_beats: input.monthlyIncludedBeats,
    carry_forward_cap_multiplier: input.carryForwardCapMultiplier,
    story_length_cap: input.storyLengthCap,
    grace_period_days: input.gracePeriodDays,
    provider_product_ref: normalizeText(input.providerProductRef),
    provider_price_ref: normalizeText(input.providerPriceRef),
    extensions_json: input.extensions ?? {},
    updated_at: timestamp,
    published_at: null,
    published_by: null,
  };

  let version: DbPricingPlanVersion;
  if (existingDraft) {
    const { data, error } = await supabase
      .from('pricing_plan_versions')
      .update(versionPayload)
      .eq('id', existingDraft.id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update pricing plan draft: ${error?.message || 'unknown error'}`);
    }
    version = data as DbPricingPlanVersion;
  } else {
    const { data, error } = await supabase
      .from('pricing_plan_versions')
      .insert(versionPayload)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create pricing plan draft: ${error?.message || 'unknown error'}`);
    }
    version = data as DbPricingPlanVersion;
  }

  await insertPricingAudit(supabase, {
    entityType: 'plan_version',
    entityId: version.id,
    actionType: existingDraft ? 'update_draft' : 'create_draft',
    performedBy: user.id,
    beforeJson: existingDraft,
    afterJson: version,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function publishPricingPlanVersion(versionId: string, reason?: string): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  const draftVersion = await getPlanVersionById(supabase, versionId);
  if (!draftVersion) {
    throw new Error('Pricing plan version not found');
  }
  if (draftVersion.status !== 'draft') {
    throw new Error('Only draft plan versions can be published');
  }

  const currentPublished = await getPlanVersionByStatus(
    supabase,
    draftVersion.plan_id,
    draftVersion.billing_interval,
    draftVersion.pricing_market_key,
    draftVersion.currency_code,
    'published'
  );

  const timestamp = new Date().toISOString();

  if (currentPublished) {
    const archivedPayload = {
      status: 'archived',
      updated_at: timestamp,
    };

    const { data: archivedData, error: archiveError } = await supabase
      .from('pricing_plan_versions')
      .update(archivedPayload)
      .eq('id', currentPublished.id)
      .select('*')
      .single();

    if (archiveError || !archivedData) {
      throw new Error(`Failed to archive current published plan version: ${archiveError?.message || 'unknown error'}`);
    }

    await insertPricingAudit(supabase, {
      entityType: 'plan_version',
      entityId: currentPublished.id,
      actionType: 'archive',
      performedBy: user.id,
      beforeJson: currentPublished,
      afterJson: archivedData as DbPricingPlanVersion,
      reason,
    });
  }

  const publishPayload = {
    status: 'published',
    published_at: timestamp,
    published_by: user.id,
    updated_at: timestamp,
  };

  const { data: publishedData, error: publishError } = await supabase
    .from('pricing_plan_versions')
    .update(publishPayload)
    .eq('id', draftVersion.id)
    .select('*')
    .single();

  if (publishError || !publishedData) {
    throw new Error(`Failed to publish pricing plan version: ${publishError?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'plan_version',
    entityId: draftVersion.id,
    actionType: 'publish',
    performedBy: user.id,
    beforeJson: draftVersion,
    afterJson: publishedData as DbPricingPlanVersion,
    reason,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function archivePricingPlanVersion(versionId: string, reason?: string): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  const version = await getPlanVersionById(supabase, versionId);
  if (!version) {
    throw new Error('Pricing plan version not found');
  }
  if (version.status === 'archived') {
    return getPricingAdminStateInternal(supabase);
  }

  const { data, error } = await supabase
    .from('pricing_plan_versions')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('id', version.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to archive pricing plan version: ${error?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'plan_version',
    entityId: version.id,
    actionType: 'archive',
    performedBy: user.id,
    beforeJson: version,
    afterJson: data as DbPricingPlanVersion,
    reason,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function savePricingTopupDraft(input: SavePricingTopupDraftInput): Promise<SavePricingTopupDraftResult> {
  const { user } = await verifyAdmin();
  const normalizedInput = validateTopupDraftInput(input);

  const supabase = createAdminClient();
  const timestamp = new Date().toISOString();

  let existingDraft: DbPricingTopupPack | null = null;
  let packKey = normalizedInput.packKey;

  if (normalizedInput.topupId) {
    existingDraft = await getTopupById(supabase, normalizedInput.topupId);
    if (!existingDraft) {
      throw new Error('Pricing top-up draft not found');
    }
    if (existingDraft.status !== 'draft') {
      throw new Error('Only draft top-up packs can be updated');
    }
    packKey = existingDraft.pack_key;
  } else if (packKey) {
    existingDraft = await getTopupByStatus(
      supabase,
      packKey,
      normalizedInput.pricingMarketKey,
      normalizedInput.currencyCode,
      'draft'
    );
  } else {
    packKey = buildGeneratedTopupPackKey(normalizedInput.beatAmount);
    const [matchingDraft, matchingPublished] = await Promise.all([
      getTopupByStatus(
        supabase,
        packKey,
        normalizedInput.pricingMarketKey,
        normalizedInput.currencyCode,
        'draft'
      ),
      getTopupByStatus(
        supabase,
        packKey,
        normalizedInput.pricingMarketKey,
        normalizedInput.currencyCode,
        'published'
      ),
    ]);

    if (matchingDraft || matchingPublished) {
      throw new Error(
        `A coin pack for ${buildTopupPackDisplayName(normalizedInput.beatAmount)} already exists in this market and currency`
      );
    }
  }

  if (!packKey) {
    throw new Error('Pack key is required');
  }

  const payload = {
    pack_key: packKey,
    status: 'draft',
    provider: normalizedInput.provider,
    name: normalizeTopupPackName(normalizedInput.name, normalizedInput.beatAmount),
    currency_code: normalizedInput.currencyCode,
    pricing_market_key: normalizedInput.pricingMarketKey,
    price_minor: normalizedInput.priceMinor,
    beat_amount: normalizedInput.beatAmount,
    provider_product_ref: normalizeText(normalizedInput.providerProductRef),
    provider_price_ref: normalizeText(normalizedInput.providerPriceRef),
    extensions_json: normalizedInput.extensions ?? {},
    updated_at: timestamp,
    published_at: null,
    published_by: null,
  };

  let topup: DbPricingTopupPack;
  if (existingDraft) {
    const { data, error } = await supabase
      .from('pricing_topup_packs')
      .update(payload)
      .eq('id', existingDraft.id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to update pricing top-up draft: ${error?.message || 'unknown error'}`);
    }
    topup = data as DbPricingTopupPack;
  } else {
    const { data, error } = await supabase
      .from('pricing_topup_packs')
      .insert(payload)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create pricing top-up draft: ${error?.message || 'unknown error'}`);
    }
    topup = data as DbPricingTopupPack;
  }

  await insertPricingAudit(supabase, {
    entityType: 'topup_pack',
    entityId: topup.id,
    actionType: existingDraft ? 'update_draft' : 'create_draft',
    performedBy: user.id,
    beforeJson: existingDraft,
    afterJson: topup,
  });

  return {
    state: await getPricingAdminStateInternal(supabase),
    topupId: topup.id,
    packKey: topup.pack_key,
  };
}

export async function publishPricingTopupPack(packId: string, reason?: string): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  const draftPack = await getTopupById(supabase, packId);
  if (!draftPack) {
    throw new Error('Pricing top-up pack not found');
  }
  if (draftPack.status !== 'draft') {
    throw new Error('Only draft top-up packs can be published');
  }

  const currentPublished = await getTopupByStatus(
    supabase,
    draftPack.pack_key,
    draftPack.pricing_market_key,
    draftPack.currency_code,
    'published'
  );

  const timestamp = new Date().toISOString();

  if (currentPublished) {
    const { data: archivedData, error: archiveError } = await supabase
      .from('pricing_topup_packs')
      .update({
        status: 'archived',
        updated_at: timestamp,
      })
      .eq('id', currentPublished.id)
      .select('*')
      .single();

    if (archiveError || !archivedData) {
      throw new Error(`Failed to archive current published top-up pack: ${archiveError?.message || 'unknown error'}`);
    }

    await insertPricingAudit(supabase, {
      entityType: 'topup_pack',
      entityId: currentPublished.id,
      actionType: 'archive',
      performedBy: user.id,
      beforeJson: currentPublished,
      afterJson: archivedData as DbPricingTopupPack,
      reason,
    });
  }

  const { data: publishedData, error: publishError } = await supabase
    .from('pricing_topup_packs')
    .update({
      status: 'published',
      published_at: timestamp,
      published_by: user.id,
      updated_at: timestamp,
    })
    .eq('id', draftPack.id)
    .select('*')
    .single();

  if (publishError || !publishedData) {
    throw new Error(`Failed to publish pricing top-up pack: ${publishError?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'topup_pack',
    entityId: draftPack.id,
    actionType: 'publish',
    performedBy: user.id,
    beforeJson: draftPack,
    afterJson: publishedData as DbPricingTopupPack,
    reason,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function archivePricingTopupPack(packId: string, reason?: string): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  const topup = await getTopupById(supabase, packId);
  if (!topup) {
    throw new Error('Pricing top-up pack not found');
  }
  if (topup.status === 'archived') {
    return getPricingAdminStateInternal(supabase);
  }

  const { data, error } = await supabase
    .from('pricing_topup_packs')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('id', topup.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to archive pricing top-up pack: ${error?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'topup_pack',
    entityId: topup.id,
    actionType: 'archive',
    performedBy: user.id,
    beforeJson: topup,
    afterJson: data as DbPricingTopupPack,
    reason,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function archiveLegacyTopupPacks(
  pricingMarketKey: PricingMarketKey,
  reason?: string
): Promise<ArchiveLegacyTopupPacksResult> {
  const { user } = await verifyAdmin();
  assertEnum(pricingMarketKey, PRICING_MARKET_KEYS, 'Pricing market');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .in('pack_key', [...LEGACY_TOPUP_PACK_KEYS])
    .eq('pricing_market_key', pricingMarketKey)
    .neq('status', 'archived');

  throwIfQueryFailed(error, 'Failed to load legacy top-up packs');

  const legacyPacks = (data ?? []) as DbPricingTopupPack[];
  if (legacyPacks.length === 0) {
    return {
      state: await getPricingAdminStateInternal(supabase),
      archivedCount: 0,
    };
  }

  const timestamp = new Date().toISOString();
  const { data: archivedData, error: archiveError } = await supabase
    .from('pricing_topup_packs')
    .update({
      status: 'archived',
      updated_at: timestamp,
    })
    .in('id', legacyPacks.map((pack) => pack.id))
    .select('*');

  throwIfQueryFailed(archiveError, 'Failed to archive legacy top-up packs');

  const archivedPacks = (archivedData ?? []) as DbPricingTopupPack[];
  const beforeById = new Map(legacyPacks.map((pack) => [pack.id, pack] as const));

  for (const pack of archivedPacks) {
    await insertPricingAudit(supabase, {
      entityType: 'topup_pack',
      entityId: pack.id,
      actionType: 'archive',
      performedBy: user.id,
      beforeJson: beforeById.get(pack.id) ?? null,
      afterJson: pack,
      reason,
    });
  }

  return {
    state: await getPricingAdminStateInternal(supabase),
    archivedCount: archivedPacks.length,
  };
}

export async function savePricingActionCost(input: SavePricingActionCostInput): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  const beatCost = validateActionCostInput(input);

  const supabase = createAdminClient();
  const existing = await getActionCostByKey(supabase, input.actionKey);
  const timestamp = new Date().toISOString();

  const { data, error } = await supabase
    .from('pricing_action_costs')
    .upsert({
      action_key: input.actionKey.trim(),
      beat_cost: beatCost,
      is_active: input.isActive,
      display_name: normalizeText(input.displayName) ?? existing?.display_name ?? null,
      cost_family: input.costFamily ?? existing?.cost_family ?? 'other',
      billing_unit: normalizeText(input.billingUnit) ?? existing?.billing_unit ?? 'operation',
      free_enabled: input.freeEnabled ?? existing?.free_enabled ?? true,
      plus_enabled: input.plusEnabled ?? existing?.plus_enabled ?? true,
      studio_enabled: input.studioEnabled ?? existing?.studio_enabled ?? true,
      metadata_json: input.metadata ?? existing?.metadata_json ?? {},
      effective_from: input.effectiveFrom ?? timestamp,
      effective_to: input.effectiveTo ?? null,
      updated_at: timestamp,
      updated_by: user.id,
    }, { onConflict: 'action_key' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to save pricing action cost: ${error?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'action_cost',
    entityId: (data as DbPricingActionCost).id,
    actionType: 'immediate_update',
    performedBy: user.id,
    beforeJson: existing,
    afterJson: data as DbPricingActionCost,
  });

  invalidatePricingGlobalsCache();
  return getPricingAdminStateInternal(supabase);
}

export async function savePricingPromotion(input: SavePricingPromotionInput): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  validatePromotionInput(input);

  const supabase = createAdminClient();
  const existing = await getPromotionByKey(supabase, input.promoKey);
  const timestamp = new Date().toISOString();

  const payload = {
    promo_key: input.promoKey.trim(),
    name: input.name.trim(),
    status: input.status,
    pricing_market_scope: input.pricingMarketScope,
    target_plan_key: input.targetPlanKey ?? null,
    target_user_segment: normalizeText(input.targetUserSegment),
    bonus_beats: input.bonusBeats,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    promo_config_json: input.promoConfig ?? {},
    updated_at: timestamp,
  };

  const { data, error } = await supabase
    .from('pricing_promotions')
    .upsert(payload, { onConflict: 'promo_key' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to save pricing promotion: ${error?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'promotion',
    entityId: (data as DbPricingPromotion).id,
    actionType: 'immediate_update',
    performedBy: user.id,
    beforeJson: existing,
    afterJson: data as DbPricingPromotion,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function archivePricingPromotion(promotionId: string, reason?: string): Promise<PricingAdminState> {
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  const promotion = await getPromotionById(supabase, promotionId);
  if (!promotion) {
    throw new Error('Pricing promotion not found');
  }
  if (promotion.status === 'archived') {
    return getPricingAdminStateInternal(supabase);
  }

  const { data, error } = await supabase
    .from('pricing_promotions')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('id', promotion.id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to archive pricing promotion: ${error?.message || 'unknown error'}`);
  }

  await insertPricingAudit(supabase, {
    entityType: 'promotion',
    entityId: promotion.id,
    actionType: 'archive',
    performedBy: user.id,
    beforeJson: promotion,
    afterJson: data as DbPricingPromotion,
    reason,
  });

  return getPricingAdminStateInternal(supabase);
}

export async function getPricingRuntimeSettings(): Promise<PricingAdminRuntimeSetting[]> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return getPricingRuntimeSettingsInternal(supabase);
}

export async function updatePricingRuntimeSettings(
  updates: UpdatePricingRuntimeSettingInput[]
): Promise<PricingAdminRuntimeSetting[]> {
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  if (updates.length === 0) {
    return getPricingRuntimeSettingsInternal(supabase);
  }

  const existingSettings = await getPricingRuntimeSettingsInternal(supabase);
  const existingMap = new Map(existingSettings.map((setting) => [setting.key, setting]));
  const timestamp = new Date().toISOString();

  for (const update of updates) {
    const definition = getRuntimeSettingDefinition(update.key);
    const previous = existingMap.get(update.key);
    if (!previous) {
      throw new Error(`Unknown pricing runtime setting: ${update.key}`);
    }

    const nextEnabled = update.enabled ?? previous.enabled;
    const nextValue = update.value !== undefined ? normalizeOptionalString(update.value) : previous.value;

    if (definition.kind === 'integer' && nextValue !== null && !/^\d+$/.test(nextValue)) {
      throw new Error(`${definition.label} must be an integer value`);
    }

    if (
      previous.enabled === nextEnabled &&
      previous.value === nextValue
    ) {
      continue;
    }

    const { error } = await supabase
      .from('feature_flags')
      .upsert({
        flag_key: update.key,
        enabled: nextEnabled,
        value: nextValue,
        updated_at: timestamp,
      }, { onConflict: 'flag_key' });

    if (error) {
      throw new Error(`Failed to update runtime setting ${update.key}: ${error.message}`);
    }

    await insertPricingAudit(supabase, {
      entityType: 'runtime_setting',
      entityId: null,
      actionType: 'immediate_update',
      performedBy: user.id,
      beforeJson: previous,
      afterJson: {
        ...previous,
        enabled: nextEnabled,
        value: nextValue,
      },
      reason: update.key,
    });
  }

  return getPricingRuntimeSettingsInternal(supabase);
}

export async function reconcilePricingSubscription(
  input: ReconcilePricingSubscriptionInput
): Promise<ReconcilePricingSubscriptionResult> {
  await verifyAdmin();

  const result = await reconcileRazorpaySubscription({
    providerSubscriptionId: normalizeText(input.providerSubscriptionId),
    billingOrderId: normalizeText(input.billingOrderId),
  });

  return {
    billingSubscriptionId: result.billingSubscriptionId,
    providerSubscriptionId: result.providerSubscriptionId,
    subscriptionStatus: result.subscriptionStatus,
    grantedCoins: result.grantedCoins,
  };
}

export async function reconcilePricingTopup(
  input: ReconcilePricingTopupInput
): Promise<ReconcilePricingTopupResult> {
  await verifyAdmin();

  const result = await reconcileRazorpayTopup({
    billingOrderId: input.billingOrderId.trim(),
    razorpayPaymentId: normalizeText(input.razorpayPaymentId),
  });

  return {
    billingOrderId: result.billingOrderId,
    paymentId: result.paymentId,
    grantedCoins: result.grantedCoins,
  };
}

export async function ensureUserFreeWelcomeGrant(
  input: EnsureFreeWelcomeGrantInput
): Promise<EnsureFreeWelcomeGrantResult> {
  await verifyAdmin();

  if (!input.userId.trim()) {
    throw new Error('User id is required');
  }

  const result = await ensureFreeWelcomeGrantForUser(input.userId.trim(), {
    pricingMarketKey: input.pricingMarketKey ?? null,
    countryCode: normalizeText(input.countryCode),
  });

  return {
    granted: result.granted,
    grantId: result.grantId,
    grantedCoins: result.beatsGranted * COINS_PER_BEAT,
    expiresAt: result.expiresAt,
  };
}

export async function expirePricingReservations(): Promise<ExpirePricingReservationsResult> {
  await verifyAdmin();
  const expiredCount = await expireStaleReservations();
  return { expiredCount };
}

async function getPricingAdminStateInternal(supabase: AdminClient): Promise<PricingAdminState> {
  const [plansResult, versionsResult, topupsResult, actionCostsResult, promotionsResult, runtimeSettings, imageModelRates] = await Promise.all([
    supabase.from('pricing_plans').select('*').order('tier_rank', { ascending: true }).order('name', { ascending: true }),
    supabase.from('pricing_plan_versions').select('*').order('plan_id', { ascending: true }).order('pricing_market_key', { ascending: true }).order('billing_interval', { ascending: true }).order('status', { ascending: true }),
    supabase.from('pricing_topup_packs').select('*').order('pricing_market_key', { ascending: true }).order('beat_amount', { ascending: true }).order('status', { ascending: true }),
    supabase.from('pricing_action_costs').select('*').order('action_key', { ascending: true }),
    supabase.from('pricing_promotions').select('*').order('created_at', { ascending: false }),
    getPricingRuntimeSettingsInternal(supabase),
    listImageModelRegistry('studio').catch(() => []),
  ]);

  throwIfQueryFailed(plansResult.error, 'Failed to load pricing plans');
  throwIfQueryFailed(versionsResult.error, 'Failed to load pricing plan versions');
  throwIfQueryFailed(topupsResult.error, 'Failed to load pricing top-up packs');
  throwIfQueryFailed(actionCostsResult.error, 'Failed to load pricing action costs');
  throwIfQueryFailed(promotionsResult.error, 'Failed to load pricing promotions');

  const versionsByPlanId = new Map<string, DbPricingPlanVersion[]>();
  for (const row of (versionsResult.data ?? []) as DbPricingPlanVersion[]) {
    const current = versionsByPlanId.get(row.plan_id) ?? [];
    current.push(row);
    versionsByPlanId.set(row.plan_id, current);
  }

  const plans = ((plansResult.data ?? []) as DbPricingPlan[]).map((plan) => ({
    plan,
    versions: versionsByPlanId.get(plan.id) ?? [],
  }));

  return {
    plans,
    topupPacks: (topupsResult.data ?? []) as DbPricingTopupPack[],
    actionCosts: (actionCostsResult.data ?? []) as DbPricingActionCost[],
    promotions: (promotionsResult.data ?? []) as DbPricingPromotion[],
    runtimeSettings,
    imageModelRates,
  };
}

function normalizeAuditPage(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizePricingPlanFeatureFlags(input?: PricingPlanFeatureFlags | null): PricingPlanFeatureFlags {
  return {
    canAccessDownloads: Boolean(input?.canAccessDownloads ?? false),
    canAccessUnbrandedExports: Boolean(input?.canAccessUnbrandedExports ?? false),
    creatorControls: Boolean(input?.creatorControls ?? false),
    videoExportPreset: normalizeVideoExportPreset(input?.videoExportPreset),
  };
}

function normalizeAuditPageSize(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 25;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

async function getPricingRuntimeSettingsInternal(supabase: AdminClient): Promise<PricingAdminRuntimeSetting[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('flag_key, enabled, value')
    .in('flag_key', [...PRICING_RUNTIME_SETTING_DEFINITIONS.map((definition) => definition.key)]);

  throwIfQueryFailed(error, 'Failed to load pricing runtime settings');

  const rows = new Map(
    ((data ?? []) as Array<{ flag_key: string; enabled: boolean; value: string | null }>)
      .map((row) => [row.flag_key, row])
  );

  return PRICING_RUNTIME_SETTING_DEFINITIONS.map((definition) => {
    const row = rows.get(definition.key);
    return {
      key: definition.key,
      kind: definition.kind,
      label: definition.label,
      description: definition.description,
      enabledHelp: definition.enabledHelp,
      disabledHelp: definition.disabledHelp,
      enabled: row?.enabled ?? definition.defaultEnabled,
      value: row?.value ?? definition.defaultValue,
      defaultEnabled: definition.defaultEnabled,
      defaultValue: definition.defaultValue,
    };
  });
}

async function upsertPricingPlanBase(supabase: AdminClient, input: SavePricingPlanDraftInput): Promise<DbPricingPlan> {
  const { data, error } = await supabase
    .from('pricing_plans')
    .upsert({
      plan_key: input.planKey.trim().toLowerCase(),
      name: input.name.trim(),
      tier_rank: input.tierRank,
      is_active: input.isActive,
      is_public: input.isPublic,
      description: normalizeText(input.description),
      feature_flags_json: normalizePricingPlanFeatureFlags(input.featureFlags),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'plan_key' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to save pricing plan: ${error?.message || 'unknown error'}`);
  }

  return data as DbPricingPlan;
}

async function getPlanVersionById(supabase: AdminClient, versionId: string): Promise<DbPricingPlanVersion | null> {
  const { data, error } = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', versionId)
    .limit(1);

  throwIfQueryFailed(error, 'Failed to load pricing plan version');
  return ((data ?? []) as DbPricingPlanVersion[])[0] ?? null;
}

async function getPlanVersionByStatus(
  supabase: AdminClient,
  planId: string,
  billingInterval: BillingInterval,
  pricingMarketKey: PricingMarketKey,
  currencyCode: string,
  status: PricingCatalogStatus
): Promise<DbPricingPlanVersion | null> {
  const { data, error } = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('plan_id', planId)
    .eq('billing_interval', billingInterval)
    .eq('pricing_market_key', pricingMarketKey)
    .eq('currency_code', currencyCode.trim().toUpperCase())
    .eq('status', status)
    .limit(1);

  throwIfQueryFailed(error, `Failed to load pricing plan version (${status})`);
  return ((data ?? []) as DbPricingPlanVersion[])[0] ?? null;
}

async function getTopupById(supabase: AdminClient, packId: string): Promise<DbPricingTopupPack | null> {
  const { data, error } = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('id', packId)
    .limit(1);

  throwIfQueryFailed(error, 'Failed to load pricing top-up pack');
  return ((data ?? []) as DbPricingTopupPack[])[0] ?? null;
}

async function getTopupByStatus(
  supabase: AdminClient,
  packKey: string,
  pricingMarketKey: PricingMarketKey,
  currencyCode: string,
  status: PricingCatalogStatus
): Promise<DbPricingTopupPack | null> {
  const { data, error } = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('pack_key', packKey.trim())
    .eq('pricing_market_key', pricingMarketKey)
    .eq('currency_code', currencyCode.trim().toUpperCase())
    .eq('status', status)
    .limit(1);

  throwIfQueryFailed(error, `Failed to load pricing top-up pack (${status})`);
  return ((data ?? []) as DbPricingTopupPack[])[0] ?? null;
}

async function getActionCostByKey(
  supabase: AdminClient,
  actionKey: string
): Promise<DbPricingActionCost | null> {
  const { data, error } = await supabase
    .from('pricing_action_costs')
    .select('*')
    .eq('action_key', actionKey.trim())
    .limit(1);

  throwIfQueryFailed(error, 'Failed to load pricing action cost');
  return ((data ?? []) as DbPricingActionCost[])[0] ?? null;
}

async function getPromotionById(
  supabase: AdminClient,
  promotionId: string
): Promise<DbPricingPromotion | null> {
  const { data, error } = await supabase
    .from('pricing_promotions')
    .select('*')
    .eq('id', promotionId)
    .limit(1);

  throwIfQueryFailed(error, 'Failed to load pricing promotion');
  return ((data ?? []) as DbPricingPromotion[])[0] ?? null;
}

async function getPromotionByKey(
  supabase: AdminClient,
  promoKey: string
): Promise<DbPricingPromotion | null> {
  const { data, error } = await supabase
    .from('pricing_promotions')
    .select('*')
    .eq('promo_key', promoKey.trim())
    .limit(1);

  throwIfQueryFailed(error, 'Failed to load pricing promotion');
  return ((data ?? []) as DbPricingPromotion[])[0] ?? null;
}

interface InsertAuditInput {
  entityType: 'plan_version' | 'topup_pack' | 'action_cost' | 'promotion' | 'runtime_setting';
  entityId: string | null;
  actionType: 'create_draft' | 'update_draft' | 'publish' | 'archive' | 'immediate_update';
  performedBy: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string;
}

async function insertPricingAudit(supabase: AdminClient, input: InsertAuditInput): Promise<void> {
  const { error } = await supabase
    .from('pricing_publish_audit')
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      action_type: input.actionType,
      performed_by: input.performedBy,
      before_json: (input.beforeJson ?? null) as JsonRecord | null,
      after_json: (input.afterJson ?? null) as JsonRecord | null,
      reason: normalizeText(input.reason),
    });

  if (error) {
    throw new Error(`Failed to record pricing audit: ${error.message}`);
  }

  // Every pricing-admin mutation records an audit row, so this is the single
  // choke point to drop the cached plans/versions/flags/action-costs.
  invalidatePricingGlobalsCache();
}

function validatePlanDraftInput(input: SavePricingPlanDraftInput): void {
  if (!input.planKey.trim()) throw new Error('Plan key is required');
  if (!input.name.trim()) throw new Error('Plan name is required');
  assertInteger(input.tierRank, 'Tier rank', 1);
  assertInteger(input.priceMinor, 'Price', 0);
  assertInteger(input.monthlyIncludedBeats, 'Monthly included beats', 0);
  if (input.planKey.trim() === 'free' && input.monthlyIncludedBeats !== 0) {
    throw new Error('Free account credits are managed by the operational welcome policy, not a monthly plan allowance');
  }
  assertNumber(input.carryForwardCapMultiplier, 'Carry forward cap multiplier', 0);
  assertInteger(input.storyLengthCap, 'Story length cap', 1);
  assertInteger(input.gracePeriodDays, 'Grace period days', 0);
  assertEnum(input.billingInterval, BILLING_INTERVALS, 'Billing interval');
  assertEnum(input.pricingMarketKey, PRICING_MARKET_KEYS, 'Pricing market');
  if (input.provider != null) {
    assertEnum(input.provider, BILLING_PROVIDERS, 'Billing provider');
  }
  if (input.priceMinor > 0 && input.provider == null) {
    throw new Error('A paid plan draft must define a billing provider');
  }
}

function validateTopupDraftInput(input: SavePricingTopupDraftInput): {
  topupId: string | null;
  packKey: string | null;
  name: string;
  provider: BillingProvider;
  currencyCode: string;
  pricingMarketKey: PricingMarketKey;
  priceMinor: number;
  beatAmount: number;
  providerProductRef?: string | null;
  providerPriceRef?: string | null;
  extensions?: JsonRecord;
} {
  assertEnum(input.provider, BILLING_PROVIDERS, 'Billing provider');
  assertEnum(input.pricingMarketKey, PRICING_MARKET_KEYS, 'Pricing market');
  assertInteger(input.priceMinor, 'Price', 0);
  assertInteger(input.beatAmount, 'Beat amount', 1);

  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();
  if (!normalizedCurrencyCode) {
    throw new Error('Currency is required');
  }

  return {
    topupId: normalizeText(input.topupId),
    packKey: normalizeText(input.packKey),
    name: input.name,
    provider: input.provider,
    currencyCode: normalizedCurrencyCode,
    pricingMarketKey: input.pricingMarketKey,
    priceMinor: input.priceMinor,
    beatAmount: input.beatAmount,
    providerProductRef: input.providerProductRef,
    providerPriceRef: input.providerPriceRef,
    extensions: input.extensions,
  };
}

function validateActionCostInput(input: SavePricingActionCostInput): number {
  if (!input.actionKey.trim()) throw new Error('Action key is required');
  assertNumber(input.beatCost, 'Beat cost', 0);

  const coinCost = input.beatCost * COINS_PER_BEAT;
  const roundedCoinCost = Math.round(coinCost);
  if (Math.abs(coinCost - roundedCoinCost) > 0.000001) {
    throw new Error('Action cost must be a whole number of coins');
  }

  return Number((roundedCoinCost / COINS_PER_BEAT).toFixed(2));
}

function validatePromotionInput(input: SavePricingPromotionInput): void {
  if (!input.promoKey.trim()) throw new Error('Promotion key is required');
  if (!input.name.trim()) throw new Error('Promotion name is required');
  assertEnum(input.status, PRICING_CATALOG_STATUSES, 'Promotion status');
  assertEnum(input.pricingMarketScope, PROMOTION_MARKET_SCOPES, 'Promotion market scope');
  if (input.targetPlanKey != null) {
    assertEnum(input.targetPlanKey, PLAN_KEYS, 'Promotion target plan');
  }
  assertInteger(input.bonusBeats, 'Promotion bonus beats', 0);
  if (input.startsAt && Number.isNaN(new Date(input.startsAt).getTime())) {
    throw new Error('Promotion start time is invalid');
  }
  if (input.endsAt && Number.isNaN(new Date(input.endsAt).getTime())) {
    throw new Error('Promotion end time is invalid');
  }
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new Error('Promotion end time must be after the start time');
  }
}

function getRuntimeSettingDefinition(key: PricingRuntimeFlagKey): PricingRuntimeSettingDefinition {
  const definition = PRICING_RUNTIME_SETTING_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`Unknown runtime setting: ${key}`);
  }
  return definition;
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function assertEnum<T extends string>(value: string, values: readonly T[], label: string): asserts value is T {
  if (!values.includes(value as T)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer greater than or equal to ${min}`);
  }
}

function assertNumber(value: number, label: string, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${label} must be greater than or equal to ${min}`);
  }
}

function buildGeneratedTopupPackKey(beatAmount: number): string {
  return `coins_${beatAmount * COINS_PER_BEAT}`;
}

function buildTopupPackDisplayName(beatAmount: number): string {
  return `${formatWholeNumber(beatAmount * COINS_PER_BEAT)} Coins`;
}

function isGeneratedTopupPackName(value: string): boolean {
  const normalized = value.trim();
  return /^\d[\d,]*\s+coins$/i.test(normalized) || /^\d+\s+beats$/i.test(normalized);
}

function normalizeTopupPackName(name: string, beatAmount: number): string {
  const normalized = name.trim();
  if (!normalized || isGeneratedTopupPackName(normalized)) {
    return buildTopupPackDisplayName(beatAmount);
  }
  return normalized;
}

function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function normalizeText(value?: string | null): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function normalizeOptionalString(value?: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
