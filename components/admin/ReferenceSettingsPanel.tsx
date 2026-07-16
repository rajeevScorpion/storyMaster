'use client';

import { useState } from 'react';
import {
  getReferenceAdminState,
  saveReferencePersonalizationSettings,
  setReferenceInputMode,
  setReferencePersonalizationEnabled,
  type ReferenceAdminState,
} from '@/app/actions/admin-references';
import {
  REFERENCE_PLATFORM_MAX_CHARACTER_REFS,
  REFERENCE_PLATFORM_MAX_WORLD_REFS,
  type ReferencePersonalizationSettings,
  type ReferenceTierLimits,
} from '@/lib/references/reference-settings';
import { PLAN_KEYS, type PlanKey } from '@/lib/types/pricing';
import type { ReferenceInputMode } from '@/lib/types/references';

const INPUT_MODES: { value: ReferenceInputMode; label: string; help: string }[] = [
  {
    value: 'direct',
    label: 'Direct (v2)',
    help: 'Raw uploads are sent to the image model at generation time (styled-sheet hybrid). No adoption jobs, no adoption coins. Adoption-only controls below are ignored.',
  },
  {
    value: 'adoption',
    label: 'Adoption (v1)',
    help: 'Each upload is analyzed and re-generated as a canonical styled image before the story starts. Uses adoption jobs + coins.',
  },
];

const TIER_LABELS: Record<PlanKey, string> = { free: 'Free', plus: 'Plus', studio: 'Studio' };

const GLOBAL_TOGGLES: { key: keyof ReferencePersonalizationSettings; label: string; help: string }[] = [
  { key: 'charactersEnabled', label: 'Character references', help: 'Allow uploading and adopting character references.' },
  { key: 'worldsEnabled', label: 'World references', help: 'Allow uploading and adopting world references.' },
  { key: 'worldVisualizationEnabled', label: 'World canonical visualization', help: 'Global kill switch for generated world visuals (a tier may still allow the mode).' },
  { key: 'descriptionOnlyFallbackEnabled', label: 'Description-only fallback', help: 'When a world visualization permanently fails, keep the adoption using its text description.' },
  { key: 'pauseNewAdoptions', label: 'Pause new adoptions', help: 'Kill switch: stop creating new adoption jobs. Existing adoptions keep displaying.' },
];

const NUMBER_KNOBS: { key: keyof ReferencePersonalizationSettings; label: string; min: number; max: number; suffix: string }[] = [
  { key: 'maxAttempts', label: 'Max attempts', min: 1, max: 5, suffix: 'tries' },
  { key: 'staleReclaimMinutes', label: 'Stale reclaim', min: 2, max: 60, suffix: 'min' },
  { key: 'maxFileSizeMb', label: 'Max upload size', min: 1, max: 15, suffix: 'MB' },
  { key: 'minDimensionPx', label: 'Min dimension', min: 128, max: 2048, suffix: 'px' },
  { key: 'abandonedSetupTtlHours', label: 'Abandoned setup TTL', min: 1, max: 720, suffix: 'h' },
];

