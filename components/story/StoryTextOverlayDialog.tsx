'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  AlignVerticalJustifyCenter,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  WholeWord,
  WrapText,
  X,
} from 'lucide-react';

import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { buildStoryTextOverlayCaptions } from '@/lib/story-overlay/captions';
import {
  getStoryTextOverlayGenerationEligibility,
  hasStoryTextOverlayTimedAlignment,
} from '@/lib/story-overlay/generation';
import {
  DEFAULT_STORY_TEXT_OVERLAY_STYLE,
  getStoryTextFontPresetsForLanguage,
  MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  normalizeStoryTextOverlayStyle,
  STORY_TEXT_OVERLAY_HIGHLIGHT_SCALE_MAX,
  STORY_TEXT_OVERLAY_HIGHLIGHT_SCALE_MIN,
} from '@/lib/story-overlay/styles';
import type {
  StoryTextOverlayAlign,
  StoryTextOverlayMode,
  StoryTextOverlayPosition,
  StoryTextOverlayStyle,
} from '@/lib/story-overlay/types';
import type { StoryAspectRatio, StoryBeat, StoryLanguage } from '@/lib/types/story';

import SegmentedControl from '@/components/ui/SegmentedControl';
import { ReelStyleColorControl } from '@/components/ui/ReelColorPicker';
import StoryStoryboardPlayer from './StoryStoryboardPlayer';

type StoryTextOverlaySettingsInput = {
  enabled: boolean;
  mode: StoryTextOverlayMode;
  style: StoryTextOverlayStyle;
};

type StoryTextOverlayBeatGenerationPreviewResult = {
  nodeId: string;
  status: 'synced' | 'fallback';
  storyTextOverlayEnabled: boolean;
  storyTextOverlayMode: StoryTextOverlayMode;
  storyTextOverlayStyle: StoryTextOverlayStyle;
  storyTextOverlayCaptions: NonNullable<StoryBeat['storyTextOverlayCaptions']>;
  storyTextOverlayAlignment: NonNullable<StoryBeat['storyTextOverlayAlignment']>;
};

type StoryTextOverlayStoryGenerationPreviewResult = {
  generated: number;
  fallback: number;
  skipped: number;
  failed: number;
  results: Array<{
    nodeId: string;
    status: 'synced' | 'fallback' | 'skipped' | 'failed';
    message?: string;
    storyTextOverlayCaptions?: StoryBeat['storyTextOverlayCaptions'];
    storyTextOverlayAlignment?: StoryBeat['storyTextOverlayAlignment'];
  }>;
};

interface StoryTextOverlayDialogProps {
  open: boolean;
  nodeId: string;
  beat: StoryBeat;
  aspectRatio: StoryAspectRatio;
  language: StoryLanguage;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  wordsPerLine: number;
  onClose: () => void;
  onSave: (settings: {
    enabled: boolean;
    mode: StoryTextOverlayMode;
    style: StoryTextOverlayStyle;
  }) => Promise<void>;
  onGenerateBeat?: (settings: StoryTextOverlaySettingsInput) => Promise<StoryTextOverlayBeatGenerationPreviewResult>;
  onGenerateStory?: (settings: StoryTextOverlaySettingsInput) => Promise<StoryTextOverlayStoryGenerationPreviewResult>;
}

function RangeControl({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-neutral-400">
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-emerald-400"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-neutral-500">{value}</span>
    </label>
  );
}

