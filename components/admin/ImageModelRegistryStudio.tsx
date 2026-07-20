'use client';

import { useEffect, useMemo, useState } from 'react';
import { ImageIcon, Loader2, RefreshCcw, Save, Sparkles } from 'lucide-react';
import {
  getAdminElevenLabsCostSettings,
  getAdminImageContinuitySettings,
  getAdminImageModelRegistry,
  saveAdminImageModelRegistryRecord,
  saveAdminImageContinuitySettings,
  saveAdminElevenLabsCostSettings,
  testAdminImageModel,
} from '@/app/actions/image-models';
import type { ImageModelCapabilities, ImageModelRegistryRecord, ImageTaskKey } from '@/lib/ai/image-models.shared';
import { normalizePromptCompilerCapability } from '@/lib/ai/prompt-compiler/capability.shared';
import {
  DEFAULT_IMAGE_CONTINUITY_SETTINGS,
  type ImageContinuitySettings,
  type StatefulRuntimePricing,
} from '@/lib/ai/image-continuity-settings.shared';
import type { ImageContinuityStrategy } from '@/lib/ai/image-continuity.shared';
import {
  DEFAULT_ELEVENLABS_COST_SETTINGS,
  type ElevenLabsCostSettings,
} from '@/lib/ai/provider-costs.shared';
import type { PlanKey } from '@/lib/types/pricing';

type Draft = Pick<
  ImageModelRegistryRecord,
  | 'displayName'
  | 'description'
  | 'badge'
  | 'isEnabled'
  | 'isUserVisible'
  | 'isAdminTestEnabled'
  | 'isDefault'
  | 'isRecommended'
  | 'allowedPlanKeys'
  | 'coinCostPerImage'
  | 'providerCostPerOutputImageUsd'
  | 'providerCostPerInputImageUsd'
  | 'capabilities'
  | 'sortOrder'
>;

const TASK_LABELS: Record<ImageTaskKey, string> = {
  image_generation: 'Story Images',
  reel_image_generation: 'Reel Images',
  portrait_generation: 'Portraits',
};

const PLAN_KEYS: PlanKey[] = ['free', 'plus', 'studio'];

function toDraft(record: ImageModelRegistryRecord): Draft {
  return {
    displayName: record.displayName,
    description: record.description,
    badge: record.badge,
    isEnabled: record.isEnabled,
    isUserVisible: record.isUserVisible,
    isAdminTestEnabled: record.isAdminTestEnabled,
    isDefault: record.isDefault,
    isRecommended: record.isRecommended,
    allowedPlanKeys: record.allowedPlanKeys,
    coinCostPerImage: record.coinCostPerImage,
    providerCostPerOutputImageUsd: record.providerCostPerOutputImageUsd,
    providerCostPerInputImageUsd: record.providerCostPerInputImageUsd,
    capabilities: record.capabilities,
    sortOrder: record.sortOrder,
  };
}

function readinessLabel(record: ImageModelRegistryRecord): string {
  if (record.isProviderConfigured) return 'Ready';
  return `Missing ${record.missingEnvVars.join(', ')}`;
}

function togglePlan(plans: PlanKey[], plan: PlanKey): PlanKey[] {
  const next = plans.includes(plan)
    ? plans.filter((item) => item !== plan)
    : [...plans, plan];
  return next.length > 0 ? next : [plan];
}

