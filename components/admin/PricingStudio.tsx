'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle,
  Coins,
  CreditCard,
  Loader2,
  Megaphone,
  RotateCcw,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  archiveLegacyTopupPacks,
  archivePricingPlanVersion,
  archivePricingPromotion,
  archivePricingTopupPack,
  expirePricingReservations,
  getPricingAdminState,
  publishPricingPlanVersion,
  publishPricingTopupPack,
  reconcilePricingSubscription,
  reconcilePricingTopup,
  ensureUserFreeWelcomeGrant,
  savePricingActionCost,
  savePricingPlanDraft,
  savePricingPromotion,
  savePricingTopupDraft,
  updatePricingRuntimeSettings,
  type PricingAdminState,
} from '@/app/actions/pricing-admin';
import { saveAdminImageModelRegistryRecord } from '@/app/actions/image-models';
import type { DbPricingPromotion, DbPricingTopupPack } from '@/lib/types/database';
import { PRICING_NAV_ITEMS, findPricingNavItem, type AdminNavChild } from '@/lib/admin/nav';
import AdminToggle from '@/components/admin/AdminToggle';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import AdminHubCard from '@/components/admin/AdminHubCard';
import FilterDropdown from '@/components/ui/FilterDropdown';
import {
  BILLING_INTERVALS,
  BILLING_PROVIDERS,
  COINS_PER_BEAT,
  DEFAULT_VIDEO_EXPORT_PRESET,
  PLAN_KEYS,
  PRICING_MARKET_KEYS,
  PROMOTION_MARKET_SCOPES,
  VIDEO_EXPORT_VERTICAL_RESOLUTIONS,
  VIDEO_EXPORT_WATERMARK_MODES,
  VIDEO_EXPORT_WATERMARK_POSITIONS,
  VIDEO_EXPORT_WATERMARK_SIZES,
  type BillingInterval,
  type BillingProvider,
  type PlanKey,
  type PricingCatalogStatus,
  type PricingMarketKey,
  type PromotionMarketScope,
  type VideoExportVerticalResolution,
  type VideoExportWatermarkMode,
  type VideoExportWatermarkPosition,
  type VideoExportWatermarkSize,
  normalizeVideoExportPreset,
} from '@/lib/types/pricing';

type PlanEditorState = {
  name: string;
  tierRank: number;
  isActive: boolean;
  isPublic: boolean;
  description: string;
  canAccessDownloads: boolean;
  canAccessUnbrandedExports: boolean;
  creatorControls: boolean;
  videoExportVerticalResolution: VideoExportVerticalResolution;
  videoExportWatermarkMode: VideoExportWatermarkMode;
  videoExportWatermarkPosition: VideoExportWatermarkPosition;
  videoExportWatermarkSize: VideoExportWatermarkSize;
  provider: BillingProvider | '';
  currencyCode: string;
  priceMinor: number;
  monthlyIncludedCoins: number;
  carryForwardCapMultiplier: number;
  storyLengthCap: number;
  gracePeriodDays: number;
  providerProductRef: string;
  providerPriceRef: string;
};

type TopupEditorState = {
  topupId: string | null;
  packKey: string | null;
  name: string;
  provider: BillingProvider;
  currencyCode: string;
  priceMinor: number;
  coinAmount: number;
  providerProductRef: string;
  providerPriceRef: string;
};

type TopupCatalogEntry = {
  packKey: string;
  current: DbPricingTopupPack;
  draft: DbPricingTopupPack | null;
  published: DbPricingTopupPack | null;
  coinAmount: number;
  label: string;
};

type PromotionEditorState = {
  id: string | null;
  promoKey: string;
  name: string;
  status: PricingCatalogStatus;
  pricingMarketScope: PromotionMarketScope;
  targetPlanKey: PlanKey | '';
  targetUserSegment: string;
  bonusCoins: number;
  startsAt: string;
  endsAt: string;
};

type ActionCostDraft = {
  coinCost: string;
  isActive: boolean;
  freeEnabled: boolean;
  plusEnabled: boolean;
  studioEnabled: boolean;
};

type RuntimeDraft = {
  enabled: boolean;
  value: string;
};

type InlineMutationFeedback = {
  status: 'success' | 'error';
  message: string;
};

export type PricingStudioSection =
  | 'workshop'
  | 'plans'
  | 'top-up-packs'
  | 'promotions'
  | 'action-costs'
  | 'runtime-controls'
  | 'recovery-tools';

const INPUT_CLASS = 'w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100';

// Workshop hub cards grouped like the Global Settings overview: catalog authoring,
// live operations, and change history each get their own titled box.
const WORKSHOP_CARD_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Catalog', ids: ['plans', 'top-up-packs', 'promotions'] },
  { label: 'Operations', ids: ['action-costs', 'runtime-controls', 'recovery-tools'] },
  { label: 'History', ids: ['audit'] },
];
const COIN_RUNTIME_SETTING_KEYS = new Set(['pricing_migration_grant_beats']);
const LEGACY_TOPUP_PACK_KEYS = new Set(['beats_25', 'beats_80', 'beats_200']);
const ACTION_COST_GROUP_DEFINITIONS = [
  {
    id: 'stories',
    title: 'Stories',
    description: 'Interactive and audio-story creation, continuation, narration, covers, and reference processing.',
    operationGroups: [
      {
        id: 'story-creation',
        title: 'Creation and continuation',
        actionKeys: [
          'start_story_initial_beat',
          'start_story_initial_beat_prompt_only',
          'continue_story_new_beat',
          'continue_story_new_beat_prompt_only',
          'preview_seed_plan',
        ],
      },
      {
        id: 'story-narration',
        title: 'Narration and text timing',
        actionKeys: [
          'generate_story_narration',
          'align_story_text_overlay',
        ],
      },
      {
        id: 'story-covers',
        title: 'Covers and sharing visuals',
        actionKeys: [
          'generate_social_share_cover',
          'generate_audio_story_cover',
        ],
      },
      {
        id: 'story-references',
        title: 'Character and world references',
        actionKeys: [
          'adopt_character_reference',
          'adopt_world_reference',
          'visualize_world_reference',
          'analyze_direct_reference',
        ],
      },
    ],
  },
  {
    id: 'reels',
    title: 'Reels',
    description: 'Short-form reel creation, narration, and reel-specific visual assets.',
    operationGroups: [
      {
        id: 'reel-creation',
        title: 'Reel creation',
        actionKeys: [
          'start_reel_full_generation',
          'start_reel_full_generation_prompt_only',
        ],
      },
      {
        id: 'reel-narration',
        title: 'Narration',
        actionKeys: ['generate_reel_narration'],
      },
      {
        id: 'reel-visuals',
        title: 'Thumbnails and visuals',
        actionKeys: ['generate_reel_thumbnail'],
      },
    ],
  },
  {
    id: 'shared',
    title: 'Shared operations',
    description: 'Meters used across stories and reels, or by platform-wide media workflows.',
    operationGroups: [
      {
        id: 'shared-images',
        title: 'Image generation',
        actionKeys: [
          'image_generation',
          'regenerate_image',
          'batch_image_generation',
        ],
      },
      {
        id: 'shared-audio',
        title: 'Narration utilities',
        actionKeys: [
          'generate_narration_preview',
          'regenerate_narration',
        ],
      },
      {
        id: 'shared-transcription',
        title: 'Speech and transcription',
        actionKeys: ['transcribe_audio_stt'],
      },
      {
        id: 'shared-export',
        title: 'Video export',
        actionKeys: [
          'export_video_sd',
          'export_video_hd',
          'export_video_future',
        ],
      },
    ],
  },
] as const;
const IMAGE_MODEL_RATE_GROUP_DEFINITIONS = [
  {
    id: 'story-image-models',
    title: 'Story image models',
    description: 'Per-image rates for story scenes and story visual generation.',
    taskKeys: ['image_generation'],
  },
  {
    id: 'reel-image-models',
    title: 'Reel image models',
    description: 'Per-image rates for vertical reel visuals.',
    taskKeys: ['reel_image_generation'],
  },
  {
    id: 'portrait-image-models',
    title: 'Character and reference models',
    description: 'Per-image rates for portraits and supporting identity assets.',
    taskKeys: ['portrait_generation'],
  },
] as const;
const VIDEO_EXPORT_WATERMARK_MODE_LABELS: Record<VideoExportWatermarkMode, string> = {
  auto: 'Auto',
  always: 'Always show',
  hidden: 'Hide',
};
const VIDEO_EXPORT_WATERMARK_POSITION_LABELS: Record<VideoExportWatermarkPosition, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
};
const VIDEO_EXPORT_WATERMARK_SIZE_LABELS: Record<VideoExportWatermarkSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-300">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-base font-medium text-neutral-100">{title}</h2>
          <p className="mt-1 text-sm text-neutral-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function beatsToCoins(value: number) {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