export default function StoryTextOverlayDialog({
  open,
  nodeId,
  beat,
  aspectRatio,
  language,
  vignetteEnabled,
  vignetteAmountPercent,
  wordsPerLine,
  onClose,
  onSave,
  onGenerateBeat,
  onGenerateStory,
}: StoryTextOverlayDialogProps) {
  const {
    playbackState,
    togglePlayPause,
    stop,
    currentTimeMs,
    durationMs,
    seekTo,
  } = useAudioPlayer(open ? beat.audioUrl : undefined, `story-text-overlay:${nodeId}`);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<StoryTextOverlayMode>('word');
  const [style, setStyle] = useState<StoryTextOverlayStyle>(DEFAULT_STORY_TEXT_OVERLAY_STYLE);
  const [isSaving, setIsSaving] = useState(false);
  const [generationScope, setGenerationScope] = useState<'beat' | 'story' | null>(null);
  const [previewCaptions, setPreviewCaptions] = useState<StoryBeat['storyTextOverlayCaptions']>();
  const [previewAlignment, setPreviewAlignment] = useState<StoryBeat['storyTextOverlayAlignment']>();
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isGenerating = generationScope !== null;
  const isBusy = isSaving || isGenerating;

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    setEnabled(beat.storyTextOverlayEnabled !== false);
    setMode(beat.storyTextOverlayMode === 'line' ? 'line' : 'word');
    setStyle(normalizeStoryTextOverlayStyle({
      ...DEFAULT_STORY_TEXT_OVERLAY_STYLE,
      wordsPerLine,
      ...(beat.storyTextOverlayStyle ?? {}),
    }));
    setPreviewCaptions(beat.storyTextOverlayCaptions);
    setPreviewAlignment(beat.storyTextOverlayAlignment);
    setGenerationMessage(null);
    setError(null);
  }, [
    beat.storyTextOverlayAlignment,
    beat.storyTextOverlayCaptions,
    beat.storyTextOverlayEnabled,
    beat.storyTextOverlayMode,
    beat.storyTextOverlayStyle,
    open,
    stop,
    wordsPerLine,
  ]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isBusy) return;
      // Let an open help popover swallow Escape before closing the dialog.
      if (document.querySelector('[data-info-popover-open]')) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBusy, onClose, open]);

  const normalizedStyle = useMemo(() => normalizeStoryTextOverlayStyle(style), [style]);
  const previewBeat = useMemo(() => ({
    ...beat,
    storyTextOverlayCaptions: previewCaptions?.length
      ? previewCaptions
      : beat.storyTextOverlayCaptions?.length
        ? beat.storyTextOverlayCaptions
      : buildStoryTextOverlayCaptions({
          storyText: beat.storyText,
          storyTextParts: beat.storyTextParts,
        }),
    storyTextOverlayAlignment: previewAlignment ?? beat.storyTextOverlayAlignment,
  }), [beat, previewAlignment, previewCaptions]);
  const fontPresets = getStoryTextFontPresetsForLanguage(language);
  const generationEligibility = useMemo(
    () => getStoryTextOverlayGenerationEligibility(beat),
    [beat]
  );
  const hasSyncedTiming = useMemo(
    () => hasStoryTextOverlayTimedAlignment(previewBeat),
    [previewBeat]
  );
  const timingStatus = generationMessage
    || (hasSyncedTiming
      ? 'Word timing synced.'
      : previewBeat.storyTextOverlayAlignment?.textHighlightSupported === false
        ? 'Text ready; timed highlight unavailable.'
        : generationEligibility.message || 'Ready for text overlay timing.');
  const updateStyle = (patch: Partial<StoryTextOverlayStyle>) => {
    setStyle((current) => normalizeStoryTextOverlayStyle({ ...current, ...patch }));
  };
  const currentSettings = (): StoryTextOverlaySettingsInput => ({
    enabled,
    mode,
    style: normalizedStyle,
  });
  const applyGeneratedPreview = (result: StoryTextOverlayBeatGenerationPreviewResult) => {
    setEnabled(result.storyTextOverlayEnabled);
    setMode(result.storyTextOverlayMode);
    setStyle(normalizeStoryTextOverlayStyle({
      ...DEFAULT_STORY_TEXT_OVERLAY_STYLE,
      wordsPerLine,
      ...result.storyTextOverlayStyle,
    }));
    setPreviewCaptions(result.storyTextOverlayCaptions);
    setPreviewAlignment(result.storyTextOverlayAlignment);
    setGenerationMessage(
      result.status === 'synced'
        ? 'Word timing synced.'
        : 'Text ready; timed highlight unavailable.'
    );
  };
  const handleGenerateBeat = async () => {
    if (!onGenerateBeat) return;
    setGenerationScope('beat');
    setGenerationMessage(null);
    setError(null);
    stop();
    try {
      const result = await onGenerateBeat(currentSettings());
      applyGeneratedPreview(result);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Unable to generate text overlay timing.');
    } finally {
      setGenerationScope(null);
    }
  };
  const handleGenerateStory = async () => {
    if (!onGenerateStory) return;
    setGenerationScope('story');
    setGenerationMessage(null);
    setError(null);
    stop();
    try {
      const result = await onGenerateStory(currentSettings());
      const currentResult = result.results.find((item) => item.nodeId === nodeId);
      if (currentResult?.status === 'synced' || currentResult?.status === 'fallback') {
        applyGeneratedPreview(currentResult as StoryTextOverlayBeatGenerationPreviewResult);
      } else if (currentResult?.storyTextOverlayCaptions?.length) {
        setPreviewCaptions(currentResult.storyTextOverlayCaptions);
        setPreviewAlignment(currentResult.storyTextOverlayAlignment);
      }
      const summary = [
        result.generated ? `${result.generated} synced` : null,
        result.fallback ? `${result.fallback} fallback` : null,
        result.skipped ? `${result.skipped} skipped` : null,
        result.failed ? `${result.failed} failed` : null,
      ].filter(Boolean).join(', ');
      setGenerationMessage(summary || 'No beats needed new timing.');
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Unable to generate text overlay timing.');
    } finally {
      setGenerationScope(null);
    }
  };
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave({ enabled, mode, style: normalizedStyle });
      stop();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save text overlay.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open || typeof document === 'undefined' || !beat.imageUrl) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-6">
      <div className="absolute inset-0" aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-text-overlay-title"
        className="relative z-10 flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl shadow-black/70"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div>
            <h2 id="story-text-overlay-title" className="text-lg font-semibold text-white">
              Story Text Overlay
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
          <div className="sticky top-0 z-10 self-stretch border-b border-white/10 bg-neutral-950 p-5 lg:self-start lg:w-2/5 lg:max-w-md lg:border-b-0 lg:border-r lg:p-6">
            <div className={`relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[32vh] sm:max-h-[40vh] lg:max-h-[58dvh]' : 'aspect-video'}`}>
              <StoryStoryboardPlayer
                gridUrl={previewBeat.imageUrl!}
                audioUrl={previewBeat.audioUrl}
                audioElapsedMs={currentTimeMs}
                audioDurationMs={durationMs}
                cycleOverride={false}
                cycleMs={2500}
                vignetteEnabled={vignetteEnabled}
                vignetteAmountPercent={vignetteAmountPercent}
                playbackState={playbackState}
                narrationTiming={previewBeat.storyboardNarrationTiming}
                storyTextOverlayCaptions={previewBeat.storyTextOverlayCaptions}
                storyTextOverlayEnabled={enabled}
                storyTextOverlayMode={mode}
                storyTextOverlayStyle={normalizedStyle}
                storyTextOverlayWordsPerLine={normalizedStyle.wordsPerLine ?? wordsPerLine}
                storyTextOverlayTextHighlightSupported={previewBeat.storyTextOverlayAlignment?.textHighlightSupported !== false}
                storyEffects={previewBeat.storyEffects}
                effectSeed={nodeId}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-4 rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className={`text-xs ${hasSyncedTiming ? 'text-emerald-300' : 'text-neutral-400'}`}>
                    {timingStatus}
                  </p>
                  {isGenerating && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-300" />}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateBeat}
                    disabled={isBusy || !onGenerateBeat || !generationEligibility.eligible}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
                  >
                    {generationScope === 'beat' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 shrink-0" />}
                    <span className="lg:hidden">This beat</span>
                    <span className="hidden lg:inline">Generate Text Overlay</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateStory}
                    disabled={isBusy || !onGenerateStory}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-neutral-500"
                  >
                    {generationScope === 'story' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                    <span className="lg:hidden">Full story</span>
                    <span className="hidden lg:inline">Generate Full Story</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={togglePlayPause} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-neutral-950 transition hover:bg-emerald-300" aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}>
                    {playbackState === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                  </button>
                  <button type="button" onClick={stop} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-neutral-300 transition hover:bg-white/10" aria-label="Restart">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setEnabled((current) => !current)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-neutral-300 transition hover:bg-white/10"
                  aria-label={enabled ? 'Hide overlay text' : 'Show overlay text'}
                >
                  {enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(durationMs, 1)}
                step={1}
                value={Math.min(currentTimeMs, durationMs || 0)}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="mt-4 h-2 w-full cursor-pointer accent-emerald-400"
                aria-label="Narration position"
              />
            </div>
          </div>

          <div className="space-y-4 p-5 sm:p-6 lg:flex-1">
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex flex-wrap gap-2 lg:block lg:space-y-3">
                <SegmentedControl<StoryTextOverlayMode>
                  ariaLabel="Highlight mode"
                  value={mode}
                  onChange={(nextMode) => setMode(nextMode)}
                  options={[
                    { value: 'word', label: 'Word', icon: WholeWord },
                    { value: 'line', label: 'Line', icon: WrapText },
                  ]}
                />
                <SegmentedControl<StoryTextOverlayPosition>
                  ariaLabel="Vertical position"
                  value={normalizedStyle.position ?? 'middle'}
                  onChange={(position) => updateStyle({ position })}
                  options={[
                    { value: 'upper', label: 'Upper', icon: ArrowUpToLine },
                    { value: 'middle', label: 'Middle', icon: AlignVerticalJustifyCenter },
                    { value: 'lower', label: 'Lower', icon: ArrowDownToLine },
                  ]}
                />
                <SegmentedControl<StoryTextOverlayAlign>
                  ariaLabel="Text alignment"
                  value={normalizedStyle.align ?? 'center'}
                  onChange={(align) => updateStyle({ align })}
                  options={[
                    { value: 'left', label: 'Left', icon: AlignLeft },
                    { value: 'center', label: 'Center', icon: AlignCenter },
                    { value: 'right', label: 'Right', icon: AlignRight },
                  ]}
                />
              </div>
              <RangeControl
                label="Words per line"
                min={MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE}
                max={MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE}
                value={normalizedStyle.wordsPerLine ?? wordsPerLine}
                onChange={(lineWords) => updateStyle({ wordsPerLine: lineWords })}
              />
            </div>

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:grid-cols-2">
              <label className="block text-xs font-medium text-neutral-400 sm:col-span-2">
                Font
                <select
                  value={normalizedStyle.fontFamily}
                  onChange={(event) => updateStyle({ fontFamily: event.target.value })}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400/50"
                >
                  {fontPresets.map((font) => (
                    <option key={font.value} value={font.value}>{font.label}</option>
                  ))}
                </select>
              </label>
              <RangeControl label="Size" min={12} max={64} value={normalizedStyle.fontSize ?? 18} onChange={(fontSize) => updateStyle({ fontSize })} />
              <RangeControl label="Offset" min={-30} max={30} value={normalizedStyle.verticalOffset ?? 0} onChange={(verticalOffset) => updateStyle({ verticalOffset })} />
              <div className="sm:col-span-2">
                <ReelStyleColorControl label="Text" color={normalizedStyle.color} fallback="#ffffff" onColorChange={(color) => updateStyle({ color })} />
              </div>
              <RangeControl label="Opacity" min={0} max={1} step={0.05} value={normalizedStyle.textOpacity ?? 1} onChange={(textOpacity) => updateStyle({ textOpacity })} />
              <RangeControl label="Outline Width" min={0} max={10} value={normalizedStyle.outlineWidth ?? 0} onChange={(outlineWidth) => updateStyle({ outlineWidth })} />
              <ReelStyleColorControl label="Outline" color={normalizedStyle.outlineColor} fallback="#000000" onColorChange={(outlineColor) => updateStyle({ outlineColor })} />
              <ReelStyleColorControl label="Shadow" color={normalizedStyle.shadowColor} fallback="#000000" onColorChange={(shadowColor) => updateStyle({ shadowColor })} />
              <RangeControl label="Shadow Blur" min={0} max={40} value={normalizedStyle.shadowBlur ?? 0} onChange={(shadowBlur) => updateStyle({ shadowBlur })} />
            </div>

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <ReelStyleColorControl label="Background" color={normalizedStyle.backgroundColor} fallback="#000000" onColorChange={(backgroundColor) => updateStyle({ backgroundColor })} />
              </div>
              <RangeControl label="Background Opacity" min={0} max={1} step={0.05} value={normalizedStyle.backgroundOpacity ?? 0} onChange={(backgroundOpacity) => updateStyle({ backgroundOpacity })} />
              <RangeControl label="Background Blur" min={0} max={24} value={normalizedStyle.backgroundBlur ?? 0} onChange={(backgroundBlur) => updateStyle({ backgroundBlur })} />
              <div className="sm:col-span-2">
                <ReelStyleColorControl label="Highlight" color={normalizedStyle.wordHighlightColor} fallback="#00d49b" onColorChange={(wordHighlightColor) => updateStyle({ wordHighlightColor })} />
              </div>
              <RangeControl label="Highlight Opacity" min={0} max={1} step={0.05} value={normalizedStyle.wordHighlightOpacity ?? 0} onChange={(wordHighlightOpacity) => updateStyle({ wordHighlightOpacity })} />
              <RangeControl label="Highlight X" min={0} max={18} value={normalizedStyle.wordHighlightPaddingX ?? 0} onChange={(wordHighlightPaddingX) => updateStyle({ wordHighlightPaddingX })} />
              <RangeControl label="Highlight Y" min={0} max={12} value={normalizedStyle.wordHighlightPaddingY ?? 0} onChange={(wordHighlightPaddingY) => updateStyle({ wordHighlightPaddingY })} />
              <RangeControl label="Highlight Radius" min={0} max={24} value={normalizedStyle.wordHighlightBorderRadius ?? 0} onChange={(wordHighlightBorderRadius) => updateStyle({ wordHighlightBorderRadius })} />
              <RangeControl label="Word Gap" min={0} max={28} value={normalizedStyle.wordHighlightWordSpacing ?? 0} onChange={(wordHighlightWordSpacing) => updateStyle({ wordHighlightWordSpacing })} />
              <RangeControl
                label="Pop Scale"
                min={STORY_TEXT_OVERLAY_HIGHLIGHT_SCALE_MIN}
                max={STORY_TEXT_OVERLAY_HIGHLIGHT_SCALE_MAX}
                step={0.01}
                value={normalizedStyle.wordHighlightScale ?? 1}
                onChange={(wordHighlightScale) => updateStyle({ wordHighlightScale })}
              />
            </div>

            {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
          </div>
        </div>

        <footer className="flex flex-row items-center justify-end gap-2 border-t border-white/10 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} disabled={isBusy} className="flex-1 rounded-full px-5 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50 sm:flex-none">Cancel</button>
          <button type="button" onClick={handleSave} disabled={isBusy} className="flex-1 rounded-full bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