export default function ReferenceSettingsPanel({ initial }: { initial: ReferenceAdminState }) {
  const [state, setState] = useState<ReferenceAdminState>(initial);
  const [settings, setSettings] = useState<ReferencePersonalizationSettings>(initial.settings);
  const [saving, setSaving] = useState(false);
  const [togglingMaster, setTogglingMaster] = useState(false);
  const [settingMode, setSettingMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const directMode = state.inputMode === 'direct';

  function applyState(next: ReferenceAdminState) {
    setState(next);
    setSettings(next.settings);
  }

  async function handleToggleMaster(enabled: boolean) {
    setTogglingMaster(true);
    setMessage(null);
    try {
      applyState(await setReferencePersonalizationEnabled(enabled));
      setMessage(enabled ? 'Feature enabled.' : 'Feature disabled.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update.');
    } finally {
      setTogglingMaster(false);
    }
  }

  async function handleSetMode(mode: ReferenceInputMode) {
    if (mode === state.inputMode) return;
    setSettingMode(true);
    setMessage(null);
    try {
      applyState(await setReferenceInputMode(mode));
      setMessage(mode === 'direct' ? 'Switched to Direct (v2).' : 'Switched to Adoption (v1).');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to switch mode.');
    } finally {
      setSettingMode(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      applyState(await saveReferencePersonalizationSettings(settings));
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshMetrics() {
    try {
      applyState(await getReferenceAdminState());
    } catch {
      /* ignore */
    }
  }

  function updateTier(planKey: PlanKey, patch: Partial<ReferenceTierLimits>) {
    setSettings((prev) => ({
      ...prev,
      tierMatrix: { ...prev.tierMatrix, [planKey]: { ...prev.tierMatrix[planKey], ...patch } },
    }));
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-serif text-neutral-100">References &amp; Personalization</h1>
        <p className="mt-1 text-sm text-neutral-400">
          User-uploaded character and world references, adopted into each story&rsquo;s locked visual
          style. Changes apply to new adoption jobs; in-progress jobs use the settings snapshotted at
          enqueue. Settings cache for ~60s.
        </p>
      </div>

      {!state.serverPipelineAvailable && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          The private R2 pipeline is unavailable, so the feature cannot be enabled:{' '}
          {state.serverPipelineUnavailableReason ?? 'unknown reason'}.
        </div>
      )}

      {/* Master toggle */}
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-4">
        <div>
          <span className="block text-sm text-neutral-100">Master feature</span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            Off by default. When off, the story-creation panel is hidden and no new references can be added.
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleToggleMaster(!state.masterEnabled)}
          disabled={togglingMaster || (!state.masterEnabled && !state.serverPipelineAvailable)}
          className={`rounded-xl border px-4 py-2 text-sm transition-colors disabled:opacity-60 ${
            state.masterEnabled
              ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
              : 'border-white/15 bg-white/5 text-neutral-300 hover:bg-white/10'
          }`}
        >
          {togglingMaster ? 'Updating…' : state.masterEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {/* Input mode */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-200">Input mode</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {INPUT_MODES.map((mode) => {
            const active = state.inputMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => void handleSetMode(mode.value)}
                disabled={settingMode || active}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-80 ${
                  active
                    ? 'border-emerald-400/40 bg-emerald-500/15'
                    : 'border-white/10 bg-neutral-900/60 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2 text-sm text-neutral-100">
                  {mode.label}
                  {active && <span className="text-[10px] uppercase tracking-wide text-emerald-300">Active</span>}
                </span>
                <span className="mt-1 block text-xs text-neutral-500">{mode.help}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Global toggles */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-200">Global controls</h2>
        {directMode && (
          <p className="text-xs text-amber-300/80">
            World-visualization and adoption controls below only apply in Adoption (v1) mode. Character/world
            enable toggles and the tier limits still apply.
          </p>
        )}
        {GLOBAL_TOGGLES.map(({ key, label, help }) => (
          <label
            key={key}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-3"
          >
            <input
              type="checkbox"
              checked={settings[key] as boolean}
              onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.checked }))}
              className="mt-1 accent-emerald-500"
            />
            <span>
              <span className="block text-sm text-neutral-100">{label}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">{help}</span>
            </span>
          </label>
        ))}
      </div>

      {/* Tier matrix */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-200">Tier matrix</h2>
        <p className="text-xs text-neutral-500">
          Platform ceiling: {REFERENCE_PLATFORM_MAX_CHARACTER_REFS} character /{' '}
          {REFERENCE_PLATFORM_MAX_WORLD_REFS} world references per story. Values above the ceiling are
          clamped on save.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="p-2">Tier</th>
                <th className="p-2">Enabled</th>
                <th className="p-2">Max characters</th>
                <th className="p-2">Max worlds</th>
                <th className="p-2">World mode</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_KEYS.map((planKey) => {
                const tier = settings.tierMatrix[planKey];
                return (
                  <tr key={planKey} className="border-t border-white/5">
                    <td className="p-2 text-neutral-200">{TIER_LABELS[planKey]}</td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={tier.enabled}
                        onChange={(e) => updateTier(planKey, { enabled: e.target.checked })}
                        className="accent-emerald-500"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        max={REFERENCE_PLATFORM_MAX_CHARACTER_REFS}
                        value={tier.maxCharacterRefs}
                        onChange={(e) => updateTier(planKey, { maxCharacterRefs: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-neutral-100"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        max={REFERENCE_PLATFORM_MAX_WORLD_REFS}
                        value={tier.maxWorldRefs}
                        onChange={(e) => updateTier(planKey, { maxWorldRefs: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-neutral-100"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={tier.worldAdoptionMode}
                        onChange={(e) =>
                          updateTier(planKey, {
                            worldAdoptionMode:
                              e.target.value === 'description_plus_canonical_visual'
                                ? 'description_plus_canonical_visual'
                                : 'description_only',
                          })
                        }
                        className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      >
                        <option value="description_only">Description only</option>
                        <option value="description_plus_canonical_visual">Description + visual</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Operational knobs */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-200">Processing &amp; upload</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {NUMBER_KNOBS.map(({ key, label, min, max, suffix }) => (
            <label key={key} className="block rounded-xl border border-white/10 bg-neutral-900/60 p-3">
              <span className="block text-xs text-neutral-400">{label}</span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={settings[key] as number}
                  onChange={(e) => setSettings((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  className="w-20 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                />
                <span className="text-xs text-neutral-500">{suffix}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/30 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {message && <span className="text-xs text-neutral-400">{message}</span>}
      </div>

      {/* Observability */}
      <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-200">
            Adoption jobs {directMode && <span className="text-xs font-normal text-neutral-500">(adoption mode only)</span>}
          </h2>
          <button
            type="button"
            onClick={() => void handleRefreshMetrics()}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            Refresh
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-3 text-center">
          <Metric label="Pending" value={state.metrics.pending} />
          <Metric label="Processing" value={state.metrics.processing} />
          <Metric label="Ready 24h" value={state.metrics.ready24h} />
          <Metric label="Failed 24h" value={state.metrics.failed24h} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/5 bg-neutral-950/60 p-3">
      <div className="text-lg text-neutral-100">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{label}</div>
    </div>
  );
}
