'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getGlobalSettings,
  setCycleOverride,
  setCycleMs,
  setStoryboardVignette,
  setStoryLoadingNodeLabels,
  setStoryLoadingHintTypewriter,
  setTextTimeout,
  setImageTimeout,
  setTtsTimeout,
  setCloudSaveTimeout,
  setFreePlusCharacterSheets,
  setCreatorCharacterSheets,
  setVideoDownload,
  setVideoDownloadAdminBypass,
} from '@/app/actions/admin';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cycleOverride, setCycleOverrideState] = useState(false);
  const [cycleOverrideToggling, setCycleOverrideToggling] = useState(false);
  const [cycleMs, setCycleMsState] = useState(5000);
  const [cycleMsInput, setCycleMsInput] = useState('5000');
  const [cycleMsSaving, setCycleMsSaving] = useState(false);
  const [vignetteEnabled, setVignetteEnabled] = useState(true);
  const [vignetteToggling, setVignetteToggling] = useState(false);
  const [loadingNodeLabelsEnabled, setLoadingNodeLabelsEnabledState] = useState(true);
  const [loadingNodeLabelsToggling, setLoadingNodeLabelsToggling] = useState(false);
  const [loadingHintTypewriterEnabled, setLoadingHintTypewriterEnabledState] = useState(false);
  const [loadingHintTypewriterToggling, setLoadingHintTypewriterToggling] = useState(false);
  const [freePlusCharacterSheetsEnabled, setFreePlusCharacterSheetsEnabledState] = useState(false);
  const [freePlusCharacterSheetsToggling, setFreePlusCharacterSheetsToggling] = useState(false);
  const [creatorCharacterSheetsEnabled, setCreatorCharacterSheetsEnabledState] = useState(false);
  const [creatorCharacterSheetsToggling, setCreatorCharacterSheetsToggling] = useState(false);
  const [videoDownloadEnabled, setVideoDownloadEnabledState] = useState(false);
  const [videoDownloadToggling, setVideoDownloadToggling] = useState(false);
  const [videoDownloadAdminBypass, setVideoDownloadAdminBypassState] = useState(false);
  const [videoDownloadAdminBypassToggling, setVideoDownloadAdminBypassToggling] = useState(false);
  const [textTimeoutMs, setTextTimeoutMs] = useState(30000);
  const [textTimeoutInput, setTextTimeoutInput] = useState('30');
  const [textTimeoutSaving, setTextTimeoutSaving] = useState(false);
  const [imageTimeoutMs, setImageTimeoutMs] = useState(90000);
  const [imageTimeoutInput, setImageTimeoutInput] = useState('90');
  const [imageTimeoutSaving, setImageTimeoutSaving] = useState(false);
  const [ttsTimeoutMs, setTtsTimeoutMs] = useState(120000);
  const [ttsTimeoutInput, setTtsTimeoutInput] = useState('120');
  const [ttsTimeoutSaving, setTtsTimeoutSaving] = useState(false);
  const [cloudSaveTimeoutMs, setCloudSaveTimeoutMs] = useState(20000);
  const [cloudSaveTimeoutInput, setCloudSaveTimeoutInput] = useState('20');
  const [cloudSaveTimeoutSaving, setCloudSaveTimeoutSaving] = useState(false);

  useEffect(() => {
    getGlobalSettings()
      .then(({
        cycleOverride: co,
        cycleMs: cm,
        vignetteEnabled: ve,
        loadingNodeLabelsEnabled: labelsEnabled,
        loadingHintTypewriterEnabled: typewriterEnabled,
        freePlusCharacterSheetsEnabled: fpSheets,
        creatorCharacterSheetsEnabled: creatorSheets,
        videoDownloadEnabled: vidDl,
        videoDownloadAdminBypass: vidDlBypass,
        textTimeoutMs: tt,
        imageTimeoutMs: it,
        ttsTimeoutMs: at,
        cloudSaveTimeoutMs: st,
      }) => {
        setCycleOverrideState(co);
        setCycleMsState(cm);
        setCycleMsInput(String(cm));
        setVignetteEnabled(ve);
        setLoadingNodeLabelsEnabledState(labelsEnabled);
        setLoadingHintTypewriterEnabledState(typewriterEnabled);
        setFreePlusCharacterSheetsEnabledState(fpSheets);
        setCreatorCharacterSheetsEnabledState(creatorSheets);
        setVideoDownloadEnabledState(vidDl);
        setVideoDownloadAdminBypassState(vidDlBypass);
        setTextTimeoutMs(tt);
        setTextTimeoutInput(String(Math.round(tt / 1000)));
        setImageTimeoutMs(it);
        setImageTimeoutInput(String(Math.round(it / 1000)));
        setTtsTimeoutMs(at);
        setTtsTimeoutInput(String(Math.round(at / 1000)));
        setCloudSaveTimeoutMs(st);
        setCloudSaveTimeoutInput(String(Math.round(st / 1000)));
        setLoading(false);
      })
      .catch((err) => {
        console.error('GlobalSettings: failed to load settings:', err);
        setLoadError(err.message || 'Failed to load settings');
        setLoading(false);
      });
  }, []);

  async function handleCycleMsSave() {
    const ms = parseInt(cycleMsInput, 10);
    if (!Number.isFinite(ms) || ms < 500) return;
    setCycleMsSaving(true);
    try {
      await setCycleMs(ms);
      setCycleMsState(ms);
    } finally {
      setCycleMsSaving(false);
    }
  }

  async function handleTimeoutSave(
    inputVal: string,
    minSec: number,
    setter: (ms: number) => Promise<void>,
    setMs: (ms: number) => void,
    setSaving: (v: boolean) => void
  ) {
    const sec = parseInt(inputVal, 10);
    if (!Number.isFinite(sec) || sec < minSec) return;
    setSaving(true);
    try {
      await setter(sec * 1000);
      setMs(sec * 1000);
    } finally {
      setSaving(false);
    }
  }

  const parsedMs = parseInt(cycleMsInput, 10);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-1 text-2xl text-neutral-100">Global Settings</h1>
      <p className="mb-8 text-sm text-neutral-400">Runtime feature flags that shape story generation, playback timing, and character reference behavior across the app.</p>

      {loadError && (
        <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          Failed to load settings - {loadError}. Try refreshing the page.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading settings...</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Storyboard</h2>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              Storyboard generation is always on now. Every beat renders as a 2x2 panel grid at 2K so playback, narration timing, and visual continuity stay consistent across the app.
            </div>

            <ToggleRow
              label="Manual Panel Timing"
              description="Override audio-synced panel cycling with a fixed duration. When off, panels advance at narration duration / 4."
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

            <ToggleRow
              label="Storyboard Vignette"
              description="Apply a soft vignette to storyboard artwork only, while keeping UI chrome above the effect."
              checked={vignetteEnabled}
              toggling={vignetteToggling}
              onToggle={async () => {
                setVignetteToggling(true);
                const next = !vignetteEnabled;
                try {
                  await setStoryboardVignette(next);
                  setVignetteEnabled(next);
                } finally {
                  setVignetteToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Show Loading Step Labels"
              description="Show or hide the small labels under the loading progress nodes while a beat is being created. Turn this off if you want the cleaner node-only version."
              checked={loadingNodeLabelsEnabled}
              toggling={loadingNodeLabelsToggling}
              onToggle={async () => {
                setLoadingNodeLabelsToggling(true);
                const next = !loadingNodeLabelsEnabled;
                try {
                  await setStoryLoadingNodeLabels(next);
                  setLoadingNodeLabelsEnabledState(next);
                } finally {
                  setLoadingNodeLabelsToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Typewriter Loading Hints"
              description="Animate the rotating hint text with a typewriter reveal. Turn this off for the simpler fade-only version."
              checked={loadingHintTypewriterEnabled}
              toggling={loadingHintTypewriterToggling}
              onToggle={async () => {
                setLoadingHintTypewriterToggling(true);
                const next = !loadingHintTypewriterEnabled;
                try {
                  await setStoryLoadingHintTypewriter(next);
                  setLoadingHintTypewriterEnabledState(next);
                } finally {
                  setLoadingHintTypewriterToggling(false);
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
                    disabled={cycleMsSaving || !Number.isFinite(parsedMs) || parsedMs < 500}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                  >
                    {cycleMsSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                  </button>
                  {cycleMs !== parsedMs && parsedMs >= 500 && (
                    <span className="text-xs text-amber-400">Unsaved</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Character References</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Decide which plan tiers get richer character sheets instead of the default 0.5K single full-body portrait.
            </p>

            <ToggleRow
              label="Enable 0.5K Character Sheets for Free and Plus"
              description="When this is on, Free and Plus stories use a compact 0.5K character sheet with a close-up, front view, and 3/4 view. When this is off, they fall back to the faster 0.5K single portrait."
              checked={freePlusCharacterSheetsEnabled}
              toggling={freePlusCharacterSheetsToggling}
              onToggle={async () => {
                setFreePlusCharacterSheetsToggling(true);
                const next = !freePlusCharacterSheetsEnabled;
                try {
                  await setFreePlusCharacterSheets(next);
                  setFreePlusCharacterSheetsEnabledState(next);
                } finally {
                  setFreePlusCharacterSheetsToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Enable Character Sheets for Creators"
              description="When this is on, Studio stories default to a 0.5K character sheet and can turn on 1K sheets in Creator Settings during setup. When this is off, creators also fall back to the default 0.5K single portrait."
              checked={creatorCharacterSheetsEnabled}
              toggling={creatorCharacterSheetsToggling}
              onToggle={async () => {
                setCreatorCharacterSheetsToggling(true);
                const next = !creatorCharacterSheetsEnabled;
                try {
                  await setCreatorCharacterSheets(next);
                  setCreatorCharacterSheetsEnabledState(next);
                } finally {
                  setCreatorCharacterSheetsToggling(false);
                }
              }}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Video Export</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Master toggle for storyline video download. When enabled, per-plan access is controlled via the Downloads toggle in Pricing Studio.
            </p>

            <ToggleRow
              label="Enable Video Download"
              description="Allow users to export published storylines as MP4 video files. Which plans can download is set in Pricing → Plans → Downloads."
              checked={videoDownloadEnabled}
              toggling={videoDownloadToggling}
              onToggle={async () => {
                setVideoDownloadToggling(true);
                const next = !videoDownloadEnabled;
                try {
                  await setVideoDownload(next);
                  setVideoDownloadEnabledState(next);
                } finally {
                  setVideoDownloadToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Admin Bypass (your account only)"
              description="Skip the plan-level paywall for your admin account so you can test video export without needing a Plus/Studio subscription. Other users are unaffected."
              checked={videoDownloadAdminBypass}
              toggling={videoDownloadAdminBypassToggling}
              onToggle={async () => {
                setVideoDownloadAdminBypassToggling(true);
                const next = !videoDownloadAdminBypass;
                try {
                  await setVideoDownloadAdminBypass(next);
                  setVideoDownloadAdminBypassState(next);
                } finally {
                  setVideoDownloadAdminBypassToggling(false);
                }
              }}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Generation Timeouts</h2>
            <p className="text-xs text-neutral-400 -mt-2">All values in seconds. Changes take effect on the next generation call.</p>

            {([
              { label: 'Text / Story', description: 'Max wait for a story beat (JSON) from Gemini.', value: textTimeoutMs, input: textTimeoutInput, setInput: setTextTimeoutInput, saving: textTimeoutSaving, setSaving: setTextTimeoutSaving, setter: setTextTimeout, setMs: setTextTimeoutMs, min: 5, defaultSec: 30 },
              { label: 'Image', description: 'Max wait for image generation from Gemini.', value: imageTimeoutMs, input: imageTimeoutInput, setInput: setImageTimeoutInput, saving: imageTimeoutSaving, setSaving: setImageTimeoutSaving, setter: setImageTimeout, setMs: setImageTimeoutMs, min: 10, defaultSec: 90 },
              { label: 'Audio / TTS', description: 'Max wait for text-to-speech narration from Gemini.', value: ttsTimeoutMs, input: ttsTimeoutInput, setInput: setTtsTimeoutInput, saving: ttsTimeoutSaving, setSaving: setTtsTimeoutSaving, setter: setTtsTimeout, setMs: setTtsTimeoutMs, min: 10, defaultSec: 120 },
              { label: 'Cloud Save Guard', description: 'Max wait before flipping a stuck save back to unsaved for retry.', value: cloudSaveTimeoutMs, input: cloudSaveTimeoutInput, setInput: setCloudSaveTimeoutInput, saving: cloudSaveTimeoutSaving, setSaving: setCloudSaveTimeoutSaving, setter: setCloudSaveTimeout, setMs: setCloudSaveTimeoutMs, min: 5, defaultSec: 20 },
            ] as const).map(({ label, description, value, input, setInput, saving, setSaving, setter, setMs, min, defaultSec }) => {
              const parsed = parseInt(input, 10);
              const currentSec = Math.round(value / 1000);
              return (
                <div key={label} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-1">{label}</p>
                  <p className="text-xs text-neutral-400 mb-3">{description} Default: {defaultSec}s.</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={min}
                      step={5}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder={String(defaultSec)}
                    />
                    <span className="text-xs text-neutral-500">s</span>
                    <button
                      onClick={() => handleTimeoutSave(input, min, setter, setMs, setSaving)}
                      disabled={saving || !Number.isFinite(parsed) || parsed < min}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                    </button>
                    {currentSec !== parsed && parsed >= min && (
                      <span className="text-xs text-amber-400">Unsaved</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