function coinsToBeats(value: number) {
  return Math.max(0, Math.round(value / COINS_PER_BEAT));
}

function coinsToActionBeats(value: number) {
  return Math.max(0, Number((value / COINS_PER_BEAT).toFixed(2)));
}

function parseActionCoinCost(value: string) {
  const parsed = value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Action cost must be 0 or more coins.');
  }
  if (!Number.isInteger(parsed)) {
    throw new Error('Action cost must be a whole number of coins.');
  }
  return parsed;
}

function coinAmountToWholeBeats(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than 0 coins.`);
  }

  const beatAmount = value / COINS_PER_BEAT;
  if (!Number.isInteger(beatAmount)) {
    throw new Error(`${label} must be in increments of ${COINS_PER_BEAT} coins.`);
  }

  return beatAmount;
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function isCoinRuntimeSettingKey(key: string) {
  return COIN_RUNTIME_SETTING_KEYS.has(key);
}

function storedValueToEditorValue(key: string, value: string | null | undefined) {
  if (!value) return '';
  if (!isCoinRuntimeSettingKey(key)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return String(beatsToCoins(parsed));
}

function editorValueToStoredValue(key: string, value: string) {
  if (!value.trim()) return '';
  if (!isCoinRuntimeSettingKey(key)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return String(coinsToBeats(parsed));
}

function formatRuntimeDefaultValue(key: string, defaultValue: string | null, defaultEnabled: boolean) {
  if (defaultValue === null) return String(defaultEnabled);
  if (!isCoinRuntimeSettingKey(key)) return defaultValue;
  const parsed = Number(defaultValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return String(beatsToCoins(parsed));
}

function buildGeneratedPackName(coinAmount: number) {
  return `${formatWholeNumber(coinAmount)} Coins`;
}

function isGeneratedPackName(name: string) {
  const normalized = name.trim();
  return /^\d[\d,]*\s+coins$/i.test(normalized) || /^\d+\s+beats$/i.test(normalized);
}

function normalizePackName(name: string | null | undefined, beatAmount: number) {
  if (!name?.trim() || isGeneratedPackName(name)) {
    return buildGeneratedPackName(beatsToCoins(beatAmount));
  }
  return name.trim();
}

function formatPlanVariantValue(variant: PricingAdminState['plans'][number]['versions'][number] | null) {
  if (!variant) return 'Missing';
  return `${variant.currency_code} ${variant.price_minor} · ${formatWholeNumber(beatsToCoins(variant.monthly_included_beats))} coins/mo`;
}

function formatTopupVariantValue(variant: PricingAdminState['topupPacks'][number] | null) {
  if (!variant) return 'Missing';
  return `${variant.currency_code} ${variant.price_minor} · ${formatWholeNumber(beatsToCoins(variant.beat_amount))} coins`;
}

function buildTopupCatalogEntries(
  topupPacks: DbPricingTopupPack[],
  market: PricingMarketKey
): TopupCatalogEntry[] {
  const grouped = new Map<string, { draft: DbPricingTopupPack | null; published: DbPricingTopupPack | null }>();

  for (const pack of topupPacks) {
    if (pack.pricing_market_key !== market || pack.status === 'archived') {
      continue;
    }

    const current = grouped.get(pack.pack_key) ?? { draft: null, published: null };
    if (pack.status === 'draft') {
      current.draft = pack;
    } else if (pack.status === 'published') {
      current.published = pack;
    }
    grouped.set(pack.pack_key, current);
  }

  return Array.from(grouped.entries())
    .map(([packKey, variants]) => {
      const current = variants.draft ?? variants.published;
      if (!current) return null;

      return {
        packKey,
        current,
        draft: variants.draft,
        published: variants.published,
        coinAmount: beatsToCoins(current.beat_amount),
        label: normalizePackName(current.name, current.beat_amount),
      };
    })
    .filter((entry): entry is TopupCatalogEntry => entry !== null)
    .sort((left, right) => left.coinAmount - right.coinAmount || left.label.localeCompare(right.label));
}

function toLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTimeValue(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultCurrencyForMarket(market: PricingMarketKey) {
  return market === 'IN' ? 'INR' : 'USD';
}

function defaultProviderForMarket(market: PricingMarketKey): BillingProvider {
  return market === 'IN' ? 'razorpay' : 'stripe';
}

function defaultPlanEditor(planKey: PlanKey, market: PricingMarketKey): PlanEditorState {
  const defaultsByPlan: Record<PlanKey, { beats: number; cap: number; tier: number }> = {
    free: { beats: 0, cap: 4, tier: 1 },
    plus: { beats: 100, cap: 8, tier: 2 },
    studio: { beats: 300, cap: 8, tier: 3 },
  };
  const defaults = defaultsByPlan[planKey];
  return {
    name: planKey === 'free' ? 'Free' : planKey === 'plus' ? 'Plus' : 'Studio',
    tierRank: defaults.tier,
    isActive: true,
    isPublic: true,
    description: '',
    canAccessDownloads: planKey === 'studio',
    canAccessUnbrandedExports: planKey === 'studio',
    creatorControls: planKey === 'studio',
    videoExportVerticalResolution: DEFAULT_VIDEO_EXPORT_PRESET.verticalResolution,
    videoExportWatermarkMode: DEFAULT_VIDEO_EXPORT_PRESET.watermarkMode,
    videoExportWatermarkPosition: DEFAULT_VIDEO_EXPORT_PRESET.watermarkPosition,
    videoExportWatermarkSize: DEFAULT_VIDEO_EXPORT_PRESET.watermarkSize,
    provider: planKey === 'free' ? '' : defaultProviderForMarket(market),
    currencyCode: defaultCurrencyForMarket(market),
    priceMinor: 0,
    monthlyIncludedCoins: beatsToCoins(defaults.beats),
    carryForwardCapMultiplier: 2,
    storyLengthCap: defaults.cap,
    gracePeriodDays: 5,
    providerProductRef: '',
    providerPriceRef: '',
  };
}

function defaultTopupEditor(market: PricingMarketKey): TopupEditorState {
  return {
    topupId: null,
    packKey: null,
    name: '',
    provider: defaultProviderForMarket(market),
    currencyCode: defaultCurrencyForMarket(market),
    priceMinor: 0,
    coinAmount: 0,
    providerProductRef: '',
    providerPriceRef: '',
  };
}

function defaultPromotionEditor(): PromotionEditorState {
  return {
    id: null,
    promoKey: '',
    name: '',
    status: 'published',
    pricingMarketScope: 'ALL',
    targetPlanKey: '',
    targetUserSegment: '',
    bonusCoins: 0,
    startsAt: '',
    endsAt: '',
  };
}

type GroupedActionCostSection = {
  id: string;
  title: string;
  description: string;
  operationGroups: Array<{
    id: string;
    title: string;
    actions: PricingAdminState['actionCosts'];
  }>;
};

function buildGroupedActionCosts(
  actionCosts: PricingAdminState['actionCosts']
): GroupedActionCostSection[] {
  const actionsByKey = new Map(actionCosts.map((action) => [action.action_key, action]));
  const assignedKeys = new Set<string>();
  const sections: GroupedActionCostSection[] = ACTION_COST_GROUP_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    operationGroups: section.operationGroups
      .map((operationGroup) => {
        const actions = operationGroup.actionKeys.flatMap((actionKey) => {
          const action = actionsByKey.get(actionKey);
          if (!action) return [];
          assignedKeys.add(actionKey);
          return [action];
        });
        return {
          id: operationGroup.id,
          title: operationGroup.title,
          actions,
        };
      })
      .filter((operationGroup) => operationGroup.actions.length > 0),
  })).filter((section) => section.operationGroups.length > 0);

  const uncategorized = actionCosts
    .filter((action) => !assignedKeys.has(action.action_key))
    .sort((left, right) =>
      (left.display_name || left.action_key).localeCompare(right.display_name || right.action_key)
    );
  if (uncategorized.length > 0) {
    const sharedSection = sections.find((section) => section.id === 'shared');
    const fallbackGroup = {
      id: 'shared-other',
      title: 'Other operations',
      actions: uncategorized,
    };
    if (sharedSection) {
      sharedSection.operationGroups.push(fallbackGroup);
    } else {
      sections.push({
        id: 'shared',
        title: 'Shared operations',
        description: 'Meters used across stories and reels, or by platform-wide media workflows.',
        operationGroups: [fallbackGroup],
      });
    }
  }

  return sections;
}

type GroupedImageModelRateSection = {
  id: string;
  title: string;
  description: string;
  models: PricingAdminState['imageModelRates'];
};

function buildGroupedImageModelRates(
  imageModelRates: PricingAdminState['imageModelRates']
): GroupedImageModelRateSection[] {
  const assignedIds = new Set<string>();
  const groups: GroupedImageModelRateSection[] = IMAGE_MODEL_RATE_GROUP_DEFINITIONS.map((definition) => {
    const allowedTaskKeys = new Set<string>(definition.taskKeys);
    const models = imageModelRates.filter((model) => {
      if (!allowedTaskKeys.has(model.taskKey)) return false;
      assignedIds.add(model.id);
      return true;
    });
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      models,
    };
  }).filter((group) => group.models.length > 0);

  const uncategorized = imageModelRates.filter((model) => !assignedIds.has(model.id));
  if (uncategorized.length > 0) {
    groups.push({
      id: 'other-image-models',
      title: 'Other image models',
      description: 'Additional model rates not yet assigned to a specific content workflow.',
      models: uncategorized,
    });
  }

  return groups;
}

export default function PricingStudio({ section = 'workshop' }: { section?: PricingStudioSection }) {
  const [state, setState] = useState<PricingAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [inlineMutationFeedback, setInlineMutationFeedback] = useState<Record<string, InlineMutationFeedback>>({});

  const [selectedPlanKey, setSelectedPlanKey] = useState<PlanKey>('free');
  const [selectedPlanMarket, setSelectedPlanMarket] = useState<PricingMarketKey>('ROW');
  const [selectedPlanInterval, setSelectedPlanInterval] = useState<BillingInterval>('monthly');
  const [planEditor, setPlanEditor] = useState<PlanEditorState>(defaultPlanEditor('free', 'ROW'));

  const [selectedTopupMarket, setSelectedTopupMarket] = useState<PricingMarketKey>('ROW');
  const [selectedTopupRecordId, setSelectedTopupRecordId] = useState<string | null>(null);
  const [isCreatingTopup, setIsCreatingTopup] = useState(false);
  const [topupEditor, setTopupEditor] = useState<TopupEditorState>(defaultTopupEditor('ROW'));

  const [actionCostDrafts, setActionCostDrafts] = useState<Record<string, ActionCostDraft>>({});
  const [imageModelCoinDrafts, setImageModelCoinDrafts] = useState<Record<string, string>>({});
  const [runtimeDrafts, setRuntimeDrafts] = useState<Record<string, RuntimeDraft>>({});
  const [promotionEditor, setPromotionEditor] = useState<PromotionEditorState>(defaultPromotionEditor());
  const [recoveryDrafts, setRecoveryDrafts] = useState({
    subscriptionId: '',
    subscriptionBillingOrderId: '',
    topupBillingOrderId: '',
    topupPaymentId: '',
    freeGrantUserId: '',
    freeGrantMarket: 'IN' as PricingMarketKey,
  });

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await getPricingAdminState();
        hydrateState(next);
      } catch (err: any) {
        setError(err.message || 'Failed to load pricing admin state');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!state) return;
    setPlanEditor(buildPlanEditor(state, selectedPlanKey, selectedPlanMarket, selectedPlanInterval));
  }, [state, selectedPlanKey, selectedPlanMarket, selectedPlanInterval]);

  const topupCatalogEntries = useMemo(
    () => buildTopupCatalogEntries(state?.topupPacks ?? [], selectedTopupMarket),
    [state, selectedTopupMarket]
  );

  const selectedTopupEntry = useMemo(() => {
    if (!selectedTopupRecordId) return null;
    return topupCatalogEntries.find((entry) =>
      entry.current.id === selectedTopupRecordId ||
      entry.draft?.id === selectedTopupRecordId ||
      entry.published?.id === selectedTopupRecordId
    ) ?? null;
  }, [selectedTopupRecordId, topupCatalogEntries]);

  useEffect(() => {
    if (!state) return;
    if (isCreatingTopup) {
      setTopupEditor(defaultTopupEditor(selectedTopupMarket));
      return;
    }

    if (selectedTopupEntry) {
      setTopupEditor(buildTopupEditor(selectedTopupEntry, selectedTopupMarket));
      return;
    }

    const firstEntry = topupCatalogEntries[0] ?? null;
    if (firstEntry && selectedTopupRecordId !== firstEntry.current.id) {
      setSelectedTopupRecordId(firstEntry.current.id);
      return;
    }

    if (!firstEntry) {
      setTopupEditor(defaultTopupEditor(selectedTopupMarket));
    }
  }, [isCreatingTopup, selectedTopupEntry, selectedTopupMarket, selectedTopupRecordId, state, topupCatalogEntries]);

  const currentPlanDraft = useMemo(() => {
    const record = state?.plans.find((item) => item.plan.plan_key === selectedPlanKey);
    if (!record) return null;
    return record.versions.find((version) =>
      version.status === 'draft' &&
      version.pricing_market_key === selectedPlanMarket &&
      version.billing_interval === selectedPlanInterval
    ) ?? null;
  }, [state, selectedPlanInterval, selectedPlanKey, selectedPlanMarket]);

  const currentPlanPublished = useMemo(() => {
    const record = state?.plans.find((item) => item.plan.plan_key === selectedPlanKey);
    if (!record) return null;
    return record.versions.find((version) =>
      version.status === 'published' &&
      version.pricing_market_key === selectedPlanMarket &&
      version.billing_interval === selectedPlanInterval
    ) ?? null;
  }, [state, selectedPlanInterval, selectedPlanKey, selectedPlanMarket]);

  const currentTopupDraft = useMemo(() => {
    return selectedTopupEntry?.draft ?? null;
  }, [selectedTopupEntry]);

  const currentTopupPublished = useMemo(() => {
    return selectedTopupEntry?.published ?? null;
  }, [selectedTopupEntry]);

  const hasLegacyTopupPacks = useMemo(() => {
    return state?.topupPacks.some((pack) =>
      pack.pricing_market_key === selectedTopupMarket &&
      pack.status !== 'archived' &&
      LEGACY_TOPUP_PACK_KEYS.has(pack.pack_key)
    ) ?? false;
  }, [selectedTopupMarket, state]);

  const groupedActionCosts = useMemo(
    () => buildGroupedActionCosts(state?.actionCosts ?? []),
    [state?.actionCosts]
  );
  const groupedImageModelRates = useMemo(
    () => buildGroupedImageModelRates(state?.imageModelRates ?? []),
    [state?.imageModelRates]
  );

  async function refreshState() {
    setLoading(true);
    setError(null);
    try {
      const next = await getPricingAdminState();
      hydrateState(next);
    } catch (err: any) {
      setError(err.message || 'Failed to load pricing admin state');
    } finally {
      setLoading(false);
    }
  }

  function hydrateState(next: PricingAdminState) {
    setState(next);
    setActionCostDrafts(Object.fromEntries(
      next.actionCosts.map((row) => [row.action_key, {
        coinCost: String(beatsToCoins(row.beat_cost)),
        isActive: row.is_active,
        freeEnabled: row.free_enabled ?? true,
        plusEnabled: row.plus_enabled ?? true,
        studioEnabled: row.studio_enabled ?? true,
      }])
    ));
    setImageModelCoinDrafts(Object.fromEntries(
      next.imageModelRates.map((row) => [row.id, String(row.coinCostPerImage)])
    ));
    setRuntimeDrafts(Object.fromEntries(
      next.runtimeSettings.map((row) => [row.key, { enabled: row.enabled, value: storedValueToEditorValue(row.key, row.value) }])
    ));
  }

  function startNewTopupDraft() {
    setIsCreatingTopup(true);
    setSelectedTopupRecordId(null);
    setTopupEditor(defaultTopupEditor(selectedTopupMarket));
  }

  function updateTopupCoinAmount(value: string) {
    const nextCoinAmount = Number(value);

    setTopupEditor((current) => {
      const coinAmount = Number.isFinite(nextCoinAmount) ? nextCoinAmount : 0;
      const nextName = !current.name.trim() || isGeneratedPackName(current.name)
        ? (coinAmount > 0 ? buildGeneratedPackName(coinAmount) : '')
        : current.name;

      return {
        ...current,
        coinAmount,
        name: nextName,
      };
    });
  }

  async function runMutation<T>(
    key: string,
    action: () => Promise<T>,
    onSuccess: (result: T) => void | Promise<void>,
    successMessage: string | ((result: T) => string),
    options?: { inlineFeedbackKey?: string }
  ) {
    const inlineFeedbackKey = options?.inlineFeedbackKey;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    if (inlineFeedbackKey) {
      setInlineMutationFeedback((current) => {
        const next = { ...current };
        delete next[inlineFeedbackKey];
        return next;
      });
    }
    try {
      const result = await action();
      await onSuccess(result);
      const nextMessage = typeof successMessage === 'function' ? successMessage(result) : successMessage;
      if (inlineFeedbackKey) {
        setInlineMutationFeedback((current) => ({
          ...current,
          [inlineFeedbackKey]: { status: 'success', message: nextMessage },
        }));
      } else {
        setMessage(nextMessage);
      }
    } catch (err: any) {
      const nextError = err.message || 'Something went wrong';
      if (inlineFeedbackKey) {
        setInlineMutationFeedback((current) => ({
          ...current,
          [inlineFeedbackKey]: { status: 'error', message: nextError },
        }));
      } else {
        setError(nextError);
      }
    } finally {
      setBusyKey(null);
    }
  }

  function clearInlineMutationFeedback(key: string) {
    setInlineMutationFeedback((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading pricing workspace...</div>;
  }

  if (!state) {
    return <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error || 'Failed to load pricing data.'}</div>;
  }

  const sectionMeta = findPricingNavItem(section) ?? findPricingNavItem('workshop')!;
  const isWorkshop = section === 'workshop';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <AdminPageHeader
          title={sectionMeta.label}
          description={sectionMeta.description}
          actions={
            <button
              onClick={() => void refreshState()}
              disabled={busyKey !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          }
        />
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-emerald-300/80">Display mode: 10 coins = 1 internal beat</p>
      </div>

      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      {isWorkshop && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Plans" value={String(state.plans.length)} hint="Plan families" />
            <MetricCard label="Versions" value={String(state.plans.reduce((sum, item) => sum + item.versions.length, 0))} hint="Draft + live variants" />
            <MetricCard label="Top-ups" value={String(state.topupPacks.length)} hint="Market variants" />
            <MetricCard label="Promotions" value={String(state.promotions.length)} hint="Immediate-save promos" />
          </div>

          {WORKSHOP_CARD_GROUPS.map((group) => {
            const cards = group.ids
              .map((id) => PRICING_NAV_ITEMS.find((item) => item.id === id))
              .filter((item): item is AdminNavChild => Boolean(item));
            if (cards.length === 0) return null;
            return (
              <div key={group.label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">{group.label}</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {cards.map((item) => (
                    <AdminHubCard
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      description={item.description}
                      icon={item.icon}
                      summary={item.staticSummary}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {section === 'runtime-controls' && (
      <SectionCard title="Runtime Controls" description="Use these switches to decide what people can see, buy, and experience. Each card explains what changes when it is on or off." icon={Settings2}>
        <div className="grid gap-4 lg:grid-cols-2">
          {state.runtimeSettings.map((setting) => {
            const draft = runtimeDrafts[setting.key] ?? { enabled: setting.enabled, value: setting.value ?? '' };
            return (
              <div key={setting.key} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">{setting.label}</p>
                    <p className="mt-1 text-xs text-neutral-400">{setting.description}</p>
                  </div>
                  <AdminToggle
                    checked={draft.enabled}
                    onToggle={() => setRuntimeDrafts((current) => ({ ...current, [setting.key]: { ...draft, enabled: !draft.enabled } }))}
                    ariaLabel={setting.label}
                  />
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    {draft.enabled ? 'What this means right now' : 'What happens while this is off'}
                  </p>
                  <p className="mt-2 text-sm text-neutral-200">
                    {draft.enabled ? setting.enabledHelp : setting.disabledHelp}
                  </p>
                </div>

                {setting.kind !== 'boolean' && (
                  <div className="mt-4 flex items-center gap-3">
                    <input
                      type={setting.kind === 'integer' ? 'number' : 'text'}
                      step={setting.kind === 'integer' ? (isCoinRuntimeSettingKey(setting.key) ? 10 : 1) : undefined}
                      value={draft.value}
                      onChange={(event) => setRuntimeDrafts((current) => ({
                        ...current,
                        [setting.key]: { ...draft, value: event.target.value },
                      }))}
                      className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
                    />
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                    If this is off, Kissago uses: {formatRuntimeDefaultValue(setting.key, setting.defaultValue, setting.defaultEnabled)}
                  </p>
                  <ActionButton
                    busy={busyKey === `runtime:${setting.key}`}
                    label="Save"
                    icon={Save}
                    onClick={() => void runMutation(
                      `runtime:${setting.key}`,
                      () => updatePricingRuntimeSettings([{
                        key: setting.key,
                        enabled: draft.enabled,
                        value: setting.kind === 'boolean' ? undefined : editorValueToStoredValue(setting.key, draft.value),
                      }]),
                      (next) => {
                        setRuntimeDrafts(Object.fromEntries(next.map((row) => [row.key, { enabled: row.enabled, value: storedValueToEditorValue(row.key, row.value) }])));
                        setState((current) => current ? { ...current, runtimeSettings: next } : current);
                      },
                      `${setting.label} saved`
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
      )}

      {section === 'plans' && (
      <SectionCard title="Plans" description="Draft and publish plan variants by market and billing interval." icon={CreditCard}>
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-4 rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <SelectField label="Plan">
              <FilterDropdown
                fullWidth
                size="form"
                value={selectedPlanKey}
                options={PLAN_KEYS.map((key) => ({ value: key, label: key }))}
                onChange={(value) => setSelectedPlanKey(value as PlanKey)}
                ariaLabel="Plan"
              />
            </SelectField>
            <SelectField label="Market">
              <FilterDropdown
                fullWidth
                size="form"
                value={selectedPlanMarket}
                options={PRICING_MARKET_KEYS.map((key) => ({ value: key, label: key }))}
                onChange={(value) => setSelectedPlanMarket(value as PricingMarketKey)}
                ariaLabel="Market"
              />
            </SelectField>
            <SelectField label="Interval">
              <FilterDropdown
                fullWidth
                size="form"
                value={selectedPlanInterval}
                options={BILLING_INTERVALS.map((value) => ({ value, label: value }))}
                onChange={(value) => setSelectedPlanInterval(value as BillingInterval)}
                ariaLabel="Interval"
              />
            </SelectField>
            <VariantStatus title="Draft" value={formatPlanVariantValue(currentPlanDraft)} />
            <VariantStatus title="Published" value={formatPlanVariantValue(currentPlanPublished)} />
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField label="Name"><input value={planEditor.name} onChange={(event) => setPlanEditor((current) => ({ ...current, name: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Tier Rank"><input type="number" value={planEditor.tierRank} onChange={(event) => setPlanEditor((current) => ({ ...current, tierRank: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Price (minor units)"><input type="number" value={planEditor.priceMinor} onChange={(event) => setPlanEditor((current) => ({ ...current, priceMinor: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label={selectedPlanKey === 'free' ? 'Monthly Included Coins (policy-managed)' : 'Monthly Included Coins'}>
                <input
                  type="number"
                  step="10"
                  value={planEditor.monthlyIncludedCoins}
                  disabled={selectedPlanKey === 'free'}
                  title={selectedPlanKey === 'free' ? 'Free accounts use the one-time welcome policy.' : undefined}
                  onChange={(event) => setPlanEditor((current) => ({ ...current, monthlyIncludedCoins: Number(event.target.value) || 0 }))}
                  className={`${INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                />
              </InputField>
              <InputField label="Story Length Cap"><input type="number" value={planEditor.storyLengthCap} onChange={(event) => setPlanEditor((current) => ({ ...current, storyLengthCap: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Grace Period Days"><input type="number" value={planEditor.gracePeriodDays} onChange={(event) => setPlanEditor((current) => ({ ...current, gracePeriodDays: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Carry Forward Cap Multiplier"><input type="number" step="0.1" value={planEditor.carryForwardCapMultiplier} onChange={(event) => setPlanEditor((current) => ({ ...current, carryForwardCapMultiplier: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <SelectField label="Provider">
                <FilterDropdown
                  fullWidth
                  size="form"
                  value={planEditor.provider}
                  options={[{ value: '', label: 'None' }, ...BILLING_PROVIDERS.map((provider) => ({ value: provider, label: provider }))]}
                  onChange={(value) => setPlanEditor((current) => ({ ...current, provider: value as BillingProvider | '' }))}
                  ariaLabel="Provider"
                />
              </SelectField>
              <InputField label="Currency"><input value={planEditor.currencyCode} onChange={(event) => setPlanEditor((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Provider Product Ref"><input value={planEditor.providerProductRef} onChange={(event) => setPlanEditor((current) => ({ ...current, providerProductRef: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Provider Price Ref"><input value={planEditor.providerPriceRef} onChange={(event) => setPlanEditor((current) => ({ ...current, providerPriceRef: event.target.value }))} className={INPUT_CLASS} /></InputField>
            </div>

            <InputField label="Description" className="mt-4">
              <textarea value={planEditor.description} onChange={(event) => setPlanEditor((current) => ({ ...current, description: event.target.value }))} rows={3} className={`${INPUT_CLASS} min-h-[88px]`} />
            </InputField>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ToggleBox label="Active" checked={planEditor.isActive} onToggle={() => setPlanEditor((current) => ({ ...current, isActive: !current.isActive }))} />
              <ToggleBox label="Public" checked={planEditor.isPublic} onToggle={() => setPlanEditor((current) => ({ ...current, isPublic: !current.isPublic }))} />
              <ToggleBox label="Creator Controls" checked={planEditor.creatorControls} onToggle={() => setPlanEditor((current) => ({ ...current, creatorControls: !current.creatorControls }))} />
              <ToggleBox label="Downloads" checked={planEditor.canAccessDownloads} onToggle={() => setPlanEditor((current) => ({ ...current, canAccessDownloads: !current.canAccessDownloads }))} />
              <ToggleBox label="Unbranded Exports" checked={planEditor.canAccessUnbrandedExports} onToggle={() => setPlanEditor((current) => ({ ...current, canAccessUnbrandedExports: !current.canAccessUnbrandedExports }))} />
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/40 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-medium text-neutral-100">Video Export Branding</h3>
                <p className="mt-1 text-xs text-neutral-400">
                  Downloads unlock export access for the plan. These controls decide vertical export size and whether the Kissago watermark is shown on landscape and vertical renders.
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Auto watermark follows the plan&apos;s Unbranded Exports entitlement: plans with unbranded exports hide it, and other plans keep it visible.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SelectField label="Vertical Resolution">
                  <FilterDropdown
                    fullWidth
                    size="form"
                    value={planEditor.videoExportVerticalResolution}
                    options={VIDEO_EXPORT_VERTICAL_RESOLUTIONS.map((value) => ({ value, label: value }))}
                    onChange={(value) => setPlanEditor((current) => ({
                      ...current,
                      videoExportVerticalResolution: value as VideoExportVerticalResolution,
                    }))}
                    ariaLabel="Vertical Resolution"
                  />
                </SelectField>

                <SelectField label="Watermark Visibility">
                  <FilterDropdown
                    fullWidth
                    size="form"
                    value={planEditor.videoExportWatermarkMode}
                    options={VIDEO_EXPORT_WATERMARK_MODES.map((value) => ({ value, label: VIDEO_EXPORT_WATERMARK_MODE_LABELS[value] }))}
                    onChange={(value) => setPlanEditor((current) => ({
                      ...current,
                      videoExportWatermarkMode: value as VideoExportWatermarkMode,
                    }))}
                    ariaLabel="Watermark Visibility"
                  />
                </SelectField>

                <SelectField label="Watermark Position">
                  <FilterDropdown
                    fullWidth
                    size="form"
                    value={planEditor.videoExportWatermarkPosition}
                    options={VIDEO_EXPORT_WATERMARK_POSITIONS.map((value) => ({ value, label: VIDEO_EXPORT_WATERMARK_POSITION_LABELS[value] }))}
                    onChange={(value) => setPlanEditor((current) => ({
                      ...current,
                      videoExportWatermarkPosition: value as VideoExportWatermarkPosition,
                    }))}
                    ariaLabel="Watermark Position"
                  />
                </SelectField>

                <SelectField label="Watermark Size">
                  <FilterDropdown
                    fullWidth
                    size="form"
                    value={planEditor.videoExportWatermarkSize}
                    options={VIDEO_EXPORT_WATERMARK_SIZES.map((value) => ({ value, label: VIDEO_EXPORT_WATERMARK_SIZE_LABELS[value] }))}
                    onChange={(value) => setPlanEditor((current) => ({
                      ...current,
                      videoExportWatermarkSize: value as VideoExportWatermarkSize,
                    }))}
                    ariaLabel="Watermark Size"
                  />
                </SelectField>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <ActionButton
                busy={busyKey === 'plan:save'}
                label="Save Draft"
                icon={Save}
                onClick={() => void runMutation(
                  'plan:save',
                  () => savePricingPlanDraft({
                    planKey: selectedPlanKey,
                    name: planEditor.name,
                    tierRank: planEditor.tierRank,
                    isActive: planEditor.isActive,
                    isPublic: planEditor.isPublic,
                    description: planEditor.description,
                    featureFlags: {
                      canAccessDownloads: planEditor.canAccessDownloads,
                      canAccessUnbrandedExports: planEditor.canAccessUnbrandedExports,
                      creatorControls: planEditor.creatorControls,
                      videoExportPreset: {
                        verticalResolution: planEditor.videoExportVerticalResolution,
                        watermarkMode: planEditor.videoExportWatermarkMode,
                        watermarkPosition: planEditor.videoExportWatermarkPosition,
                        watermarkSize: planEditor.videoExportWatermarkSize,
                      },
                    },
                    provider: planEditor.provider || null,
                    billingInterval: selectedPlanInterval,
                    currencyCode: planEditor.currencyCode,
                    pricingMarketKey: selectedPlanMarket,
                    priceMinor: planEditor.priceMinor,
                    monthlyIncludedBeats: coinsToBeats(planEditor.monthlyIncludedCoins),
                    carryForwardCapMultiplier: planEditor.carryForwardCapMultiplier,
                    storyLengthCap: planEditor.storyLengthCap,
                    gracePeriodDays: planEditor.gracePeriodDays,
                    providerProductRef: planEditor.providerProductRef,
                    providerPriceRef: planEditor.providerPriceRef,
                  }),
                  hydrateState,
                  `${selectedPlanKey} draft saved`
                )}
              />
              <ActionButton
                busy={busyKey === 'plan:publish'}
                disabled={!currentPlanDraft}
                label="Publish Draft"
                icon={CheckCircle}
                onClick={() => currentPlanDraft && void runMutation(
                  'plan:publish',
                  () => publishPricingPlanVersion(currentPlanDraft.id),
                  hydrateState,
                  `${selectedPlanKey} draft published`
                )}
              />
              <ActionButton
                busy={busyKey === 'plan:archive'}
                disabled={!currentPlanDraft && !currentPlanPublished}
                label="Archive Current"
                icon={Archive}
                tone="secondary"
                onClick={() => {
                  const target = currentPlanDraft ?? currentPlanPublished;
                  if (!target) return;
                  void runMutation(
                    'plan:archive',
                    () => archivePricingPlanVersion(target.id),
                    hydrateState,
                    `${selectedPlanKey} variant archived`
                  );
                }}
              />
            </div>
          </div>
        </div>
      </SectionCard>
      )}

      {section === 'top-up-packs' && (
      <SectionCard title="Top-up Packs" description="Manage one-time coin packs by market." icon={Coins}>
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-4 rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <button
              type="button"
              onClick={startNewTopupDraft}
              disabled={busyKey !== null}
              className="w-full rounded-lg border border-dashed border-white/15 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              New pack
            </button>
            <SelectField label="Pack">
              <FilterDropdown
                fullWidth
                size="form"
                value={isCreatingTopup ? 'new' : (selectedTopupRecordId ?? '')}
                options={[{ value: 'new', label: 'New pack' }, ...topupCatalogEntries.map((entry) => ({ value: entry.current.id, label: entry.label }))]}
                onChange={(value) => {
                  if (value === 'new') {
                    startNewTopupDraft();
                    return;
                  }

                  setIsCreatingTopup(false);
                  setSelectedTopupRecordId(value);
                }}
                ariaLabel="Pack"
              />
            </SelectField>
            <SelectField label="Market">
              <FilterDropdown
                fullWidth
                size="form"
                value={selectedTopupMarket}
                options={PRICING_MARKET_KEYS.map((key) => ({ value: key, label: key }))}
                onChange={(value) => setSelectedTopupMarket(value as PricingMarketKey)}
                ariaLabel="Market"
              />
            </SelectField>
            <VariantStatus title="Draft" value={formatTopupVariantValue(currentTopupDraft)} />
            <VariantStatus title="Published" value={formatTopupVariantValue(currentTopupPublished)} />
            <ActionButton
              busy={busyKey === `topup:legacy:${selectedTopupMarket}`}
              disabled={!hasLegacyTopupPacks}
              label="Archive Legacy Packs"
              icon={Archive}
              tone="secondary"
              onClick={() => void runMutation(
                `topup:legacy:${selectedTopupMarket}`,
                () => archiveLegacyTopupPacks(selectedTopupMarket),
                (result) => {
                  hydrateState(result.state);
                  setIsCreatingTopup(false);
                },
                (result) => result.archivedCount > 0
                  ? `Archived ${result.archivedCount} legacy pack variants for ${selectedTopupMarket}`
                  : `No legacy packs were active for ${selectedTopupMarket}`
              )}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField label="Name"><input value={topupEditor.name} onChange={(event) => setTopupEditor((current) => ({ ...current, name: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <SelectField label="Provider">
                <FilterDropdown
                  fullWidth
                  size="form"
                  value={topupEditor.provider}
                  options={BILLING_PROVIDERS.map((provider) => ({ value: provider, label: provider }))}
                  onChange={(value) => setTopupEditor((current) => ({ ...current, provider: value as BillingProvider }))}
                  ariaLabel="Provider"
                />
              </SelectField>
              <InputField label="Currency"><input value={topupEditor.currencyCode} onChange={(event) => setTopupEditor((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Price (minor units)"><input type="number" value={topupEditor.priceMinor} onChange={(event) => setTopupEditor((current) => ({ ...current, priceMinor: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Coin Amount"><input type="number" min="0" step="10" value={topupEditor.coinAmount} onChange={(event) => updateTopupCoinAmount(event.target.value)} className={INPUT_CLASS} /></InputField>
              <InputField label="Provider Product Ref"><input value={topupEditor.providerProductRef} onChange={(event) => setTopupEditor((current) => ({ ...current, providerProductRef: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Provider Price Ref"><input value={topupEditor.providerPriceRef} onChange={(event) => setTopupEditor((current) => ({ ...current, providerPriceRef: event.target.value }))} className={INPUT_CLASS} /></InputField>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <ActionButton
                busy={busyKey === 'topup:save'}
                label="Save Draft"
                icon={Save}
                onClick={() => void runMutation(
                  'topup:save',
                  () => savePricingTopupDraft({
                    topupId: topupEditor.topupId,
                    packKey: topupEditor.packKey,
                    name: topupEditor.name,
                    provider: topupEditor.provider,
                    currencyCode: topupEditor.currencyCode,
                    pricingMarketKey: selectedTopupMarket,
                    priceMinor: topupEditor.priceMinor,
                    beatAmount: coinAmountToWholeBeats(topupEditor.coinAmount, 'Coin amount'),
                    providerProductRef: topupEditor.providerProductRef,
                    providerPriceRef: topupEditor.providerPriceRef,
                  }),
                  (result) => {
                    hydrateState(result.state);
                    setIsCreatingTopup(false);
                    setSelectedTopupRecordId(result.topupId);
                  },
                  'Top-up draft saved'
                )}
              />
              <ActionButton
                busy={busyKey === 'topup:publish'}
                disabled={!currentTopupDraft}
                label="Publish Draft"
                icon={CheckCircle}
                onClick={() => currentTopupDraft && void runMutation(
                  'topup:publish',
                  () => publishPricingTopupPack(currentTopupDraft.id),
                  hydrateState,
                  'Top-up draft published'
                )}
              />
              <ActionButton
                busy={busyKey === 'topup:archive'}
                disabled={!currentTopupDraft && !currentTopupPublished}
                label="Archive Current"
                icon={Archive}
                tone="secondary"
                onClick={() => {
                  const target = currentTopupDraft ?? currentTopupPublished;
                  if (!target) return;
                  void runMutation(
                    'topup:archive',
                    () => archivePricingTopupPack(target.id),
                    hydrateState,
                    'Top-up variant archived'
                  );
                }}
              />
            </div>
          </div>
        </div>
      </SectionCard>
      )}

      {section === 'action-costs' && (
      <SectionCard
        title="Metering and Entitlements"
        description="The authoritative coin rate and tier gate for every costly operation."
        icon={Sparkles}
      >
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Plan access and wallet balance are separate checks. Coins never unlock a disabled tier. Image generation uses the selected image model rate; this row controls its tier access.
        </div>
        <div className="space-y-8">
          {groupedActionCosts.map((contentSection) => (
            <section key={contentSection.id} className="rounded-2xl border border-white/10 bg-neutral-950/35 p-5">
              <div className="border-b border-white/10 pb-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-300/80">
                  {contentSection.title}
                </p>
                <p className="mt-1 text-sm text-neutral-400">{contentSection.description}</p>
              </div>
              <div className="mt-5 space-y-6">
                {contentSection.operationGroups.map((operationGroup) => (
                  <div key={operationGroup.id}>
                    <div className="mb-3 flex items-center gap-2">
                      <h3 className="text-sm font-medium text-neutral-200">{operationGroup.title}</h3>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-neutral-500">
                        {operationGroup.actions.length}
                      </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {operationGroup.actions.map((action) => {
            const feedbackKey = `action:${action.action_key}`;
            const feedback = inlineMutationFeedback[feedbackKey];
            const draft = actionCostDrafts[action.action_key] ?? {
              coinCost: String(beatsToCoins(action.beat_cost)),
              isActive: action.is_active,
              freeEnabled: action.free_enabled ?? true,
              plusEnabled: action.plus_enabled ?? true,
              studioEnabled: action.studio_enabled ?? true,
            };
            const rateStrategy = typeof action.metadata_json?.rateStrategy === 'string'
              ? action.metadata_json.rateStrategy
              : null;
            return (
              <div key={action.id} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">
                      {action.display_name || action.action_key}
                    </p>
                    <p className="mt-1 break-all text-xs text-neutral-500">{action.action_key}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
                    {action.cost_family || 'other'} · {action.billing_unit || 'operation'}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.coinCost}
                    onChange={(event) => {
                      clearInlineMutationFeedback(feedbackKey);
                      setActionCostDrafts((current) => ({
                        ...current,
                        [action.action_key]: { ...draft, coinCost: event.target.value },
                      }));
                    }}
                    disabled={rateStrategy === 'image_model_registry'}
                    className="w-28 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="text-xs text-neutral-500">
                    {rateStrategy === 'image_model_registry' ? 'model-priced' : 'coins'}
                  </span>
                  <AdminToggle
                    checked={draft.isActive}
                    onToggle={() => {
                      clearInlineMutationFeedback(feedbackKey);
                      setActionCostDrafts((current) => ({
                        ...current,
                        [action.action_key]: { ...draft, isActive: !draft.isActive },
                      }));
                    }}
                    ariaLabel={`Toggle ${action.action_key}`}
                  />
                  <span className="text-xs text-neutral-500">{draft.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {([
                    ['freeEnabled', 'Free'],
                    ['plusEnabled', 'Plus'],
                    ['studioEnabled', 'Studio'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-neutral-950/50 px-2.5 py-2">
                      <span className="text-xs text-neutral-400">{label}</span>
                      <AdminToggle
                        checked={draft[key]}
                        onToggle={() => {
                          clearInlineMutationFeedback(feedbackKey);
                          setActionCostDrafts((current) => ({
                            ...current,
                            [action.action_key]: { ...draft, [key]: !draft[key] },
                          }));
                        }}
                        ariaLabel={`Allow ${action.action_key} for ${label}`}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <ActionButton
                    busy={busyKey === feedbackKey}
                    label="Save Cost"
                    icon={Save}
                    onClick={() => void runMutation(
                      feedbackKey,
                      () => {
                        const coinCost = parseActionCoinCost(draft.coinCost);
                        return savePricingActionCost({
                          actionKey: action.action_key,
                          beatCost: coinsToActionBeats(coinCost),
                          isActive: draft.isActive,
                          displayName: action.display_name,
                          costFamily: action.cost_family,
                          billingUnit: action.billing_unit,
                          freeEnabled: draft.freeEnabled,
                          plusEnabled: draft.plusEnabled,
                          studioEnabled: draft.studioEnabled,
                          metadata: action.metadata_json,
                          effectiveFrom: action.effective_from,
                          effectiveTo: action.effective_to,
                        });
                      },
                      hydrateState,
                      'Saved',
                      { inlineFeedbackKey: feedbackKey }
                    )}
                  />
                  {feedback && (
                    <span
                      role="status"
                      aria-live="polite"
                      className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${
                        feedback.status === 'success' ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {feedback.status === 'success' && <CheckCircle size={14} className="shrink-0" />}
                      <span className="break-words">{feedback.message}</span>
                    </span>
                  )}
                </div>
              </div>
            );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-white/10 bg-neutral-900/50 p-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-neutral-100">Image model rate overrides</h3>
            <p className="mt-1 text-xs text-neutral-500">
              These per-image rates are consumed by the same coin-economy gateway and override the zero-cost image entitlement row above.
            </p>
          </div>
          <div className="space-y-5">
            {groupedImageModelRates.map((modelGroup) => (
              <div key={modelGroup.id}>
                <div className="mb-3">
                  <h4 className="text-sm font-medium text-neutral-200">{modelGroup.title}</h4>
                  <p className="mt-1 text-xs text-neutral-500">{modelGroup.description}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {modelGroup.models.map((model) => {
              const feedbackKey = `image-rate:${model.id}`;
              const feedback = inlineMutationFeedback[feedbackKey];
              const value = imageModelCoinDrafts[model.id] ?? String(model.coinCostPerImage);
              return (
                <div key={model.id} className="rounded-xl border border-white/10 bg-neutral-950/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-neutral-200">{model.displayName}</p>
                      <p className="mt-1 truncate text-xs text-neutral-500">{model.taskKey} · {model.providerKey}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      model.isEnabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-neutral-500'
                    }`}>
                      {model.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={value}
                      onChange={(event) => {
                        clearInlineMutationFeedback(feedbackKey);
                        setImageModelCoinDrafts((current) => ({
                          ...current,
                          [model.id]: event.target.value,
                        }));
                      }}
                      className="w-28 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
                    />
                    <span className="text-xs text-neutral-500">coins / image</span>
                    <ActionButton
                      busy={busyKey === feedbackKey}
                      label="Save"
                      icon={Save}
                      onClick={() => void runMutation(
                        feedbackKey,
                        async () => {
                          const coinCostPerImage = parseActionCoinCost(value);
                          await saveAdminImageModelRegistryRecord({
                            id: model.id,
                            coinCostPerImage,
                          });
                          return getPricingAdminState();
                        },
                        hydrateState,
                        'Saved',
                        { inlineFeedbackKey: feedbackKey }
                      )}
                    />
                    {feedback && (
                      <span
                        role="status"
                        aria-live="polite"
                        className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${
                          feedback.status === 'success' ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {feedback.status === 'success' && <CheckCircle size={14} className="shrink-0" />}
                        <span className="break-words">{feedback.message}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
      )}

      {section === 'promotions' && (
      <SectionCard title="Promotions" description="Immediate-save promotions for campaign and event windows." icon={Megaphone}>
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Promotions are immediate-save in v1. Plans and top-ups keep draft/publish safety, but promos update the live row directly.
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3 rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <button onClick={() => setPromotionEditor(defaultPromotionEditor())} className="w-full rounded-lg border border-dashed border-white/15 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5">
              New Promotion
            </button>
            {state.promotions.map((promo) => (
              <button
                key={promo.id}
                onClick={() => setPromotionEditor(buildPromotionEditor(promo))}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${promotionEditor.id === promo.id ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-neutral-950/40 hover:bg-white/5'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-neutral-100">{promo.name}</p>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">{promo.status}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{promo.promo_key}</p>
                <p className="mt-2 text-xs text-neutral-400">{promo.pricing_market_scope} · {formatWholeNumber(beatsToCoins(promo.bonus_beats))} coins</p>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField label="Promo Key"><input value={promotionEditor.promoKey} onChange={(event) => setPromotionEditor((current) => ({ ...current, promoKey: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Name"><input value={promotionEditor.name} onChange={(event) => setPromotionEditor((current) => ({ ...current, name: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <SelectField label="Status">
                <FilterDropdown
                  fullWidth
                  size="form"
                  value={promotionEditor.status}
                  options={[{ value: 'published', label: 'published' }, { value: 'archived', label: 'archived' }]}
                  onChange={(value) => setPromotionEditor((current) => ({ ...current, status: value as PricingCatalogStatus }))}
                  ariaLabel="Status"
                />
              </SelectField>
              <SelectField label="Market Scope">
                <FilterDropdown
                  fullWidth
                  size="form"
                  value={promotionEditor.pricingMarketScope}
                  options={PROMOTION_MARKET_SCOPES.map((scope) => ({ value: scope, label: scope }))}
                  onChange={(value) => setPromotionEditor((current) => ({ ...current, pricingMarketScope: value as PromotionMarketScope }))}
                  ariaLabel="Market Scope"
                />
              </SelectField>
              <SelectField label="Target Plan">
                <FilterDropdown
                  fullWidth
                  size="form"
                  value={promotionEditor.targetPlanKey}
                  options={[{ value: '', label: 'All plans' }, ...PLAN_KEYS.map((planKey) => ({ value: planKey, label: planKey }))]}
                  onChange={(value) => setPromotionEditor((current) => ({ ...current, targetPlanKey: value as PlanKey | '' }))}
                  ariaLabel="Target Plan"
                />
              </SelectField>
              <InputField label="Target User Segment"><input value={promotionEditor.targetUserSegment} onChange={(event) => setPromotionEditor((current) => ({ ...current, targetUserSegment: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Bonus Coins"><input type="number" step="10" value={promotionEditor.bonusCoins} onChange={(event) => setPromotionEditor((current) => ({ ...current, bonusCoins: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Starts At"><input type="datetime-local" value={promotionEditor.startsAt} onChange={(event) => setPromotionEditor((current) => ({ ...current, startsAt: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Ends At"><input type="datetime-local" value={promotionEditor.endsAt} onChange={(event) => setPromotionEditor((current) => ({ ...current, endsAt: event.target.value }))} className={INPUT_CLASS} /></InputField>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <ActionButton
                busy={busyKey === 'promotion:save'}
                label="Save Promotion"
                icon={Save}
                onClick={() => void runMutation(
                  'promotion:save',
                  () => savePricingPromotion({
                    promoKey: promotionEditor.promoKey,
                    name: promotionEditor.name,
                    status: promotionEditor.status,
                    pricingMarketScope: promotionEditor.pricingMarketScope,
                    targetPlanKey: promotionEditor.targetPlanKey || null,
                    targetUserSegment: promotionEditor.targetUserSegment,
                    bonusBeats: coinsToBeats(promotionEditor.bonusCoins),
                    startsAt: fromLocalDateTimeValue(promotionEditor.startsAt),
                    endsAt: fromLocalDateTimeValue(promotionEditor.endsAt),
                  }),
                  hydrateState,
                  `${promotionEditor.name || promotionEditor.promoKey} saved`
                )}
              />
              <ActionButton
                busy={busyKey === 'promotion:archive'}
                disabled={!promotionEditor.id}
                label="Archive Promotion"
                icon={Archive}
                tone="secondary"
                onClick={() => {
                  const promotionId = promotionEditor.id;
                  if (!promotionId) return;
                  void runMutation(
                    'promotion:archive',
                    () => archivePricingPromotion(promotionId),
                    (next) => {
                      hydrateState(next);
                      setPromotionEditor(defaultPromotionEditor());
                    },
                    'Promotion archived'
                  );
                }}
              />
            </div>
          </div>
        </div>
      </SectionCard>
      )}

      {section === 'recovery-tools' && (
      <SectionCard
        title="Recovery Tools"
        description="Use these only during internal testing when a payment or wallet event needs a manual nudge."
        icon={Wrench}
      >
        <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          These tools are here to help stage testing. They do not change your pricing catalog. They only help a user wallet catch up when checkout or webhook events need manual support.
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <p className="text-sm font-medium text-neutral-100">Reconcile a Razorpay subscription</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Use this when a monthly plan payment succeeded, but the plan or refill is not showing up in the user wallet yet.
            </p>
            <div className="mt-4 grid gap-3">
              <InputField label="Razorpay Subscription ID">
                <input
                  value={recoveryDrafts.subscriptionId}
                  onChange={(event) => setRecoveryDrafts((current) => ({ ...current, subscriptionId: event.target.value }))}
                  placeholder="sub_..."
                  className={INPUT_CLASS}
                />
              </InputField>
              <InputField label="Or Billing Order ID">
                <input
                  value={recoveryDrafts.subscriptionBillingOrderId}
                  onChange={(event) => setRecoveryDrafts((current) => ({ ...current, subscriptionBillingOrderId: event.target.value }))}
                  placeholder="Internal billing order id"
                  className={INPUT_CLASS}
                />
              </InputField>
            </div>
            <div className="mt-4">
              <ActionButton
                busy={busyKey === 'recovery:subscription'}
                label="Refresh subscription"
                icon={RotateCcw}
                onClick={() => void runMutation(
                  'recovery:subscription',
                  () => reconcilePricingSubscription({
                    providerSubscriptionId: recoveryDrafts.subscriptionId,
                    billingOrderId: recoveryDrafts.subscriptionBillingOrderId,
                  }),
                  () => {},
                  (result) => {
                    const granted = result.grantedCoins > 0
                      ? ` and granted ${formatWholeNumber(result.grantedCoins)} coins`
                      : '';
                    return `Subscription ${result.providerSubscriptionId} is now ${result.subscriptionStatus}${granted}.`;
                  }
                )}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <p className="text-sm font-medium text-neutral-100">Reconcile a coin-pack payment</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Use this when a top-up payment succeeded, but the purchased coins did not appear in the wallet.
            </p>
            <div className="mt-4 grid gap-3">
              <InputField label="Billing Order ID">
                <input
                  value={recoveryDrafts.topupBillingOrderId}
                  onChange={(event) => setRecoveryDrafts((current) => ({ ...current, topupBillingOrderId: event.target.value }))}
                  placeholder="Internal billing order id"
                  className={INPUT_CLASS}
                />
              </InputField>
              <InputField label="Razorpay Payment ID">
                <input
                  value={recoveryDrafts.topupPaymentId}
                  onChange={(event) => setRecoveryDrafts((current) => ({ ...current, topupPaymentId: event.target.value }))}
                  placeholder="pay_..."
                  className={INPUT_CLASS}
                />
              </InputField>
            </div>
            <div className="mt-4">
              <ActionButton
                busy={busyKey === 'recovery:topup'}
                label="Add missing coins"
                icon={RotateCcw}
                onClick={() => void runMutation(
                  'recovery:topup',
                  () => reconcilePricingTopup({
                    billingOrderId: recoveryDrafts.topupBillingOrderId,
                    razorpayPaymentId: recoveryDrafts.topupPaymentId,
                  }),
                  () => {},
                  (result) => `Top-up ${result.billingOrderId} is synced. ${formatWholeNumber(result.grantedCoins)} coins were added to the wallet.`
                )}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <p className="text-sm font-medium text-neutral-100">Ensure free welcome coins</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Use this only when a free account should have received its one-time welcome coins, but the wallet has not picked them up yet.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px]">
              <InputField label="User ID">
                <input
                  value={recoveryDrafts.freeGrantUserId}
                  onChange={(event) => setRecoveryDrafts((current) => ({ ...current, freeGrantUserId: event.target.value }))}
                  placeholder="User UUID"
                  className={INPUT_CLASS}
                />
              </InputField>
              <SelectField label="Market">
                <FilterDropdown
                  fullWidth
                  size="form"
                  value={recoveryDrafts.freeGrantMarket}
                  options={PRICING_MARKET_KEYS.map((market) => ({ value: market, label: market }))}
                  onChange={(value) => setRecoveryDrafts((current) => ({ ...current, freeGrantMarket: value as PricingMarketKey }))}
                  ariaLabel="Market"
                />
              </SelectField>
            </div>
            <div className="mt-4">
              <ActionButton
                busy={busyKey === 'recovery:free-grant'}
                label="Ensure welcome grant"
                icon={RotateCcw}
                onClick={() => void runMutation(
                  'recovery:free-grant',
                  () => ensureUserFreeWelcomeGrant({
                    userId: recoveryDrafts.freeGrantUserId,
                    pricingMarketKey: recoveryDrafts.freeGrantMarket,
                  }),
                  () => {},
                  (result) => result.granted
                    ? `A one-time welcome grant of ${formatWholeNumber(result.grantedCoins)} coins was added.`
                    : 'This user already received a free-account grant, or the welcome policy is paused.'
                )}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <p className="text-sm font-medium text-neutral-100">Release stale coin holds</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Use this when an interrupted test left coins in a temporary hold and you want Kissago to clear old holds right away.
            </p>
            <div className="mt-6">
              <ActionButton
                busy={busyKey === 'recovery:expire'}
                label="Release old holds"
                icon={RotateCcw}
                onClick={() => void runMutation(
                  'recovery:expire',
                  () => expirePricingReservations(),
                  () => {},
                  (result) => result.expiredCount > 0
                    ? `${result.expiredCount} stale coin holds were released.`
                    : 'No stale coin holds needed to be released.'
                )}
              />
            </div>
          </div>
        </div>
      </SectionCard>
      )}

    </div>
  );
}

function buildPlanEditor(
  state: PricingAdminState,
  planKey: PlanKey,
  market: PricingMarketKey,
  interval: BillingInterval
): PlanEditorState {
  const record = state.plans.find((item) => item.plan.plan_key === planKey);
  const draft = record?.versions.find((version) =>
    version.status === 'draft' &&
    version.pricing_market_key === market &&
    version.billing_interval === interval
  );
  const published = record?.versions.find((version) =>
    version.status === 'published' &&
    version.pricing_market_key === market &&
    version.billing_interval === interval
  );
  const source = draft ?? published;
  const fallback = defaultPlanEditor(planKey, market);
  const videoExportPreset = normalizeVideoExportPreset(record?.plan.feature_flags_json?.videoExportPreset);

  return {
    name: record?.plan.name ?? fallback.name,
    tierRank: record?.plan.tier_rank ?? fallback.tierRank,
    isActive: record?.plan.is_active ?? fallback.isActive,
    isPublic: record?.plan.is_public ?? fallback.isPublic,
    description: record?.plan.description ?? fallback.description,
    canAccessDownloads: Boolean(record?.plan.feature_flags_json?.canAccessDownloads ?? fallback.canAccessDownloads),
    canAccessUnbrandedExports: Boolean(record?.plan.feature_flags_json?.canAccessUnbrandedExports ?? fallback.canAccessUnbrandedExports),
    creatorControls: Boolean(record?.plan.feature_flags_json?.creatorControls ?? fallback.creatorControls),
    videoExportVerticalResolution: videoExportPreset.verticalResolution,
    videoExportWatermarkMode: videoExportPreset.watermarkMode,
    videoExportWatermarkPosition: videoExportPreset.watermarkPosition,
    videoExportWatermarkSize: videoExportPreset.watermarkSize,
    provider: (source?.provider ?? fallback.provider) as BillingProvider | '',
    currencyCode: source?.currency_code ?? fallback.currencyCode,
    priceMinor: source?.price_minor ?? fallback.priceMinor,
    monthlyIncludedCoins: source ? beatsToCoins(source.monthly_included_beats) : fallback.monthlyIncludedCoins,
    carryForwardCapMultiplier: source?.carry_forward_cap_multiplier ?? fallback.carryForwardCapMultiplier,
    storyLengthCap: source?.story_length_cap ?? fallback.storyLengthCap,
    gracePeriodDays: source?.grace_period_days ?? fallback.gracePeriodDays,
    providerProductRef: source?.provider_product_ref ?? '',
    providerPriceRef: source?.provider_price_ref ?? '',
  };
}

function buildTopupEditor(
  entry: TopupCatalogEntry | null,
  market: PricingMarketKey
): TopupEditorState {
  const source = entry?.draft ?? entry?.published ?? null;
  const fallback = defaultTopupEditor(market);

  return {
    topupId: entry?.draft?.id ?? null,
    packKey: entry?.packKey ?? null,
    name: source ? normalizePackName(source.name, source.beat_amount) : fallback.name,
    provider: (source?.provider ?? fallback.provider) as BillingProvider,
    currencyCode: source?.currency_code ?? fallback.currencyCode,
    priceMinor: source?.price_minor ?? fallback.priceMinor,
    coinAmount: source ? beatsToCoins(source.beat_amount) : fallback.coinAmount,
    providerProductRef: source?.provider_product_ref ?? '',
    providerPriceRef: source?.provider_price_ref ?? '',
  };
}

function buildPromotionEditor(promotion: DbPricingPromotion): PromotionEditorState {
  return {
    id: promotion.id,
    promoKey: promotion.promo_key,
    name: promotion.name,
    status: promotion.status,
    pricingMarketScope: promotion.pricing_market_scope,
    targetPlanKey: promotion.target_plan_key ?? '',
    targetUserSegment: promotion.target_user_segment ?? '',
    bonusCoins: beatsToCoins(promotion.bonus_beats),
    startsAt: toLocalDateTimeValue(promotion.starts_at),
    endsAt: toLocalDateTimeValue(promotion.ends_at),
  };
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl text-neutral-100">{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{hint}</p>
    </div>
  );
}

function SelectField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function InputField({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function ToggleBox({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-colors ${checked ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-neutral-950/40 text-neutral-300'}`}>
      {label}
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full ${checked ? 'bg-emerald-500' : 'bg-neutral-700'}`}>
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function VariantStatus({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950/40 p-3">
      <p className="text-xs uppercase tracking-wider text-neutral-500">{title}</p>
      <p className="mt-1 text-sm text-neutral-100">{value}</p>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  icon: Icon,
  busy = false,
  disabled = false,
  tone = 'primary',
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'secondary';
}) {
  const className = tone === 'primary'
    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
    : 'border border-white/10 bg-neutral-900/60 text-neutral-200 hover:bg-white/10';
  return (
    <button onClick={onClick} disabled={disabled || busy} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${className}`}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {label}
    </button>
  );
}
