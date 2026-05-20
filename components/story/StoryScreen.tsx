'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type ChangeEvent, type CSSProperties } from 'react';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import { ArrowRight, RefreshCcw, BookOpen, Check, ChevronDown, ChevronUp, Save, Loader2, Share2, ExternalLink, Compass, CloudOff, CloudUpload, CheckCircle2, ImageIcon, ImageOff, AlertTriangle, Copy, Upload, Trash2, X, Layers, Volume2, AlignLeft, AlignCenter, AlignRight, Type, Download, Lock, Play, Pause } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { deleteStory } from '@/app/actions/persistence';
import PublishDialog from './PublishDialog';
import ManageStorylineCoverDialog from './ManageStorylineCoverDialog';
import Timeline from './Timeline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NarrationButton from './NarrationButton';
import AutoScrollButton from './AutoScrollButton';
import ReelCaptionOverlay, { ReelTimedCaptionText } from './ReelCaptionOverlay';
import { findChildForOption, getCurrentNode, getNodesByBeatNumber } from '@/lib/utils/story-map';
import { extractStoryline } from '@/lib/utils/storyline';
import { useKeyboardNavigation } from '@/lib/hooks/useKeyboardNavigation';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { useStoryAutoScroll } from '@/lib/hooks/useStoryAutoScroll';
import { getStoryboardSettings, checkIsAdmin } from '@/app/actions/admin';
import { useVideoExport } from '@/lib/hooks/useVideoExport';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import StoryboardVignette from './StoryboardVignette';
import { getStoryboardPanelCropStyle, STORYBOARD_PANEL_SEQUENCE } from '@/lib/storyboard/layout';
import { getActiveGalleryStorageKey, getBeatDisplayImageUrl, hasBeatImpossibleImageState, normalizeBeatMediaFields } from '@/lib/types/beat-media';
import type { StoryBeat, StoryNode, StorySession } from '@/lib/types/story';
import { resolveVideoExportWatermarkVisibility, type PricingRuntimeContext } from '@/lib/types/pricing';
import {
  DEFAULT_REEL_TEXT_OVERLAY_STYLE,
  REEL_CAPTION_VERTICAL_OFFSET_MAX,
  REEL_CAPTION_VERTICAL_OFFSET_MIN,
  normalizeReelTextOverlayStyle,
  reelColorInputValue,
  type ReelTextOverlayStyle,
} from '@/lib/reel/styles';
import {
  blobToDataUrl,
  compressImageFile,
  formatFileSize,
  getUploadFileExtension,
} from '@/lib/media/clientImageCompression';
import {
  DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  getAssetTypeCompressionEnabled,
  type ImageCompressionMetadata,
  type ImageUploadOptimizationSettings,
} from '@/lib/media/imageUploadOptimization';
import { useMyStoriesStore } from '@/lib/store/my-stories-store';

