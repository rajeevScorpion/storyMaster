'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, FileText, Loader2, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';

import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { buildStoryTextOverlayCaptions } from '@/lib/story-overlay/captions';
import {
  getStoryTextOverlayGenerationEligibility,
  hasStoryTextOverlayTimedAlignment,
} from '@/lib/story-overlay/generation';
import {
  DEFAULT_STORY_TEXT_OVERLAY_STYLE,
  getStoryTextFontPresetsForLanguage,
  normalizeStoryTextOverlayStyle,
  storyOverlayColorInputValue,
} from '@/lib/story-overlay/styles';
import type { StoryTextOverlayMode, StoryTextOverlayStyle } from '@/lib/story-overlay/types';
import type { StoryAspectRatio, StoryBeat, StoryLanguage } from '@/lib/types/story';

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

function SegmentedButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-emerald-400 text-neutral-950' : 'text-neutral-300 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
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
    <label className="block text-xs font-medium text-neutral-400">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-neutral-500">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer accent-emerald-400"
      />
    </label>
  );
}

function ColorControl({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs font-medium text-neutral-400">
      <span>{label}</span>
      <input
        type="color"
        value={storyOverlayColorInputValue(value, fallback)}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
      />
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
    setStyle(normalizeStoryTextOverlayStyle(beat.storyTextOverlayStyle ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE));
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
  ]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onClose();
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
    setStyle(normalizeStoryTextOverlayStyle(result.storyTextOverlayStyle));
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
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close story text overlay"
        onClick={isBusy ? undefined : onClose}
      />
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.1fr)]">
          <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r lg:p-6">
            <div className={`relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[58dvh]' : 'aspect-video'}`}>
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
                storyTextOverlayWordsPerLine={wordsPerLine}
                storyTextOverlayTextHighlightSupported={previewBeat.storyTextOverlayAlignment?.textHighlightSupported !== false}
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
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleGenerateBeat}
                    disabled={isBusy || !onGenerateBeat || !generationEligibility.eligible}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
                  >
                    {generationScope === 'beat' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Generate Text Overlay
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateStory}
                    disabled={isBusy || !onGenerateStory}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-neutral-500"
                  >
                    {generationScope === 'story' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    Generate Full Story
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
                className="mt-4 h-1.5 w-full cursor-pointer accent-emerald-400"
                aria-label="Narration position"
              />
            </div>
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex rounded-full bg-black/30 p-1">
                <SegmentedButton active={mode === 'word'} onClick={() => setMode('word')}>Word</SegmentedButton>
                <SegmentedButton active={mode === 'line'} onClick={() => setMode('line')}>Line</SegmentedButton>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {(['upper', 'middle', 'lower'] as const).map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={() => updateStyle({ position })}
                    className={`rounded-full px-3 py-2 text-xs font-medium capitalize transition ${normalizedStyle.position === position ? 'bg-white text-neutral-950' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}
                  >
                    {position}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button
                    key={align}
                    type="button"
                    onClick={() => updateStyle({ align })}
                    className={`rounded-full px-3 py-2 text-xs font-medium capitalize transition ${normalizedStyle.align === align ? 'bg-white text-neutral-950' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}
                  >
                    {align}
                  </button>
                ))}
              </div>
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
              <ColorControl label="Text" value={normalizedStyle.color} fallback="#ffffff" onChange={(color) => updateStyle({ color })} />
              <RangeControl label="Opacity" min={0} max={1} step={0.05} value={normalizedStyle.textOpacity ?? 1} onChange={(textOpacity) => updateStyle({ textOpacity })} />
              <ColorControl label="Outline" value={normalizedStyle.outlineColor} fallback="#000000" onChange={(outlineColor) => updateStyle({ outlineColor })} />
              <RangeControl label="Outline Width" min={0} max={10} value={normalizedStyle.outlineWidth ?? 0} onChange={(outlineWidth) => updateStyle({ outlineWidth })} />
              <ColorControl label="Shadow" value={normalizedStyle.shadowColor} fallback="#000000" onChange={(shadowColor) => updateStyle({ shadowColor })} />
              <RangeControl label="Shadow Blur" min={0} max={40} value={normalizedStyle.shadowBlur ?? 0} onChange={(shadowBlur) => updateStyle({ shadowBlur })} />
            </div>

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:grid-cols-2">
              <ColorControl label="Background" value={normalizedStyle.backgroundColor} fallback="#000000" onChange={(backgroundColor) => updateStyle({ backgroundColor })} />
              <RangeControl label="Background Opacity" min={0} max={1} step={0.05} value={normalizedStyle.backgroundOpacity ?? 0} onChange={(backgroundOpacity) => updateStyle({ backgroundOpacity })} />
              <RangeControl label="Background Blur" min={0} max={24} value={normalizedStyle.backgroundBlur ?? 0} onChange={(backgroundBlur) => updateStyle({ backgroundBlur })} />
              <ColorControl label="Highlight" value={normalizedStyle.wordHighlightColor} fallback="#00d49b" onChange={(wordHighlightColor) => updateStyle({ wordHighlightColor })} />
              <RangeControl label="Highlight Opacity" min={0} max={1} step={0.05} value={normalizedStyle.wordHighlightOpacity ?? 0} onChange={(wordHighlightOpacity) => updateStyle({ wordHighlightOpacity })} />
              <RangeControl label="Highlight X" min={0} max={18} value={normalizedStyle.wordHighlightPaddingX ?? 0} onChange={(wordHighlightPaddingX) => updateStyle({ wordHighlightPaddingX })} />
              <RangeControl label="Highlight Y" min={0} max={12} value={normalizedStyle.wordHighlightPaddingY ?? 0} onChange={(wordHighlightPaddingY) => updateStyle({ wordHighlightPaddingY })} />
              <RangeControl label="Highlight Radius" min={0} max={24} value={normalizedStyle.wordHighlightBorderRadius ?? 0} onChange={(wordHighlightBorderRadius) => updateStyle({ wordHighlightBorderRadius })} />
              <RangeControl label="Word Gap" min={0} max={28} value={normalizedStyle.wordHighlightWordSpacing ?? 0} onChange={(wordHighlightWordSpacing) => updateStyle({ wordHighlightWordSpacing })} />
            </div>

            {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} disabled={isBusy} className="rounded-full px-5 py-2.5 text-sm font-medium text-neutral-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50">Cancel</button>
          <button type="button" onClick={handleSave} disabled={isBusy} className="rounded-full bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
