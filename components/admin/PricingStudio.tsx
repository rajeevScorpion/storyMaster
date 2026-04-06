'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle,
  Coins,
  CreditCard,
  Loader2,
  Megaphone,
  RefreshCw,
  Save,
  Settings2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  archivePricingPlanVersion,
  archivePricingPromotion,
  archivePricingTopupPack,
  getPricingAdminState,
  publishPricingPlanVersion,
  publishPricingTopupPack,
  savePricingActionCost,
  savePricingPlanDraft,
  savePricingPromotion,
  savePricingTopupDraft,
  updatePricingRuntimeSettings,
  type PricingAdminState,
} from '@/app/actions/pricing-admin';
import type { DbPricingPromotion } from '@/lib/types/database';
import {
  BILLING_INTERVALS,
  BILLING_PROVIDERS,
  COINS_PER_BEAT,
  PLAN_KEYS,
  PRICING_MARKET_KEYS,
  PROMOTION_MARKET_SCOPES,
  type BillingInterval,
  type BillingProvider,
  type PlanKey,
  type PricingCatalogStatus,
  type PricingMarketKey,
  type PromotionMarketScope,
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
  name: string;
  provider: BillingProvider;
  currencyCode: string;
  priceMinor: number;
  coinAmount: number;
  providerProductRef: string;
  providerPriceRef: string;
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
};

type RuntimeDraft = {
  enabled: boolean;
  value: string;
};

const INPUT_CLASS = 'w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100';
const TOPUP_PACK_KEYS = ['beats_25', 'beats_80', 'beats_200'] as const;
const COIN_RUNTIME_SETTING_KEYS = new Set(['pricing_migration_grant_beats']);

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
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
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

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function beatsToCoins(value: number) {
  return value * COINS_PER_BEAT;
}