function StoryboardCycler({
  gridUrl,
  audioUrl,
  cycleOverride,
  cycleMs,
  vignetteEnabled,
  vignetteAmountPercent,
  playbackState,
  onImageError,
  onImageLoad,
  imageClassName,
  showIndicators = true,
  captions,
  textOverlayEnabled = true,
  textOverlayStyle,
}: {
  gridUrl: string;
  audioUrl?: string;
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  playbackState: 'idle' | 'playing' | 'paused';
  onImageError?: () => void;
  onImageLoad?: () => void;
  imageClassName?: string;
  showIndicators?: boolean;
  captions?: StoryBeat['reelCaptions'];
  textOverlayEnabled?: boolean;
  textOverlayStyle?: StoryBeat['reelTextOverlayStyle'];
}) {
  const [activePanel, setActivePanel] = useState(0);
  const [currentElapsedMs, setCurrentElapsedMs] = useState<number | null>(null);
  const [resolvedAudioDurationMs, setResolvedAudioDurationMs] = useState<number | null>(null);
  const hasAudio = !!audioUrl;
  const prevPlaybackStateRef = useRef<'idle' | 'playing' | 'paused'>('idle');
  const timedCaptions = useMemo(() => captions?.filter((caption) => (
    typeof caption.startMs === 'number'
    && typeof caption.endMs === 'number'
    && caption.endMs > caption.startMs
  )), [captions]);
  const hasTimedCaptions = Boolean(timedCaptions && timedCaptions.length > 0);
  const elapsedBeforePauseRef = useRef(0);
  const playbackStartedAtRef = useRef<number | null>(null);
  const panelDurationMs = cycleOverride
    ? cycleMs
    : !audioUrl
    ? STORYBOARD_ADVANCE_MS
    : resolvedAudioDurationMs ?? STORYBOARD_ADVANCE_MS;

  // Effect 1: resolve panel duration whenever the beat changes
  useEffect(() => {
    prevPlaybackStateRef.current = 'idle';

    if (cycleOverride || !audioUrl) return;

    // Narration present: hold panel 1 until audio metadata is known
    const audio = new Audio();
    const onMeta = () => {
      const d = audio.duration;
      setResolvedAudioDurationMs(isFinite(d) && d > 0 ? (d * 1000) / 4 : STORYBOARD_ADVANCE_MS);
    };
    const onError = () => setResolvedAudioDurationMs(STORYBOARD_ADVANCE_MS);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('error', onError);
    audio.src = audioUrl; // triggers metadata load — no play()
    return () => { audio.src = ''; };
  }, [gridUrl, audioUrl, cycleOverride, cycleMs]);

  // Effect 2: run interval only when playing (or when no narration)
  // Pause → interval clears → panel freezes
  // End (idle after play) → interval clears → panel stays on last frame
  // Replay (idle → playing) → resets to panel 1 and restarts
  useEffect(() => {
    if (panelDurationMs === null) return;
    if (hasTimedCaptions && hasAudio && !cycleOverride) return;

    const prev = prevPlaybackStateRef.current;
    prevPlaybackStateRef.current = playbackState;

    // Reset to panel 1 when replaying after narration ended
    let resetPanelTimeout: number | undefined;
    if (hasAudio && !cycleOverride && prev === 'idle' && playbackState === 'playing') {
      resetPanelTimeout = window.setTimeout(() => setActivePanel(0), 0);
    }

    // With narration: only cycle while playing
    // Without narration / override: cycle freely (playbackState stays 'idle')
    const shouldCycle = !hasAudio || cycleOverride || playbackState === 'playing';
    if (!shouldCycle) {
      return () => {
        if (resetPanelTimeout) window.clearTimeout(resetPanelTimeout);
      };
    }

    const id = setInterval(() => setActivePanel(p => Math.min(p + 1, 3)), panelDurationMs);
    return () => {
      if (resetPanelTimeout) window.clearTimeout(resetPanelTimeout);
      clearInterval(id);
    };
  }, [panelDurationMs, playbackState, hasAudio, cycleOverride, hasTimedCaptions]);

  useEffect(() => {
    if (!hasTimedCaptions || !hasAudio || cycleOverride) return;

    const prev = prevPlaybackStateRef.current;
    prevPlaybackStateRef.current = playbackState;

    if (prev === 'idle' && playbackState === 'playing') {
      elapsedBeforePauseRef.current = 0;
      playbackStartedAtRef.current = Date.now();
      window.setTimeout(() => setActivePanel(0), 0);
    } else if (playbackState === 'playing' && playbackStartedAtRef.current === null) {
      playbackStartedAtRef.current = Date.now();
    }

    if (playbackState === 'paused' && playbackStartedAtRef.current !== null) {
      elapsedBeforePauseRef.current += Date.now() - playbackStartedAtRef.current;
      playbackStartedAtRef.current = null;
    }

    if (playbackState !== 'playing') return;

    const id = window.setInterval(() => {
      const startedAt = playbackStartedAtRef.current ?? Date.now();
      const elapsedMs = elapsedBeforePauseRef.current + (Date.now() - startedAt);
      setCurrentElapsedMs(elapsedMs);
      const caption = timedCaptions!.find((item) => elapsedMs >= item.startMs! && elapsedMs < item.endMs!)
        ?? timedCaptions!.find((item) => elapsedMs < item.endMs!)
        ?? timedCaptions![timedCaptions!.length - 1];
      setActivePanel(Math.max(0, Math.min(3, caption.panelIndex)));
    }, 100);

    return () => window.clearInterval(id);
  }, [hasTimedCaptions, hasAudio, cycleOverride, playbackState, timedCaptions]);

  const activeCaptionObj = textOverlayEnabled
    ? captions?.find((caption) => caption.panelIndex === activePanel)
    : undefined;
  const activeCaption = activeCaptionObj?.text;
  const activeCaptionWordTimings = activeCaptionObj?.wordTimings;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className={`absolute inset-0 overflow-hidden ${imageClassName ?? ''}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activePanel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="absolute inset-0 overflow-hidden"
          >
            {/* Overscanned grid container, positioned to crop to the active quadrant. */}
            <div
              className="absolute"
              style={getStoryboardPanelCropStyle(activePanel)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gridUrl}
                alt=""
                className="w-full h-full object-cover"
                onLoad={onImageLoad}
                onError={onImageError}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <StoryboardVignette enabled={vignetteEnabled} amountPercent={vignetteAmountPercent} />
      {activeCaption && (
        <ReelCaptionOverlay style={textOverlayStyle}>
          <ReelTimedCaptionText
            text={activeCaption}
            wordTimings={activeCaptionWordTimings}
            elapsedMs={currentElapsedMs}
            isPlaying={playbackState === 'playing'}
            style={textOverlayStyle}
          />
        </ReelCaptionOverlay>
      )}
      {showIndicators && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {STORYBOARD_PANEL_SEQUENCE.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                i === activePanel ? 'bg-white/70 scale-125' : 'bg-white/25'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function isFallbackImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('https://picsum.photos/seed/');
}

const REEL_PANEL_COUNT = 4;

function splitReelTextIntoPanels(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentences.length >= REEL_PANEL_COUNT) {
    return Array.from({ length: REEL_PANEL_COUNT }, (_, index) =>
      index === REEL_PANEL_COUNT - 1
        ? sentences.slice(index).join(' ')
        : sentences[index]
    );
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunkSize = Math.max(1, Math.ceil(words.length / REEL_PANEL_COUNT));
  return Array.from({ length: REEL_PANEL_COUNT }, (_, index) =>
    words.slice(index * chunkSize, (index + 1) * chunkSize).join(' ')
  );
}

function getReelPanelTexts(beat: Pick<StoryBeat, 'storyText' | 'reelCaptions'>): string[] {
  const fallback = splitReelTextIntoPanels(beat.storyText || '');
  return Array.from({ length: REEL_PANEL_COUNT }, (_, index) => {
    const caption = beat.reelCaptions?.find((item) => item.panelIndex === index);
    return caption?.text?.trim() || fallback[index] || '';
  });
}

const REEL_FONT_PRESETS = [
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, Cambria, Times New Roman, serif' },
  { label: 'Clean', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Rounded', value: 'Verdana, Geneva, sans-serif' },
] as const;

function reelOverlayStyleKey(style: ReelTextOverlayStyle | null | undefined): string {
  const normalized = normalizeReelTextOverlayStyle(style);
  return JSON.stringify({
    fontFamily: normalized.fontFamily,
    fontSize: normalized.fontSize,
    fontWeight: normalized.fontWeight,
    color: normalized.color,
    shadowColor: normalized.shadowColor,
    shadowBlur: normalized.shadowBlur,
    backgroundColor: normalized.backgroundColor,
    backgroundOpacity: normalized.backgroundOpacity,
    position: normalized.position,
    verticalOffset: normalized.verticalOffset,
    align: normalized.align,
    wordHighlightColor: normalized.wordHighlightColor,
    wordHighlightOpacity: normalized.wordHighlightOpacity,
  });
}

function clampReelNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeOpacityInput(value: number): number {
  return Math.round(clampReelNumber(value, 0, 1) * 100) / 100;
}

function reelOverlayColorInputValue(
  color: string | undefined,
  fallback: string
): string {
  return reelColorInputValue(color, fallback);
}

interface ReelToolbarProps {
  storyMap: StorySession['storyMap'];
  onNodeClick: (nodeId: string) => void;
  focusedNodeId?: string;
  nodes?: StoryNode[];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  canOpenPromptTools: boolean;
  promptToolsOpen: boolean;
  onTogglePromptTools: () => void;
  className?: string;
}

function ReelToolbar({
  storyMap,
  onNodeClick,
  focusedNodeId,
  nodes,
  isCollapsed,
  onToggleCollapsed,
  canOpenPromptTools,
  promptToolsOpen,
  onTogglePromptTools,
  className,
}: ReelToolbarProps) {
  return (
    <div className={`relative z-30 flex min-h-14 items-center justify-between gap-3 border-b border-white/10 bg-neutral-950 px-4 py-2.5 ${className ?? ''}`}>
      <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
        <Timeline
          storyMap={storyMap}
          onNodeClick={onNodeClick}
          focusedNodeId={focusedNodeId}
          nodes={nodes}
          compact
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 transition-colors"
          title={isCollapsed ? 'Show text' : 'Hide text'}
        >
          {isCollapsed ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          onClick={onTogglePromptTools}
          disabled={!canOpenPromptTools}
          aria-expanded={promptToolsOpen}
          aria-haspopup="dialog"
          className={`p-2 rounded-full transition-colors ${
            !canOpenPromptTools
              ? 'cursor-not-allowed bg-white/5 text-neutral-700'
              : promptToolsOpen
              ? 'bg-sky-500/20 hover:bg-sky-500/25 text-sky-200'
              : 'bg-white/5 hover:bg-white/10 text-neutral-300'
          }`}
          title={canOpenPromptTools ? 'Prompt and image tools' : 'No prompt tools available'}
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface ReelCaptionStylePanelProps {
  normalizedStyle: ReelTextOverlayStyle;
  hasUnsavedStyle: boolean;
  isSavingStyle: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  message: string | null;
  onChange: (patch: ReelTextOverlayStyle) => void;
  onSave: () => void;
}

interface ReelStyleNumberInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onCommit: (value: number) => void;
}

function ReelStyleNumberInput({
  value,
  min,
  max,
  step = 1,
  label,
  onCommit,
}: ReelStyleNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const rounded = step < 1
      ? Math.round(parsed / step) * step
      : Math.round(parsed);
    const next = clampReelNumber(rounded, min, max);
    onCommit(step < 1 ? normalizeOpacityInput(next) : next);
    setDraft(String(step < 1 ? normalizeOpacityInput(next) : next));
  }, [draft, max, min, onCommit, step, value]);

  return (
    <input
      type="text"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      className="h-7 w-12 rounded-lg border border-white/10 bg-black/20 px-2 text-right font-sans text-[11px] tabular-nums text-neutral-200 outline-none transition-colors focus:border-emerald-400/50"
    />
  );
}

interface ReelStyleOpacityControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function ReelStyleOpacityControl({ label, value, onChange }: ReelStyleOpacityControlProps) {
  const percent = Math.round((value ?? 0) * 100);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(normalizeOpacityInput(Number(event.target.value)))}
        className="min-w-0 flex-1 accent-emerald-400"
      />
      <ReelStyleNumberInput
        value={percent}
        min={0}
        max={100}
        label={`${label} percent`}
        onCommit={(nextPercent) => onChange(normalizeOpacityInput(nextPercent / 100))}
      />
    </div>
  );
}

interface ReelStyleColorControlProps {
  label: string;
  color: string | undefined;
  fallback: string;
  opacity: number;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

function ReelStyleColorControl({
  label,
  color,
  fallback,
  opacity,
  onColorChange,
  onOpacityChange,
}: ReelStyleColorControlProps) {
  const colorInputValue = reelOverlayColorInputValue(color, fallback);
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-neutral-900 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
          {label}
        </span>
        <input
          type="color"
          value={colorInputValue}
          aria-label={`${label} color`}
          onChange={(event) => onColorChange(event.target.value)}
          className="h-7 w-8 cursor-pointer rounded border border-white/10 bg-transparent p-0"
        />
        <input
          type="text"
          value={color ?? fallback}
          aria-label={`${label} hex color`}
          onChange={(event) => onColorChange(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 font-sans text-[11px] text-neutral-200 outline-none transition-colors focus:border-emerald-400/50"
        />
      </div>
      <ReelStyleOpacityControl
        label={`${label} opacity`}
        value={opacity}
        onChange={onOpacityChange}
      />
    </div>
  );
}

interface ReelCaptionStyleControlsProps {
  normalizedStyle: ReelTextOverlayStyle;
  onChange: (patch: ReelTextOverlayStyle) => void;
}

function ReelCaptionStyleControls({
  normalizedStyle,
  onChange,
}: ReelCaptionStyleControlsProps) {
  const fontSize = normalizedStyle.fontSize ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize;
  const verticalOffset = normalizedStyle.verticalOffset ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.verticalOffset;
  const backgroundOpacity = normalizedStyle.backgroundOpacity ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundOpacity;
  const wordHighlightOpacity = normalizedStyle.wordHighlightOpacity ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightOpacity;

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2 lg:grid-cols-[auto_minmax(11rem,1fr)_auto]">
        <div className="flex rounded-full border border-white/10 bg-neutral-900 p-0.5">
          {([
            ['upper', 'Top'],
            ['middle', 'Mid'],
            ['lower', 'Low'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ position: value })}
              className={`rounded-full px-2.5 py-1.5 text-[10px] font-sans uppercase tracking-wider transition-colors ${
                normalizedStyle.position === value
                  ? 'bg-emerald-400 text-neutral-950'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-3 py-2">
          <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
            Y
          </span>
          <input
            type="range"
            min={REEL_CAPTION_VERTICAL_OFFSET_MIN}
            max={REEL_CAPTION_VERTICAL_OFFSET_MAX}
            value={verticalOffset}
            onChange={(event) => onChange({ verticalOffset: Number(event.target.value) })}
            className="min-w-0 flex-1 accent-emerald-400"
          />
          <ReelStyleNumberInput
            value={verticalOffset}
            min={REEL_CAPTION_VERTICAL_OFFSET_MIN}
            max={REEL_CAPTION_VERTICAL_OFFSET_MAX}
            label="Caption vertical offset"
            onCommit={(nextValue) => onChange({ verticalOffset: nextValue })}
          />
        </label>

        <div className="flex rounded-full border border-white/10 bg-neutral-900 p-0.5">
          {([
            ['left', AlignLeft, 'Align left'],
            ['center', AlignCenter, 'Align center'],
            ['right', AlignRight, 'Align right'],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ align: value })}
              className={`rounded-full p-2 transition-colors ${
                normalizedStyle.align === value
                  ? 'bg-emerald-400 text-neutral-950'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100'
              }`}
              title={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.4fr)]">
        <label className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-3 py-2">
          <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
            Font
          </span>
          <select
            value={normalizedStyle.fontFamily}
            onChange={(event) => onChange({ fontFamily: event.target.value })}
            className="min-w-0 flex-1 bg-transparent font-sans text-[11px] text-neutral-200 outline-none"
          >
            {!REEL_FONT_PRESETS.some((font) => font.value === normalizedStyle.fontFamily) && (
              <option value={normalizedStyle.fontFamily} className="bg-neutral-900 text-neutral-100">
                Custom
              </option>
            )}
            {REEL_FONT_PRESETS.map((font) => (
              <option key={font.value} value={font.value} className="bg-neutral-900 text-neutral-100">
                {font.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-3 py-2">
          <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
            Size
          </span>
          <input
            type="range"
            min={12}
            max={42}
            value={fontSize}
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
            className="min-w-0 flex-1 accent-emerald-400"
          />
          <ReelStyleNumberInput
            value={fontSize}
            min={12}
            max={42}
            label="Caption font size"
            onCommit={(nextValue) => onChange({ fontSize: nextValue })}
          />
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <ReelStyleColorControl
          label="BG"
          color={normalizedStyle.backgroundColor}
          fallback={DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundColor}
          opacity={backgroundOpacity}
          onColorChange={(backgroundColor) => onChange({ backgroundColor })}
          onOpacityChange={(backgroundOpacity) => onChange({ backgroundOpacity })}
        />
        <ReelStyleColorControl
          label="Word"
          color={normalizedStyle.wordHighlightColor}
          fallback={DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightColor}
          opacity={wordHighlightOpacity}
          onColorChange={(wordHighlightColor) => onChange({ wordHighlightColor })}
          onOpacityChange={(wordHighlightOpacity) => onChange({ wordHighlightOpacity })}
        />
      </div>
    </div>
  );
}

function ReelCaptionStylePanel({
  normalizedStyle,
  hasUnsavedStyle,
  isSavingStyle,
  saveState,
  message,
  onChange,
  onSave,
}: ReelCaptionStylePanelProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.24em] text-neutral-400">
          <Type className="h-3.5 w-3.5 text-emerald-300/80" />
          Caption style
        </div>
        {hasUnsavedStyle && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSavingStyle}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-sans uppercase tracking-wider text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-wait disabled:opacity-70"
          >
            {isSavingStyle ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </button>
        )}
      </div>

      <div className="px-4 py-3">
        <ReelCaptionStyleControls
          normalizedStyle={normalizedStyle}
          onChange={onChange}
        />

        {message && (
          <p className={`text-xs font-sans ${saveState === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

interface ReelPanelEditorProps {
  panelDrafts: string[];
  hasUnsavedText: boolean;
  isTextSaving: boolean;
  saveState: 'idle' | 'saving' | 'warning' | 'saved' | 'error';
  message: string | null;
  onPanelChange: (panelIndex: number, value: string) => void;
  onSaveText: (confirmClearNarration?: boolean) => void;
  onCancelChanges: () => void;
  onCancelWarning: () => void;
}

function ReelPanelEditor({
  panelDrafts,
  hasUnsavedText,
  isTextSaving,
  saveState,
  message,
  onPanelChange,
  onSaveText,
  onCancelChanges,
  onCancelWarning,
}: ReelPanelEditorProps) {
  return (
    <div className="bg-neutral-950">
      <div
        className="max-h-[12.25rem] overflow-y-auto scrollbar-none px-4 py-3"
        style={{
          maskImage: 'linear-gradient(to bottom, black 0%, black 82%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 82%, transparent 100%)',
        }}
      >
        <div className="space-y-3">
          {panelDrafts.map((text, panelIndex) => (
            <label key={panelIndex} className="block">
              <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-emerald-300/80">
                Panel {String(panelIndex + 1).padStart(2, '0')}
              </span>
              <textarea
                value={text}
                onChange={(event) => onPanelChange(panelIndex, event.target.value)}
                rows={2}
                className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 font-serif text-sm leading-relaxed text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-400/50 focus:bg-neutral-900 md:text-[13px]"
                placeholder={`Panel ${String(panelIndex + 1).padStart(2, '0')} text`}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        {hasUnsavedText && saveState !== 'warning' && (
          <>
            <button
              type="button"
              onClick={() => onSaveText(false)}
              disabled={isTextSaving}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-sans uppercase tracking-wider text-neutral-950 transition-colors hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70"
            >
              {isTextSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save text
            </button>
            <button
              type="button"
              onClick={onCancelChanges}
              disabled={isTextSaving}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        )}
        {saveState === 'warning' && (
          <>
            <button
              type="button"
              onClick={() => onSaveText(true)}
              disabled={isTextSaving}
              className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-sans uppercase tracking-wider text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-wait disabled:opacity-70"
            >
              {isTextSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              Clear narration and save
            </button>
            <button
              type="button"
              onClick={onCancelWarning}
              disabled={isTextSaving}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        )}
        {message && (
          <p className={`text-xs font-sans ${
            saveState === 'error'
              ? 'text-rose-300'
              : saveState === 'warning'
              ? 'text-amber-200'
              : 'text-emerald-300'
          }`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

const PROMPT_ONLY_ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const PROMPT_ONLY_MAX_UPLOAD_MB = 5;
const PROMPT_ONLY_MAX_UPLOAD_BYTES = PROMPT_ONLY_MAX_UPLOAD_MB * 1024 * 1024;
const PROMPT_ONLY_LANDSCAPE_ASPECT_RATIO = 16 / 9;
const PROMPT_ONLY_VERTICAL_ASPECT_RATIO = 9 / 16;
const PROMPT_ONLY_ASPECT_RATIO_TOLERANCE = 0.03;

const CHARACTER_SHEET_ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const CHARACTER_SHEET_SQUARE_ASPECT_RATIO = 1;
const CHARACTER_SHEET_MIN_DIMENSION = 512;

type PromptOnlyUploadPreview = {
  dataUrl: string;
  uploadBody: File;
  previewUrl: string;
  previewObjectUrl?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageExtension: string;
  width: number;
  height: number;
  resolutionAdvice: string;
  originalFileName?: string;
  originalFileSize?: number;
  optimizationMetadata?: ImageCompressionMetadata;
  optimizationWarning?: string;
};

type PromptToolsModalState =
  | { view: 'closed' }
  | { view: 'overview' }
  | { view: 'beat-upload' }
  | { view: 'character-upload'; characterId: string; characterName: string };

function buildBeatPromptCopyText(beat: StoryBeat): string {
  return beat.finalImagePromptText?.trim()
    || beat.storyboardPromptText?.trim()
    || beat.imagePrompt?.trim()
    || '';
}

type CharacterPromptCopyItem = {
  key: string;
  label: string;
  promptText: string;
  characterId: string;
  characterName: string;
  referenceSheetUrl?: string;
  referenceSheetStorageKey?: string;
  referenceSheetGallery: import('@/lib/types/story').CharacterSheetGalleryEntry[];
};

function buildCharacterPromptCopyItems(
  beat: StoryBeat,
  session: StorySession
): CharacterPromptCopyItem[] {
  // Portrait tasks are only emitted for new / visually-changed characters in
  // this beat, so they tell us which characters have a "Copy Sheet" prompt
  // available. Every other on-screen character still gets an Upload entry.
  const promptByCharacterId = new Map<string, string>();
  for (const task of beat.storyboardPlan?.portraitTasks ?? []) {
    const text = task.finalPromptText?.trim() || task.prompt?.trim() || '';
    if (text) {
      promptByCharacterId.set(task.characterId, text);
    }
  }

  // Gallery + active fields canonically live on session.characters; beat-level
  // copies only carry the active pointer, so we read the full reference shape
  // from the roster first and fall back to the beat-level snapshot.
  const rosterById = new Map<string, import('@/lib/types/story').Character>();
  for (const character of session.characters ?? []) {
    rosterById.set(character.id, character);
  }

  const items: CharacterPromptCopyItem[] = [];
  const seenIds = new Set<string>();
  for (const character of beat.characters ?? []) {
    if (!character.id || seenIds.has(character.id)) continue;
    seenIds.add(character.id);
    const rosterEntry = rosterById.get(character.id);
    const activeUrl = rosterEntry?.referenceSheetUrl ?? character.referenceSheetUrl;
    const activeKey = rosterEntry?.referenceSheetStorageKey ?? character.referenceSheetStorageKey;
    const gallery = rosterEntry?.referenceSheetGallery ?? character.referenceSheetGallery ?? [];
    items.push({
      key: `${character.id}:${items.length}`,
      label: character.name,
      promptText: promptByCharacterId.get(character.id) ?? '',
      characterId: character.id,
      characterName: character.name,
      referenceSheetUrl: activeUrl,
      referenceSheetStorageKey: activeKey,
      referenceSheetGallery: gallery,
    });
  }

  return items;
}

function hasRequiredPromptOnlyAspectRatio(width: number, height: number, targetRatio: number): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }

  const ratio = width / height;
  return Math.abs(ratio - targetRatio) <= PROMPT_ONLY_ASPECT_RATIO_TOLERANCE;
}

function getPromptOnlyResolutionAdvice(width: number, height: number, isVerticalStory: boolean): string {
  if (isVerticalStory) {
    if (width >= 1152 && height >= 2048) {
      return 'Strong for larger phone screens.';
    }
    if (width >= 720 && height >= 1280) {
      return 'Good for smaller phone screens. For larger screens, 1152x2048 or above is recommended.';
    }
    return 'Below the recommended minimum. Use at least 720x1280, and 1152x2048 for larger screens.';
  }

  if (width >= 2048 && height >= 1152) {
    return 'Strong for larger screens.';
  }
  if (width >= 1280 && height >= 720) {
    return 'Good for smaller screens. For larger screens, 2048x1152 or above is recommended.';
  }
  return 'Below the recommended minimum. Use at least 1280x720, and 2048x1152 for larger screens.';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Could not read the selected image.'));
    };
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error('Could not inspect the selected image.'));
    image.src = dataUrl;
  });
}

function getCharacterSheetResolutionAdvice(width: number, height: number): string {
  const min = Math.min(width, height);
  if (min >= 1024) {
    return 'Strong reference resolution.';
  }
  if (min >= CHARACTER_SHEET_MIN_DIMENSION) {
    return 'Acceptable, but 1024x1024 or above gives better continuity.';
  }
  return `Below the recommended minimum. Use at least ${CHARACTER_SHEET_MIN_DIMENSION}x${CHARACTER_SHEET_MIN_DIMENSION}.`;
}

function revokeUploadPreview(preview: PromptOnlyUploadPreview | null) {
  if (preview?.previewObjectUrl) {
    URL.revokeObjectURL(preview.previewObjectUrl);
  }
}

function buildCompressionStatsText(
  metadata: ImageCompressionMetadata | undefined,
  settings: ImageUploadOptimizationSettings
): string | null {
  if (!metadata || !settings.showCompressionStatsToUser) return null;
  if (!metadata.compressionApplied) {
    return metadata.skippedReason === 'already_optimized_webp'
      ? 'Image is already optimized.'
      : null;
  }
  return `Image optimized successfully. Original: ${formatFileSize(metadata.originalSizeBytes)}. Optimized: ${formatFileSize(metadata.optimizedSizeBytes)}.`;
}

async function validateCharacterSheetUpload(
  file: File,
  maxBytes: number,
  optimizationSettings: ImageUploadOptimizationSettings
): Promise<PromptOnlyUploadPreview> {
  if (!CHARACTER_SHEET_ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof CHARACTER_SHEET_ACCEPTED_IMAGE_TYPES)[number])) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }

  const compressionEnabled = getAssetTypeCompressionEnabled('character_reference', optimizationSettings);
  if (!compressionEnabled && file.size > maxBytes) {
    const limitMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
    throw new Error(`Image must be ${limitMb} MB or smaller.`);
  }

  if (!compressionEnabled) {
    const dataUrl = await readFileAsDataUrl(file);
    const { width, height } = await readImageDimensions(dataUrl);

    if (!hasRequiredPromptOnlyAspectRatio(width, height, CHARACTER_SHEET_SQUARE_ASPECT_RATIO)) {
      throw new Error('Character sheets must use a 1:1 aspect ratio.');
    }
    if (Math.min(width, height) < CHARACTER_SHEET_MIN_DIMENSION) {
      throw new Error(`Image must be at least ${CHARACTER_SHEET_MIN_DIMENSION}x${CHARACTER_SHEET_MIN_DIMENSION}.`);
    }

    return {
      dataUrl,
      uploadBody: file,
      previewUrl: dataUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      storageExtension: getUploadFileExtension(file),
      width,
      height,
      resolutionAdvice: getCharacterSheetResolutionAdvice(width, height),
    };
  }

  const result = await compressImageFile(file, {
    assetType: 'character_reference',
    settings: optimizationSettings,
    orientation: 'square',
  });
  const width = result.metadata.outputWidth;
  const height = result.metadata.outputHeight;
  if (!hasRequiredPromptOnlyAspectRatio(width, height, CHARACTER_SHEET_SQUARE_ASPECT_RATIO)) {
    URL.revokeObjectURL(result.previewUrl);
    throw new Error('Character sheets must use a 1:1 aspect ratio.');
  }
  if (Math.min(width, height) < CHARACTER_SHEET_MIN_DIMENSION) {
    URL.revokeObjectURL(result.previewUrl);
    throw new Error(`Image must be at least ${CHARACTER_SHEET_MIN_DIMENSION}x${CHARACTER_SHEET_MIN_DIMENSION}.`);
  }
  const dataUrl = await blobToDataUrl(result.file);
  return {
    dataUrl,
    uploadBody: result.file,
    previewUrl: result.previewUrl,
    previewObjectUrl: result.previewUrl,
    fileName: result.file.name,
    fileSize: result.file.size,
    mimeType: result.file.type,
    storageExtension: getUploadFileExtension(result.file),
    width,
    height,
    originalFileName: file.name,
    originalFileSize: file.size,
    optimizationMetadata: result.metadata,
    optimizationWarning: result.warningMessage ?? buildCompressionStatsText(result.metadata, optimizationSettings) ?? undefined,
    resolutionAdvice: getCharacterSheetResolutionAdvice(width, height),
  };
}

async function validatePromptOnlyImageFile(
  file: File,
  isVerticalStory: boolean,
  optimizationSettings: ImageUploadOptimizationSettings
): Promise<PromptOnlyUploadPreview> {
  if (!PROMPT_ONLY_ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof PROMPT_ONLY_ACCEPTED_IMAGE_TYPES)[number])) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }

  const compressionEnabled = getAssetTypeCompressionEnabled('storyboard_image', optimizationSettings);
  if (!compressionEnabled && file.size > PROMPT_ONLY_MAX_UPLOAD_BYTES) {
    throw new Error(`Image must be ${PROMPT_ONLY_MAX_UPLOAD_MB} MB or smaller.`);
  }

  const targetRatio = isVerticalStory ? PROMPT_ONLY_VERTICAL_ASPECT_RATIO : PROMPT_ONLY_LANDSCAPE_ASPECT_RATIO;
  const requiredAspectRatio = isVerticalStory ? '9:16' : '16:9';

  if (!compressionEnabled) {
    const dataUrl = await readFileAsDataUrl(file);
    const { width, height } = await readImageDimensions(dataUrl);

    if (!hasRequiredPromptOnlyAspectRatio(width, height, targetRatio)) {
      throw new Error(`Image must use a ${requiredAspectRatio} aspect ratio.`);
    }

    return {
      dataUrl,
      uploadBody: file,
      previewUrl: dataUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      storageExtension: getUploadFileExtension(file),
      width,
      height,
      resolutionAdvice: getPromptOnlyResolutionAdvice(width, height, isVerticalStory),
    };
  }

  const result = await compressImageFile(file, {
    assetType: 'storyboard_image',
    settings: optimizationSettings,
    orientation: isVerticalStory ? 'portrait' : 'landscape',
  });
  const width = result.metadata.outputWidth;
  const height = result.metadata.outputHeight;
  if (!hasRequiredPromptOnlyAspectRatio(width, height, targetRatio)) {
    URL.revokeObjectURL(result.previewUrl);
    throw new Error(`Image must use a ${requiredAspectRatio} aspect ratio.`);
  }
  const dataUrl = await blobToDataUrl(result.file);
  return {
    dataUrl,
    uploadBody: result.file,
    previewUrl: result.previewUrl,
    previewObjectUrl: result.previewUrl,
    fileName: result.file.name,
    fileSize: result.file.size,
    mimeType: result.file.type,
    storageExtension: getUploadFileExtension(result.file),
    width,
    height,
    originalFileName: file.name,
    originalFileSize: file.size,
    optimizationMetadata: result.metadata,
    optimizationWarning: result.warningMessage ?? buildCompressionStatsText(result.metadata, optimizationSettings) ?? undefined,
    resolutionAdvice: getPromptOnlyResolutionAdvice(width, height, isVerticalStory),
  };
}

type StoryReaderPanel = 'story' | 'branches';

interface StoryRuntimeSettings {
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  audioStorylinePublishEnabled: boolean;
  reelStoryPublishEnabled: boolean;
  cloudSaveTimeoutMs: number;
  storyAssetSignedUrlSwapEnabled: boolean;
  storyIncrementalAssetSyncEnabled: boolean;
  storyAssetUploadPauseDuringGenerationEnabled: boolean;
  storyAssetSyncWarningTimeoutMs: number;
  loadingReaderScrollSpeedPxPerSecond: number;
  storyUiTextLineCount: number;
  storyUiAutoScrollEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
  promptOnlyMaxImagesPerBeat: number;
  promptOnlyImageGalleryCleanupEnabled: boolean;
  promptOnlyImageGalleryCleanupDays: number;
  characterSheetUploadEnabled: boolean;
  characterSheetUploadMaxBytes: number;
  characterSheetMaxPerCharacter: number;
  characterSheetCleanupEnabled: boolean;
  characterSheetCleanupDays: number;
  imageUploadOptimizationSettings: ImageUploadOptimizationSettings;
}

export default function StoryScreen() {
  const session = useStoryStore((state) => state.session);
  const continueStory = useStoryStore((state) => state.continueStory);
  const navigateToNode = useStoryStore((state) => state.navigateToNode);
  const isLoading = useStoryStore((state) => state.isLoading);
  const resetStory = useStoryStore((state) => state.resetStory);
  const restartExploration = useStoryStore((state) => state.restartExploration);
  const isGeneratingAudio = useStoryStore((state) => state.isGeneratingAudio);
  const isRegeneratingImage = useStoryStore((state) => state.isRegeneratingImage);
  const audioReadyNodeId = useStoryStore((state) => state.audioReadyNodeId);
  const generateNarrationForNode = useStoryStore((state) => state.generateNarrationForNode);
  const updateReelPanelCaptions = useStoryStore((state) => state.updateReelPanelCaptions);
  const updateReelTextOverlayStyle = useStoryStore((state) => state.updateReelTextOverlayStyle);
  const regenerateImageForNode = useStoryStore((state) => state.regenerateImageForNode);
  const clearAudioReady = useStoryStore((state) => state.clearAudioReady);
  const storyMode = useStoryStore((state) => state.storyMode);
  const toggleStoryMode = useStoryStore((state) => state.toggleStoryMode);
  const isSaving = useStoryStore((state) => state.isSaving);
  const saveStatus = useStoryStore((state) => state.saveStatus);
  const saveWarning = useStoryStore((state) => state.saveWarning);
  const saveStoryToCloud = useStoryStore((state) => state.saveStoryToCloud);
  const setSaveRuntimeSettings = useStoryStore((state) => state.setSaveRuntimeSettings);
  const retryPendingBeatAssetSync = useStoryStore((state) => state.retryPendingBeatAssetSync);
  const lastPublishResult = useStoryStore((state) => state.lastPublishResult);
  const refreshSignedUrls = useStoryStore((state) => state.refreshSignedUrls);
  const setPromptOnlyBeatImage = useStoryStore((state) => state.setPromptOnlyBeatImage);
  const selectPromptOnlyBeatImage = useStoryStore((state) => state.selectPromptOnlyBeatImage);
  const deletePromptOnlyBeatImage = useStoryStore((state) => state.deletePromptOnlyBeatImage);
  const permanentlyDeletePromptOnlyBeatImage = useStoryStore((state) => state.permanentlyDeletePromptOnlyBeatImage);
  const setCharacterReferenceSheet = useStoryStore((state) => state.setCharacterReferenceSheet);
  const selectCharacterReferenceSheet = useStoryStore((state) => state.selectCharacterReferenceSheet);
  const deleteCharacterReferenceSheet = useStoryStore((state) => state.deleteCharacterReferenceSheet);
  const permanentlyDeleteCharacterReferenceSheet = useStoryStore((state) => state.permanentlyDeleteCharacterReferenceSheet);
  const { user } = useAuth();
  const { data: pricing } = usePricingRuntime();
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [cycleSettings, setCycleSettings] = useState<StoryRuntimeSettings>({
    cycleOverride: false,
    cycleMs: STORYBOARD_ADVANCE_MS,
    vignetteEnabled: true,
    vignetteAmountPercent: 100,
    audioStorylinePublishEnabled: false,
    reelStoryPublishEnabled: false,
    cloudSaveTimeoutMs: 20000,
    storyAssetSignedUrlSwapEnabled: false,
    storyIncrementalAssetSyncEnabled: false,
    storyAssetUploadPauseDuringGenerationEnabled: false,
    storyAssetSyncWarningTimeoutMs: 15000,
    loadingReaderScrollSpeedPxPerSecond: 24,
    storyUiTextLineCount: 7,
    storyUiAutoScrollEnabled: true,
    videoDownloadEnabled: false,
    videoDownloadAdminBypass: false,
    promptOnlyMaxImagesPerBeat: 3,
    promptOnlyImageGalleryCleanupEnabled: true,
    promptOnlyImageGalleryCleanupDays: 7,
    characterSheetUploadEnabled: true,
    characterSheetUploadMaxBytes: 5 * 1024 * 1024,
    characterSheetMaxPerCharacter: 3,
    characterSheetCleanupEnabled: true,
    characterSheetCleanupDays: 7,
    imageUploadOptimizationSettings: DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  });

  // Fetch storyboard cycle settings once on mount
  useEffect(() => {
    getStoryboardSettings()
      .then((settings) => {
        setCycleSettings(settings);
        setSaveRuntimeSettings({
          storyAssetSignedUrlSwapEnabled: settings.storyAssetSignedUrlSwapEnabled,
          storyIncrementalAssetSyncEnabled: settings.storyIncrementalAssetSyncEnabled,
          storyAssetUploadPauseDuringGenerationEnabled: settings.storyAssetUploadPauseDuringGenerationEnabled,
          storyAssetSyncWarningTimeoutMs: settings.storyAssetSyncWarningTimeoutMs,
        });
      })
      .catch(() => {/* use defaults */});
  }, [setSaveRuntimeSettings]);

  useEffect(() => {
    let cancelled = false;

    checkIsAdmin()
      .then((isAdmin) => {
        if (!cancelled) setIsAdminUser(user?.id ? isAdmin : false);
      })
      .catch(() => {
        if (!cancelled) setIsAdminUser(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Refresh signed URLs every 50 minutes to prevent expiry
  useEffect(() => {
    const interval = setInterval(() => {
      refreshSignedUrls();
    }, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshSignedUrls]);

  useEffect(() => {
    if (!cycleSettings.storyIncrementalAssetSyncEnabled) return;

    const handleForegroundRetry = () => {
      retryPendingBeatAssetSync().catch(() => {});
    };

    window.addEventListener('focus', handleForegroundRetry);
    window.addEventListener('online', handleForegroundRetry);
    return () => {
      window.removeEventListener('focus', handleForegroundRetry);
      window.removeEventListener('online', handleForegroundRetry);
    };
  }, [cycleSettings.storyIncrementalAssetSyncEnabled, retryPendingBeatAssetSync]);

  if (!session || !session.storyMap) return null;

  const currentNode = getCurrentNode(session.storyMap);
  if (!currentNode) return null;

  const currentBeat = normalizeBeatMediaFields(currentNode.data);
  const isEnding = currentBeat.isEnding;
  const isPromptOnlyStory = session.storyConfig.imageGenerationMode === 'prompt_only';
  const isReelStory = session.storyConfig.storyKind === 'reel';
  const continueCoinCost = isReelStory
    ? 0
    : (
        pricing.actionCosts[
          isPromptOnlyStory
            ? 'continue_story_new_beat_prompt_only'
            : 'continue_story_new_beat'
        ] ?? (isPromptOnlyStory ? 0.5 : 1)
      ) * 10;
  const showCoinHint = pricing.controls.pricingHardEnforcementEnabled || pricing.controls.pricingCheckoutEnabled;

  const hasExistingBranch = (optionId: string) =>
    findChildForOption(session.storyMap, session.storyMap.currentNodeId, optionId) !== null;

  return (
    <StoryScreenInner
      session={session}
      currentBeat={currentBeat}
      isEnding={isEnding}
      isLoading={isLoading}
      continueStory={continueStory}
      navigateToNode={navigateToNode}
      resetStory={resetStory}
      onRestart={session.sourceStoryOwnerId ? restartExploration : resetStory}
      hasExistingBranch={hasExistingBranch}
      isGeneratingAudio={isGeneratingAudio}
      isRegeneratingImage={isRegeneratingImage}
      audioReadyNodeId={audioReadyNodeId}
      generateNarrationForNode={generateNarrationForNode}
      updateReelPanelCaptions={updateReelPanelCaptions}
      updateReelTextOverlayStyle={updateReelTextOverlayStyle}
      regenerateImageForNode={regenerateImageForNode}
      clearAudioReady={clearAudioReady}
      storyMode={storyMode}
      toggleStoryMode={toggleStoryMode}
      isSaving={isSaving}
      saveStatus={saveStatus}
      saveWarning={saveWarning}
      onSave={user && !session.sourceStoryOwnerId ? () => saveStoryToCloud(user.id, {
        signedUrlSwapEnabled: cycleSettings.storyAssetSignedUrlSwapEnabled,
        incrementalAssetSyncEnabled: cycleSettings.storyIncrementalAssetSyncEnabled,
        pauseAssetUploadsDuringGenerationEnabled: cycleSettings.storyAssetUploadPauseDuringGenerationEnabled,
        assetSyncWarningTimeoutMs: cycleSettings.storyAssetSyncWarningTimeoutMs,
      }) : undefined}
      lastPublishResult={lastPublishResult}
      cycleSettings={cycleSettings}
      pricing={pricing}
      isAdminUser={isAdminUser}
      continueCoinCost={continueCoinCost}
      showCoinHint={showCoinHint}
      setPromptOnlyBeatImage={setPromptOnlyBeatImage}
      selectPromptOnlyBeatImage={selectPromptOnlyBeatImage}
      deletePromptOnlyBeatImage={deletePromptOnlyBeatImage}
      permanentlyDeletePromptOnlyBeatImage={permanentlyDeletePromptOnlyBeatImage}
      setCharacterReferenceSheet={setCharacterReferenceSheet}
      selectCharacterReferenceSheet={selectCharacterReferenceSheet}
      deleteCharacterReferenceSheet={deleteCharacterReferenceSheet}
      permanentlyDeleteCharacterReferenceSheet={permanentlyDeleteCharacterReferenceSheet}
    />
  );
}

// Separate inner component so hooks can be called unconditionally
function StoryScreenInner({
  session,
  currentBeat,
  isEnding,
  isLoading,
  continueStory,
  navigateToNode,
  resetStory,
  onRestart,
  hasExistingBranch,
  isGeneratingAudio,
  isRegeneratingImage,
  audioReadyNodeId,
  generateNarrationForNode,
  updateReelPanelCaptions,
  updateReelTextOverlayStyle,
  regenerateImageForNode,
  clearAudioReady,
  storyMode,
  toggleStoryMode,
  isSaving,
  saveStatus,
  saveWarning,
  onSave,
  lastPublishResult,
  cycleSettings,
  pricing,
  isAdminUser,
  continueCoinCost,
  showCoinHint,
  setPromptOnlyBeatImage,
  selectPromptOnlyBeatImage,
  deletePromptOnlyBeatImage,
  permanentlyDeletePromptOnlyBeatImage,
  setCharacterReferenceSheet,
  selectCharacterReferenceSheet,
  deleteCharacterReferenceSheet,
  permanentlyDeleteCharacterReferenceSheet,
}: {
  session: NonNullable<ReturnType<typeof useStoryStore.getState>['session']>;
  currentBeat: NonNullable<ReturnType<typeof useStoryStore.getState>['session']>['beats'][number];
  isEnding: boolean;
  isLoading: boolean;
  continueStory: (optionId: string) => void;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  onRestart: () => void;
  hasExistingBranch: (optionId: string) => boolean;
  isGeneratingAudio: boolean;
  isRegeneratingImage: boolean;
  audioReadyNodeId: string | null;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  updateReelPanelCaptions: (nodeId: string, panelTexts: string[]) => Promise<{ clearedNarration: boolean }>;
  updateReelTextOverlayStyle: (style: StoryBeat['reelTextOverlayStyle']) => Promise<void>;
  regenerateImageForNode: (nodeId: string) => Promise<void>;
  clearAudioReady: () => void;
  storyMode: boolean;
  toggleStoryMode: () => void;
  isSaving: boolean;
  saveStatus: 'idle' | 'unsaved' | 'saving' | 'saved';
  saveWarning: string | null;
  onSave?: () => void;
  lastPublishResult: { alreadyPublished: boolean; storylineId: string; error?: string } | null;
  cycleSettings: StoryRuntimeSettings;
  pricing: PricingRuntimeContext;
  isAdminUser: boolean;
  continueCoinCost: number;
  showCoinHint: boolean;
  setPromptOnlyBeatImage: (nodeId: string, imageDataUrl: string, options?: { maxImagesPerBeat?: number; optimizationMetadata?: ImageCompressionMetadata; storageExtension?: string; uploadBody?: File | Blob | string }) => Promise<void>;
  selectPromptOnlyBeatImage: (nodeId: string, storageKey: string) => Promise<void>;
  deletePromptOnlyBeatImage: (nodeId: string) => Promise<void>;
  permanentlyDeletePromptOnlyBeatImage: (nodeId: string, storageKey: string) => Promise<void>;
  setCharacterReferenceSheet: (characterId: string, imageDataUrl: string, options?: { maxPerCharacter?: number; optimizationMetadata?: ImageCompressionMetadata; storageExtension?: string; uploadBody?: File | Blob | string }) => Promise<void>;
  selectCharacterReferenceSheet: (characterId: string, storageKey: string) => Promise<void>;
  deleteCharacterReferenceSheet: (characterId: string) => Promise<void>;
  permanentlyDeleteCharacterReferenceSheet: (characterId: string, storageKey: string) => Promise<void>;
}) {
  const router = useRouter();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const currentNodeId = session.storyMap.currentNodeId;
  const preludeText =
    currentBeat.beatNumber === 1 && !session.storyConfig.authoring.seedPlan
      ? session.storyConfig.authoring.preludeText?.trim()
      : '';

  const [isMinimized, setIsMinimized] = useState(false);
  const [activeReaderPanel, setActiveReaderPanel] = useState<StoryReaderPanel>('story');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showDiscardReelDialog, setShowDiscardReelDialog] = useState(false);
  const [isDiscardingReel, setIsDiscardingReel] = useState(false);
  const [discardReelError, setDiscardReelError] = useState<string | null>(null);
  const [managedStorylineId, setManagedStorylineId] = useState<string | null>(null);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [scrollState, setScrollState] = useState({ atTop: true, atBottom: false });
  const [copiedPromptKey, setCopiedPromptKey] = useState<string | null>(null);
  const [promptToolsModalState, setPromptToolsModalState] = useState<PromptToolsModalState>({ view: 'closed' });
  const [isPromptToolsHelpOpen, setIsPromptToolsHelpOpen] = useState(false);
  const [savedRefsExpanded, setSavedRefsExpanded] = useState(false);
  const [promptToolsSuccess, setPromptToolsSuccess] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<PromptOnlyUploadPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isOptimizingPromptOnlyImage, setIsOptimizingPromptOnlyImage] = useState(false);
  const [isUploadingPromptOnlyImage, setIsUploadingPromptOnlyImage] = useState(false);
  const [pendingDeleteStorageKey, setPendingDeleteStorageKey] = useState<string | null>(null);
  const [isPermanentlyDeletingKey, setIsPermanentlyDeletingKey] = useState<string | null>(null);
  const [characterSheetPreview, setCharacterSheetPreview] = useState<PromptOnlyUploadPreview | null>(null);
  const [characterSheetError, setCharacterSheetError] = useState<string | null>(null);
  const [isOptimizingCharacterSheet, setIsOptimizingCharacterSheet] = useState(false);
  const [isUploadingCharacterSheet, setIsUploadingCharacterSheet] = useState(false);
  const [pendingCharacterDeleteId, setPendingCharacterDeleteId] = useState<string | null>(null);
  const [pendingSheetDeleteKey, setPendingSheetDeleteKey] = useState<string | null>(null);
  const [permanentlyDeletingSheetKey, setPermanentlyDeletingSheetKey] = useState<string | null>(null);
  const characterSheetInputRef = useRef<HTMLInputElement>(null);
  const isReelStory = session.storyConfig.storyKind === 'reel';
  const visibleReaderPanel: StoryReaderPanel = isEnding || isReelStory ? 'story' : activeReaderPanel;
  const { scrollRef, isAutoScrolling, toggleAutoScroll, stopAutoScroll } = useStoryAutoScroll<HTMLDivElement>({
    enabled: !isReelStory && cycleSettings.storyUiAutoScrollEnabled && !isMinimized && visibleReaderPanel === 'story',
    resetKey: currentNodeId,
    pxPerSecond: cycleSettings.loadingReaderScrollSpeedPxPerSecond,
  });
  const thumbRef = useRef<HTMLDivElement>(null);
  const autoMinimizedForLoadingRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Update gradients via state (infrequent edge changes)
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setScrollState(prev => {
      if (prev.atTop !== atTop || prev.atBottom !== atBottom) {
        return { atTop, atBottom };
      }
      return prev;
    });

    // Update thumb position directly via DOM — no re-render lag
    const thumb = thumbRef.current;
    if (thumb) {
      const thumbH = Math.max(10, (el.clientHeight / el.scrollHeight) * 100) * 0.4;
      const scrollRatio = el.scrollTop / (el.scrollHeight - el.clientHeight || 1);
      const thumbTop = scrollRatio * (100 - thumbH);
      thumb.style.top = `${thumbTop}%`;
      thumb.style.height = `${thumbH}%`;
    }
  }, [scrollRef]);

  useEffect(() => {
    return () => revokeUploadPreview(uploadPreview);
  }, [uploadPreview]);

  useEffect(() => {
    return () => revokeUploadPreview(characterSheetPreview);
  }, [characterSheetPreview]);

  // Audio player
  const normalizedCurrentBeat = normalizeBeatMediaFields(currentBeat);
  const isPromptOnlyStory = session.storyConfig.imageGenerationMode === 'prompt_only';
  const reelTimelineNodes = useMemo(
    () => (isReelStory ? getNodesByBeatNumber(session.storyMap) : undefined),
    [isReelStory, session.storyMap]
  );
  const [reelPlayAllActive, setReelPlayAllActive] = useState(false);
  const reelPlayAllNodeIdsRef = useRef<string[]>([]);
  const pendingReelPlayAllNodeIdRef = useRef<string | null>(null);
  const isVerticalStory = session.storyConfig.isVerticalStory || session.storyConfig.aspectRatio === '9:16';
  const hasImpossibleImageState = hasBeatImpossibleImageState(normalizedCurrentBeat);
  const isStoryboard = !!normalizedCurrentBeat.isStoryboard && !!normalizedCurrentBeat.imageUrl;
  const displayImageUrl = normalizedCurrentBeat.portraitImageUrl || getBeatDisplayImageUrl(normalizedCurrentBeat);
  const imageKey = normalizedCurrentBeat.imageUrl || displayImageUrl;
  const visualKey = displayImageUrl ?? currentNodeId;
  const imageLoadFailed = !!imageKey && failedImageUrl === imageKey;
  const showPendingImageState = !displayImageUrl && normalizedCurrentBeat.imageStatus === 'pending';
  const showPromptOnlyPlaceholder = isPromptOnlyStory && !displayImageUrl && !showPendingImageState;
  const showFailedImageState = !showPromptOnlyPlaceholder && !displayImageUrl && (normalizedCurrentBeat.imageStatus === 'failed' || hasImpossibleImageState);
  const showSaveAlert = Boolean(saveWarning) && saveStatus !== 'unsaved';
  const canRegenerateImage = !isPromptOnlyStory && (!normalizedCurrentBeat.imageUrl || isFallbackImageUrl(normalizedCurrentBeat.imageUrl) || imageLoadFailed);
  const cancelReelPlayAll = useCallback(() => {
    pendingReelPlayAllNodeIdRef.current = null;
    reelPlayAllNodeIdsRef.current = [];
    setReelPlayAllActive(false);
  }, []);
  const handleReelAudioEnded = useCallback(() => {
    if (!reelPlayAllActive) return;

    const nodeIds = reelPlayAllNodeIdsRef.current;
    const currentIndex = nodeIds.indexOf(currentNodeId);
    const nextNodeId = currentIndex >= 0 ? nodeIds[currentIndex + 1] : undefined;

    if (nextNodeId) {
      pendingReelPlayAllNodeIdRef.current = nextNodeId;
      navigateToNode(nextNodeId);
      return;
    }

    cancelReelPlayAll();
  }, [cancelReelPlayAll, currentNodeId, navigateToNode, reelPlayAllActive]);
  const { playbackState, togglePlayPause, play: playAudio } = useAudioPlayer(
    normalizedCurrentBeat.audioUrl,
    currentNodeId,
    { onEnded: handleReelAudioEnded }
  );
  const {
    exportVideo,
    cancel: cancelExport,
    isExporting,
    progress: exportProgress,
    phase: exportPhase,
    error: exportError,
  } = useVideoExport();
  const isAudioReady = audioReadyNodeId === currentNodeId;
  const beatPromptText = buildBeatPromptCopyText(normalizedCurrentBeat);
  const characterPromptItems = buildCharacterPromptCopyItems(normalizedCurrentBeat, session);
  const promptToolsOpen = promptToolsModalState.view !== 'closed';
  const needsAttentionCharacters = characterPromptItems.filter((item) => !item.referenceSheetUrl);
  const readyInBeatCharacters = characterPromptItems.filter((item) => Boolean(item.referenceSheetUrl));
  const activeCharacterSheetTarget = promptToolsModalState.view === 'character-upload' ? promptToolsModalState : null;
  const activeCharacterPromptItem = activeCharacterSheetTarget
    ? characterPromptItems.find((item) => item.characterId === activeCharacterSheetTarget.characterId) ?? null
    : null;
  const promptToolsHelpText = promptToolsModalState.view === 'beat-upload'
    ? `Use a ${isVerticalStory ? '9:16' : '16:9'} JPG, PNG, or WebP image. Review the preview, upload it to this beat, and you'll come right back here.`
    : promptToolsModalState.view === 'character-upload'
    ? 'Upload a square JPG, PNG, or WebP sheet. It stays attached to this character for future beats and continuations, then returns you to the tools overview.'
    : isPromptOnlyStory
    ? 'Copy prompts, upload this beat image, and add refs only for characters that still need them. Successful uploads return here automatically.'
    : 'Copy prompts and add character refs only where this beat still needs them. Successful uploads return here automatically.';
  const promptToolsShellLabel = promptToolsModalState.view === 'beat-upload'
    ? 'Beat image upload tools'
    : promptToolsModalState.view === 'character-upload'
    ? 'Character sheet tools'
    : isPromptOnlyStory
    ? 'Prompt and image tools'
    : 'Prompt tools';
  const canOpenPromptTools = Boolean(isPromptOnlyStory || beatPromptText || characterPromptItems.length > 0);
  const isPromptToolsOverview = promptToolsModalState.view === 'overview';
  const isBeatUploadView = promptToolsModalState.view === 'beat-upload';
  const isCharacterUploadView = promptToolsModalState.view === 'character-upload';
  const activeCharacterGallery = activeCharacterPromptItem?.referenceSheetGallery ?? [];
  const activeCharacterStorageKey = activeCharacterPromptItem?.referenceSheetStorageKey;
  const activeCharacterHasSheet = Boolean(activeCharacterPromptItem?.referenceSheetUrl);
  const publishPath = isEnding ? extractStoryline(session.storyMap, currentNodeId) : null;
  const canPublishStandardStoryline = Boolean(
    publishPath?.beats.every((beat) => {
      const normalizedBeat = normalizeBeatMediaFields(beat);
      return Boolean(normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl);
    })
  );
  const canPublishAudioStoryline = Boolean(
    isEnding &&
    isPromptOnlyStory &&
    !canPublishStandardStoryline &&
    cycleSettings.audioStorylinePublishEnabled
  );
  const prevNodeIdForAutoplay = useRef<string | undefined>(undefined);
  const orderedOptions = currentBeat.canonicalOptionId
    ? [
        ...currentBeat.options.filter((option) => option.id === currentBeat.canonicalOptionId),
        ...currentBeat.options.filter((option) => option.id !== currentBeat.canonicalOptionId),
      ]
    : currentBeat.options;
  const savedReelPanelTexts = useMemo(
    () => getReelPanelTexts({
      storyText: normalizedCurrentBeat.storyText,
      reelCaptions: normalizedCurrentBeat.reelCaptions,
    }),
    [normalizedCurrentBeat.reelCaptions, normalizedCurrentBeat.storyText]
  );
  const savedReelOverlayStyle = useMemo(
    () => normalizeReelTextOverlayStyle(
      normalizedCurrentBeat.reelTextOverlayStyle
        ?? session.storyConfig.reel.textOverlayStyle
    ),
    [normalizedCurrentBeat.reelTextOverlayStyle, session.storyConfig.reel.textOverlayStyle]
  );
  const [reelPanelDraft, setReelPanelDraft] = useState<string[]>(savedReelPanelTexts);
  const [reelTextSaveState, setReelTextSaveState] = useState<'idle' | 'saving' | 'warning' | 'saved' | 'error'>('idle');
  const [reelTextMessage, setReelTextMessage] = useState<string | null>(null);
  const [reelOverlayDraft, setReelOverlayDraft] = useState<ReelTextOverlayStyle>(savedReelOverlayStyle);
  const [reelStyleSaveState, setReelStyleSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reelStyleMessage, setReelStyleMessage] = useState<string | null>(null);
  const normalizedReelOverlayDraft = useMemo(
    () => normalizeReelTextOverlayStyle(reelOverlayDraft),
    [reelOverlayDraft]
  );
  const hasReelAudio = Boolean(
    normalizedCurrentBeat.audioUrl
    || normalizedCurrentBeat.audioStatus === 'ready'
    || normalizedCurrentBeat.audioStatus === 'pending'
  );
  const hasUnsavedReelText = isReelStory && reelPanelDraft.some((text, index) =>
    text.trim() !== (savedReelPanelTexts[index] || '').trim()
  );
  const isReelTextSaving = reelTextSaveState === 'saving';
  const hasUnsavedReelOverlayStyle = isReelStory
    && reelOverlayStyleKey(reelOverlayDraft) !== reelOverlayStyleKey(savedReelOverlayStyle);
  const isReelStyleSaving = reelStyleSaveState === 'saving';
  const reelDistributionBeats = isReelStory && publishPath ? publishPath.beats : [];
  const reelHasCompletePath = reelDistributionBeats.length > 0;
  const reelHasAllImages = reelHasCompletePath && reelDistributionBeats.every((beat) => {
    const normalizedBeat = normalizeBeatMediaFields(beat);
    return Boolean(normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl) && normalizedBeat.imageStatus === 'ready';
  });
  const reelHasAllAudio = reelHasCompletePath && reelDistributionBeats.every((beat) => {
    const normalizedBeat = normalizeBeatMediaFields(beat);
    return Boolean(normalizedBeat.audioUrl) && normalizedBeat.audioStatus === 'ready';
  });
  const reelHasPendingWork = isGeneratingAudio || isRegeneratingImage || showPendingImageState;
  const reelReadyForDistribution = Boolean(
    isReelStory &&
    isEnding &&
    reelHasAllImages &&
    reelHasAllAudio &&
    !hasUnsavedReelText &&
    !hasUnsavedReelOverlayStyle &&
    !reelHasPendingWork
  );
  const reelDistributionBlockReason = !isEnding
    ? 'Finish generating the reel first.'
    : !reelHasAllImages
    ? 'Reel publishing and export need an image on every beat.'
    : !reelHasAllAudio
    ? 'Generate narration before publishing or exporting.'
    : hasUnsavedReelText
    ? 'Save panel text before publishing or exporting.'
    : hasUnsavedReelOverlayStyle
    ? 'Save caption style before publishing or exporting.'
    : reelHasPendingWork
    ? 'Wait for image and narration generation to finish.'
    : null;
  const reelPlayableNodes = useMemo(
    () => (reelTimelineNodes ?? []).filter((node) => {
      const normalizedBeat = normalizeBeatMediaFields(node.data);
      return Boolean(normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl)
        && normalizedBeat.imageStatus === 'ready'
        && Boolean(normalizedBeat.audioUrl)
        && normalizedBeat.audioStatus === 'ready';
    }),
    [reelTimelineNodes]
  );
  const canPlayFullReel = Boolean(
    isReelStory
    && reelTimelineNodes?.length
    && reelPlayableNodes.length === reelTimelineNodes.length
    && !hasUnsavedReelText
    && !hasUnsavedReelOverlayStyle
    && !reelHasPendingWork
  );
  const reelPlayAllDisabledReason = !reelTimelineNodes?.length
    ? 'No reel beats available yet.'
    : reelPlayableNodes.length !== reelTimelineNodes.length
    ? 'Generate images and narration for every beat first.'
    : hasUnsavedReelText
    ? 'Save panel text before playing the full reel.'
    : hasUnsavedReelOverlayStyle
    ? 'Save caption style before playing the full reel.'
    : reelHasPendingWork
    ? 'Wait for image and narration generation to finish.'
    : 'Play reel from beginning';
  const videoDownloadGlobalOn = cycleSettings.videoDownloadEnabled;
  const adminBypassed = cycleSettings.videoDownloadAdminBypass && isAdminUser;
  const canAccessVideoExport = adminBypassed || (pricing.controls.pricingSnapshotEnabled && pricing.snapshot.canAccessDownloads);
  const videoExportPreset = pricing.snapshot.videoExportPreset;
  const showVideoWatermark = resolveVideoExportWatermarkVisibility(
    videoExportPreset,
    pricing.snapshot.canAccessUnbrandedExports
  );
  const reelPublishingEnabled = cycleSettings.reelStoryPublishEnabled;
  const canPublishReel = Boolean(reelPublishingEnabled && !lastPublishResult && onSave && reelReadyForDistribution);
  const canExportReelVideo = Boolean(videoDownloadGlobalOn && reelReadyForDistribution && canAccessVideoExport);
  const reelExportBeats = reelDistributionBeats.map((beat) => {
    const normalizedBeat = normalizeBeatMediaFields(beat);
    return {
      ...normalizedBeat,
      imageUrl: normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl,
    };
  });
  const exportPhaseLabel = exportPhase === 'loading'
    ? 'Loading encoder'
    : exportPhase === 'preparing'
    ? 'Preparing scenes'
    : exportPhase === 'encoding'
    ? 'Rendering video'
    : exportPhase === 'finalizing'
    ? 'Finalizing file'
    : 'Exporting video';

  useEffect(() => {
    setReelPanelDraft(savedReelPanelTexts);
    setReelTextSaveState('idle');
    setReelTextMessage(null);
  }, [currentNodeId, savedReelPanelTexts]);

  useEffect(() => {
    setReelOverlayDraft(savedReelOverlayStyle);
    setReelStyleSaveState('idle');
    setReelStyleMessage(null);
  }, [savedReelOverlayStyle]);

  const updateReelPanelDraft = useCallback((panelIndex: number, value: string) => {
    setReelPanelDraft((current) =>
      Array.from({ length: REEL_PANEL_COUNT }, (_, index) => (
        index === panelIndex ? value : current[index] || ''
      ))
    );
    setReelTextSaveState('idle');
    setReelTextMessage(null);
  }, []);

  const handleSaveReelText = useCallback(async (confirmClearNarration = false) => {
    if (!isReelStory || !hasUnsavedReelText || isReelTextSaving) return;

    if (hasReelAudio && !confirmClearNarration) {
      setReelTextSaveState('warning');
      setReelTextMessage('Saving text will clear the existing narration for this beat.');
      return;
    }

    setReelTextSaveState('saving');
    setReelTextMessage(null);

    try {
      const result = await updateReelPanelCaptions(currentNodeId, reelPanelDraft);
      setReelTextSaveState('saved');
      setReelTextMessage(result.clearedNarration
        ? 'Text saved. Narration was cleared.'
        : 'Text saved.');
    } catch (error) {
      setReelTextSaveState('error');
      setReelTextMessage(error instanceof Error ? error.message : 'Failed to save reel text.');
    }
  }, [
    currentNodeId,
    hasReelAudio,
    hasUnsavedReelText,
    isReelStory,
    isReelTextSaving,
    reelPanelDraft,
    updateReelPanelCaptions,
  ]);

  const handleCancelReelTextWarning = useCallback(() => {
    setReelTextSaveState('idle');
    setReelTextMessage(null);
  }, []);

  const handleCancelReelTextChanges = useCallback(() => {
    setReelPanelDraft(savedReelPanelTexts);
    setReelTextSaveState('idle');
    setReelTextMessage(null);
  }, [savedReelPanelTexts]);

  const updateReelOverlayDraft = useCallback((patch: ReelTextOverlayStyle) => {
    setReelOverlayDraft((current) => normalizeReelTextOverlayStyle({
      ...current,
      ...patch,
    }));
    setReelStyleSaveState('idle');
    setReelStyleMessage(null);
  }, []);

  const handleSaveReelOverlayStyle = useCallback(async () => {
    if (!isReelStory || !hasUnsavedReelOverlayStyle || isReelStyleSaving) return;

    setReelStyleSaveState('saving');
    setReelStyleMessage(null);

    try {
      await updateReelTextOverlayStyle(reelOverlayDraft);
      setReelStyleSaveState('saved');
      setReelStyleMessage('Style saved.');
    } catch (error) {
      setReelStyleSaveState('error');
      setReelStyleMessage(error instanceof Error ? error.message : 'Failed to save text style.');
    }
  }, [
    hasUnsavedReelOverlayStyle,
    isReelStory,
    isReelStyleSaving,
    reelOverlayDraft,
    updateReelTextOverlayStyle,
  ]);

  const handleGenerateNarration = useCallback(() => {
    if (isReelStory && hasUnsavedReelText) {
      setReelTextSaveState('error');
      setReelTextMessage('Save panel text before generating narration.');
      return;
    }
    void generateNarrationForNode(currentNodeId);
  }, [currentNodeId, generateNarrationForNode, hasUnsavedReelText, isReelStory]);

  const handleManualNavigateToNode = useCallback((nodeId: string) => {
    if (isReelStory) {
      cancelReelPlayAll();
    }
    navigateToNode(nodeId);
  }, [cancelReelPlayAll, isReelStory, navigateToNode]);

  const handleReelNarrationToggle = useCallback(() => {
    cancelReelPlayAll();
    togglePlayPause();
  }, [cancelReelPlayAll, togglePlayPause]);

  const handleReelGenerateNarration = useCallback(() => {
    cancelReelPlayAll();
    handleGenerateNarration();
  }, [cancelReelPlayAll, handleGenerateNarration]);

  const handleToggleReelPlayAll = useCallback(() => {
    if (!canPlayFullReel || !reelTimelineNodes?.length) return;

    if (reelPlayAllActive) {
      if (playbackState === 'playing') {
        togglePlayPause();
        return;
      }
      playAudio();
      return;
    }

    const nodeIds = reelTimelineNodes.map((node) => node.id);
    const firstNodeId = nodeIds[0];
    if (!firstNodeId) return;

    reelPlayAllNodeIdsRef.current = nodeIds;
    pendingReelPlayAllNodeIdRef.current = null;
    setReelPlayAllActive(true);

    if (currentNodeId !== firstNodeId) {
      pendingReelPlayAllNodeIdRef.current = firstNodeId;
      navigateToNode(firstNodeId);
      return;
    }

    playAudio();
  }, [
    canPlayFullReel,
    currentNodeId,
    navigateToNode,
    playAudio,
    playbackState,
    reelPlayAllActive,
    reelTimelineNodes,
    togglePlayPause,
  ]);

  useEffect(() => {
    if (!reelPlayAllActive || pendingReelPlayAllNodeIdRef.current !== currentNodeId || !normalizedCurrentBeat.audioUrl) {
      return;
    }

    pendingReelPlayAllNodeIdRef.current = null;
    playAudio();
  }, [currentNodeId, normalizedCurrentBeat.audioUrl, playAudio, reelPlayAllActive]);

  useEffect(() => {
    if (!canPlayFullReel && reelPlayAllActive) {
      cancelReelPlayAll();
    }
  }, [canPlayFullReel, cancelReelPlayAll, reelPlayAllActive]);

  // Autoplay narration in story mode when navigating to a node with audio
  useEffect(() => {
    if (prevNodeIdForAutoplay.current !== currentNodeId) {
      prevNodeIdForAutoplay.current = currentNodeId;
      if (storyMode && normalizedCurrentBeat.audioUrl && playbackState === 'idle') {
        playAudio();
      }
    }
  }, [currentNodeId, storyMode, normalizedCurrentBeat.audioUrl, playbackState, playAudio]);

  // Autoplay when audio becomes ready on current node in story mode
  useEffect(() => {
    if (storyMode && isAudioReady && normalizedCurrentBeat.audioUrl && playbackState === 'idle') {
      playAudio();
    }
  }, [storyMode, isAudioReady, normalizedCurrentBeat.audioUrl, playbackState, playAudio]);

  // Chime when audio becomes ready for current node
  useEffect(() => {
    if (isAudioReady) {
      const chime = new Audio('/sounds/chime.wav');
      chime.volume = 0.3;
      chime.play().catch(() => {});
    }
  }, [isAudioReady]);

  const { focusedOptionIndex, focusMode } = useKeyboardNavigation({
    storyMap: session.storyMap,
    options: orderedOptions,
    onNavigateNode: handleManualNavigateToNode,
    onSelectOption: continueStory,
    onToggleMinimized: () => setIsMinimized(prev => !prev),
    onToggleNarration: () => {
      if (isReelStory) {
        cancelReelPlayAll();
      }
      if (isReelStory && hasUnsavedReelText) {
        setReelTextSaveState('error');
        setReelTextMessage('Save panel text before using narration.');
        return;
      }
      if (normalizedCurrentBeat.audioUrl) {
        togglePlayPause();
      } else if (!isGeneratingAudio) {
        handleGenerateNarration();
      }
    },
    timelineNodes: reelTimelineNodes,
    isLoading,
    isEnding,
  });

  // Auto-hide while a beat is generating, then restore the reader when that loading completes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (isLoading) {
        setIsMinimized((current) => {
          autoMinimizedForLoadingRef.current = !current;
          return true;
        });
        return;
      }

      if (autoMinimizedForLoadingRef.current) {
        autoMinimizedForLoadingRef.current = false;
        setIsMinimized(false);
        setActiveReaderPanel('story');
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [isLoading]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(handleScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [currentNodeId, cycleSettings.storyUiTextLineCount, handleScroll]);

  useEffect(() => {
    if (isMinimized) {
      stopAutoScroll();
    }
  }, [isMinimized, stopAutoScroll]);

  useEffect(() => {
    if (!copiedPromptKey) return;
    const timeoutId = window.setTimeout(() => setCopiedPromptKey(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copiedPromptKey]);

  useEffect(() => {
    if (!promptToolsSuccess) return;
    const timeoutId = window.setTimeout(() => setPromptToolsSuccess(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [promptToolsSuccess]);

  // Auto-save when a new beat is generated
  useEffect(() => {
    if (saveStatus === 'unsaved' && onSave && !isSaving) {
      onSave();
    }
  }, [saveStatus, onSave, isSaving]);

  // Recovery guard for a save request that is taking longer than expected.
  // The store queues one retry behind the active save instead of launching overlapping uploads.
  useEffect(() => {
    if (!onSave || saveStatus !== 'saving') return;

    const timeoutId = window.setTimeout(() => {
      const latest = useStoryStore.getState();
      if (latest.saveStatus !== 'saving') return;

      if (cycleSettings.storyIncrementalAssetSyncEnabled) {
        if (!isPromptOnlyStory) {
          useStoryStore.setState({
            saveWarning: latest.saveWarning || 'Beat media is syncing in the background.',
          });
        }
        return;
      }

      useStoryStore.setState({
        error: latest.error || 'Cloud save is taking longer than usual. A retry is queued.',
      });
      onSave();
    }, cycleSettings.storyIncrementalAssetSyncEnabled
      ? cycleSettings.storyAssetSyncWarningTimeoutMs
      : cycleSettings.cloudSaveTimeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    saveStatus,
    onSave,
    isPromptOnlyStory,
    cycleSettings.cloudSaveTimeoutMs,
    cycleSettings.storyIncrementalAssetSyncEnabled,
    cycleSettings.storyAssetSyncWarningTimeoutMs,
  ]);

  // Auto-scroll focused option into view
  useEffect(() => {
    if (focusedOptionIndex >= 0 && optionRefs.current[focusedOptionIndex]) {
      optionRefs.current[focusedOptionIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [focusedOptionIndex]);

  const backgroundImageOpacity = isVerticalStory
    ? (isLoading ? 'opacity-95 md:opacity-70' : (isMinimized ? 'opacity-90 md:opacity-60' : 'opacity-90 md:opacity-40'))
    : isLoading
    ? (isMinimized ? 'opacity-85' : 'opacity-70')
    : (isMinimized ? 'opacity-60' : 'opacity-40');
  const backgroundGradientClass = isLoading
    ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950/60 via-neutral-950/35 to-transparent'
    : 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950 via-neutral-950/90 to-transparent';
  const headerGradientClass = isLoading
    ? 'relative z-10 flex shrink-0 flex-col gap-5 px-4 pb-2 pt-4 md:flex-row md:items-center md:justify-between md:gap-0 md:p-6 md:pl-36 md:pr-24 bg-gradient-to-b from-neutral-950/45 via-neutral-950/15 to-transparent'
    : 'relative z-10 flex shrink-0 flex-col gap-5 px-4 pb-2 pt-4 md:flex-row md:items-center md:justify-between md:gap-0 md:p-6 md:pl-36 md:pr-24 bg-gradient-to-b from-neutral-950/80 to-transparent';
  const chromeVisibilityClass = isLoading
    ? 'opacity-0 pointer-events-none select-none'
    : 'opacity-100';
  const storyTextViewportStyle = {
    height: `min(46vh, calc(${cycleSettings.storyUiTextLineCount} * 1lh))`,
  } satisfies CSSProperties;
  const reelTextViewportStyle = {
    height: 'min(52vh, 30rem)',
  } satisfies CSSProperties;

  const resetBeatUploadState = useCallback(() => {
    setUploadPreview((prev) => {
      revokeUploadPreview(prev);
      return null;
    });
    setUploadError(null);
    setIsOptimizingPromptOnlyImage(false);
    setIsUploadingPromptOnlyImage(false);
    setPendingDeleteStorageKey(null);
    setIsPermanentlyDeletingKey(null);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }, []);

  const resetCharacterUploadState = useCallback(() => {
    setCharacterSheetPreview((prev) => {
      revokeUploadPreview(prev);
      return null;
    });
    setCharacterSheetError(null);
    setIsOptimizingCharacterSheet(false);
    setIsUploadingCharacterSheet(false);
    setPendingCharacterDeleteId(null);
    setPendingSheetDeleteKey(null);
    setPermanentlyDeletingSheetKey(null);
    if (characterSheetInputRef.current) {
      characterSheetInputRef.current.value = '';
    }
  }, []);

  const openPromptToolsOverview = useCallback(() => {
    setPromptToolsModalState({ view: 'overview' });
    setIsPromptToolsHelpOpen(false);
    setSavedRefsExpanded(false);
    setPromptToolsSuccess(null);
  }, []);

  const closePromptToolsModal = useCallback(() => {
    if (isUploadingPromptOnlyImage || isUploadingCharacterSheet || isOptimizingPromptOnlyImage || isOptimizingCharacterSheet) return;

    setPromptToolsModalState({ view: 'closed' });
    setIsPromptToolsHelpOpen(false);
    setSavedRefsExpanded(false);
    setPromptToolsSuccess(null);
    resetBeatUploadState();
    resetCharacterUploadState();
  }, [
    isOptimizingCharacterSheet,
    isOptimizingPromptOnlyImage,
    isUploadingCharacterSheet,
    isUploadingPromptOnlyImage,
    resetBeatUploadState,
    resetCharacterUploadState,
  ]);

  // Close the prompt-tools modal on Escape only from the overview state.
  useEffect(() => {
    if (!promptToolsOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && promptToolsModalState.view === 'overview') {
        closePromptToolsModal();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [closePromptToolsModal, promptToolsModalState.view, promptToolsOpen]);

  // Reset the prompt-tools modal when the active beat changes.
  useEffect(() => {
    setPromptToolsModalState({ view: 'closed' });
    setIsPromptToolsHelpOpen(false);
    setSavedRefsExpanded(false);
    setPromptToolsSuccess(null);
    resetBeatUploadState();
    resetCharacterUploadState();
  }, [currentNodeId, resetBeatUploadState, resetCharacterUploadState]);

  const copyPromptText = useCallback(async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPromptKey(key);
    } catch {
      setCopiedPromptKey(null);
    }
  }, []);

  const openBeatUploadView = useCallback(() => {
    resetBeatUploadState();
    setPromptToolsSuccess(null);
    setIsPromptToolsHelpOpen(false);
    setPromptToolsModalState({ view: 'beat-upload' });
  }, [resetBeatUploadState]);

  const handlePromptOnlyFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadError(null);
    setIsOptimizingPromptOnlyImage(true);
    try {
      const validated = await validatePromptOnlyImageFile(
        file,
        isVerticalStory,
        cycleSettings.imageUploadOptimizationSettings
      );
      setUploadPreview((prev) => {
        revokeUploadPreview(prev);
        return validated;
      });
    } catch (error: any) {
      setUploadPreview((prev) => {
        revokeUploadPreview(prev);
        return null;
      });
      setUploadError(error?.message || 'Could not validate the selected image.');
    } finally {
      setIsOptimizingPromptOnlyImage(false);
      event.target.value = '';
    }
  }, [cycleSettings.imageUploadOptimizationSettings, isVerticalStory]);

  const handlePromptOnlyUpload = useCallback(async () => {
    if (!uploadPreview) {
      setUploadError('Choose an image before uploading.');
      return;
    }

    setIsUploadingPromptOnlyImage(true);
    setUploadError(null);
    try {
      await setPromptOnlyBeatImage(currentNodeId, uploadPreview.dataUrl, {
        uploadBody: uploadPreview.uploadBody,
        maxImagesPerBeat: cycleSettings.promptOnlyMaxImagesPerBeat,
        optimizationMetadata: uploadPreview.optimizationMetadata,
        storageExtension: uploadPreview.storageExtension,
      });
      resetBeatUploadState();
      setPromptToolsSuccess('Beat image saved.');
      setIsPromptToolsHelpOpen(false);
      setPromptToolsModalState({ view: 'overview' });
    } catch (error: any) {
      setUploadError(error?.message || 'Could not upload this image.');
    } finally {
      setIsUploadingPromptOnlyImage(false);
    }
  }, [currentNodeId, cycleSettings.promptOnlyMaxImagesPerBeat, resetBeatUploadState, setPromptOnlyBeatImage, uploadPreview]);

  const handlePromptOnlyDelete = useCallback(async () => {
    try {
      await deletePromptOnlyBeatImage(currentNodeId);
    } catch {
      // Keep the current editor state if deletion fails.
    }
  }, [currentNodeId, deletePromptOnlyBeatImage]);

  const handleSelectGalleryImage = useCallback(async (storageKey: string) => {
    try {
      await selectPromptOnlyBeatImage(currentNodeId, storageKey);
    } catch {
      // Selection failures shouldn't break the modal — keep state as-is.
    }
  }, [currentNodeId, selectPromptOnlyBeatImage]);

  const handlePermanentDelete = useCallback(async (storageKey: string) => {
    setIsPermanentlyDeletingKey(storageKey);
    try {
      await permanentlyDeletePromptOnlyBeatImage(currentNodeId, storageKey);
      setPendingDeleteStorageKey(null);
    } catch (error: any) {
      setUploadError(error?.message || 'Could not delete this image.');
    } finally {
      setIsPermanentlyDeletingKey(null);
    }
  }, [currentNodeId, permanentlyDeletePromptOnlyBeatImage]);

  const openCharacterSheetUpload = useCallback((characterId: string, characterName: string) => {
    resetCharacterUploadState();
    setPromptToolsSuccess(null);
    setIsPromptToolsHelpOpen(false);
    setPromptToolsModalState({ view: 'character-upload', characterId, characterName });
  }, [resetCharacterUploadState]);

  const handleCharacterSheetFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCharacterSheetError(null);
    setIsOptimizingCharacterSheet(true);
    try {
      const validated = await validateCharacterSheetUpload(
        file,
        cycleSettings.characterSheetUploadMaxBytes,
        cycleSettings.imageUploadOptimizationSettings
      );
      setCharacterSheetPreview((prev) => {
        revokeUploadPreview(prev);
        return validated;
      });
    } catch (error: any) {
      setCharacterSheetPreview((prev) => {
        revokeUploadPreview(prev);
        return null;
      });
      setCharacterSheetError(error?.message || 'Could not validate the selected image.');
    } finally {
      setIsOptimizingCharacterSheet(false);
      event.target.value = '';
    }
  }, [cycleSettings.characterSheetUploadMaxBytes, cycleSettings.imageUploadOptimizationSettings]);

  const handleCharacterSheetUpload = useCallback(async () => {
    if (!activeCharacterSheetTarget) return;
    if (!characterSheetPreview) {
      setCharacterSheetError('Choose an image before uploading.');
      return;
    }

    setIsUploadingCharacterSheet(true);
    setCharacterSheetError(null);
    try {
      await setCharacterReferenceSheet(activeCharacterSheetTarget.characterId, characterSheetPreview.dataUrl, {
        uploadBody: characterSheetPreview.uploadBody,
        maxPerCharacter: cycleSettings.characterSheetMaxPerCharacter,
        optimizationMetadata: characterSheetPreview.optimizationMetadata,
        storageExtension: characterSheetPreview.storageExtension,
      });
      resetCharacterUploadState();
      setPromptToolsSuccess(`${activeCharacterSheetTarget.characterName} sheet saved.`);
      setIsPromptToolsHelpOpen(false);
      setPromptToolsModalState({ view: 'overview' });
    } catch (error: any) {
      setCharacterSheetError(error?.message || 'Could not upload this character sheet.');
    } finally {
      setIsUploadingCharacterSheet(false);
    }
  }, [
    activeCharacterSheetTarget,
    characterSheetPreview,
    cycleSettings.characterSheetMaxPerCharacter,
    resetCharacterUploadState,
    setCharacterReferenceSheet,
  ]);

  const handleCharacterSheetClearActive = useCallback(async (characterId: string) => {
    setPendingCharacterDeleteId(characterId);
    try {
      await deleteCharacterReferenceSheet(characterId);
    } catch {
      // Keep the existing reference if clearing fails.
    } finally {
      setPendingCharacterDeleteId(null);
    }
  }, [deleteCharacterReferenceSheet]);

  const handleSelectCharacterSheet = useCallback(async (characterId: string, storageKey: string) => {
    try {
      await selectCharacterReferenceSheet(characterId, storageKey);
    } catch {
      // Selection failures shouldn't break the modal — keep state as-is.
    }
  }, [selectCharacterReferenceSheet]);

  const handlePermanentDeleteCharacterSheet = useCallback(async (characterId: string, storageKey: string) => {
    setPermanentlyDeletingSheetKey(storageKey);
    try {
      await permanentlyDeleteCharacterReferenceSheet(characterId, storageKey);
      setPendingSheetDeleteKey(null);
    } catch (error: any) {
      setCharacterSheetError(error?.message || 'Could not delete this sheet.');
    } finally {
      setPermanentlyDeletingSheetKey(null);
    }
  }, [permanentlyDeleteCharacterReferenceSheet]);

  const returnToPromptToolsOverview = useCallback(() => {
    if (isUploadingPromptOnlyImage || isUploadingCharacterSheet) return;

    resetBeatUploadState();
    resetCharacterUploadState();
    setPromptToolsSuccess(null);
    setIsPromptToolsHelpOpen(false);
    setPromptToolsModalState({ view: 'overview' });
  }, [
    isUploadingCharacterSheet,
    isUploadingPromptOnlyImage,
    resetBeatUploadState,
    resetCharacterUploadState,
  ]);

  const togglePromptTools = useCallback(() => {
    if (!canOpenPromptTools) return;
    if (promptToolsOpen) {
      closePromptToolsModal();
    } else {
      openPromptToolsOverview();
    }
  }, [canOpenPromptTools, closePromptToolsModal, openPromptToolsOverview, promptToolsOpen]);

  const handleExportReelVideo = useCallback(async () => {
    if (!canExportReelVideo || isExporting) return;

    const exportTitle = session.title || 'kissago-reel';
    if (!adminBypassed) {
      const auth = await authorizeCurrentUserBillableAction({
        actionKey: 'export_video_future',
        idempotencyKey: `export-reel-${session.savedStoryId ?? currentNodeId}-${Date.now()}`,
        relatedStoryId: session.savedStoryId ?? null,
        relatedNodeId: currentNodeId,
        metadata: { source: 'reel_creation' },
      });

      if (auth.status === 'denied') {
        window.open('/wallet', '_blank');
        return;
      }

      const ok = await exportVideo(reelExportBeats, exportTitle, {
        aspectRatio: '9:16',
        videoExportPreset,
        showWatermark: showVideoWatermark,
      });

      if (auth.status === 'allowed' && auth.reservationId) {
        if (ok) {
          await finalizeCurrentUserBillableAction({
            reservationId: auth.reservationId,
            storyId: session.savedStoryId ?? null,
            relatedEntityId: currentNodeId,
            metadata: { source: 'reel_creation' },
          });
        } else {
          await releaseCurrentUserBillableAction({
            reservationId: auth.reservationId,
            reason: 'export_failed',
            metadata: { source: 'reel_creation' },
          });
        }
      }
      return;
    }

    await exportVideo(reelExportBeats, exportTitle, {
      aspectRatio: '9:16',
      videoExportPreset,
      showWatermark: showVideoWatermark,
    });
  }, [
    adminBypassed,
    canExportReelVideo,
    currentNodeId,
    exportVideo,
    isExporting,
    reelExportBeats,
    session.savedStoryId,
    session.title,
    showVideoWatermark,
    videoExportPreset,
  ]);

  const handleConfirmDiscardReel = useCallback(async () => {
    if (!isReelStory || !session.savedStoryId || isDiscardingReel) return;

    setIsDiscardingReel(true);
    setDiscardReelError(null);
    try {
      const discardedStoryId = session.savedStoryId;
      await deleteStory(discardedStoryId);
      sessionStorage.setItem('kissago_skip_story_reload', discardedStoryId);
      useMyStoriesStore.getState().removeReel(discardedStoryId);
      resetStory();
      router.replace('/?mode=reel');
    } catch (error) {
      setDiscardReelError(error instanceof Error ? error.message : 'Failed to discard this reel.');
    } finally {
      setIsDiscardingReel(false);
    }
  }, [isDiscardingReel, isReelStory, resetStory, router, session.savedStoryId]);

  const mainClassName = `relative z-10 flex-1 flex flex-col w-full min-h-0 transition-opacity duration-300 ${chromeVisibilityClass} ${
    isReelStory
      ? 'justify-center px-4 pb-3 pt-1 md:px-8 md:pb-4 md:pt-8 max-w-6xl mx-auto'
      : 'justify-end px-4 pb-[31px] pt-1 md:p-12 max-w-5xl mx-auto'
  }`;

  const renderReelPreview = (surface: 'desktop' | 'mobile') => (
    <div
      className={`relative mx-auto aspect-[9/16] overflow-hidden border border-white/15 bg-neutral-950/50 shadow-2xl ${
        surface === 'desktop'
          ? 'hidden h-[80dvh] max-h-[calc(100dvh-7rem)] rounded-[28px] md:block'
          : 'w-full max-w-[19rem] rounded-[24px] md:hidden'
      }`}
    >
      {isStoryboard ? (
        <StoryboardCycler
          key={`reel-${surface}:${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
          gridUrl={normalizedCurrentBeat.imageUrl!}
          audioUrl={normalizedCurrentBeat.audioUrl}
          cycleOverride={cycleSettings.cycleOverride}
          cycleMs={cycleSettings.cycleMs}
          vignetteEnabled={cycleSettings.vignetteEnabled}
          vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
          playbackState={playbackState}
          captions={normalizedCurrentBeat.reelCaptions}
          textOverlayEnabled={normalizedCurrentBeat.reelTextOverlayEnabled !== false}
          textOverlayStyle={reelOverlayDraft}
          onImageLoad={() => setFailedImageUrl((prev) => (prev === normalizedCurrentBeat.imageUrl ? null : prev))}
          onImageError={() => setFailedImageUrl(normalizedCurrentBeat.imageUrl!)}
        />
      ) : displayImageUrl ? (
        <Image
          src={displayImageUrl}
          alt={currentBeat.sceneSummary}
          fill
          className="object-cover"
          referrerPolicy="no-referrer"
          priority
          unoptimized
          onLoad={() => setFailedImageUrl((prev) => (prev === displayImageUrl ? null : prev))}
          onError={() => setFailedImageUrl(displayImageUrl)}
        />
      ) : showPromptOnlyPlaceholder ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-neutral-300"
          title="No image for this beat - use the prompt tools to upload one"
        >
          <ImageOff className="h-10 w-10 text-sky-200/80" />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900/70 text-center text-neutral-200">
          {showPendingImageState ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
              <p className="text-sm uppercase tracking-[0.18em] text-neutral-300">Image Syncing</p>
            </>
          ) : (
            <>
              <AlertTriangle className="h-8 w-8 text-amber-300" />
              <p className="text-sm uppercase tracking-[0.18em] text-neutral-300">Image Upload Needs Retry</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  const reelEditorLayout = isReelStory ? (
    <div className="flex min-h-0 w-full flex-col gap-4 md:grid md:grid-cols-[3.25rem_auto_minmax(20rem,24rem)] md:items-end md:justify-center md:gap-6">
      <div className="md:hidden">
        {renderReelPreview('mobile')}
      </div>

      <div className="flex justify-start md:h-full md:items-end md:justify-center md:pb-4">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleToggleReelPlayAll}
            disabled={!canPlayFullReel}
            title={reelPlayAllActive ? (playbackState === 'playing' ? 'Pause full reel' : 'Resume full reel') : reelPlayAllDisabledReason}
            className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md transition-all ${
              canPlayFullReel
                ? reelPlayAllActive
                  ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                  : 'border-emerald-500/25 bg-neutral-900/60 text-emerald-200 hover:border-emerald-400/45 hover:bg-neutral-800'
                : 'cursor-not-allowed border-white/10 bg-neutral-900/35 text-neutral-600'
            }`}
          >
            {reelPlayAllActive && playbackState === 'playing' ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </button>
        <NarrationButton
          isGeneratingAudio={isGeneratingAudio}
          isAudioReady={isAudioReady}
          playbackState={playbackState}
          hasAudio={!!normalizedCurrentBeat.audioUrl}
          onTogglePlayPause={handleReelNarrationToggle}
          onGenerateNarration={handleReelGenerateNarration}
          onClearGlow={clearAudioReady}
          storyMode={storyMode}
          onToggleStoryMode={toggleStoryMode}
          disabled={hasUnsavedReelText}
          disabledReason="Save panel text before generating narration"
        />
        </div>
      </div>

      {renderReelPreview('desktop')}

      <div className="flex min-h-0 w-full flex-col gap-3 md:self-end">
        <ReelCaptionStylePanel
          normalizedStyle={normalizedReelOverlayDraft}
          hasUnsavedStyle={hasUnsavedReelOverlayStyle}
          isSavingStyle={isReelStyleSaving}
          saveState={reelStyleSaveState}
          message={reelStyleMessage}
          onChange={updateReelOverlayDraft}
          onSave={handleSaveReelOverlayStyle}
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="touch-visible relative z-20 w-full overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl"
        >
          <ReelToolbar
            storyMap={session.storyMap}
            onNodeClick={handleManualNavigateToNode}
            focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
            nodes={reelTimelineNodes}
            isCollapsed={isMinimized}
            onToggleCollapsed={() => setIsMinimized((prev) => !prev)}
            canOpenPromptTools={canOpenPromptTools}
            promptToolsOpen={promptToolsOpen}
            onTogglePromptTools={togglePromptTools}
            className={isMinimized ? 'border-b-0 rounded-3xl' : ''}
          />
          {!isMinimized && (
            <ReelPanelEditor
              panelDrafts={reelPanelDraft}
              hasUnsavedText={hasUnsavedReelText}
              isTextSaving={isReelTextSaving}
              saveState={reelTextSaveState}
              message={reelTextMessage}
              onPanelChange={updateReelPanelDraft}
              onSaveText={handleSaveReelText}
              onCancelChanges={handleCancelReelTextChanges}
              onCancelWarning={handleCancelReelTextWarning}
            />
          )}
        </motion.div>

        <div className="space-y-2">
          {lastPublishResult && (
            <div className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
              lastPublishResult.error
                ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
            }`}>
              {lastPublishResult.error ? (
                <>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Publishing failed - {lastPublishResult.error}</span>
                </>
              ) : (
                <>
                  <Share2 className="h-4 w-4 shrink-0" />
                  <span>{lastPublishResult.alreadyPublished ? 'This reel is already published.' : 'Reel published.'}</span>
                  <div className="ml-auto flex items-center gap-3">
                    <Link
                      href={`/storyline/${lastPublishResult.storylineId}`}
                      className="inline-flex items-center gap-1 text-emerald-200 transition-colors hover:text-white"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setManagedStorylineId(lastPublishResult.storylineId)}
                      className="inline-flex items-center gap-1 text-emerald-200 transition-colors hover:text-white"
                    >
                      Cover <ImageIcon className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {!lastPublishResult && (
            <div className={`grid gap-2 ${reelPublishingEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {reelPublishingEnabled && (
                <button
                  type="button"
                  onClick={() => canPublishReel && setShowPublishDialog(true)}
                  disabled={!canPublishReel}
                  title={!onSave ? 'Sign in to publish this reel.' : reelDistributionBlockReason ?? 'Publish reel'}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
                >
                  <Share2 className="h-4 w-4" />
                  <span>Publish</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setDiscardReelError(null);
                  setShowDiscardReelDialog(true);
                }}
                disabled={!session.savedStoryId || isDiscardingReel}
                title={session.savedStoryId ? 'Discard this reel draft' : 'Save must finish before this reel can be discarded.'}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-500"
              >
                {isDiscardingReel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span>Discard</span>
              </button>

              {canExportReelVideo ? (
                <button
                  type="button"
                  onClick={() => void handleExportReelVideo()}
                  disabled={isExporting}
                  title={isExporting ? `Exporting... ${exportProgress}%` : 'Export reel video'}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-70 ${
                    reelPublishingEnabled
                      ? 'border-sky-500/30 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25'
                      : 'border-emerald-500/35 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                  }`}
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{exportPhase === 'loading' ? 'Loading' : `${exportProgress}%`}</span>
                    </>
                  ) : exportProgress === 100 ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-300" />
                      <span>Saved</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Export</span>
                    </>
                  )}
                </button>
              ) : reelReadyForDistribution && videoDownloadGlobalOn && !canAccessVideoExport ? (
                <button
                  type="button"
                  onClick={() => window.open('/wallet', '_blank')}
                  title="Video export is available on eligible plans."
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200"
                >
                  <Lock className="h-4 w-4" />
                  <span>Export</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title={!videoDownloadGlobalOn ? 'Video export is disabled in Global Settings.' : reelDistributionBlockReason ?? 'Export reel video'}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-neutral-500 disabled:cursor-not-allowed"
                >
                  <Download className="h-4 w-4" />
                  <span>Export</span>
                </button>
              )}
            </div>
          )}

          {exportError && (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{exportError}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative h-dvh bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={visualKey}
            initial={isStoryboard ? { opacity: 0 } : { opacity: 0, scale: 1.05 }}
            animate={isStoryboard ? { opacity: 1 } : { opacity: 1, scale: [1, 1.08] }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.5, ease: "easeOut" },
              scale: { duration: 20, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" },
            }}
            className={isVerticalStory ? 'absolute inset-0' : 'absolute inset-0 scale-110 blur-2xl md:scale-100 md:blur-none'}
          >
            <div className={isVerticalStory ? 'absolute inset-0 md:scale-110 md:blur-2xl' : 'contents'}>
            {isStoryboard ? (
              <StoryboardCycler
                key={`${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                gridUrl={normalizedCurrentBeat.imageUrl!}
                audioUrl={normalizedCurrentBeat.audioUrl}
                cycleOverride={cycleSettings.cycleOverride}
                cycleMs={cycleSettings.cycleMs}
                vignetteEnabled={cycleSettings.vignetteEnabled}
                vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                playbackState={playbackState}
                captions={normalizedCurrentBeat.reelCaptions}
                textOverlayEnabled={normalizedCurrentBeat.reelTextOverlayEnabled !== false}
                textOverlayStyle={isReelStory ? reelOverlayDraft : normalizedCurrentBeat.reelTextOverlayStyle}
                onImageLoad={() => setFailedImageUrl((prev) => (prev === normalizedCurrentBeat.imageUrl ? null : prev))}
                onImageError={() => setFailedImageUrl(normalizedCurrentBeat.imageUrl!)}
              />
            ) : displayImageUrl && (
              <Image
                src={displayImageUrl}
                alt={currentBeat.sceneSummary}
                fill
                className={`object-cover transition-opacity duration-700 ${backgroundImageOpacity}`}
                referrerPolicy="no-referrer"
                priority
                unoptimized
                onLoad={() => setFailedImageUrl((prev) => (prev === displayImageUrl ? null : prev))}
                onError={() => setFailedImageUrl(displayImageUrl)}
              />
            )}
            </div>
            {!isReelStory && isVerticalStory && displayImageUrl && (
              <div className="absolute inset-0 hidden items-center justify-center px-8 py-20 md:flex">
                <div className="relative h-full max-h-[min(78vh,900px)] aspect-[9/16] overflow-hidden rounded-[28px] border border-white/15 bg-neutral-950/50 shadow-2xl">
                  {isStoryboard ? (
                    <StoryboardCycler
                      key={`vertical-window:${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                      gridUrl={normalizedCurrentBeat.imageUrl!}
                      audioUrl={normalizedCurrentBeat.audioUrl}
                      cycleOverride={cycleSettings.cycleOverride}
                      cycleMs={cycleSettings.cycleMs}
                      vignetteEnabled={cycleSettings.vignetteEnabled}
                      vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                      playbackState={playbackState}
                      captions={normalizedCurrentBeat.reelCaptions}
                      textOverlayEnabled={normalizedCurrentBeat.reelTextOverlayEnabled !== false}
                      textOverlayStyle={isReelStory ? reelOverlayDraft : normalizedCurrentBeat.reelTextOverlayStyle}
                      onImageLoad={() => setFailedImageUrl((prev) => (prev === normalizedCurrentBeat.imageUrl ? null : prev))}
                      onImageError={() => setFailedImageUrl(normalizedCurrentBeat.imageUrl!)}
                    />
                  ) : (
                    <Image
                      src={displayImageUrl}
                      alt={currentBeat.sceneSummary}
                      fill
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      priority
                      unoptimized
                      onLoad={() => setFailedImageUrl((prev) => (prev === displayImageUrl ? null : prev))}
                      onError={() => setFailedImageUrl(displayImageUrl)}
                    />
                  )}
                  {isReelStory && !normalizedCurrentBeat.audioUrl && (
                    <button
                      onClick={() => !isGeneratingAudio && handleGenerateNarration()}
                      disabled={isGeneratingAudio || hasUnsavedReelText}
                      className="absolute bottom-4 right-4 z-20 p-2.5 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-all disabled:cursor-wait"
                      title={hasUnsavedReelText ? 'Save panel text before generating narration' : isGeneratingAudio ? 'Generating narration...' : 'Generate narration'}
                    >
                      {isGeneratingAudio ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
            <motion.div
              initial={false}
              animate={{
                height: isLoading ? (isMinimized ? '14%' : '42%') : (isMinimized ? '20%' : '60%'),
                opacity: isLoading ? (isMinimized ? 0.26 : 0.42) : (isMinimized ? 0.5 : 0.7),
              }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className={backgroundGradientClass}
            />
          </motion.div>
        </AnimatePresence>
        {!displayImageUrl && (showPendingImageState || showFailedImageState) && (
          <div className="absolute inset-0 hidden items-center justify-center px-6 text-center md:flex">
            <div className="rounded-3xl border border-white/10 bg-neutral-950/65 px-6 py-5 backdrop-blur-md">
              <div className="mb-3 flex justify-center">
                {showPendingImageState ? (
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
                ) : (
                  <AlertTriangle className="h-8 w-8 text-amber-300" />
                )}
              </div>
              <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">
                {showPendingImageState ? 'Beat Image Syncing' : 'Beat Image Needs Retry'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Header */}
      <header className={`${headerGradientClass} transition-opacity duration-300 ${chromeVisibilityClass}`}>
        <div className="order-2 flex min-w-0 items-start gap-2 self-stretch md:order-1 md:items-center md:gap-3 md:self-auto">
          <BookOpen className="hidden h-6 w-6 shrink-0 text-emerald-400 md:block" />
          <h1 className="min-w-0 max-w-[calc(100vw-2rem)] text-lg font-serif leading-snug tracking-wide text-neutral-200 md:text-xl">
            {session.title || "Kissago"}
          </h1>
        </div>
        <div className="order-1 flex h-11 items-center justify-end gap-3 pl-32 pr-12 text-sm font-sans uppercase tracking-widest text-neutral-400 md:order-2 md:h-auto md:self-auto md:gap-4 md:p-0">
          <span className="text-xs md:text-sm">
            <span className="hidden md:inline">Beat </span>{currentBeat.beatNumber} / {session.maxBeats}
          </span>
          {onSave && (
            <button
              onClick={onSave}
              disabled={isSaving || (saveStatus === 'saved' && !saveWarning)}
              className={`p-2 rounded-full transition-all duration-300 ${
                showSaveAlert
                  ? 'text-amber-400 hover:bg-white/10'
                  : saveStatus === 'saving'
                  ? 'text-amber-400'
                  : saveStatus === 'saved'
                  ? 'text-emerald-400'
                  : saveStatus === 'unsaved'
                  ? 'text-orange-400 hover:bg-white/10'
                  : 'text-neutral-400 hover:bg-white/10'
              } disabled:cursor-default`}
              title={
                showSaveAlert
                  ? saveWarning ?? 'Beat media needs attention.'
                  : saveStatus === 'saving'
                  ? 'Saving...'
                  : saveStatus === 'saved'
                  ? 'Saved to cloud'
                  : saveStatus === 'unsaved'
                  ? 'Unsaved changes'
                  : 'Save Story'
              }
            >
              {showSaveAlert ? (
                <AlertTriangle className="w-4 h-4" />
              ) : saveStatus === 'saving' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saveStatus === 'saved' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : saveStatus === 'unsaved' ? (
                <CloudUpload className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </button>
          )}
          {!onSave && saveStatus !== 'idle' && (
            <div className="p-2 text-neutral-600" title="Sign in to save">
              <CloudOff className="w-4 h-4" />
            </div>
          )}
          <button
            onClick={onRestart}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Restart Story"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className={mainClassName}>
        {isReelStory ? reelEditorLayout : (
          <>
        <div className={`min-h-0 flex-none items-start justify-center pb-3 md:hidden ${isVerticalStory ? 'hidden' : 'flex'}`}>
          {(displayImageUrl || showPendingImageState || showFailedImageState || showPromptOnlyPlaceholder) && (
            <div className="relative w-full aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/40 shadow-2xl">
              {isStoryboard ? (
                <StoryboardCycler
                  key={`mobile-window:${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                  gridUrl={normalizedCurrentBeat.imageUrl!}
                  audioUrl={normalizedCurrentBeat.audioUrl}
                  cycleOverride={cycleSettings.cycleOverride}
                  cycleMs={cycleSettings.cycleMs}
                  vignetteEnabled={cycleSettings.vignetteEnabled}
                  vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                  playbackState={playbackState}
                  imageClassName="mobile-scene-shuttle"
                  captions={normalizedCurrentBeat.reelCaptions}
                  textOverlayEnabled={normalizedCurrentBeat.reelTextOverlayEnabled !== false}
                  textOverlayStyle={isReelStory ? reelOverlayDraft : normalizedCurrentBeat.reelTextOverlayStyle}
                  onImageLoad={() => setFailedImageUrl((prev) => (prev === normalizedCurrentBeat.imageUrl ? null : prev))}
                  onImageError={() => setFailedImageUrl(normalizedCurrentBeat.imageUrl!)}
                />
              ) : displayImageUrl ? (
                <div className="mobile-scene-shuttle absolute inset-0">
                  <Image
                    src={displayImageUrl}
                    alt={currentBeat.sceneSummary}
                    fill
                    className="object-cover"
                    referrerPolicy="no-referrer"
                    priority
                    unoptimized
                    onLoad={() => setFailedImageUrl((prev) => (prev === displayImageUrl ? null : prev))}
                    onError={() => setFailedImageUrl(displayImageUrl)}
                  />
                </div>
              ) : showPromptOnlyPlaceholder ? (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-neutral-300"
                  title="No image for this beat — use the prompt tools to upload one"
                >
                  <ImageOff className="h-10 w-10 text-sky-200/80" />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900/70 text-center text-neutral-200">
                  {showPendingImageState ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
                      <p className="text-sm uppercase tracking-[0.18em] text-neutral-300">Image Syncing</p>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-8 w-8 text-amber-300" />
                      <p className="text-sm uppercase tracking-[0.18em] text-neutral-300">Image Upload Needs Retry</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-3 flex items-center gap-2 md:hidden">
          {!isReelStory && !isMinimized && (
            <>
              <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
                <Timeline
                  storyMap={session.storyMap}
                  onNodeClick={navigateToNode}
                  focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
                  compact
                />
              </div>
              {!isEnding && (
                <div className="grid shrink-0 grid-cols-2 rounded-full border border-white/10 bg-neutral-950/65 p-0.5 backdrop-blur-md">
                  {([
                    ['story', 'Story'],
                    ['branches', 'Branches'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setActiveReaderPanel(value)}
                      className={`rounded-full px-3 py-1 text-[10px] font-sans uppercase tracking-wider transition-colors ${
                        activeReaderPanel === value
                          ? 'bg-emerald-500 text-neutral-950'
                          : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {isReelStory && isMinimized && (
          <div className="mb-3 flex shrink-0 justify-center md:justify-start">
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-neutral-950/80 px-4 py-2 text-xs font-sans uppercase tracking-wider text-neutral-300 shadow-2xl backdrop-blur-md transition-colors hover:bg-neutral-900 hover:text-white"
              title="Show text"
            >
              <BookOpen className="h-4 w-4" />
              Show text
            </button>
          </div>
        )}

        <div className="grid shrink-0 md:grid-cols-12 gap-4 md:gap-8 items-end">

          {/* Story Text Card + Toggle */}
          <div
            className={`md:col-span-7 flex-col items-center relative ${
              isReelStory && isMinimized
                ? 'hidden'
                : !isMinimized && visibleReaderPanel === 'story'
                ? 'flex'
                : 'hidden md:flex'
            }`}
            onMouseEnter={() => setIsCardHovered(true)}
            onMouseLeave={() => setIsCardHovered(false)}
          >
            {/* Card chrome toggles — minimize + prompt-tools popover */}
            <div className={`relative mb-2 items-center gap-2 self-end ${isReelStory ? 'hidden' : 'flex'}`}>
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="hidden p-2 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-colors md:block"
                title={isMinimized ? 'Expand story' : 'Minimize story'}
              >
                {isMinimized ? (
                  <ChevronUp className="w-5 h-5 text-neutral-300" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-neutral-300" />
                )}
              </button>
              {canOpenPromptTools && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (promptToolsOpen) {
                        closePromptToolsModal();
                      } else {
                        openPromptToolsOverview();
                      }
                    }}
                    aria-expanded={promptToolsOpen}
                    aria-haspopup="dialog"
                    className={`p-2 rounded-full backdrop-blur-md transition-colors ${
                      promptToolsOpen
                        ? 'bg-sky-500/20 hover:bg-sky-500/25 text-sky-200'
                        : 'bg-white/5 hover:bg-white/10 text-neutral-300'
                    }`}
                    title={isPromptOnlyStory ? 'Prompt & image tools' : 'Prompt tools'}
                  >
                    <Layers className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

          {/* Card + Narration button row */}
          <div className="flex items-end gap-3 w-full md:gap-5">
            {/* Narration + Regenerate image buttons — outside card, left side */}
            {!isMinimized && (
              <div className="shrink-0 pb-3 flex flex-col items-center gap-2 md:pb-4">
                {/* Missing-image indicator — prompt-only beat without an uploaded image */}
                {showPromptOnlyPlaceholder && (
                  <div
                    className="p-2.5 backdrop-blur-md rounded-full bg-neutral-900/60 border border-sky-500/20 text-sky-300"
                    title="No image for this beat — open prompt tools to upload one"
                  >
                    <ImageOff className="w-5 h-5" />
                  </div>
                )}
                {/* Regenerate image button — only when image is missing */}
                {canRegenerateImage && (
                  <button
                    onClick={() => regenerateImageForNode(currentNodeId)}
                    disabled={isRegeneratingImage}
                    className={`p-2.5 backdrop-blur-md rounded-full transition-all duration-300 ${
                      isRegeneratingImage
                        ? 'bg-neutral-900/60 border border-white/5 cursor-wait'
                        : 'bg-neutral-900/60 border border-amber-500/20 hover:border-amber-500/40 hover:bg-neutral-800 cursor-pointer'
                    }`}
                    title={isRegeneratingImage ? 'Generating image...' : 'Regenerate image'}
                  >
                    {isRegeneratingImage ? (
                      <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-amber-400 hover:text-amber-300 transition-colors" />
                    )}
                  </button>
                )}
                {!isReelStory && cycleSettings.storyUiAutoScrollEnabled && (
                  <AutoScrollButton
                    active={isAutoScrolling}
                    onClick={toggleAutoScroll}
                    disabled={scrollState.atBottom}
                  />
                )}
                <NarrationButton
                  isGeneratingAudio={isGeneratingAudio}
                  isAudioReady={isAudioReady}
                  playbackState={playbackState}
                  hasAudio={!!normalizedCurrentBeat.audioUrl}
                  onTogglePlayPause={togglePlayPause}
                  onGenerateNarration={handleGenerateNarration}
                  onClearGlow={clearAudioReady}
                  storyMode={storyMode}
                  onToggleStoryMode={toggleStoryMode}
                  disabled={isReelStory && hasUnsavedReelText}
                  disabledReason="Save panel text before generating narration"
                />
              </div>
            )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            style={{ opacity: isReelStory ? 1 : isCardHovered ? 1 : 0.1 }}
            className={`touch-visible relative z-20 w-full border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-500 ${
              isReelStory
                ? 'bg-neutral-950'
                : isMinimized
                ? 'bg-neutral-950/40'
                : 'bg-neutral-900/80'
            }`}
          >
            {isReelStory && !isMinimized && (
              <div className="relative z-30 flex items-center justify-between gap-3 border-b border-white/10 bg-neutral-950 px-4 py-3 md:px-5">
                <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
                  <Timeline
                    storyMap={session.storyMap}
                    onNodeClick={navigateToNode}
                    focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
                    nodes={reelTimelineNodes}
                    compact
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMinimized(true)}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-neutral-300 transition-colors"
                    title="Hide text"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {canOpenPromptTools && (
                    <button
                      type="button"
                      onClick={() => {
                        if (promptToolsOpen) {
                          closePromptToolsModal();
                        } else {
                          openPromptToolsOverview();
                        }
                      }}
                      aria-expanded={promptToolsOpen}
                      aria-haspopup="dialog"
                      className={`p-2 rounded-full transition-colors ${
                        promptToolsOpen
                          ? 'bg-sky-500/20 hover:bg-sky-500/25 text-sky-200'
                          : 'bg-white/5 hover:bg-white/10 text-neutral-300'
                      }`}
                      title={isPromptOnlyStory ? 'Prompt & image tools' : 'Prompt tools'}
                    >
                      <Layers className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Top scroll fade gradient */}
            {!isMinimized && (
              <div
                className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-neutral-900 to-transparent z-10 pointer-events-none transition-opacity duration-500 rounded-t-3xl"
                style={{ opacity: scrollState.atTop || !isCardHovered ? 0 : 1 }}
              />
            )}

            {/* Scrollable content area */}
            <div className="p-5 md:p-8">
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                style={!isMinimized ? (isReelStory ? reelTextViewportStyle : storyTextViewportStyle) : undefined}
                className={`text-xl md:text-2xl font-serif leading-relaxed ${isMinimized ? '' : 'overflow-y-auto scrollbar-none'}`}
              >
                <AnimatePresence mode="wait">
                <motion.div
                  key={session.storyMap.currentNodeId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              >
                  {preludeText && !isMinimized && (
                    <div className="mb-8 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-5">
                      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-emerald-300">
                        Prelude
                      </p>
                      <p className="mt-3 text-base font-serif leading-relaxed text-neutral-300">
                        {preludeText}
                      </p>
                    </div>
                  )}

                  {isReelStory && !isMinimized ? (
                    <div className="space-y-4">
                      {reelPanelDraft.map((text, panelIndex) => (
                        <label key={panelIndex} className="block">
                          <span className="font-sans text-[11px] uppercase tracking-[0.22em] text-emerald-300/80">
                            Panel {String(panelIndex + 1).padStart(2, '0')}
                          </span>
                          <textarea
                            value={text}
                            onChange={(event) => updateReelPanelDraft(panelIndex, event.target.value)}
                            rows={2}
                            className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 font-serif text-base leading-relaxed text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-400/50 focus:bg-neutral-900 md:text-lg"
                            placeholder={`Panel ${String(panelIndex + 1).padStart(2, '0')} text`}
                          />
                        </label>
                      ))}

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {hasUnsavedReelText && reelTextSaveState !== 'warning' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveReelText(false)}
                              disabled={isReelTextSaving}
                              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-xs font-sans uppercase tracking-wider text-neutral-950 transition-colors hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70"
                            >
                              {isReelTextSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
                              Save text
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelReelTextChanges}
                              disabled={isReelTextSaving}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {reelTextSaveState === 'warning' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveReelText(true)}
                              disabled={isReelTextSaving}
                              className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-xs font-sans uppercase tracking-wider text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-wait disabled:opacity-70"
                            >
                              {isReelTextSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <AlertTriangle className="h-4 w-4" />
                              )}
                              Clear narration and save
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelReelTextWarning}
                              disabled={isReelTextSaving}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {reelTextMessage && (
                          <p className={`text-xs font-sans ${
                            reelTextSaveState === 'error'
                              ? 'text-rose-300'
                              : reelTextSaveState === 'warning'
                              ? 'text-amber-200'
                              : 'text-emerald-300'
                          }`}>
                            {reelTextMessage}
                          </p>
                        )}
                      </div>

                      <div className="border-t border-white/10 pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 font-sans text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                            <Type className="h-4 w-4 text-emerald-300/80" />
                            Caption style
                          </div>
                          {hasUnsavedReelOverlayStyle && (
                            <button
                              type="button"
                              onClick={handleSaveReelOverlayStyle}
                              disabled={isReelStyleSaving}
                              className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-sans uppercase tracking-wider text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-wait disabled:opacity-70"
                            >
                              {isReelStyleSaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              Save style
                            </button>
                          )}
                        </div>

                        <div className="mt-3">
                          <ReelCaptionStyleControls
                            normalizedStyle={normalizedReelOverlayDraft}
                            onChange={updateReelOverlayDraft}
                          />
                        </div>

                        {reelStyleMessage && (
                          <p className={`mt-3 text-xs font-sans ${
                            reelStyleSaveState === 'error' ? 'text-rose-300' : 'text-emerald-300'
                          }`}>
                            {reelStyleMessage}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className={`transition-colors duration-500 ${
                      isMinimized ? 'text-neutral-500 line-clamp-2' : 'text-neutral-300'
                    }`}>
                      {currentBeat.storyText}
                    </p>
                  )}

                  {isEnding && !isMinimized && (
                    <div className="mt-8 pt-8 border-t border-white/10">
                      <h3 className="text-sm font-sans uppercase tracking-widest text-emerald-400 mb-4">
                        The End
                      </h3>
                      <p className="text-neutral-400 font-sans italic">
                        {currentBeat.nextBeatGoal}
                      </p>

                      {/* Auto-publish status */}
                      {lastPublishResult && (
                        <div className="mt-4">
                          {lastPublishResult.error ? (
                            <div className="flex items-center gap-2 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              <span>Publishing failed — {lastPublishResult.error}</span>
                            </div>
                          ) : lastPublishResult.alreadyPublished ? (
                            <div className="flex items-center gap-2 text-sm text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3">
                              <Check className="w-4 h-4 shrink-0" />
                              <span>This path is already published.</span>
                              <div className="ml-auto flex items-center gap-3">
                                <Link
                                  href={`/storyline/${lastPublishResult.storylineId}`}
                                  className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors"
                                >
                                  View <ExternalLink className="w-3 h-3" />
                                </Link>
                                <button
                                  onClick={() => setManagedStorylineId(lastPublishResult.storylineId)}
                                  className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors"
                                >
                                  Manage Cover <ImageIcon className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                              <Share2 className="w-4 h-4 shrink-0" />
                              <span>{canPublishAudioStoryline ? 'Audio story published!' : 'Storyline published!'}</span>
                              <div className="ml-auto flex items-center gap-3">
                                <Link
                                  href={`/storyline/${lastPublishResult.storylineId}`}
                                  className="flex items-center gap-1 text-emerald-300 hover:text-emerald-200 transition-colors"
                                >
                                  View <ExternalLink className="w-3 h-3" />
                                </Link>
                                <button
                                  onClick={() => setManagedStorylineId(lastPublishResult.storylineId)}
                                  className="flex items-center gap-1 text-emerald-300 hover:text-emerald-200 transition-colors"
                                >
                                  Manage Cover <ImageIcon className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-8 flex flex-wrap gap-3">
                        {!lastPublishResult && onSave && canPublishStandardStoryline && (
                          <button
                            onClick={() => setShowPublishDialog(true)}
                            className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-6 py-3 rounded-2xl font-medium hover:bg-emerald-500/30 transition-colors flex items-center gap-2"
                          >
                            <Share2 className="w-4 h-4" />
                            Publish Storyline
                          </button>
                        )}
                        {!lastPublishResult && onSave && canPublishAudioStoryline && (
                          <button
                            onClick={() => setShowPublishDialog(true)}
                            className="bg-sky-500/20 text-sky-200 border border-sky-500/30 px-6 py-3 rounded-2xl font-medium hover:bg-sky-500/30 transition-colors flex items-center gap-2"
                          >
                            <Share2 className="w-4 h-4" />
                            Publish as Audio Story
                          </button>
                        )}
                        {!lastPublishResult && onSave && isPromptOnlyStory && !canPublishStandardStoryline && !cycleSettings.audioStorylinePublishEnabled && (
                          <div className="max-w-xl rounded-2xl border border-amber-500/25 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
                            Upload an image for every beat before publishing, or enable audio-only publishing in Global Settings.
                          </div>
                        )}
                        {session.explorationMode && (
                          <button
                            onClick={() => {
                              // Navigate to a branch point to explore more
                              const rootId = session.storyMap.rootNodeId;
                              navigateToNode(rootId);
                            }}
                            className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-6 py-3 rounded-2xl font-medium hover:bg-indigo-500/30 transition-colors flex items-center gap-2"
                          >
                            <Compass className="w-4 h-4" />
                            Explore More Branches
                          </button>
                        )}
                        <button
                          onClick={resetStory}
                          className="bg-white text-black px-8 py-4 rounded-2xl font-medium hover:bg-neutral-200 transition-colors flex items-center gap-2"
                        >
                          Start a New Story
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Bottom scroll fade gradient */}
            {!isMinimized && (
              <div
                className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-neutral-900 to-transparent z-10 pointer-events-none transition-opacity duration-500 rounded-b-3xl"
                style={{ opacity: scrollState.atBottom || !isCardHovered ? 0 : 1 }}
              />
            )}

            {/* Scroll indicator — positioned just outside the card's right edge */}
            {!isMinimized && isCardHovered && (
              <div className="absolute right-1 top-8 bottom-2 w-1 pointer-events-none z-20">
                <div
                  ref={thumbRef}
                  className="absolute w-full rounded-full bg-neutral-500/60"
                />
              </div>
            )}
          </motion.div>
          </div>{/* end card + narration button row */}

          </div>

          {/* Choices Column */}
          {!isEnding && !isReelStory && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className={`md:col-span-5 flex-col justify-end ${
                !isMinimized && activeReaderPanel === 'branches' ? 'flex' : 'hidden md:flex'
              }`}
            >
              {/* Timeline — positioned above choices */}
              <div className="hidden shrink-0 md:block">
                <Timeline
                  storyMap={session.storyMap}
                  onNodeClick={navigateToNode}
                  focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
                />
              </div>

              {/* Header with toggle */}
              <div className="flex items-center justify-between mb-3 px-4 shrink-0">
                <div>
                  <h3 className="text-xs font-sans uppercase tracking-widest text-neutral-500">
                    What happens next?
                  </h3>
                  {showCoinHint && (
                    <p className="mt-1 text-[11px] font-sans text-neutral-500">
                      A new path uses {continueCoinCost.toLocaleString()} coins. Reopening an explored path stays free.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="hidden p-1.5 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-colors md:block"
                  title={isMinimized ? 'Show options' : 'Hide options'}
                >
                  {isMinimized ? (
                    <ChevronUp className="w-4 h-4 text-neutral-300" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-neutral-300" />
                  )}
                </button>
              </div>

              {/* Scrollable options — shows ~2.5 cards with fade hint */}
              <AnimatePresence>
                {!isMinimized && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="relative shrink-0 overflow-hidden md:max-h-none"
                  >
                    <div
                      ref={optionsContainerRef}
                      className="max-h-[min(42dvh,24rem)] overflow-y-auto scrollbar-none space-y-4 px-1 pt-3 md:max-h-none md:pt-1"
                      style={{
                        maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%)',
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%)',
                      }}
                    >
                      {orderedOptions.map((option, index) => {
                        const explored = hasExistingBranch(option.id);
                        const isFocused = focusMode === 'options' && focusedOptionIndex === index;
                        const isCanonical = option.id === currentBeat.canonicalOptionId;
                        return (
                          <motion.button
                            key={option.id}
                            ref={(el) => { optionRefs.current[index] = el; }}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            onClick={() => continueStory(option.id)}
                            disabled={isLoading}
                            className={`w-full text-left group backdrop-blur-md rounded-2xl p-4 md:p-6 transition-all duration-300 flex items-center justify-between ${
                              explored
                                ? 'bg-neutral-900/60 hover:bg-neutral-800 border border-emerald-500/20 hover:border-emerald-500/40 glow-pulse-mild'
                                : 'bg-neutral-900/60 hover:bg-neutral-800 border border-white/5 hover:border-white/20'
                            } ${isFocused ? 'ring-2 ring-emerald-400/50 border-emerald-500/40' : ''}`}
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base md:text-lg font-serif text-neutral-200 group-hover:text-white transition-colors">
                                  {option.label}
                                </p>
                                {isCanonical && (
                                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.18em] text-emerald-300">
                                    Original path
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-sans text-neutral-500 mt-1 uppercase tracking-wider line-clamp-2">
                                {option.intent}
                              </p>
                            </div>
                            {explored ? (
                              <Check className="w-4 h-4 text-emerald-500/60" />
                            ) : (
                              <ArrowRight className="w-5 h-5 text-neutral-600 group-hover:text-emerald-400 transition-colors transform group-hover:translate-x-1" />
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
          </>
        )}
      </main>

      <AnimatePresence>
        {promptToolsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              role="dialog"
              aria-modal="true"
              aria-label={promptToolsShellLabel}
              className={`flex max-h-[min(90vh,48rem)] w-full ${isPromptToolsOverview ? 'max-w-xl' : 'max-w-2xl'} flex-col overflow-hidden rounded-[28px] border border-sky-500/20 bg-neutral-900/95 shadow-2xl`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 pb-4 pt-6">
                <div className="min-w-0">
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-sky-200">
                    {isBeatUploadView
                      ? 'Upload Beat Image'
                      : isCharacterUploadView
                      ? activeCharacterHasSheet
                        ? 'Manage Character Sheets'
                        : 'Upload Character Sheet'
                      : isPromptOnlyStory
                      ? 'Prompt and Image Tools'
                      : 'Prompt Tools'}
                  </p>
                  <h3 className="mt-2 text-2xl font-serif text-neutral-100">
                    {isBeatUploadView
                      ? `Add a ${isVerticalStory ? '9:16' : '16:9'} storyboard image`
                      : isCharacterUploadView
                      ? activeCharacterSheetTarget?.characterName
                      : isPromptOnlyStory
                      ? 'Copy prompts and keep going'
                      : 'Copy prompts and manage refs'}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                    {isBeatUploadView
                      ? 'Saved images stay attached to this beat so you can swap between them later.'
                      : isCharacterUploadView
                      ? 'Reference sheets persist with this character so future episodes and continuations can reuse them.'
                      : isPromptOnlyStory
                      ? `Copy the exact prompts for this beat, then upload a ${isVerticalStory ? '9:16' : '16:9'} image or add only the character refs still missing.`
                      : 'Copy the exact prompt text for this beat and add character refs only where continuity still needs them.'}
                  </p>
                </div>
                <div className="relative flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPromptToolsHelpOpen((open) => !open)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-neutral-100"
                    aria-label="Open prompt tools help"
                    title="What to do here"
                  >
                    i
                  </button>
                  <button
                    type="button"
                    onClick={closePromptToolsModal}
                    disabled={isUploadingPromptOnlyImage || isUploadingCharacterSheet || isOptimizingPromptOnlyImage || isOptimizingCharacterSheet}
                    className="rounded-full border border-white/10 p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Close prompt tools dialog"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <AnimatePresence>
                    {isPromptToolsHelpOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute right-0 top-full z-10 mt-3 w-72 rounded-2xl border border-white/10 bg-neutral-950/95 px-4 py-3 text-sm leading-relaxed text-neutral-200 shadow-2xl"
                      >
                        {promptToolsHelpText}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {promptToolsSuccess && isPromptToolsOverview && (
                  <div
                    role="status"
                    className="mb-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
                  >
                    {promptToolsSuccess}
                  </div>
                )}

                {isPromptToolsOverview && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {beatPromptText && (
                        <button
                          type="button"
                          onClick={() => void copyPromptText('beat', beatPromptText)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-neutral-100 transition-colors hover:bg-white/10"
                          title="Copy this beat's image prompt"
                        >
                          {copiedPromptKey === 'beat' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedPromptKey === 'beat' ? 'Copied' : 'Copy Beat Prompt'}
                        </button>
                      )}
                      {isPromptOnlyStory && (
                        <button
                          type="button"
                          onClick={openBeatUploadView}
                          className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-xs uppercase tracking-[0.18em] text-emerald-200 transition-colors hover:bg-emerald-500/25"
                          title={displayImageUrl ? 'Replace this beat image' : `Upload a ${isVerticalStory ? '9:16' : '16:9'} image for this beat`}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {displayImageUrl ? 'Replace Image' : 'Upload Image'}
                        </button>
                      )}
                    </div>

                    {characterPromptItems.length > 0 && (
                      <div className="mt-6 rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-sans uppercase tracking-[0.18em] text-neutral-400">
                              Character Refs
                            </p>
                            <p className="mt-1 text-sm text-neutral-300">
                              {readyInBeatCharacters.length} ready
                              {needsAttentionCharacters.length > 0
                                ? ` • ${needsAttentionCharacters.length} need${needsAttentionCharacters.length === 1 ? 's' : ''} attention`
                                : ' • All current-beat characters are covered.'}
                            </p>
                          </div>
                          {readyInBeatCharacters.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setSavedRefsExpanded((open) => !open)}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-neutral-200 transition-colors hover:bg-white/10"
                              aria-expanded={savedRefsExpanded}
                              title={savedRefsExpanded ? 'Hide saved references' : 'Show saved references'}
                            >
                              {savedRefsExpanded ? 'Hide Saved' : 'Show Saved'}
                              {savedRefsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>

                        {needsAttentionCharacters.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {needsAttentionCharacters.map((item) => (
                              <div
                                key={item.key}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-neutral-950/50 px-4 py-3"
                              >
                                <p className="min-w-0 truncate text-sm font-medium text-neutral-100">{item.label}</p>
                                <div className="flex items-center gap-2">
                                  {item.promptText && (
                                    <button
                                      type="button"
                                      onClick={() => void copyPromptText(item.key, item.promptText)}
                                      className="rounded-full border border-white/10 bg-white/5 p-2 text-neutral-200 transition-colors hover:bg-white/10"
                                      title={`Copy the ${item.label} character sheet prompt`}
                                      aria-label={`Copy the ${item.label} character sheet prompt`}
                                    >
                                      {copiedPromptKey === item.key ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    </button>
                                  )}
                                  {cycleSettings.characterSheetUploadEnabled && (
                                    <button
                                      type="button"
                                      onClick={() => openCharacterSheetUpload(item.characterId, item.characterName)}
                                      className="rounded-full border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-200 transition-colors hover:bg-emerald-500/20"
                                      title={`Open character sheet tools for ${item.characterName}`}
                                      aria-label={`Open character sheet tools for ${item.characterName}`}
                                    >
                                      <ImageIcon className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {savedRefsExpanded && readyInBeatCharacters.length > 0 && (
                          <div className="mt-4 border-t border-white/5 pt-4">
                            <p className="text-[11px] font-sans uppercase tracking-[0.18em] text-neutral-500">
                              Saved In This Beat
                            </p>
                            <div className="mt-3 space-y-2">
                              {readyInBeatCharacters.map((item) => (
                                <div
                                  key={`${item.key}:ready`}
                                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-neutral-950/50 px-4 py-3"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-neutral-100">{item.label}</p>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                                      {item.referenceSheetGallery.length} saved
                                    </p>
                                  </div>
                                  {cycleSettings.characterSheetUploadEnabled && (
                                    <button
                                      type="button"
                                      onClick={() => openCharacterSheetUpload(item.characterId, item.characterName)}
                                      className="rounded-full border border-white/10 bg-white/5 p-2 text-neutral-200 transition-colors hover:bg-white/10"
                                      title={`Open character sheet tools for ${item.characterName}`}
                                      aria-label={`Open character sheet tools for ${item.characterName}`}
                                    >
                                      <ImageIcon className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {isBeatUploadView && (() => {
                  const gallery = normalizedCurrentBeat.imageGallery ?? [];
                  const cap = cycleSettings.promptOnlyMaxImagesPerBeat;
                  const capReached = gallery.length >= cap;
                  const cleanupDays = cycleSettings.promptOnlyImageGalleryCleanupDays;
                  const cleanupEnabled = cycleSettings.promptOnlyImageGalleryCleanupEnabled;
                  const activeStorageKey = getActiveGalleryStorageKey(normalizedCurrentBeat);
                  const optimizationSettings = cycleSettings.imageUploadOptimizationSettings;
                  const compressionEnabled = getAssetTypeCompressionEnabled('storyboard_image', optimizationSettings);

                  return (
                    <>
                      {gallery.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                              Saved Images ({gallery.length} / {cap})
                            </p>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3">
                            {gallery.map((entry) => {
                              const isActive = activeStorageKey === entry.storageKey;
                              const isPendingConfirm = pendingDeleteStorageKey === entry.storageKey;
                              const isDeleting = isPermanentlyDeletingKey === entry.storageKey;
                              return (
                                <div key={entry.storageKey} className="relative">
                                  <button
                                    type="button"
                                    onClick={() => void handleSelectGalleryImage(entry.storageKey)}
                                    disabled={isActive || isDeleting}
                                    className={`group relative block overflow-hidden rounded-xl border transition-colors ${
                                      isVerticalStory ? 'aspect-[9/16] w-20' : 'aspect-video w-32'
                                    } ${
                                      isActive
                                        ? 'border-emerald-400/70 ring-2 ring-emerald-400/40'
                                        : 'border-white/10 hover:border-sky-400/40'
                                    } ${isDeleting ? 'opacity-50' : ''}`}
                                    title={isActive ? 'Active beat image' : 'Use this image'}
                                  >
                                    <Image
                                      src={entry.url}
                                      alt="Beat image option"
                                      fill
                                      className="object-cover"
                                      unoptimized
                                    />
                                    {isActive && (
                                      <span className="absolute bottom-1 left-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-950">
                                        Active
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isDeleting) return;
                                      if (isActive) {
                                        setPendingDeleteStorageKey(entry.storageKey);
                                      } else {
                                        void handlePermanentDelete(entry.storageKey);
                                      }
                                    }}
                                    disabled={isDeleting}
                                    className="absolute -right-1.5 -top-1.5 rounded-full border border-white/10 bg-neutral-950/90 p-1 text-neutral-300 transition-colors hover:border-rose-400/60 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-50"
                                    title="Permanently delete this image"
                                  >
                                    {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                  </button>
                                  {isPendingConfirm && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-neutral-950/95 p-2 text-center text-[11px] text-neutral-200">
                                      <p>Permanently delete this active image? The most recent remaining image will become active.</p>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setPendingDeleteStorageKey(null)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-200 hover:bg-white/10"
                                        >
                                          Keep
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handlePermanentDelete(entry.storageKey)}
                                          className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-100 hover:bg-rose-500/25"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {cleanupEnabled && (
                            <p className="mt-2 text-[11px] text-neutral-500">
                              Unused images are removed after {cleanupDays} day{cleanupDays === 1 ? '' : 's'}.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="mt-5 rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
                        <p>Accepted formats: JPG, PNG, or WebP.</p>
                        <p className="mt-1">
                          {compressionEnabled
                            ? `Raw file can be up to ${optimizationSettings.rawSelectedFileLimitMB} MB. Optimized upload limit: ${optimizationSettings.finalUploadLimitMB} MB.`
                            : `Maximum file size: ${PROMPT_ONLY_MAX_UPLOAD_MB} MB.`}
                        </p>
                        <p className="mt-1">Required aspect ratio: {isVerticalStory ? '9:16' : '16:9'}.</p>
                        <p className="mt-1">
                          Recommended resolution: {isVerticalStory
                            ? '720x1280 or above for smaller screens, and 1152x2048 or above for larger screens.'
                            : '1280x720 or above for smaller screens, and 2048x1152 or above for larger screens.'}
                        </p>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        <input
                          ref={uploadInputRef}
                          type="file"
                          accept={PROMPT_ONLY_ACCEPTED_IMAGE_TYPES.join(',')}
                          onChange={handlePromptOnlyFileSelected}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => uploadInputRef.current?.click()}
                          disabled={capReached || isOptimizingPromptOnlyImage}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                          title={capReached ? `Limit of ${cap} images per beat reached` : undefined}
                        >
                          <Upload className="h-4 w-4" />
                          {isOptimizingPromptOnlyImage ? 'Optimizing...' : uploadPreview ? 'Choose Different Image' : 'Choose Image'}
                        </button>
                        {displayImageUrl && (
                          <button
                            type="button"
                            onClick={() => void handlePromptOnlyDelete()}
                            className="inline-flex items-center gap-2 rounded-full border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20"
                            title="Clear active image (keeps it in the gallery)"
                          >
                            <Trash2 className="h-4 w-4" />
                            Clear Active
                          </button>
                        )}
                      </div>

                      {capReached && (
                        <p className="mt-3 text-xs text-amber-300">
                          You&apos;ve reached the limit of {cap} image{cap === 1 ? '' : 's'} per beat. Delete one to upload another.
                        </p>
                      )}

                      {isOptimizingPromptOnlyImage && (
                        <div className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Optimizing image for faster upload...
                        </div>
                      )}

                      {uploadPreview && (
                        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/60">
                            <Image
                              src={uploadPreview.previewUrl}
                              alt="Selected beat upload preview"
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
                            <p className="font-medium text-neutral-100">{uploadPreview.fileName}</p>
                            <p className="mt-2">Format: {uploadPreview.mimeType}</p>
                            <p className="mt-1">Size: {(uploadPreview.fileSize / (1024 * 1024)).toFixed(2)} MB</p>
                            {uploadPreview.originalFileSize && uploadPreview.originalFileSize !== uploadPreview.fileSize && (
                              <p className="mt-1">Original: {formatFileSize(uploadPreview.originalFileSize)}</p>
                            )}
                            <p className="mt-1">Resolution: {uploadPreview.width}x{uploadPreview.height}</p>
                            {uploadPreview.optimizationWarning && (
                              <p className="mt-3 text-sm text-emerald-300">{uploadPreview.optimizationWarning}</p>
                            )}
                            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-neutral-500">Resolution advice</p>
                            <p className="mt-1 text-sm text-neutral-300">{uploadPreview.resolutionAdvice}</p>
                          </div>
                        </div>
                      )}

                      {uploadError && (
                        <div className="mt-5 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                          {uploadError}
                        </div>
                      )}
                    </>
                  );
                })()}

                {isCharacterUploadView && activeCharacterSheetTarget && (() => {
                  const cap = cycleSettings.characterSheetMaxPerCharacter;
                  const capReached = activeCharacterGallery.length >= cap;
                  const cleanupDays = cycleSettings.characterSheetCleanupDays;
                  const cleanupEnabled = cycleSettings.characterSheetCleanupEnabled;
                  const isClearingActive = pendingCharacterDeleteId === activeCharacterSheetTarget.characterId;
                  const optimizationSettings = cycleSettings.imageUploadOptimizationSettings;
                  const compressionEnabled = getAssetTypeCompressionEnabled('character_reference', optimizationSettings);

                  return (
                    <>
                      {activeCharacterGallery.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between">
                            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                              Saved Sheets ({activeCharacterGallery.length} / {cap})
                            </p>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3">
                            {activeCharacterGallery.map((entry) => {
                              const isActive = activeCharacterStorageKey === entry.storageKey;
                              const isPendingConfirm = pendingSheetDeleteKey === entry.storageKey;
                              const isDeleting = permanentlyDeletingSheetKey === entry.storageKey;

                              return (
                                <div key={entry.storageKey} className="relative">
                                  <button
                                    type="button"
                                    onClick={() => void handleSelectCharacterSheet(activeCharacterSheetTarget.characterId, entry.storageKey)}
                                    disabled={isActive || isDeleting}
                                    className={`group relative block aspect-square w-24 overflow-hidden rounded-xl border transition-colors ${
                                      isActive
                                        ? 'border-emerald-400/70 ring-2 ring-emerald-400/40'
                                        : 'border-white/10 hover:border-sky-400/40'
                                    } ${isDeleting ? 'opacity-50' : ''}`}
                                    title={isActive ? 'Active character sheet' : 'Use this sheet'}
                                  >
                                    <Image
                                      src={entry.url}
                                      alt={`${activeCharacterSheetTarget.characterName} reference sheet`}
                                      fill
                                      className="object-cover"
                                      unoptimized
                                    />
                                    {isActive && (
                                      <span className="absolute bottom-1 left-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-950">
                                        Active
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isDeleting) return;
                                      if (isActive) {
                                        setPendingSheetDeleteKey(entry.storageKey);
                                      } else {
                                        void handlePermanentDeleteCharacterSheet(activeCharacterSheetTarget.characterId, entry.storageKey);
                                      }
                                    }}
                                    disabled={isDeleting}
                                    className="absolute -right-1.5 -top-1.5 rounded-full border border-white/10 bg-neutral-950/90 p-1 text-neutral-300 transition-colors hover:border-rose-400/60 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-50"
                                    title="Permanently delete this sheet"
                                  >
                                    {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                  </button>
                                  {isPendingConfirm && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-neutral-950/95 p-2 text-center text-[11px] text-neutral-200">
                                      <p>Permanently delete the active sheet? The most recent remaining sheet will become active.</p>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setPendingSheetDeleteKey(null)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-200 hover:bg-white/10"
                                        >
                                          Keep
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handlePermanentDeleteCharacterSheet(activeCharacterSheetTarget.characterId, entry.storageKey)}
                                          className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-100 hover:bg-rose-500/25"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {cleanupEnabled && (
                            <p className="mt-2 text-[11px] text-neutral-500">
                              Unused sheets are removed after {cleanupDays} day{cleanupDays === 1 ? '' : 's'}.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="mt-5 rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
                        <p>Accepted formats: JPG, PNG, or WebP.</p>
                        <p className="mt-1">
                          {compressionEnabled
                            ? `Raw file can be up to ${optimizationSettings.rawSelectedFileLimitMB} MB. Optimized upload limit: ${optimizationSettings.finalUploadLimitMB} MB.`
                            : `Maximum file size: ${Math.max(1, Math.round(cycleSettings.characterSheetUploadMaxBytes / (1024 * 1024)))} MB.`}
                        </p>
                        <p className="mt-1">Required aspect ratio: 1:1 (square).</p>
                        <p className="mt-1">
                          Minimum resolution: {CHARACTER_SHEET_MIN_DIMENSION}x{CHARACTER_SHEET_MIN_DIMENSION}. Recommended: 1024x1024 or above.
                        </p>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        <input
                          ref={characterSheetInputRef}
                          type="file"
                          accept={CHARACTER_SHEET_ACCEPTED_IMAGE_TYPES.join(',')}
                          onChange={handleCharacterSheetFileSelected}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => characterSheetInputRef.current?.click()}
                          disabled={capReached || isOptimizingCharacterSheet}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                          title={capReached ? `Limit of ${cap} sheets per character reached` : undefined}
                        >
                          <Upload className="h-4 w-4" />
                          {isOptimizingCharacterSheet ? 'Optimizing...' : characterSheetPreview ? 'Choose Different Image' : 'Choose Image'}
                        </button>
                        {activeCharacterHasSheet && (
                          <button
                            type="button"
                            onClick={() => void handleCharacterSheetClearActive(activeCharacterSheetTarget.characterId)}
                            disabled={isClearingActive}
                            className="inline-flex items-center gap-2 rounded-full border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Clear the active sheet (gallery preserved)"
                          >
                            {isClearingActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Clear Active
                          </button>
                        )}
                      </div>

                      {capReached && (
                        <p className="mt-3 text-xs text-amber-300">
                          You&apos;ve reached the limit of {cap} sheet{cap === 1 ? '' : 's'} per character. Delete one to upload another.
                        </p>
                      )}

                      {isOptimizingCharacterSheet && (
                        <div className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Optimizing image for faster upload...
                        </div>
                      )}

                      {characterSheetPreview && (
                        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/60">
                            <Image
                              src={characterSheetPreview.previewUrl}
                              alt={`${activeCharacterSheetTarget.characterName} reference preview`}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
                            <p className="font-medium text-neutral-100">{characterSheetPreview.fileName}</p>
                            <p className="mt-2">Format: {characterSheetPreview.mimeType}</p>
                            <p className="mt-1">Size: {(characterSheetPreview.fileSize / (1024 * 1024)).toFixed(2)} MB</p>
                            {characterSheetPreview.originalFileSize && characterSheetPreview.originalFileSize !== characterSheetPreview.fileSize && (
                              <p className="mt-1">Original: {formatFileSize(characterSheetPreview.originalFileSize)}</p>
                            )}
                            <p className="mt-1">Resolution: {characterSheetPreview.width}x{characterSheetPreview.height}</p>
                            {characterSheetPreview.optimizationWarning && (
                              <p className="mt-3 text-sm text-emerald-300">{characterSheetPreview.optimizationWarning}</p>
                            )}
                            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-neutral-500">Resolution advice</p>
                            <p className="mt-1 text-sm text-neutral-300">{characterSheetPreview.resolutionAdvice}</p>
                          </div>
                        </div>
                      )}

                      {characterSheetError && (
                        <div className="mt-5 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                          {characterSheetError}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {isBeatUploadView && (() => {
                const capReached = (normalizedCurrentBeat.imageGallery ?? []).length >= cycleSettings.promptOnlyMaxImagesPerBeat;

                return (
                  <div className="flex items-center justify-end gap-3 border-t border-white/5 p-6">
                    <button
                      type="button"
                      onClick={returnToPromptToolsOverview}
                      disabled={isUploadingPromptOnlyImage || isOptimizingPromptOnlyImage}
                      className="rounded-full px-4 py-2 text-sm text-neutral-400 transition-colors hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePromptOnlyUpload()}
                      disabled={!uploadPreview || isUploadingPromptOnlyImage || isOptimizingPromptOnlyImage || capReached}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-5 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUploadingPromptOnlyImage || isOptimizingPromptOnlyImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Upload Image
                    </button>
                  </div>
                );
              })()}

              {isCharacterUploadView && activeCharacterSheetTarget && (() => {
                const capReached = activeCharacterGallery.length >= cycleSettings.characterSheetMaxPerCharacter;

                return (
                  <div className="flex items-center justify-end gap-3 border-t border-white/5 p-6">
                    <button
                      type="button"
                      onClick={returnToPromptToolsOverview}
                      disabled={isUploadingCharacterSheet || isOptimizingCharacterSheet}
                      className="rounded-full px-4 py-2 text-sm text-neutral-400 transition-colors hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCharacterSheetUpload()}
                      disabled={!characterSheetPreview || isUploadingCharacterSheet || isOptimizingCharacterSheet || capReached}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-5 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUploadingCharacterSheet || isOptimizingCharacterSheet ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Upload Sheet
                    </button>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDiscardReelDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={!isDiscardingReel ? () => setShowDiscardReelDialog(false) : undefined}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-rose-300">Discard Reel</p>
                  <h2 className="mt-2 text-xl font-serif text-neutral-100">Delete this reel draft?</h2>
                </div>
                {!isDiscardingReel && (
                  <button
                    type="button"
                    onClick={() => setShowDiscardReelDialog(false)}
                    className="rounded-full p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <p className="text-sm leading-6 text-neutral-300">
                This will permanently delete this reel draft and remove it from your Reels list. This cannot be undone.
              </p>

              {discardReelError && (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
                  {discardReelError}
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDiscardReelDialog(false)}
                  disabled={isDiscardingReel}
                  className="px-4 py-2 text-sm text-neutral-400 transition-colors hover:text-neutral-200 disabled:cursor-wait disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDiscardReel()}
                  disabled={isDiscardingReel || !session.savedStoryId}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-wait disabled:opacity-60"
                >
                  {isDiscardingReel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete Permanently
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isExporting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6"
          >
            <div className="absolute inset-0 bg-neutral-950/55 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-full max-w-md overflow-hidden rounded-[28px] border border-white/15 bg-white/10 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.14),_transparent_55%),linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))]" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-emerald-300/90">
                      Video Export
                    </p>
                    <h3 className="mt-2 text-2xl font-serif text-white">
                      {exportPhaseLabel}
                    </h3>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-emerald-300">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                </div>

                <p className="mt-4 text-sm font-sans leading-6 text-neutral-200/90">
                  Keep this tab open while your reel video is being rendered. Leaving, refreshing, or closing the tab can stop the export.
                </p>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs font-sans uppercase tracking-[0.22em] text-neutral-300/80">
                    <span>Progress</span>
                    <span>{exportProgress}%</span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${exportProgress}%` }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300"
                    />
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={cancelExport}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-sans text-neutral-100 transition-all hover:bg-white/15"
                    title="Cancel video export"
                  >
                    <X className="h-4 w-4" />
                    <span>Cancel Export</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Publish Dialog */}
      {isEnding && (
        <PublishDialog
          isOpen={showPublishDialog && (!isReelStory || reelPublishingEnabled)}
          onClose={() => setShowPublishDialog(false)}
          endingNodeId={session.storyMap.currentNodeId}
          publishMode={canPublishAudioStoryline ? 'audio_story' : 'standard'}
          allowMissingImages={canPublishAudioStoryline}
        />
      )}

      <ManageStorylineCoverDialog
        isOpen={Boolean(managedStorylineId)}
        storylineId={managedStorylineId}
        onClose={() => setManagedStorylineId(null)}
      />
    </div>
  );
}
