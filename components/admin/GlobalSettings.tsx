'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getGlobalSettings,
  setCycleOverride,
  setCycleMs,
  setStoryboardVignette,
  setStoryboardVignetteAmountPercent,
  setStoryboardImageSize,
  setStoryboardWebpCompression,
  setStoryboardWebpQualityPercent,
  setStoryboardClientProcessing,
  setStoryLoadingNodeLabels,
  setStoryLoadingHintTypewriter,
  setStoryLoadingReaderAnticipationMs,
  setStoryLoadingReaderStoryText,
  setStoryLoadingReaderOptions,
  setStoryLoadingReaderScrollSpeed,
  setStoryUiTextLineCount,
  setStoryUiAutoScroll,
  setTextTimeout,
  setImageTimeout,
  setTtsTimeout,
  setCloudSaveTimeout,
  setAuthoringWordCap,
  setPreviewSeedPlanPriceCoins,
  setFreePlusCharacterSheets,
  setCreatorCharacterSheets,
  setVideoDownload,
  setVideoDownloadAdminBypass,
} from '@/app/actions/admin';
import {
  MAX_STORY_UI_TEXT_LINE_COUNT,
  MIN_STORY_UI_TEXT_LINE_COUNT,
  type StoryboardImageSize,
} from '@/lib/types/storyboard-settings';

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
  const [vignetteAmountPercent, setVignetteAmountPercent] = useState(100);
  const [vignetteAmountInput, setVignetteAmountInput] = useState('100');
  const [vignetteAmountSaving, setVignetteAmountSaving] = useState(false);
  const [storyboardImageSize, setStoryboardImageSizeState] = useState<StoryboardImageSize>('1K');
  const [storyboardImageSizeSaving, setStoryboardImageSizeSaving] = useState(false);
  const [storyboardWebpCompressionEnabled, setStoryboardWebpCompressionEnabledState] = useState(false);
  const [storyboardWebpCompressionToggling, setStoryboardWebpCompressionToggling] = useState(false);
  const [storyboardWebpQualityPercent, setStoryboardWebpQualityPercentState] = useState(85);
  const [storyboardWebpQualityInput, setStoryboardWebpQualityInput] = useState('85');
  const [storyboardWebpQualitySaving, setStoryboardWebpQualitySaving] = useState(false);
  const [storyboardClientProcessingEnabled, setStoryboardClientProcessingEnabledState] = useState(false);
  const [storyboardClientProcessingToggling, setStoryboardClientProcessingToggling] = useState(false);
  const [storyboardLayoutMode, setStoryboardLayoutModeState] = useState<'2x2'>('2x2');
  const [loadingNodeLabelsEnabled, setLoadingNodeLabelsEnabledState] = useState(true);
  const [loadingNodeLabelsToggling, setLoadingNodeLabelsToggling] = useState(false);
  const [loadingHintTypewriterEnabled, setLoadingHintTypewriterEnabledState] = useState(false);
  const [loadingHintTypewriterToggling, setLoadingHintTypewriterToggling] = useState(false);
  const [loadingReaderAnticipationMs, setLoadingReaderAnticipationMsState] = useState(10000);
  const [loadingReaderAnticipationInput, setLoadingReaderAnticipationInput] = useState('10');
  const [loadingReaderAnticipationSaving, setLoadingReaderAnticipationSaving] = useState(false);
  const [loadingReaderStoryTextEnabled, setLoadingReaderStoryTextEnabledState] = useState(true);
  const [loadingReaderStoryTextToggling, setLoadingReaderStoryTextToggling] = useState(false);
  const [loadingReaderOptionsEnabled, setLoadingReaderOptionsEnabledState] = useState(true);
  const [loadingReaderOptionsToggling, setLoadingReaderOptionsToggling] = useState(false);
  const [loadingReaderScrollSpeedPxPerSecond, setLoadingReaderScrollSpeedPxPerSecondState] = useState(24);
  const [loadingReaderScrollSpeedInput, setLoadingReaderScrollSpeedInput] = useState('24');
  const [loadingReaderScrollSpeedSaving, setLoadingReaderScrollSpeedSaving] = useState(false);
  const [storyUiTextLineCount, setStoryUiTextLineCountState] = useState(7);
  const [storyUiTextLineCountInput, setStoryUiTextLineCountInput] = useState('7');
  const [storyUiTextLineCountSaving, setStoryUiTextLineCountSaving] = useState(false);
  const [storyUiAutoScrollEnabled, setStoryUiAutoScrollEnabledState] = useState(true);
  const [storyUiAutoScrollToggling, setStoryUiAutoScrollToggling] = useState(false);
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
  const [authoringWordCap, setAuthoringWordCapState] = useState(500);
  const [authoringWordCapInput, setAuthoringWordCapInput] = useState('500');
  const [authoringWordCapSaving, setAuthoringWordCapSaving] = useState(false);
  const [previewSeedPlanPriceCoins, setPreviewSeedPlanPriceCoinsState] = useState(0);
  const [previewSeedPlanPriceCoinsInput, setPreviewSeedPlanPriceCoinsInput] = useState('0');
  const [previewSeedPlanPriceCoinsSaving, setPreviewSeedPlanPriceCoinsSaving] = useState(false);

  useEffect(() => {
    getGlobalSettings()
      .then(({
        cycleOverride: co,
        cycleMs: cm,
        vignetteEnabled: ve,
        vignetteAmountPercent: vap,
        storyboardImageSize: imageSize,
        storyboardWebpCompressionEnabled: webpCompressionEnabled,
        storyboardWebpQualityPercent: webpQualityPercent,
        storyboardClientProcessingEnabled: clientProcessingEnabled,
        storyboardLayoutMode: layoutMode,
        loadingNodeLabelsEnabled: labelsEnabled,
        loadingHintTypewriterEnabled: typewriterEnabled,
        loadingReaderAnticipationMs: readerAnticipationMs,
        loadingReaderStoryTextEnabled: readerStoryTextEnabled,
        loadingReaderOptionsEnabled: readerOptionsEnabled,
        loadingReaderScrollSpeedPxPerSecond: readerScrollSpeed,
        storyUiTextLineCount: uiTextLineCount,
        storyUiAutoScrollEnabled: uiAutoScrollEnabled,
        freePlusCharacterSheetsEnabled: fpSheets,
        creatorCharacterSheetsEnabled: creatorSheets,
        videoDownloadEnabled: vidDl,
        videoDownloadAdminBypass: vidDlBypass,
        textTimeoutMs: tt,
        imageTimeoutMs: it,
        ttsTimeoutMs: at,
        cloudSaveTimeoutMs: st,
        authoringWordCap: awc,
        previewSeedPlanPriceCoins: previewPriceCoins,
      }) => {
        setCycleOverrideState(co);
        setCycleMsState(cm);
        setCycleMsInput(String(cm));
        setVignetteEnabled(ve);
        setVignetteAmountPercent(vap);
        setVignetteAmountInput(String(vap));
        setStoryboardImageSizeState(imageSize);
        setStoryboardWebpCompressionEnabledState(webpCompressionEnabled);
        setStoryboardWebpQualityPercentState(webpQualityPercent);
        setStoryboardWebpQualityInput(String(webpQualityPercent));
        setStoryboardClientProcessingEnabledState(clientProcessingEnabled);
        setStoryboardLayoutModeState(layoutMode);
        setLoadingNodeLabelsEnabledState(labelsEnabled);
        setLoadingHintTypewriterEnabledState(typewriterEnabled);
        setLoadingReaderAnticipationMsState(readerAnticipationMs);
        setLoadingReaderAnticipationInput(String(Math.round(readerAnticipationMs / 1000)));
        setLoadingReaderStoryTextEnabledState(readerStoryTextEnabled);
        setLoadingReaderOptionsEnabledState(readerOptionsEnabled);
        setLoadingReaderScrollSpeedPxPerSecondState(readerScrollSpeed);
        setLoadingReaderScrollSpeedInput(String(readerScrollSpeed));
        setStoryUiTextLineCountState(uiTextLineCount);
        setStoryUiTextLineCountInput(String(uiTextLineCount));
        setStoryUiAutoScrollEnabledState(uiAutoScrollEnabled);
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
        setAuthoringWordCapState(awc);
        setAuthoringWordCapInput(String(awc));
        setPreviewSeedPlanPriceCoinsState(previewPriceCoins);
        setPreviewSeedPlanPriceCoinsInput(String(previewPriceCoins));
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

  async function handleVignetteAmountSave() {
    const percent = parseInt(vignetteAmountInput, 10);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    setVignetteAmountSaving(true);
    try {
      await setStoryboardVignetteAmountPercent(percent);
      setVignetteAmountPercent(percent);
    } finally {
      setVignetteAmountSaving(false);
    }
  }

  async function handleStoryboardImageSizeSave(size: StoryboardImageSize) {
    if (size === storyboardImageSize) return;
    setStoryboardImageSizeSaving(true);
    try {
      await setStoryboardImageSize(size);
      setStoryboardImageSizeState(size);
    } finally {
      setStoryboardImageSizeSaving(false);
    }
  }

  async function handleStoryboardWebpQualitySave() {
    const percent = parseInt(storyboardWebpQualityInput, 10);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) return;
    setStoryboardWebpQualitySaving(true);
    try {
      await setStoryboardWebpQualityPercent(percent);
      setStoryboardWebpQualityPercentState(percent);
    } finally {
      setStoryboardWebpQualitySaving(false);
    }
  }

  async function handleLoadingReaderAnticipationSave() {
    const sec = parseInt(loadingReaderAnticipationInput, 10);
    if (!Number.isFinite(sec) || sec < 0) return;
    setLoadingReaderAnticipationSaving(true);
    try {
      const ms = sec * 1000;
      await setStoryLoadingReaderAnticipationMs(ms);
      setLoadingReaderAnticipationMsState(ms);
    } finally {
      setLoadingReaderAnticipationSaving(false);
    }
  }

  async function handleLoadingReaderScrollSpeedSave() {
    const pxPerSecond = parseInt(loadingReaderScrollSpeedInput, 10);
    if (!Number.isFinite(pxPerSecond) || pxPerSecond < 1) return;
    setLoadingReaderScrollSpeedSaving(true);
    try {
      await setStoryLoadingReaderScrollSpeed(pxPerSecond);
      setLoadingReaderScrollSpeedPxPerSecondState(pxPerSecond);
    } finally {
      setLoadingReaderScrollSpeedSaving(false);
    }
  }

  async function handleStoryUiTextLineCountSave() {
    const lines = parseInt(storyUiTextLineCountInput, 10);
    if (!Number.isFinite(lines) || lines < MIN_STORY_UI_TEXT_LINE_COUNT || lines > MAX_STORY_UI_TEXT_LINE_COUNT) return;
    setStoryUiTextLineCountSaving(true);
    try {
      await setStoryUiTextLineCount(lines);
      setStoryUiTextLineCountState(lines);
    } finally {
      setStoryUiTextLineCountSaving(false);
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

  async function handleAuthoringWordCapSave() {
    const words = parseInt(authoringWordCapInput, 10);
    if (!Number.isFinite(words) || words < 50) return;
    setAuthoringWordCapSaving(true);
    try {
      await setAuthoringWordCap(words);
      setAuthoringWordCapState(words);
    } finally {
      setAuthoringWordCapSaving(false);
    }
  }

  async function handlePreviewSeedPlanPriceSave() {
    const coins = parseInt(previewSeedPlanPriceCoinsInput, 10);
    if (!Number.isFinite(coins) || coins < 0 || coins % 10 !== 0) return;
    setPreviewSeedPlanPriceCoinsSaving(true);
    try {
      await setPreviewSeedPlanPriceCoins(coins);
      setPreviewSeedPlanPriceCoinsState(coins);
    } finally {
      setPreviewSeedPlanPriceCoinsSaving(false);
    }
  }

  const parsedMs = parseInt(cycleMsInput, 10);
  const parsedVignetteAmountPercent = parseInt(vignetteAmountInput, 10);
  const parsedStoryboardWebpQualityPercent = parseInt(storyboardWebpQualityInput, 10);
  const storyboardCompressionControlsEnabled = storyboardClientProcessingEnabled && storyboardWebpCompressionEnabled;
  const parsedLoadingReaderAnticipationSec = parseInt(loadingReaderAnticipationInput, 10);
  const parsedLoadingReaderScrollSpeed = parseInt(loadingReaderScrollSpeedInput, 10);
  const parsedStoryUiTextLineCount = parseInt(storyUiTextLineCountInput, 10);
  const parsedAuthoringWordCap = parseInt(authoringWordCapInput, 10);
  const parsedPreviewSeedPlanPriceCoins = parseInt(previewSeedPlanPriceCoinsInput, 10);

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
              Storyboard generation is always on. Every beat renders as a 2x2 panel grid; image size and browser-side WebP processing apply to new beat images only.
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Storyboard Image Size</p>
              <p className="text-xs text-neutral-400 mb-3">Gemini output size for new per-beat storyboard images.</p>
              <div className="inline-flex rounded-lg border border-white/10 bg-neutral-950/60 p-1">
                {(['1K', '2K'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => handleStoryboardImageSizeSave(size)}
                    disabled={storyboardImageSizeSaving}
                    className={`rounded-md px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                      storyboardImageSize === size
                        ? 'bg-emerald-500 text-neutral-950'
                        : 'text-neutral-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {storyboardImageSizeSaving && (
                <span className="ml-3 inline-flex items-center gap-1 text-xs text-neutral-400">
                  <Loader2 size={12} className="animate-spin" />Saving
                </span>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Storyboard Layout</p>
              <p className="text-xs text-neutral-400 mb-3">Layout mode is stored for future formats. The active runtime mode remains the four-panel storyboard.</p>
              <div className="inline-flex rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
                {storyboardLayoutMode} grid
              </div>
            </div>

            <ToggleRow
              label="Client-Side Image Processing"
              description="Allow the browser to process storyboard images after Gemini returns them. Turn off for direct 1K output testing."
              checked={storyboardClientProcessingEnabled}
              toggling={storyboardClientProcessingToggling}
              onToggle={async () => {
                setStoryboardClientProcessingToggling(true);
                const next = !storyboardClientProcessingEnabled;
                try {
                  await setStoryboardClientProcessing(next);
                  setStoryboardClientProcessingEnabledState(next);
                } finally {
                  setStoryboardClientProcessingToggling(false);
                }
              }}
            />

            <ToggleRow
              label="WebP Compression"
              description="Encode storyboard images as WebP in the browser when client-side processing is also enabled."
              checked={storyboardWebpCompressionEnabled}
              toggling={storyboardWebpCompressionToggling}
              onToggle={async () => {
                setStoryboardWebpCompressionToggling(true);
                const next = !storyboardWebpCompressionEnabled;
                try {
                  await setStoryboardWebpCompression(next);
                  setStoryboardWebpCompressionEnabledState(next);
                } finally {
                  setStoryboardWebpCompressionToggling(false);
                }
              }}
            />

            <div className={`rounded-xl border border-white/10 bg-neutral-900/60 p-4 ${storyboardCompressionControlsEnabled ? '' : 'opacity-60'}`}>
              <p className="text-sm font-medium text-neutral-100 mb-1">WebP Quality</p>
              <p className="text-xs text-neutral-400 mb-3">Compression quality from 1 to 100. Active only when both processing and WebP compression are on.</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={storyboardWebpQualityInput}
                  disabled={!storyboardCompressionControlsEnabled}
                  onChange={(e) => setStoryboardWebpQualityInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed"
                  placeholder="85"
                />
                <span className="text-xs text-neutral-500">%</span>
                <button
                  onClick={handleStoryboardWebpQualitySave}
                  disabled={
                    !storyboardCompressionControlsEnabled ||
                    storyboardWebpQualitySaving ||
                    !Number.isFinite(parsedStoryboardWebpQualityPercent) ||
                    parsedStoryboardWebpQualityPercent < 1 ||
                    parsedStoryboardWebpQualityPercent > 100
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {storyboardWebpQualitySaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {storyboardWebpQualityPercent !== parsedStoryboardWebpQualityPercent && parsedStoryboardWebpQualityPercent >= 1 && parsedStoryboardWebpQualityPercent <= 100 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedStoryboardWebpQualityPercent) && (parsedStoryboardWebpQualityPercent < 1 || parsedStoryboardWebpQualityPercent > 100) && (
                <p className="mt-3 text-xs text-amber-400">Use a value from 1 to 100.</p>
              )}
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

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Vignette Amount</p>
              <p className="text-xs text-neutral-400 mb-3">Intensity from 0 to 100. A value of 100 matches the current vignette strength.</p>
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Number.isFinite(parsedVignetteAmountPercent) ? Math.min(100, Math.max(0, parsedVignetteAmountPercent)) : vignetteAmountPercent}
                  onChange={(e) => setVignetteAmountInput(e.target.value)}
                  className="w-full max-w-sm accent-emerald-400"
                />
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={vignetteAmountInput}
                    onChange={(e) => setVignetteAmountInput(e.target.value)}
                    className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="100"
                  />
                  <span className="text-xs text-neutral-500">%</span>
                  <button
                    onClick={handleVignetteAmountSave}
                    disabled={
                      vignetteAmountSaving ||
                      !Number.isFinite(parsedVignetteAmountPercent) ||
                      parsedVignetteAmountPercent < 0 ||
                      parsedVignetteAmountPercent > 100
                    }
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                  >
                    {vignetteAmountSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                  </button>
                  {vignetteAmountPercent !== parsedVignetteAmountPercent && parsedVignetteAmountPercent >= 0 && parsedVignetteAmountPercent <= 100 && (
                    <span className="text-xs text-amber-400">Unsaved</span>
                  )}
                </div>
              </div>
              {Number.isFinite(parsedVignetteAmountPercent) && (parsedVignetteAmountPercent < 0 || parsedVignetteAmountPercent > 100) && (
                <p className="mt-3 text-xs text-amber-400">Use a value from 0 to 100.</p>
              )}
            </div>

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
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">UI</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Shared reader controls for live stories and published playback.
            </p>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Story Text Lines</p>
              <p className="text-xs text-neutral-400 mb-3">
                Visible story text height before scrolling. Default: 7 lines.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_STORY_UI_TEXT_LINE_COUNT}
                  max={MAX_STORY_UI_TEXT_LINE_COUNT}
                  step={1}
                  value={storyUiTextLineCountInput}
                  onChange={(e) => setStoryUiTextLineCountInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="7"
                />
                <span className="text-xs text-neutral-500">lines</span>
                <button
                  onClick={handleStoryUiTextLineCountSave}
                  disabled={
                    storyUiTextLineCountSaving ||
                    !Number.isFinite(parsedStoryUiTextLineCount) ||
                    parsedStoryUiTextLineCount < MIN_STORY_UI_TEXT_LINE_COUNT ||
                    parsedStoryUiTextLineCount > MAX_STORY_UI_TEXT_LINE_COUNT
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {storyUiTextLineCountSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {storyUiTextLineCount !== parsedStoryUiTextLineCount && parsedStoryUiTextLineCount >= MIN_STORY_UI_TEXT_LINE_COUNT && parsedStoryUiTextLineCount <= MAX_STORY_UI_TEXT_LINE_COUNT && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedStoryUiTextLineCount) && (parsedStoryUiTextLineCount < MIN_STORY_UI_TEXT_LINE_COUNT || parsedStoryUiTextLineCount > MAX_STORY_UI_TEXT_LINE_COUNT) && (
                <p className="mt-3 text-xs text-amber-400">
                  Use a value from {MIN_STORY_UI_TEXT_LINE_COUNT} to {MAX_STORY_UI_TEXT_LINE_COUNT}.
                </p>
              )}
            </div>

            <ToggleRow
              label="Auto-scroll Story Button"
              description="Show the reader control that automatically scrolls long story text."
              checked={storyUiAutoScrollEnabled}
              toggling={storyUiAutoScrollToggling}
              onToggle={async () => {
                setStoryUiAutoScrollToggling(true);
                const next = !storyUiAutoScrollEnabled;
                try {
                  await setStoryUiAutoScroll(next);
                  setStoryUiAutoScrollEnabledState(next);
                } finally {
                  setStoryUiAutoScrollToggling(false);
                }
              }}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Loader Screen</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Controls the modal shown while new story beats are being generated.
            </p>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Anticipation Time</p>
              <p className="text-xs text-neutral-400 mb-3">
                Minimum time to hold the anticipation copy before falling back to previous story text. Generated story text still appears immediately when it is ready. Default: 10s.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={loadingReaderAnticipationInput}
                  onChange={(e) => setLoadingReaderAnticipationInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="10"
                />
                <span className="text-xs text-neutral-500">s</span>
                <button
                  onClick={handleLoadingReaderAnticipationSave}
                  disabled={loadingReaderAnticipationSaving || !Number.isFinite(parsedLoadingReaderAnticipationSec) || parsedLoadingReaderAnticipationSec < 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {loadingReaderAnticipationSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {Math.round(loadingReaderAnticipationMs / 1000) !== parsedLoadingReaderAnticipationSec && parsedLoadingReaderAnticipationSec >= 0 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <ToggleRow
              label="Show Story Text"
              description="Reveal the generated beat text in the loader as soon as it is ready. When off, the anticipation copy loops until the beat is ready."
              checked={loadingReaderStoryTextEnabled}
              toggling={loadingReaderStoryTextToggling}
              onToggle={async () => {
                setLoadingReaderStoryTextToggling(true);
                const next = !loadingReaderStoryTextEnabled;
                try {
                  await setStoryLoadingReaderStoryText(next);
                  setLoadingReaderStoryTextEnabledState(next);
                } finally {
                  setLoadingReaderStoryTextToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Show Branching Options"
              description="Show non-clickable generated branch previews after the story text has finished scrolling."
              checked={loadingReaderOptionsEnabled}
              toggling={loadingReaderOptionsToggling}
              onToggle={async () => {
                setLoadingReaderOptionsToggling(true);
                const next = !loadingReaderOptionsEnabled;
                try {
                  await setStoryLoadingReaderOptions(next);
                  setLoadingReaderOptionsEnabledState(next);
                } finally {
                  setLoadingReaderOptionsToggling(false);
                }
              }}
            />

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Story Text Scrolling Speed</p>
              <p className="text-xs text-neutral-400 mb-3">Auto-scroll speed for generated story text. Default: 24 px/s.</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={loadingReaderScrollSpeedInput}
                  onChange={(e) => setLoadingReaderScrollSpeedInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="24"
                />
                <span className="text-xs text-neutral-500">px/s</span>
                <button
                  onClick={handleLoadingReaderScrollSpeedSave}
                  disabled={loadingReaderScrollSpeedSaving || !Number.isFinite(parsedLoadingReaderScrollSpeed) || parsedLoadingReaderScrollSpeed < 1}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {loadingReaderScrollSpeedSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {loadingReaderScrollSpeedPxPerSecond !== parsedLoadingReaderScrollSpeed && parsedLoadingReaderScrollSpeed >= 1 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <ToggleRow
              label="Show Loading Step Labels"
              description="Show or hide the small labels under the loading progress nodes while a beat is being created."
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
              label="Typewriter Loading Text"
              description="Animate the anticipation line with a typewriter reveal."
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
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Authoring</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Shared limits and preview pricing for prompt-based and seeded story setup.
            </p>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Shared authoring word cap</p>
              <p className="text-xs text-neutral-400 mb-3">
                Applies to prompt mode prompts and seeded mode source text plus extra guidance. Titles are excluded.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={50}
                  step={25}
                  value={authoringWordCapInput}
                  onChange={(e) => setAuthoringWordCapInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="500"
                />
                <span className="text-xs text-neutral-500">words</span>
                <button
                  onClick={handleAuthoringWordCapSave}
                  disabled={authoringWordCapSaving || !Number.isFinite(parsedAuthoringWordCap) || parsedAuthoringWordCap < 50}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {authoringWordCapSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {authoringWordCap !== parsedAuthoringWordCap && parsedAuthoringWordCap >= 50 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Seed preview price</p>
              <p className="text-xs text-neutral-400 mb-3">
                Preview is text-only. Set 0 to keep it free, or charge in multiples of 10 coins so it stays aligned with beat-based wallet billing.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={previewSeedPlanPriceCoinsInput}
                  onChange={(e) => setPreviewSeedPlanPriceCoinsInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="0"
                />
                <span className="text-xs text-neutral-500">coins</span>
                <button
                  onClick={handlePreviewSeedPlanPriceSave}
                  disabled={
                    previewSeedPlanPriceCoinsSaving ||
                    !Number.isFinite(parsedPreviewSeedPlanPriceCoins) ||
                    parsedPreviewSeedPlanPriceCoins < 0 ||
                    parsedPreviewSeedPlanPriceCoins % 10 !== 0
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {previewSeedPlanPriceCoinsSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {previewSeedPlanPriceCoins !== parsedPreviewSeedPlanPriceCoins && parsedPreviewSeedPlanPriceCoins >= 0 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedPreviewSeedPlanPriceCoins) && parsedPreviewSeedPlanPriceCoins % 10 !== 0 && (
                <p className="mt-3 text-xs text-amber-400">Use multiples of 10 coins.</p>
              )}
            </div>
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
