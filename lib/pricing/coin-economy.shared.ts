import {
  COINS_PER_BEAT,
  type PlanKey,
  type PricingActionKey,
  type PricingCostFamily,
} from '@/lib/types/pricing';
import type { DbPricingActionCost } from '@/lib/types/database';

export interface CoinEconomyComponentInput {
  meterKey: PricingActionKey;
  quantity?: number;
  unitBeatCostOverride?: number;
  metadata?: Record<string, unknown>;
}

export interface CoinEconomyQuoteComponent {
  meterKey: PricingActionKey;
  displayName: string;
  costFamily: PricingCostFamily;
  billingUnit: string;
  quantity: number;
  unitBeatCost: number;
  unitCoinCost: number;
  totalBeatCost: number;
  totalCoinCost: number;
  metadata: Record<string, unknown>;
}

export type CoinEconomyQuoteDeniedReason =
  | 'tier_locked'
  | 'feature_disabled'
  | 'pricing_unavailable';

export interface CoinEconomyQuote {
  operationKey: PricingActionKey;
  planKey: PlanKey;
  allowed: boolean;
  deniedReason: CoinEconomyQuoteDeniedReason | null;
  deniedMeterKey: PricingActionKey | null;
  components: CoinEconomyQuoteComponent[];
  totalBeatCost: number;
  totalCoinCost: number;
}

type MeterFallback = Pick<
  DbPricingActionCost,
  | 'action_key'
  | 'beat_cost'
  | 'is_active'
  | 'display_name'
  | 'cost_family'
  | 'billing_unit'
  | 'free_enabled'
  | 'plus_enabled'
  | 'studio_enabled'
  | 'metadata_json'
>;

const DEFAULT_METER_POLICIES: Partial<Record<PricingActionKey, MeterFallback>> = {
  image_generation: {
    action_key: 'image_generation',
    beat_cost: 0,
    is_active: true,
    display_name: 'AI image generation',
    cost_family: 'image',
    billing_unit: 'image',
    free_enabled: false,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: { rateStrategy: 'image_model_registry' },
  },
  generate_story_narration: {
    action_key: 'generate_story_narration',
    beat_cost: 1,
    is_active: true,
    display_name: 'Story narration',
    cost_family: 'tts',
    billing_unit: 'narration',
    free_enabled: true,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: {},
  },
  generate_reel_narration: {
    action_key: 'generate_reel_narration',
    beat_cost: 1,
    is_active: true,
    display_name: 'Reel narration',
    cost_family: 'tts',
    billing_unit: 'narration',
    free_enabled: true,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: {},
  },
  generate_narration_preview: {
    action_key: 'generate_narration_preview',
    beat_cost: 0.5,
    is_active: true,
    display_name: 'Narration preview',
    cost_family: 'tts',
    billing_unit: 'preview',
    free_enabled: true,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: {},
  },
  align_story_text_overlay: {
    action_key: 'align_story_text_overlay',
    beat_cost: 0.5,
    is_active: true,
    display_name: 'Text/audio alignment',
    cost_family: 'alignment',
    billing_unit: 'alignment',
    free_enabled: true,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: {},
  },
  export_video_sd: {
    action_key: 'export_video_sd',
    beat_cost: 2,
    is_active: true,
    display_name: 'Export SD video',
    cost_family: 'export',
    billing_unit: 'export',
    free_enabled: true,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: { quality: 'sd' },
  },
  export_video_hd: {
    action_key: 'export_video_hd',
    beat_cost: 3,
    is_active: true,
    display_name: 'Export HD video',
    cost_family: 'export',
    billing_unit: 'export',
    free_enabled: false,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: { quality: 'hd' },
  },
};

function roundBeatCost(value: number): number {
  return Number(value.toFixed(2));
}

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

function isTierEnabled(policy: MeterFallback, planKey: PlanKey): boolean {
  if (planKey === 'studio') return policy.studio_enabled;
  if (planKey === 'plus') return policy.plus_enabled;
  return policy.free_enabled;
}

function normalizePolicy(row: DbPricingActionCost | MeterFallback): MeterFallback {
  return {
    action_key: row.action_key,
    beat_cost: Number(row.beat_cost ?? 0),
    is_active: row.is_active !== false,
    display_name: row.display_name || String(row.action_key).replaceAll('_', ' '),
    cost_family: row.cost_family || 'other',
    billing_unit: row.billing_unit || 'operation',
    free_enabled: row.free_enabled !== false,
    plus_enabled: row.plus_enabled !== false,
    studio_enabled: row.studio_enabled !== false,
    metadata_json: row.metadata_json ?? {},
  };
}

