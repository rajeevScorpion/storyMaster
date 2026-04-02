'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getGlobalSettings, setStoryboardMode, setCycleOverride, setCycleMs } from '@/app/actions/admin';

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
  toggling,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  toggling: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <div>
        <p className="text-sm font-medium text-neutral-100">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`relative ml-6 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-neutral-600'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

export default function GlobalSettings() {
  const [loading, setLoading] = useState(true);
  const [storyboardEnabled, setStoryboardEnabled] = useState(false);
  const [storyboardToggling, setStoryboardToggling] = useState(false);
  const [cycleOverride, setCycleOverrideState] = useState(false);
  const [cycleOverrideToggling, setCycleOverrideToggling] = useState(false);
  const [cycleMs, setCycleMsState] = useState(5000);
  const [cycleMsInput, setCycleMsInput] = useState('5000');
  const [cycleMsSaving, setCycleMsSaving] = useState(false);

  useEffect(() => {
    getGlobalSettings().then(({ storyboardMode, cycleOverride: co, cycleMs: cm }) => {
      setStoryboardEnabled(storyboardMode);
      setCycleOverrideState(co);
      setCycleMsState(cm);
      setCycleMsInput(String(cm));
      setLoading(false);
    });
  }, []);

  async function handleCycleMsSave() {
    const ms = parseInt(cycleMsInput, 10);
    if (!ms || ms < 500) return;
    setCycleMsSaving(true);
    try {
      await setCycleMs(ms);
      setCycleMsState(ms);
    } finally {
      setCycleMsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-1 text-2xl text-neutral-100">Global Settings</h1>
      <p className="mb-8 text-sm text-neutral-400">Runtime feature flags that apply globally to all story generation. Premium-user scoping can be added later.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading settings...</div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Storyboard</h2>

          <ToggleRow
            label="Storyboard Mode"
            description="Generate a 2×2 panel grid at 2K (16:9) per beat instead of a single 1K image. Panels cycle automatically in the story reader."
            checked={storyboardEnabled}
            toggling={storyboardToggling}
            onToggle={async () => {
              setStoryboardToggling(true);
              const next = !storyboardEnabled;
              try {
                await setStoryboardMode(next);
                setStoryboardEnabled(next);
              } finally {
                setStoryboardToggling(false);
              }
            }}
          />

          <ToggleRow
            label="Manual Panel Timing"
            description="Override audio-synced panel cycling with a fixed duration. When off, panels advance at narration duration ÷ 4."
            checked={cycleOverride}
            toggling={cycleOverrideToggling}
            onToggle={async () => {
              setCycleOverrideToggling(true);
              const next = !cycleOverride;
              try {
                await setCycleOverride(next);
                setCycleOverrideState(next);
              } finally {
                setCycleOverrideToggling(false);
              }
            }}
          />

          {cycleOverride && (
            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Panel Duration</p>
              <p className="text-xs text-neutral-400 mb-3">Time each panel is shown (milliseconds). Minimum 500ms.</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={500}
                  step={100}
                  value={cycleMsInput}
                  onChange={(e) => setCycleMsInput(e.target.value)}
                  className="w-32 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="5000"
                />
                <span className="text-xs text-neutral-500">ms</span>
                <button
                  onClick={handleCycleMsSave}
                  disabled={cycleMsSaving || !cycleMsInput || parseInt(cycleMsInput, 10) < 500}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {cycleMsSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {cycleMs !== parseInt(cycleMsInput, 10) && parseInt(cycleMsInput, 10) >= 500 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
