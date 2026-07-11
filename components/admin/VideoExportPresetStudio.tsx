'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';

import FilterDropdown from '@/components/ui/FilterDropdown';
import {
  getVideoExportPresetSettings,
  resetVideoExportPresetSettings,
  saveVideoExportPresetSettings,
} from '@/app/actions/video-export';
import {
  EXPORT_PRESET_FPS_VALUES,
  EXPORT_PRESET_SAMPLE_RATES,
  normalizeExportPresets,
  serializeExportPresets,
  type ExportPresetDefinition,
} from '@/lib/video-export/presets';
import { PLAN_KEYS, type PlanKey } from '@/lib/types/pricing';

const PLAN_LABELS: Record<PlanKey, string> = {
  free: 'Free',
  plus: 'Plus',
  studio: 'Studio',
};

const FPS_OPTIONS = EXPORT_PRESET_FPS_VALUES.map((fps) => ({ value: String(fps), label: `${fps} fps` }));
const SAMPLE_RATE_OPTIONS = EXPORT_PRESET_SAMPLE_RATES.map((rate) => ({
  value: String(rate),
  label: `${(rate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`,
}));

function presetIsHeavy(preset: ExportPresetDefinition): boolean {
  return preset.fps === 60 || preset.width * preset.height > 1080 * 1920;
}

function SmallToggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        checked
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-white/10 bg-neutral-800 text-neutral-400 hover:border-white/20'
      }`}
    >
      {label}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:border-emerald-500/40 focus:outline-none"
        />
        {suffix && <span className="text-neutral-500">{suffix}</span>}
      </span>
    </label>
  );
}

export default function VideoExportPresetStudio() {
  const [presets, setPresets] = useState<ExportPresetDefinition[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVideoExportPresetSettings()
      .then((loaded) => {
        if (cancelled) return;
        setPresets(loaded);
        setSavedSnapshot(serializeExportPresets(loaded));
      })
      .catch(() => {
        if (!cancelled) setMessage('Could not load export presets.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnsavedChanges = useMemo(
    () => serializeExportPresets(presets) !== savedSnapshot,
    [presets, savedSnapshot]
  );

  const updatePreset = (id: string, patch: Partial<ExportPresetDefinition>) => {
    setPresets((current) => current.map((preset) => (
      preset.id === id ? { ...preset, ...patch } : preset
    )));
  };

  const toggleTier = (preset: ExportPresetDefinition, tier: PlanKey) => {
    const allowedTiers = preset.allowedTiers.includes(tier)
      ? preset.allowedTiers.filter((item) => item !== tier)
      : [...preset.allowedTiers, tier];
    updatePreset(preset.id, { allowedTiers });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveVideoExportPresetSettings(normalizeExportPresets(presets));
      setPresets(saved);
      setSavedSnapshot(serializeExportPresets(saved));
      setMessage('Export presets saved.');
    } catch {
      setMessage('Saving export presets failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const defaults = await resetVideoExportPresetSettings();
      setPresets(defaults);
      setSavedSnapshot(serializeExportPresets(defaults));
      setMessage('Export presets reset to the recommended defaults.');
    } catch {
      setMessage('Resetting export presets failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-6 text-sm text-neutral-400">
        <Loader2 size={14} className="animate-spin" /> Loading export presets…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs leading-relaxed text-neutral-400">
          Export engine presets shown in the download dialog. These control resolution, frame rate, and
          bitrate per tier — creative effects (pan/zoom, particles, transitions) stay in the story
          effects system. Plan watermark branding is still configured per plan in Pricing Studio.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {hasUnsavedChanges && <span className="text-xs text-amber-400">Unsaved</span>}
          <button
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw size={12} /> Reset defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasUnsavedChanges}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save presets'}
          </button>
        </div>
      </div>

      {presets.map((preset) => (
        <div key={preset.id} className="space-y-4 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <input
                value={preset.label}
                onChange={(event) => updatePreset(preset.id, { label: event.target.value })}
                className="w-40 rounded-lg border border-white/10 bg-neutral-800 px-2 py-1.5 text-sm font-medium text-neutral-100 focus:border-emerald-500/40 focus:outline-none"
                aria-label={`${preset.id} preset label`}
              />
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
                {preset.id}
              </span>
              {preset.isExperimental && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  Experimental
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <SmallToggle
                label={preset.enabled ? 'Enabled' : 'Disabled'}
                checked={preset.enabled}
                onToggle={() => updatePreset(preset.id, { enabled: !preset.enabled })}
              />
              <SmallToggle
                label="Admin only"
                checked={preset.adminOnly}
                onToggle={() => updatePreset(preset.id, { adminOnly: !preset.adminOnly })}
              />
            </div>
          </div>

          <input
            value={preset.description}
            onChange={(event) => updatePreset(preset.id, { description: event.target.value })}
            placeholder="User-facing description"
            className="w-full rounded-lg border border-white/10 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-300 focus:border-emerald-500/40 focus:outline-none"
            aria-label={`${preset.id} preset description`}
          />

          <div className="flex flex-wrap items-end gap-4">
            <NumberField
              label="Width"
              value={preset.width}
              onChange={(width) => updatePreset(preset.id, { width })}
              suffix="px"
            />
            <NumberField
              label="Height"
              value={preset.height}
              onChange={(height) => updatePreset(preset.id, { height })}
              suffix="px"
            />
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Frame rate
              <FilterDropdown
                value={String(preset.fps)}
                options={FPS_OPTIONS}
                onChange={(value) => updatePreset(preset.id, { fps: Number(value) as ExportPresetDefinition['fps'] })}
                ariaLabel={`${preset.id} preset frame rate`}
              />
            </label>
            <NumberField
              label="Video bitrate"
              value={Math.round(preset.videoBitrate / 1_000_000 * 10) / 10}
              onChange={(mbps) => updatePreset(preset.id, { videoBitrate: Math.round(mbps * 1_000_000) })}
              suffix="Mbps"
            />
            <NumberField
              label="Audio bitrate"
              value={Math.round(preset.audioBitrate / 1000)}
              onChange={(kbps) => updatePreset(preset.id, { audioBitrate: Math.round(kbps * 1000) })}
              suffix="kbps"
            />
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Sample rate
              <FilterDropdown
                value={String(preset.audioSampleRate)}
                options={SAMPLE_RATE_OPTIONS}
                onChange={(value) => updatePreset(preset.id, { audioSampleRate: Number(value) })}
                ariaLabel={`${preset.id} preset audio sample rate`}
              />
            </label>
            <NumberField
              label="Sort order"
              value={preset.sortOrder}
              onChange={(sortOrder) => updatePreset(preset.id, { sortOrder })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-400">Available to:</span>
            {PLAN_KEYS.map((tier) => (
              <SmallToggle
                key={tier}
                label={PLAN_LABELS[tier]}
                checked={preset.allowedTiers.includes(tier)}
                onToggle={() => toggleTier(preset, tier)}
              />
            ))}
          </div>

          <input
            value={preset.upgradePromptText}
            onChange={(event) => updatePreset(preset.id, { upgradePromptText: event.target.value })}
            placeholder="Upgrade prompt shown when tier-locked (optional)"
            className="w-full rounded-lg border border-white/10 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-300 focus:border-emerald-500/40 focus:outline-none"
            aria-label={`${preset.id} preset upgrade prompt`}
          />

          {preset.enabled && presetIsHeavy(preset) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              High frame rate or resolution — exports get heavier on RAM and slower on mobile devices.
              Verify on mid-range hardware before enabling broadly.
            </div>
          )}
        </div>
      ))}

      {message && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
          {message}
        </div>
      )}
    </div>
  );
}