export function buildCoinEconomyQuote(input: {
  operationKey: PricingActionKey;
  planKey: PlanKey;
  components: CoinEconomyComponentInput[];
  catalog: DbPricingActionCost[];
  now?: Date;
}): CoinEconomyQuote {
  const rows = new Map<string, DbPricingActionCost>(
    input.catalog.map((row) => [row.action_key, row])
  );
  const quotedComponents: CoinEconomyQuoteComponent[] = [];

  for (const requested of input.components) {
    const stored = rows.get(requested.meterKey);
    const nowMs = (input.now ?? new Date()).getTime();
    const storedIsEffective = stored
      ? new Date(stored.effective_from).getTime() <= nowMs
        && (!stored.effective_to || nowMs < new Date(stored.effective_to).getTime())
      : false;
    if (stored && !storedIsEffective) {
      return {
        operationKey: input.operationKey,
        planKey: input.planKey,
        allowed: false,
        deniedReason: 'pricing_unavailable',
        deniedMeterKey: requested.meterKey,
        components: quotedComponents,
        totalBeatCost: 0,
        totalCoinCost: 0,
      };
    }
    const fallback = DEFAULT_METER_POLICIES[requested.meterKey];
    const source = (storedIsEffective ? stored : null) ?? fallback;
    if (!source) {
      return {
        operationKey: input.operationKey,
        planKey: input.planKey,
        allowed: false,
        deniedReason: 'pricing_unavailable',
        deniedMeterKey: requested.meterKey,
        components: quotedComponents,
        totalBeatCost: 0,
        totalCoinCost: 0,
      };
    }

    const policy = normalizePolicy(source);
    const quantity = Number(requested.quantity ?? 1);
    const override = Number(requested.unitBeatCostOverride ?? NaN);
    const unitBeatCost = Number.isFinite(override)
      ? Math.max(0, roundBeatCost(override))
      : Math.max(0, roundBeatCost(Number(policy.beat_cost)));

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Coin meter ${requested.meterKey} requires a positive quantity.`);
    }

    if (!policy.is_active) {
      return {
        operationKey: input.operationKey,
        planKey: input.planKey,
        allowed: false,
        deniedReason: 'feature_disabled',
        deniedMeterKey: requested.meterKey,
        components: quotedComponents,
        totalBeatCost: 0,
        totalCoinCost: 0,
      };
    }

    if (!isTierEnabled(policy, input.planKey)) {
      return {
        operationKey: input.operationKey,
        planKey: input.planKey,
        allowed: false,
        deniedReason: 'tier_locked',
        deniedMeterKey: requested.meterKey,
        components: quotedComponents,
        totalBeatCost: 0,
        totalCoinCost: 0,
      };
    }

    const totalBeatCost = roundBeatCost(unitBeatCost * quantity);
    quotedComponents.push({
      meterKey: requested.meterKey,
      displayName: policy.display_name || requested.meterKey,
      costFamily: policy.cost_family,
      billingUnit: policy.billing_unit,
      quantity,
      unitBeatCost,
      unitCoinCost: beatsToCoins(unitBeatCost),
      totalBeatCost,
      totalCoinCost: beatsToCoins(totalBeatCost),
      metadata: {
        ...policy.metadata_json,
        ...(requested.metadata ?? {}),
      },
    });
  }

  const totalBeatCost = roundBeatCost(
    quotedComponents.reduce((total, component) => total + component.totalBeatCost, 0)
  );

  return {
    operationKey: input.operationKey,
    planKey: input.planKey,
    allowed: true,
    deniedReason: null,
    deniedMeterKey: null,
    components: quotedComponents,
    totalBeatCost,
    totalCoinCost: beatsToCoins(totalBeatCost),
  };
}

export function pricingAuthorizationMessage(input: {
  status: 'denied';
  reason: string;
  coinCost: number;
  availableCoins: number;
}): string {
  if (input.reason === 'sign_in_required') return 'Sign in to use this feature.';
  if (input.reason === 'tier_locked') return 'This feature is not included in your current plan.';
  if (input.reason === 'feature_disabled') return 'This feature is currently disabled.';
  if (input.reason === 'pricing_unavailable') return 'Pricing for this feature is not configured.';
  if (input.reason === 'checkout_unavailable') {
    return `This action costs ${input.coinCost} coins. Your balance is ${input.availableCoins}, and checkout is unavailable.`;
  }
  return `This action costs ${input.coinCost} coins. Your balance is ${input.availableCoins}.`;
}