export default function ImageModelRegistryStudio() {
  const [records, setRecords] = useState<ImageModelRegistryRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [savingElevenLabsCosts, setSavingElevenLabsCosts] = useState(false);
  const [savingContinuitySettings, setSavingContinuitySettings] = useState(false);
  const [elevenLabsCosts, setElevenLabsCosts] = useState<ElevenLabsCostSettings>(DEFAULT_ELEVENLABS_COST_SETTINGS);
  const [continuitySettings, setContinuitySettings] = useState<ImageContinuitySettings>(DEFAULT_IMAGE_CONTINUITY_SETTINGS);
  const [testPrompt, setTestPrompt] = useState('A clean 2x2 storyboard of a lighthouse at sunrise, no text.');
  const [testImage, setTestImage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    return records.reduce<Record<ImageTaskKey, ImageModelRegistryRecord[]>>((acc, record) => {
      acc[record.taskKey] = [...(acc[record.taskKey] ?? []), record];
      return acc;
    }, {
      image_generation: [],
      reel_image_generation: [],
      portrait_generation: [],
    });
  }, [records]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, costs, continuity] = await Promise.all([
        getAdminImageModelRegistry(),
        getAdminElevenLabsCostSettings(),
        getAdminImageContinuitySettings(),
      ]);
      setRecords(next);
      setDrafts(Object.fromEntries(next.map((record) => [record.id, toDraft(record)])));
      setElevenLabsCosts(costs);
      setContinuitySettings(continuity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image models.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch,
      },
    }));
  };

  // Merge a prompt-compiler capability patch into the model's capabilities JSONB
  // (the registry save fully replaces capabilities, so we keep the rest intact).
  const updatePromptCompiler = (
    id: string,
    patch: Partial<NonNullable<ImageModelCapabilities['promptCompiler']>>
  ) => {
    setDrafts((current) => {
      const draft = current[id];
      if (!draft) return current;
      const capabilities: ImageModelCapabilities = {
        ...(draft.capabilities ?? {}),
        promptCompiler: { ...(draft.capabilities?.promptCompiler ?? {}), ...patch },
      };
      return { ...current, [id]: { ...draft, capabilities } };
    });
  };

  const save = async (record: ImageModelRegistryRecord) => {
    const draft = drafts[record.id];
    if (!draft) return;
    setSavingId(record.id);
    setError(null);
    setMessage(null);
    try {
      const next = await saveAdminImageModelRegistryRecord({
        id: record.id,
        ...draft,
      });
      setRecords(next);
      setDrafts(Object.fromEntries(next.map((item) => [item.id, toDraft(item)])));
      setMessage(`${draft.displayName} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save image model.');
    } finally {
      setSavingId(null);
    }
  };

  const updateElevenLabsCost = (modelId: string, value: number) => {
    setElevenLabsCosts((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.modelId === modelId
          ? { ...model, usdPer1kChars: Math.max(0, Number.isFinite(value) ? value : 0) }
          : model
      ),
    }));
  };

  const updateElevenLabsForcedAlignmentCost = (value: number) => {
    setElevenLabsCosts((current) => ({
      ...current,
      forcedAlignmentUsdPerHour: Math.max(0, Number.isFinite(value) ? value : 0),
    }));
  };

  const saveElevenLabsCosts = async () => {
    setSavingElevenLabsCosts(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveAdminElevenLabsCostSettings(elevenLabsCosts);
      setElevenLabsCosts(saved);
      setMessage('ElevenLabs cost settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ElevenLabs cost settings.');
    } finally {
      setSavingElevenLabsCosts(false);
    }
  };

  const updateRuntimePricing = (
    provider: 'openai' | 'gemini',
    patch: Partial<StatefulRuntimePricing>
  ) => {
    setContinuitySettings((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        ...patch,
      },
    }));
  };

  const saveContinuitySettings = async () => {
    setSavingContinuitySettings(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveAdminImageContinuitySettings(continuitySettings);
      setContinuitySettings(saved);
      setMessage('Image continuity settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save image continuity settings.');
    } finally {
      setSavingContinuitySettings(false);
    }
  };

  const runTest = async (record: ImageModelRegistryRecord) => {
    setTestingId(record.id);
    setError(null);
    setMessage(null);
    setTestImage(null);
    try {
      const result = await testAdminImageModel({
        taskKey: record.taskKey,
        modelKey: record.modelKey,
        prompt: testPrompt,
        aspectRatio: record.taskKey === 'reel_image_generation' ? '9:16' : record.taskKey === 'portrait_generation' ? '1:1' : '16:9',
      });
      setTestImage(result.dataUrl);
      setMessage(`Test completed with ${record.displayName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image model test failed.');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">Generation registry</p>
          <h1 className="mt-2 text-3xl font-serif text-neutral-100">Image Models</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Configure provider visibility, defaults, plan access, coin billing, and provider USD cost telemetry.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles className="h-5 w-5 text-emerald-300" />
          <input
            value={testPrompt}
            onChange={(event) => setTestPrompt(event.target.value)}
            className="min-w-72 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
            aria-label="Admin image model test prompt"
          />
        </div>
        {testImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={testImage}
            alt="Admin image model test result"
            className="mt-4 max-h-80 rounded-lg border border-white/10 object-contain"
          />
        )}
      </div>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">Continuity strategy</p>
            <h2 className="mt-2 text-xl font-serif text-neutral-100">Stateful Runtime</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-400">
              Stateful image chains use OpenAI Responses or Gemini Interactions when available; xAI stays on reference-image resend.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveContinuitySettings()}
            disabled={savingContinuitySettings || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {savingContinuitySettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Continuity
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr_1fr]">
          <label className="block rounded-lg border border-white/10 bg-neutral-950/50 p-3">
            <span className="block text-sm font-medium text-neutral-100">Default strategy</span>
            <select
              value={continuitySettings.defaultStrategy}
              onChange={(event) => setContinuitySettings((current) => ({
                ...current,
                defaultStrategy: event.target.value as ImageContinuityStrategy,
              }))}
              className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
              aria-label="Default image continuity strategy"
            >
              <option value="auto">Auto</option>
              <option value="provider_stateful">Stateful provider</option>
              <option value="resend_refs">Resend references</option>
            </select>
          </label>
          {(['openai', 'gemini'] as const).map((provider) => {
            const settings = continuitySettings[provider];
            return (
              <div key={provider} className="rounded-lg border border-white/10 bg-neutral-950/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium capitalize text-neutral-100">{provider}</span>
                  <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(event) => updateRuntimePricing(provider, { enabled: event.target.checked })}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    Stateful
                  </label>
                </div>
                <label className="mt-3 block text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                  Runtime model
                  <input
                    value={settings.runtimeModelId}
                    onChange={(event) => updateRuntimePricing(provider, { runtimeModelId: event.target.value })}
                    className="mt-1 block w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case tracking-normal text-neutral-100 outline-none focus:border-emerald-500/50"
                    aria-label={`${provider} stateful runtime model`}
                  />
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {([
                    ['inputUsdPer1MTokens', 'Input'],
                    ['cachedInputUsdPer1MTokens', 'Cached'],
                    ['outputUsdPer1MTokens', 'Output'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="block text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {label}
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        value={settings[key]}
                        onChange={(event) => updateRuntimePricing(provider, { [key]: Number(event.target.value) })}
                        className="mt-1 block w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case tracking-normal text-neutral-100 outline-none focus:border-emerald-500/50"
                        aria-label={`${provider} ${label} USD per 1M tokens`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">TTS cost telemetry</p>
            <h2 className="mt-2 text-xl font-serif text-neutral-100">ElevenLabs</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-400">
              USD estimates are recorded in Admin Cost for ElevenLabs reel TTS and story overlay forced alignment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveElevenLabsCosts()}
            disabled={savingElevenLabsCosts || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {savingElevenLabsCosts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Costs
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
            <span className="block text-sm font-medium text-neutral-100">Forced Alignment</span>
            <span className="mt-1 block truncate text-xs text-neutral-500">elevenlabs-forced-alignment</span>
            <input
              type="number"
              min={0}
              step={0.001}
              value={elevenLabsCosts.forcedAlignmentUsdPerHour}
              onChange={(event) => updateElevenLabsForcedAlignmentCost(Number(event.target.value))}
              className="mt-3 w-32 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
              aria-label="ElevenLabs forced alignment USD per hour"
            />
            <span className="ml-2 text-xs text-neutral-500">USD / hour</span>
          </label>
          {elevenLabsCosts.models.map((model) => (
            <label key={model.modelId} className="block rounded-lg border border-white/10 bg-neutral-950/50 p-3">
              <span className="block text-sm font-medium text-neutral-100">{model.displayName}</span>
              <span className="mt-1 block truncate text-xs text-neutral-500">{model.modelId}</span>
              <input
                type="number"
                min={0}
                step={0.001}
                value={model.usdPer1kChars}
                onChange={(event) => updateElevenLabsCost(model.modelId, Number(event.target.value))}
                className="mt-3 w-32 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
                aria-label={`${model.displayName} USD per 1K characters`}
              />
              <span className="ml-2 text-xs text-neutral-500">USD / 1K chars</span>
            </label>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-neutral-400">
          Loading image models...
        </div>
      ) : (
        (Object.keys(grouped) as ImageTaskKey[]).map((taskKey) => (
          <section key={taskKey} className="space-y-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-serif text-neutral-100">{TASK_LABELS[taskKey]}</h2>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[1260px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5 text-left text-neutral-500">
                    <th className="px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium">Readiness</th>
                    <th className="px-4 py-3 font-medium">Coins</th>
                    <th className="px-4 py-3 font-medium">Provider USD</th>
                    <th className="px-4 py-3 font-medium">Plans</th>
                    <th className="px-4 py-3 font-medium">Flags</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[taskKey].map((record) => {
                    const draft = drafts[record.id] ?? toDraft(record);
                    const busy = savingId === record.id || testingId === record.id;
                    return (
                      <tr key={record.id} className="border-b border-white/5 align-top">
                        <td className="px-4 py-3">
                          <input
                            value={draft.displayName}
                            onChange={(event) => updateDraft(record.id, { displayName: event.target.value })}
                            className="w-64 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
                            aria-label={`${record.displayName} display name`}
                          />
                          <p className="mt-2 text-xs text-neutral-500">{record.providerLabel} · {record.providerModelId}</p>
                          <textarea
                            value={draft.description}
                            onChange={(event) => updateDraft(record.id, { description: event.target.value })}
                            className="mt-2 h-16 w-64 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 outline-none focus:border-emerald-500/50"
                            aria-label={`${record.displayName} description`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full border px-2 py-1 text-xs ${
                            record.isProviderConfigured
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}>
                            {readinessLabel(record)}
                          </span>
                          <p className="mt-2 text-xs text-neutral-500">
                            Env: {record.requiredEnvVars.length > 0 ? record.requiredEnvVars.join(', ') : 'none'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={draft.coinCostPerImage}
                            onChange={(event) => updateDraft(record.id, { coinCostPerImage: Number(event.target.value) })}
                            className="w-24 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/50"
                            aria-label={`${record.displayName} coins per image`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <label className="block text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                            Output
                            <input
                              type="number"
                              min={0}
                              step={0.001}
                              value={draft.providerCostPerOutputImageUsd}
                              onChange={(event) => updateDraft(record.id, { providerCostPerOutputImageUsd: Number(event.target.value) })}
                              className="mt-1 block w-24 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case tracking-normal text-neutral-100 outline-none focus:border-emerald-500/50"
                              aria-label={`${record.displayName} provider USD per output image`}
                            />
                          </label>
                          <label className="mt-2 block text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                            Input ref
                            <input
                              type="number"
                              min={0}
                              step={0.001}
                              value={draft.providerCostPerInputImageUsd}
                              onChange={(event) => updateDraft(record.id, { providerCostPerInputImageUsd: Number(event.target.value) })}
                              className="mt-1 block w-24 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case tracking-normal text-neutral-100 outline-none focus:border-emerald-500/50"
                              aria-label={`${record.displayName} provider USD per input reference image`}
                            />
                          </label>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {PLAN_KEYS.map((plan) => (
                              <label key={plan} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-300">
                                <input
                                  type="checkbox"
                                  checked={draft.allowedPlanKeys.includes(plan)}
                                  onChange={() => updateDraft(record.id, { allowedPlanKeys: togglePlan(draft.allowedPlanKeys, plan) })}
                                  className="h-3.5 w-3.5 accent-emerald-500"
                                />
                                {plan}
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="grid gap-2">
                            {([
                              ['isEnabled', 'Enabled'],
                              ['isUserVisible', 'User visible'],
                              ['isDefault', 'Default'],
                              ['isRecommended', 'Recommended'],
                            ] as const).map(([key, label]) => (
                              <label key={key} className="inline-flex items-center gap-2 text-xs text-neutral-300">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft[key])}
                                  onChange={(event) => updateDraft(record.id, { [key]: event.target.checked })}
                                  className="h-3.5 w-3.5 accent-emerald-500"
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                          {(() => {
                            const compiler = normalizePromptCompilerCapability(draft.capabilities);
                            return (
                              <div className="mt-3 rounded-lg border border-white/10 bg-neutral-950/50 p-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-300/70">Prompt compiler</p>
                                <label className="mt-1.5 inline-flex items-center gap-2 text-xs text-neutral-300">
                                  <input
                                    type="checkbox"
                                    checked={compiler.enabled}
                                    onChange={(event) => updatePromptCompiler(record.id, { enabled: event.target.checked })}
                                    className="h-3.5 w-3.5 accent-emerald-500"
                                  />
                                  Enabled
                                </label>
                                <label className="mt-2 block text-[11px] text-neutral-400">
                                  Budget (chars)
                                  <input
                                    type="number"
                                    min={1200}
                                    max={20000}
                                    step={100}
                                    value={compiler.promptBudgetChars}
                                    onChange={(event) => updatePromptCompiler(record.id, { promptBudgetChars: Number(event.target.value) })}
                                    className="mt-1 block w-24 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-500/50"
                                    aria-label={`${record.displayName} prompt compiler budget`}
                                  />
                                </label>
                                <label className="mt-2 block text-[11px] text-neutral-400">
                                  Adapter
                                  <select
                                    value={compiler.adapterVersion}
                                    onChange={(event) => updatePromptCompiler(record.id, { adapterVersion: event.target.value })}
                                    className="mt-1 block w-full rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-500/50"
                                    aria-label={`${record.displayName} prompt compiler adapter`}
                                  >
                                    <option value="neutral-v1">neutral-v1</option>
                                    <option value="gemini-v1">gemini-v1</option>
                                  </select>
                                </label>
                                <label className="mt-2 inline-flex items-center gap-2 text-xs text-neutral-300">
                                  <input
                                    type="checkbox"
                                    checked={compiler.supportsNegativePrompt}
                                    onChange={(event) => updatePromptCompiler(record.id, { supportsNegativePrompt: event.target.checked })}
                                    className="h-3.5 w-3.5 accent-emerald-500"
                                  />
                                  Negative prompt
                                </label>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void runTest(record)}
                              disabled={busy || !record.isProviderConfigured}
                              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                            >
                              {testingId === record.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              Test
                            </button>
                            <button
                              type="button"
                              onClick={() => void save(record)}
                              disabled={busy}
                              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              {savingId === record.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              Save
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