function coinsToBeats(value: number) {
  return Math.max(0, Math.round(value / COINS_PER_BEAT));
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

function getDefaultPackNameFromKey(packKey: string) {
  const match = /^beats_(\d+)$/.exec(packKey);
  if (!match) return packKey.replaceAll('_', ' ');
  return `${formatWholeNumber(beatsToCoins(Number(match[1])))} Coins`;
}

function normalizePackName(name: string | null | undefined, packKey: string, beatAmount: number) {
  if (!name?.trim()) return getDefaultPackNameFromKey(packKey);
  if (/^\d+\s+beats$/i.test(name.trim())) {
    return `${formatWholeNumber(beatsToCoins(beatAmount))} Coins`;
  }
  return name;
}

function formatPlanVariantValue(variant: PricingAdminState['plans'][number]['versions'][number] | null) {
  if (!variant) return 'Missing';
  return `${variant.currency_code} ${variant.price_minor} · ${formatWholeNumber(beatsToCoins(variant.monthly_included_beats))} coins/mo`;
}

function formatTopupVariantValue(variant: PricingAdminState['topupPacks'][number] | null) {
  if (!variant) return 'Missing';
  return `${variant.currency_code} ${variant.price_minor} · ${formatWholeNumber(beatsToCoins(variant.beat_amount))} coins`;
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
    free: { beats: 12, cap: 4, tier: 1 },
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
    name: getDefaultPackNameFromKey('beats_25'),
    provider: defaultProviderForMarket(market),
    currencyCode: defaultCurrencyForMarket(market),
    priceMinor: 0,
    coinAmount: beatsToCoins(25),
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

export default function PricingStudio() {
  const [state, setState] = useState<PricingAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [selectedPlanKey, setSelectedPlanKey] = useState<PlanKey>('free');
  const [selectedPlanMarket, setSelectedPlanMarket] = useState<PricingMarketKey>('ROW');
  const [selectedPlanInterval, setSelectedPlanInterval] = useState<BillingInterval>('monthly');
  const [planEditor, setPlanEditor] = useState<PlanEditorState>(defaultPlanEditor('free', 'ROW'));

  const [selectedTopupKey, setSelectedTopupKey] = useState('beats_25');
  const [selectedTopupMarket, setSelectedTopupMarket] = useState<PricingMarketKey>('ROW');
  const [topupEditor, setTopupEditor] = useState<TopupEditorState>(defaultTopupEditor('ROW'));

  const [actionCostDrafts, setActionCostDrafts] = useState<Record<string, ActionCostDraft>>({});
  const [runtimeDrafts, setRuntimeDrafts] = useState<Record<string, RuntimeDraft>>({});
  const [promotionEditor, setPromotionEditor] = useState<PromotionEditorState>(defaultPromotionEditor());

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

  useEffect(() => {
    if (!state) return;
    setTopupEditor(buildTopupEditor(state, selectedTopupKey, selectedTopupMarket));
  }, [state, selectedTopupKey, selectedTopupMarket]);

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
    return state?.topupPacks.find((pack) =>
      pack.pack_key === selectedTopupKey &&
      pack.pricing_market_key === selectedTopupMarket &&
      pack.status === 'draft'
    ) ?? null;
  }, [state, selectedTopupKey, selectedTopupMarket]);

  const currentTopupPublished = useMemo(() => {
    return state?.topupPacks.find((pack) =>
      pack.pack_key === selectedTopupKey &&
      pack.pricing_market_key === selectedTopupMarket &&
      pack.status === 'published'
    ) ?? null;
  }, [state, selectedTopupKey, selectedTopupMarket]);

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
      next.actionCosts.map((row) => [row.action_key, { coinCost: String(beatsToCoins(row.beat_cost)), isActive: row.is_active }])
    ));
    setRuntimeDrafts(Object.fromEntries(
      next.runtimeSettings.map((row) => [row.key, { enabled: row.enabled, value: storedValueToEditorValue(row.key, row.value) }])
    ));
  }

  async function runMutation<T>(key: string, action: () => Promise<T>, onSuccess: (result: T) => void, successMessage: string) {
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      onSuccess(result);
      setMessage(successMessage);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading pricing workspace...</div>;
  }

  if (!state) {
    return <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error || 'Failed to load pricing data.'}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl text-neutral-100">Pricing Workspace</h1>
            <p className="mt-1 text-sm text-neutral-400">Admin controls for plans, top-ups, promotions, wallet rules, and rollout settings.</p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-emerald-300/80">Display mode: 10 coins = 1 internal beat</p>
          </div>
          <button
            onClick={() => void refreshState()}
            disabled={busyKey !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <MetricCard label="Plans" value={String(state.plans.length)} hint="Plan families" />
          <MetricCard label="Versions" value={String(state.plans.reduce((sum, item) => sum + item.versions.length, 0))} hint="Draft + live variants" />
          <MetricCard label="Top-ups" value={String(state.topupPacks.length)} hint="Market variants" />
          <MetricCard label="Promotions" value={String(state.promotions.length)} hint="Immediate-save promos" />
        </div>

        {error && <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
        {message && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}
      </div>

      <SectionCard title="Runtime Controls" description="Immediate-save pricing knobs and rollout flags." icon={Settings2}>
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
                  <button
                    onClick={() => setRuntimeDrafts((current) => ({ ...current, [setting.key]: { ...draft, enabled: !draft.enabled } }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.enabled ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${draft.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
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

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">Default: {formatRuntimeDefaultValue(setting.key, setting.defaultValue, setting.defaultEnabled)}</p>
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

      <SectionCard title="Plans" description="Draft and publish plan variants by market and billing interval." icon={CreditCard}>
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-4 rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <SelectField label="Plan">
              <select value={selectedPlanKey} onChange={(event) => setSelectedPlanKey(event.target.value as PlanKey)} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                {PLAN_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </SelectField>
            <SelectField label="Market">
              <select value={selectedPlanMarket} onChange={(event) => setSelectedPlanMarket(event.target.value as PricingMarketKey)} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                {PRICING_MARKET_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </SelectField>
            <SelectField label="Interval">
              <select value={selectedPlanInterval} onChange={(event) => setSelectedPlanInterval(event.target.value as BillingInterval)} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                {BILLING_INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </SelectField>
            <VariantStatus title="Draft" value={formatPlanVariantValue(currentPlanDraft)} />
            <VariantStatus title="Published" value={formatPlanVariantValue(currentPlanPublished)} />
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField label="Name"><input value={planEditor.name} onChange={(event) => setPlanEditor((current) => ({ ...current, name: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Tier Rank"><input type="number" value={planEditor.tierRank} onChange={(event) => setPlanEditor((current) => ({ ...current, tierRank: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Price (minor units)"><input type="number" value={planEditor.priceMinor} onChange={(event) => setPlanEditor((current) => ({ ...current, priceMinor: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Monthly Included Coins"><input type="number" step="10" value={planEditor.monthlyIncludedCoins} onChange={(event) => setPlanEditor((current) => ({ ...current, monthlyIncludedCoins: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Story Length Cap"><input type="number" value={planEditor.storyLengthCap} onChange={(event) => setPlanEditor((current) => ({ ...current, storyLengthCap: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Grace Period Days"><input type="number" value={planEditor.gracePeriodDays} onChange={(event) => setPlanEditor((current) => ({ ...current, gracePeriodDays: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Carry Forward Cap Multiplier"><input type="number" step="0.1" value={planEditor.carryForwardCapMultiplier} onChange={(event) => setPlanEditor((current) => ({ ...current, carryForwardCapMultiplier: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <SelectField label="Provider">
                <select value={planEditor.provider} onChange={(event) => setPlanEditor((current) => ({ ...current, provider: event.target.value as BillingProvider | '' }))} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                  <option value="">None</option>
                  {BILLING_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
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

      <SectionCard title="Top-up Packs" description="Manage one-time coin packs by market." icon={Coins}>
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-4 rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <SelectField label="Pack">
              <select value={selectedTopupKey} onChange={(event) => setSelectedTopupKey(event.target.value)} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                {TOPUP_PACK_KEYS.map((key) => <option key={key} value={key}>{getPackOptionLabel(state, key, selectedTopupMarket)}</option>)}
              </select>
            </SelectField>
            <SelectField label="Market">
              <select value={selectedTopupMarket} onChange={(event) => setSelectedTopupMarket(event.target.value as PricingMarketKey)} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                {PRICING_MARKET_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </SelectField>
            <VariantStatus title="Draft" value={formatTopupVariantValue(currentTopupDraft)} />
            <VariantStatus title="Published" value={formatTopupVariantValue(currentTopupPublished)} />
          </div>

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <InputField label="Name"><input value={topupEditor.name} onChange={(event) => setTopupEditor((current) => ({ ...current, name: event.target.value }))} className={INPUT_CLASS} /></InputField>
              <SelectField label="Provider">
                <select value={topupEditor.provider} onChange={(event) => setTopupEditor((current) => ({ ...current, provider: event.target.value as BillingProvider }))} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                  {BILLING_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </SelectField>
              <InputField label="Currency"><input value={topupEditor.currencyCode} onChange={(event) => setTopupEditor((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Price (minor units)"><input type="number" value={topupEditor.priceMinor} onChange={(event) => setTopupEditor((current) => ({ ...current, priceMinor: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
              <InputField label="Coin Amount"><input type="number" step="10" value={topupEditor.coinAmount} onChange={(event) => setTopupEditor((current) => ({ ...current, coinAmount: Number(event.target.value) || 0 }))} className={INPUT_CLASS} /></InputField>
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
                    packKey: selectedTopupKey,
                    name: topupEditor.name,
                    provider: topupEditor.provider,
                    currencyCode: topupEditor.currencyCode,
                    pricingMarketKey: selectedTopupMarket,
                    priceMinor: topupEditor.priceMinor,
                    beatAmount: coinsToBeats(topupEditor.coinAmount),
                    providerProductRef: topupEditor.providerProductRef,
                    providerPriceRef: topupEditor.providerPriceRef,
                  }),
                  hydrateState,
                  `${selectedTopupKey} draft saved`
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
                  `${selectedTopupKey} draft published`
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
                    `${selectedTopupKey} variant archived`
                  );
                }}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Action Costs" description="Immediate-save coin costs for billable actions." icon={Sparkles}>
        <div className="grid gap-4 md:grid-cols-2">
          {state.actionCosts.map((action) => {
            const draft = actionCostDrafts[action.action_key] ?? { coinCost: String(beatsToCoins(action.beat_cost)), isActive: action.is_active };
            return (
              <div key={action.id} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <p className="text-sm font-medium text-neutral-100">{action.action_key}</p>
                <div className="mt-4 flex items-center gap-3">
                  <input
                    type="number"
                    step="10"
                    value={draft.coinCost}
                    onChange={(event) => setActionCostDrafts((current) => ({
                      ...current,
                      [action.action_key]: { ...draft, coinCost: event.target.value },
                    }))}
                    className="w-28 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
                  />
                  <span className="text-xs text-neutral-500">coins</span>
                  <button
                    onClick={() => setActionCostDrafts((current) => ({
                      ...current,
                      [action.action_key]: { ...draft, isActive: !draft.isActive },
                    }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.isActive ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${draft.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                  <span className="text-xs text-neutral-500">{draft.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="mt-4">
                  <ActionButton
                    busy={busyKey === `action:${action.action_key}`}
                    label="Save Cost"
                    icon={Save}
                    onClick={() => void runMutation(
                      `action:${action.action_key}`,
                      () => savePricingActionCost({
                        actionKey: action.action_key,
                        beatCost: coinsToBeats(Number(draft.coinCost) || 0),
                        isActive: draft.isActive,
                        effectiveFrom: action.effective_from,
                        effectiveTo: action.effective_to,
                      }),
                      hydrateState,
                      `${action.action_key} updated`
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

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
                <select value={promotionEditor.status} onChange={(event) => setPromotionEditor((current) => ({ ...current, status: event.target.value as PricingCatalogStatus }))} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                  <option value="published">published</option>
                  <option value="archived">archived</option>
                </select>
              </SelectField>
              <SelectField label="Market Scope">
                <select value={promotionEditor.pricingMarketScope} onChange={(event) => setPromotionEditor((current) => ({ ...current, pricingMarketScope: event.target.value as PromotionMarketScope }))} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                  {PROMOTION_MARKET_SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                </select>
              </SelectField>
              <SelectField label="Target Plan">
                <select value={promotionEditor.targetPlanKey} onChange={(event) => setPromotionEditor((current) => ({ ...current, targetPlanKey: event.target.value as PlanKey | '' }))} className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                  <option value="">All plans</option>
                  {PLAN_KEYS.map((planKey) => <option key={planKey} value={planKey}>{planKey}</option>)}
                </select>
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

      <SectionCard title="Recent Audit" description="Latest pricing changes recorded for traceability." icon={ShieldAlert}>
        <div className="space-y-3">
          {state.recentAudit.length === 0 ? (
            <p className="text-sm text-neutral-500">No pricing audit entries yet.</p>
          ) : (
            state.recentAudit.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">{entry.entity_type} · {entry.action_type}</p>
                    <p className="mt-1 text-xs text-neutral-500">Performed at {formatDate(entry.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">{entry.entity_id ?? 'runtime'}</span>
                </div>
                {entry.reason && <p className="mt-2 text-xs text-neutral-400">Reason: {entry.reason}</p>}
              </div>
            ))
          )}
        </div>
      </SectionCard>
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

  return {
    name: record?.plan.name ?? fallback.name,
    tierRank: record?.plan.tier_rank ?? fallback.tierRank,
    isActive: record?.plan.is_active ?? fallback.isActive,
    isPublic: record?.plan.is_public ?? fallback.isPublic,
    description: record?.plan.description ?? fallback.description,
    canAccessDownloads: Boolean(record?.plan.feature_flags_json?.canAccessDownloads ?? fallback.canAccessDownloads),
    canAccessUnbrandedExports: Boolean(record?.plan.feature_flags_json?.canAccessUnbrandedExports ?? fallback.canAccessUnbrandedExports),
    creatorControls: Boolean(record?.plan.feature_flags_json?.creatorControls ?? fallback.creatorControls),
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
  state: PricingAdminState,
  packKey: string,
  market: PricingMarketKey
): TopupEditorState {
  const draft = state.topupPacks.find((pack) => pack.pack_key === packKey && pack.pricing_market_key === market && pack.status === 'draft');
  const published = state.topupPacks.find((pack) => pack.pack_key === packKey && pack.pricing_market_key === market && pack.status === 'published');
  const source = draft ?? published;
  const fallback = defaultTopupEditor(market);

  return {
    name: normalizePackName(source?.name, packKey, source?.beat_amount ?? coinsToBeats(fallback.coinAmount)),
    provider: (source?.provider ?? fallback.provider) as BillingProvider,
    currencyCode: source?.currency_code ?? fallback.currencyCode,
    priceMinor: source?.price_minor ?? fallback.priceMinor,
    coinAmount: source ? beatsToCoins(source.beat_amount) : fallback.coinAmount,
    providerProductRef: source?.provider_product_ref ?? '',
    providerPriceRef: source?.provider_price_ref ?? '',
  };
}

function getPackOptionLabel(
  state: PricingAdminState,
  packKey: string,
  market: PricingMarketKey
) {
  const draft = state.topupPacks.find((pack) => pack.pack_key === packKey && pack.pricing_market_key === market && pack.status === 'draft');
  const published = state.topupPacks.find((pack) => pack.pack_key === packKey && pack.pricing_market_key === market && pack.status === 'published');
  const source = draft ?? published;
  return normalizePackName(source?.name, packKey, source?.beat_amount ?? coinsToBeats(0));
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
