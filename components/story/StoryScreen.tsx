'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useId, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { ArrowRight, RefreshCcw, BookOpen, Check, ChevronDown, ChevronUp, Save, Loader2, Share2, ExternalLink, Compass, CloudOff, CloudUpload, CheckCircle2, ImageIcon, ImageOff, AlertTriangle, Copy, Upload, Trash2, X, Layers, Clock3, Volume2, VolumeX, AlignLeft, AlignCenter, AlignRight, Type, Download, Lock, Play, Pause, Square, Blend, Clapperboard, Focus, SlidersHorizontal, Info, BookmarkPlus, BookmarkCheck, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { deleteStory } from '@/app/actions/persistence';
import { saveCharacterToLibrary } from '@/app/actions/character-library';
import type { CharacterMaster } from '@/lib/types/character-library';
import { getEpisodeNavigation } from '@/app/actions/episodes';
import type { EpisodeNavigation } from '@/lib/types/episodes';
import ContinueAsEpisodeDialog from './ContinueAsEpisodeDialog';
import PublishDialog from './PublishDialog';
import BatchVisualsBanner from './BatchVisualsBanner';
import ManageStorylineCoverDialog from './ManageStorylineCoverDialog';
import Timeline from './Timeline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NarrationButton from './NarrationButton';
import AutoScrollButton from './AutoScrollButton';
import FilterDropdown from '@/components/ui/FilterDropdown';
import InfoPopover from '@/components/ui/InfoPopover';
import ReelCanvasPreview from './ReelCanvasPreview';
import StoryStoryboardPlayer from './StoryStoryboardPlayer';
import VideoExportDialog from './VideoExportDialog';
import type { ResolvedExportPreset } from '@/lib/video-export/presets';
import StoryNarrationTimingDialog from './StoryNarrationTimingDialog';
import StoryTextOverlayDialog from './StoryTextOverlayDialog';
import StoryTransitionDialog from './StoryTransitionDialog';
import StoryEffectsDialog from './StoryEffectsDialog';
import BeatActionsMenu from './BeatActionsMenu';
import EditBeatTextDialog from './EditBeatTextDialog';
import RegenerateImageDialog from './RegenerateImageDialog';
import ImageVersionHistoryDialog from './ImageVersionHistoryDialog';
import CustomOptionInput from './CustomOptionInput';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import { findChildForOption, getCurrentNode, getNodesByBeatNumber, hasActiveDescendants } from '@/lib/utils/story-map';
import type { TimelineImpact } from '@/app/actions/beat-control';
import { extractStoryline } from '@/lib/utils/storyline';
import { useKeyboardNavigation } from '@/lib/hooks/useKeyboardNavigation';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { useStoryTransitionPlayback } from '@/lib/hooks/useStoryTransitionPlayback';
import { getStoryboardPanelBoundariesMs } from '@/lib/storyboard/narration-timing';
import { STORYBOARD_PANEL_COUNT } from '@/lib/storyboard/layout';
import { useResolvedStoryMediaState } from '@/lib/hooks/useResolvedStoryMedia';
import { getStableMediaIdentity, getStoryPersistence, type StoryMediaAsset } from '@/lib/persistence';
import { saveTreeProgress } from '@/lib/persistence/runtime';
import { parseR2Reference } from '@/lib/media/r2-reference';
import { useStoryAutoScroll } from '@/lib/hooks/useStoryAutoScroll';
import { getStoryboardSettings, checkIsAdmin } from '@/app/actions/admin';
import {
  applyReelNarrationVoicePreviewAction,
  deleteNarrationPresetAction,
  deleteReelNarrationVoicePreviewAction,
  duplicateNarrationPresetAction,
  listNarrationPresetsAction,
  listReelNarrationVoicePreviewsAction,
  previewReelNarrationAction,
  saveDefaultNarrationPresetAction,
  saveNarrationSettingsAsPresetAction,
  saveReelNarrationVoicePreviewAction,
  updateNarrationPresetAction,
} from '@/app/actions/reel-narration';
import { useReelVideoExport } from '@/lib/hooks/useReelVideoExport';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { getActiveGalleryStorageKey, getBeatDisplayImageUrl, hasBeatImpossibleImageState, normalizeBeatMediaFields } from '@/lib/types/beat-media';
import type { StoryBeat, StoryNode, StorySession } from '@/lib/types/story';
import { resolveVideoExportWatermarkVisibility, type PricingRuntimeContext } from '@/lib/types/pricing';
import {
  DEFAULT_REEL_TEXT_OVERLAY_STYLE,
  REEL_CAPTION_VERTICAL_OFFSET_MAX,
  REEL_CAPTION_VERTICAL_OFFSET_MIN,
  getDefaultReelTextFontFamilyForLanguage,
  getReelTextFontPresetsForLanguage,
  isReelTextFontFamilyCompatibleWithLanguage,
  normalizeReelTextOverlayStyle,
  type ReelTextOverlayStyle,
} from '@/lib/reel/styles';
import { ReelStyleColorControl, ReelStyleNumberInput } from '@/components/ui/ReelColorPicker';
import {
  DEFAULT_REEL_TRANSITION_SETTINGS,
  REEL_TRANSITION_DURATION_MAX_MS,
  REEL_TRANSITION_DURATION_MIN_MS,
  REEL_TRANSITION_PAUSE_MAX_MS,
  REEL_TRANSITION_PAUSE_MIN_MS,
  REEL_TRANSITION_REGISTRY,
  REEL_TRANSITION_TYPES,
  normalizeReelTransitionSettings,
  reelTransitionSettingsKey,
  type ReelTransitionSettings,
} from '@/lib/reel/transitions';
import { REEL_PANEL_COUNT, getEditableReelPanelTexts, splitTextIntoCompleteCaptionPanels } from '@/lib/reel/captions';
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
import {
  DEFAULT_REEL_NARRATION_ADMIN_SETTINGS,
  applyPresetToNarrationSettings,
  getAvailableReelNarrationLanguages,
  getReelNarrationVoiceOptions,
  normalizeReelNarrationSettings,
  storyLanguageToNarrationLanguage,
  type NarrationVoiceGender,
  type NarrationPreset,
  type NarrationVoicePreviewScope,
  type ReelNarrationAdminSettings,
  type ReelNarrationSettings,
  type ReelNarrationVoicePreview,
} from '@/lib/reel/narration';

const MAX_VOICE_PREVIEWS_LOCAL = 4;
type ApplyReelNarrationPreviewResult = Awaited<ReturnType<typeof applyReelNarrationVoicePreviewAction>>;

function formatNarrationProvider(provider: string | undefined): string {
  if (provider === 'elevenlabs') return 'ElevenLabs';
  if (provider === 'gemini_tts') return 'Gemini TTS';
  return 'Provider unknown';
}

function getHighlightStatusLabel(preview: ReelNarrationVoicePreview): string {
  if (preview.generationMetadata?.textHighlightSupported) return 'Highlight supported';
  if (preview.generationMetadata?.provider === 'gemini_tts') return 'Highlight unavailable';
  if (preview.generationMetadata?.provider === 'elevenlabs') return 'No word timestamps';
  return 'Highlight unknown';
}

function getHighlightUnavailableReason(preview: ReelNarrationVoicePreview): string {
  if (preview.generationMetadata?.provider === 'gemini_tts') {
    return 'Text highlight is unavailable because Gemini TTS does not provide word-level timestamps.';
  }
  if (preview.generationMetadata?.provider === 'elevenlabs') {
    return 'Text highlight is unavailable because this preview did not return word-level timestamps.';
  }
  return 'Text highlight availability is unknown for this older preview.';
}

function stripUnsupportedWordTimings(beat: StoryBeat): StoryBeat {
  if (beat.narrationMetadata?.textHighlightSupported === true) return beat;
  if (!beat.reelCaptions?.some((caption) => caption.wordTimings?.length)) return beat;
  return {
    ...beat,
    reelCaptions: beat.reelCaptions.map((caption) => ({
      ...caption,
      wordTimings: undefined,
    })),
  };
}

function hasFinalReelNarration(beat: StoryBeat): boolean {
  const normalizedBeat = normalizeBeatMediaFields(beat);
  if (!normalizedBeat.audioUrl || normalizedBeat.audioStatus !== 'ready') return false;
  if (normalizedBeat.activeNarrationPreviewId) return true;
  if (normalizedBeat.narrationMetadata?.scope === 'sample') return false;
  return true;
}

function isFallbackImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('https://picsum.photos/seed/');
}

function ReelInfoPopover({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const open = () => {
    if (!buttonRef.current) return;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) {
      setPanelStyle({
        bottom: 12,
        left: 12,
        right: 12,
      });
      setIsOpen(true);
      return;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    setPanelStyle({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)),
      top: Math.min(rect.bottom + 8, window.innerHeight - 8),
    });
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const panel = document.getElementById(panelId);
      if (panel?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, panelId]);

  return (
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-neutral-950 text-neutral-500 transition-colors hover:border-emerald-400/40 hover:text-emerald-300"
        aria-label={`Show ${title} details`}
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <Info className="h-3 w-3" aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && panelStyle && (
            <>
              <motion.button
                type="button"
                aria-label={`Close ${title} details`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                onClick={() => setIsOpen(false)}
                className="fixed inset-0 z-[1090] bg-black/45 md:hidden"
              />
              <motion.div
                id={panelId}
                role="dialog"
                aria-label={title}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                style={panelStyle}
                className="fixed z-[1100] max-h-[min(48dvh,22rem)] w-auto overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950 p-3 text-left text-xs leading-relaxed text-neutral-300 shadow-2xl shadow-black/50 md:w-64 md:max-h-[75vh]"
              >
                <div className="mb-1 font-sans text-xs font-medium text-emerald-300">
                  {title}
                </div>
                {children}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function ReelFieldLabel({
  children,
  infoTitle,
  info,
}: {
  children: ReactNode;
  infoTitle?: string;
  info?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
      <span>{children}</span>
      {infoTitle && info && (
        <ReelInfoPopover title={infoTitle}>
          {info}
        </ReelInfoPopover>
      )}
    </span>
  );
}

function getReelPanelTexts(beat: Pick<StoryBeat, 'storyText' | 'reelCaptions'>): string[] {
  return getEditableReelPanelTexts(beat, REEL_PANEL_COUNT);
}

function reelOverlayStyleKey(style: ReelTextOverlayStyle | null | undefined): string {
  const normalized = normalizeReelTextOverlayStyle(style);
  return JSON.stringify({
    fontFamily: normalized.fontFamily,
    fontSize: normalized.fontSize,
    fontWeight: normalized.fontWeight,
    color: normalized.color,
    textOpacity: normalized.textOpacity,
    shadowColor: normalized.shadowColor,
    shadowBlur: normalized.shadowBlur,
    backgroundColor: normalized.backgroundColor,
    backgroundOpacity: normalized.backgroundOpacity,
    backgroundBlur: normalized.backgroundBlur,
    position: normalized.position,
    verticalOffset: normalized.verticalOffset,
    align: normalized.align,
    wordHighlightColor: normalized.wordHighlightColor,
    wordHighlightOpacity: normalized.wordHighlightOpacity,
    wordHighlightPaddingX: normalized.wordHighlightPaddingX,
    wordHighlightPaddingY: normalized.wordHighlightPaddingY,
    wordHighlightBorderRadius: normalized.wordHighlightBorderRadius,
    wordHighlightWordSpacing: normalized.wordHighlightWordSpacing,
  });
}

function reelNarrationSettingsKey(settings: ReelNarrationSettings | null | undefined): string {
  const normalized = normalizeReelNarrationSettings(settings);
  return JSON.stringify({
    provider: normalized.provider,
    fallbackProvider: normalized.fallbackProvider,
    language: normalized.language,
    voiceGender: normalized.voiceGender,
    voiceId: normalized.voiceId,
    model: normalized.model,
    presetId: normalized.presetId,
    speed: normalized.speed,
    stability: normalized.stability,
    similarityBoost: normalized.similarityBoost,
    style: normalized.style,
    speakerBoost: normalized.speakerBoost,
    emotionalIntensity: normalized.emotionalIntensity,
    pacing: normalized.pacing,
    tone: normalized.tone,
    deliveryStyle: normalized.deliveryStyle,
    narrationInstruction: normalized.narrationInstruction,
    languageMode: normalized.languageMode,
    useExpressiveTags: normalized.useExpressiveTags,
    usePronunciationDictionary: normalized.usePronunciationDictionary,
    pauseStyle: normalized.pauseStyle,
  });
}

interface ReelToolbarProps {
  storyMap: StorySession['storyMap'];
  onNodeClick: (nodeId: string) => void;
  focusedNodeId?: string;
  nodes?: StoryNode[];
  canOpenPromptTools: boolean;
  promptToolsOpen: boolean;
  onTogglePromptTools: () => void;
  actions?: ReactNode;
}

function ReelToolbar({
  storyMap,
  onNodeClick,
  focusedNodeId,
  nodes,
  canOpenPromptTools,
  promptToolsOpen,
  onTogglePromptTools,
  actions,
}: ReelToolbarProps) {
  return (
    <div className="relative z-30 flex min-h-10 items-center justify-between gap-3 px-1 py-1">
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
          onClick={onTogglePromptTools}
          disabled={!canOpenPromptTools}
          aria-expanded={promptToolsOpen}
          aria-haspopup="dialog"
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            !canOpenPromptTools
              ? 'cursor-not-allowed border-white/5 bg-white/[0.03] text-neutral-700'
              : promptToolsOpen
              ? 'border-sky-400/25 bg-sky-500/20 text-sky-200 hover:bg-sky-500/25'
              : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10'
          }`}
          title={canOpenPromptTools ? 'Prompt and image tools' : 'No prompt tools available'}
        >
          <Layers className="w-4 h-4" />
        </button>
        {actions}
      </div>
    </div>
  );
}

type ReelEditorSection = 'text' | 'style' | 'transitions' | 'voice';
type ReelEditorDestination = ReelEditorSection;
type ReelMobilePreviewMode = 'work' | 'full';
type ReelPreviewSurface = 'desktop' | 'mobile-work' | 'mobile-full';

const REEL_EDITOR_DESTINATIONS: Array<{
  id: ReelEditorDestination;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}> = [
  { id: 'text', label: 'Panel Text', icon: BookOpen },
  { id: 'style', label: 'Text Settings', icon: Type },
  { id: 'transitions', label: 'Transitions', icon: Blend },
  { id: 'voice', label: 'Voice / Narration', icon: Volume2 },
];

const REEL_MOBILE_PREVIEW_MODES: Array<{
  id: ReelMobilePreviewMode;
  label: string;
  icon: LucideIcon;
}> = [
  { id: 'work', label: 'Work mode', icon: SlidersHorizontal },
  { id: 'full', label: 'Full preview', icon: Focus },
];

interface ReelCaptionStylePanelProps {
  textOverlayEnabled: boolean;
  normalizedStyle: ReelTextOverlayStyle;
  storyLanguage: string;
  hasUnsavedStyle: boolean;
  isSavingStyle: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  message: string | null;
  embedded?: boolean;
  wordHighlightAvailable?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (patch: ReelTextOverlayStyle) => void;
  onCancel: () => void;
  onSave: () => void;
}

interface ReelStyleSliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function ReelStyleSliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: ReelStyleSliderControlProps) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span className="block font-sans text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-emerald-400"
        />
        <ReelStyleNumberInput
          value={value}
          min={min}
          max={max}
          step={step}
          label={label}
          onCommit={onChange}
        />
      </div>
    </div>
  );
}

const REEL_NARRATION_GENDER_OPTIONS: Array<{ value: NarrationVoiceGender; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

const REEL_NARRATION_PACING_OPTIONS = [
  { value: 'very_slow', label: 'Very slow' },
  { value: 'slow', label: 'Slow' },
  { value: 'gentle', label: 'Gentle' },
  { value: 'steady', label: 'Steady' },
  { value: 'dynamic', label: 'Dynamic' },
];

const REEL_NARRATION_PAUSE_OPTIONS = [
  { value: 'short', label: 'Short' },
  { value: 'natural', label: 'Natural' },
  { value: 'long', label: 'Long' },
];

const REEL_NARRATION_LANGUAGE_OPTIONS = [
  { value: 'en-IN', label: 'English' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'bn-IN', label: 'Bangla' },
  { value: 'ur-IN', label: 'Urdu' },
  { value: 'gu-IN', label: 'Gujarati' },
];

interface ReelFontDropdownProps {
  value: string | undefined;
  storyLanguage: string;
  onChange: (fontFamily: string) => void;
}

interface FloatingListboxPosition {
  bottom?: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
  top?: number;
  width: number;
}

function useFloatingListbox(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  optionCount: number,
  optionHeight = 40
) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingListboxPosition | null>(null);
  const [opensUp, setOpensUp] = useState(false);

  const updatePosition = useCallback(() => {
    if (!anchorRef.current || typeof window === 'undefined') return;

    const rect = anchorRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const estimatedMenuHeight = Math.min(optionCount * optionHeight + 12, 280);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextOpensUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(
      optionHeight + 12,
      (nextOpensUp ? spaceAbove : spaceBelow) - viewportPadding * 2
    );
    const maxWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const width = Math.min(rect.width, maxWidth);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    );

    setOpensUp(nextOpensUp);
    setPosition({
      bottom: nextOpensUp ? Math.max(viewportPadding, window.innerHeight - rect.top + gap) : undefined,
      left,
      maxHeight: Math.min(280, availableHeight),
      maxWidth,
      top: nextOpensUp ? undefined : Math.min(window.innerHeight - viewportPadding, rect.bottom + gap),
      width,
    });
  }, [optionCount, optionHeight]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(updatePosition);
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [onOpenChange, open, updatePosition]);

  return { anchorRef, menuRef, opensUp, position, updatePosition };
}

function ReelFontDropdown({ value, storyLanguage, onChange }: ReelFontDropdownProps) {
  const [open, setOpen] = useState(false);
  const options = getReelTextFontPresetsForLanguage(storyLanguage);
  const selected = options.find((font) => font.value === value) ?? options[0];
  const selectedLabel = selected?.label ?? 'Font';
  const {
    anchorRef: fontDropdownAnchorRef,
    menuRef: fontDropdownMenuRef,
    opensUp: fontDropdownOpensUp,
    position: fontDropdownPosition,
    updatePosition: updateFontDropdownPosition,
  } = useFloatingListbox(open, setOpen, options.length, 38);

  return (
    <div
      ref={fontDropdownAnchorRef}
      className="relative min-w-0 flex-1"
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget as Node | null) &&
          !fontDropdownMenuRef.current?.contains(event.relatedTarget as Node | null)
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!open) updateFontDropdownPosition();
          setOpen((current) => !current);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-7 w-full items-center justify-between gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-left font-sans text-[11px] text-neutral-100 outline-none transition-colors hover:border-white/20 focus:border-emerald-400/50"
      >
        <span className="min-w-0 truncate" style={{ fontFamily: selected?.value ?? value }}>
          {selectedLabel}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && fontDropdownPosition && (
            <motion.div
              ref={fontDropdownMenuRef}
              role="listbox"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className={`fixed z-[1000] overflow-y-auto border border-white/12 bg-neutral-950 p-1.5 shadow-2xl shadow-black/60 ${
                fontDropdownOpensUp ? 'rounded-2xl rounded-b-none' : 'rounded-2xl rounded-t-none'
              }`}
              style={{
                bottom: fontDropdownPosition.bottom,
                left: fontDropdownPosition.left,
                maxHeight: fontDropdownPosition.maxHeight,
                maxWidth: fontDropdownPosition.maxWidth,
                top: fontDropdownPosition.top,
                width: fontDropdownPosition.width,
              }}
            >
              {options.map((font) => {
                const active = font.value === value;
                return (
                  <button
                    key={`${font.label}-${font.value}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange(font.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left font-sans text-xs transition-colors ${
                      active
                        ? 'bg-emerald-400 text-neutral-950'
                        : 'text-neutral-200 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="min-w-0 truncate" style={{ fontFamily: font.value }}>
                      {font.label}
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

interface ReelCaptionStyleControlsProps {
  textOverlayEnabled: boolean;
  normalizedStyle: ReelTextOverlayStyle;
  storyLanguage: string;
  wordHighlightAvailable?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (patch: ReelTextOverlayStyle) => void;
}

function ReelCaptionStyleControls({
  textOverlayEnabled,
  normalizedStyle,
  storyLanguage,
  wordHighlightAvailable = true,
  onEnabledChange,
  onChange,
}: ReelCaptionStyleControlsProps) {
  const fontSize = normalizedStyle.fontSize ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize;
  const verticalOffset = normalizedStyle.verticalOffset ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.verticalOffset;
  const textOpacity = normalizedStyle.textOpacity ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.textOpacity;
  const backgroundOpacity = normalizedStyle.backgroundOpacity ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundOpacity;
  const backgroundBlur = normalizedStyle.backgroundBlur ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundBlur;
  const wordHighlightOpacity = normalizedStyle.wordHighlightOpacity ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightOpacity;
  const wordHighlightPaddingX = normalizedStyle.wordHighlightPaddingX ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightPaddingX;
  const wordHighlightPaddingY = normalizedStyle.wordHighlightPaddingY ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightPaddingY;
  const wordHighlightBorderRadius = normalizedStyle.wordHighlightBorderRadius ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightBorderRadius;
  const wordHighlightWordSpacing = normalizedStyle.wordHighlightWordSpacing ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightWordSpacing;

  useEffect(() => {
    if (!isReelTextFontFamilyCompatibleWithLanguage(normalizedStyle.fontFamily, storyLanguage)) {
      onChange({ fontFamily: getDefaultReelTextFontFamilyForLanguage(storyLanguage) });
    }
  }, [normalizedStyle.fontFamily, onChange, storyLanguage]);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-neutral-900 px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-sans text-[10px] uppercase tracking-wider text-neutral-500">Captions</p>
          <p className="mt-0.5 text-xs text-neutral-300">{textOverlayEnabled ? 'Shown on reel' : 'Hidden from reel'}</p>
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!textOverlayEnabled)}
          className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
            textOverlayEnabled
              ? 'justify-end border-emerald-400/60 bg-emerald-500/25'
              : 'justify-start border-white/10 bg-neutral-800'
          }`}
          role="switch"
          aria-checked={textOverlayEnabled}
          aria-label="Show reel captions"
        >
          <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
        </button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="flex min-w-0 rounded-full border border-white/10 bg-neutral-900 p-0.5">
          {([
            ['upper', 'Top'],
            ['middle', 'Mid'],
            ['lower', 'Low'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ position: value })}
              className={`flex-1 rounded-full px-2.5 py-1.5 text-[10px] font-sans uppercase tracking-wider transition-colors ${
                normalizedStyle.position === value
                  ? 'bg-emerald-400 text-neutral-950'
                  : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 rounded-full border border-white/10 bg-neutral-900 p-0.5">
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

      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-neutral-900 px-2.5 py-2">
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

        <label className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-neutral-900 px-2.5 py-2">
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

      <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-3 py-2">
        <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
          Font
        </span>
        <ReelFontDropdown
          value={normalizedStyle.fontFamily}
          storyLanguage={storyLanguage}
          onChange={(fontFamily) => onChange({ fontFamily })}
        />
      </div>

      <ReelStyleColorControl
        label="Text"
        color={normalizedStyle.color}
        fallback={DEFAULT_REEL_TEXT_OVERLAY_STYLE.color}
        opacity={textOpacity}
        onColorChange={(color) => onChange({ color })}
        onOpacityChange={(nextTextOpacity) => onChange({ textOpacity: nextTextOpacity })}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2">
        <ReelStyleColorControl
          label="BG"
          color={normalizedStyle.backgroundColor}
          fallback={DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundColor}
          opacity={backgroundOpacity}
          blur={backgroundBlur}
          onColorChange={(backgroundColor) => onChange({ backgroundColor })}
          onOpacityChange={(backgroundOpacity) => onChange({ backgroundOpacity })}
          onBlurChange={(backgroundBlur) => onChange({ backgroundBlur })}
        />
        {wordHighlightAvailable ? (
          <ReelStyleColorControl
            label="Word highlight"
            color={normalizedStyle.wordHighlightColor}
            fallback={DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightColor}
            opacity={wordHighlightOpacity}
            sampleText="Word highlight"
            samplePaddingX={wordHighlightPaddingX}
            samplePaddingY={wordHighlightPaddingY}
            sampleBorderRadius={wordHighlightBorderRadius}
            sampleWordSpacing={wordHighlightWordSpacing}
            onColorChange={(wordHighlightColor) => onChange({ wordHighlightColor })}
            onOpacityChange={(wordHighlightOpacity) => onChange({ wordHighlightOpacity })}
            onSamplePaddingXChange={(wordHighlightPaddingX) => onChange({ wordHighlightPaddingX })}
            onSamplePaddingYChange={(wordHighlightPaddingY) => onChange({ wordHighlightPaddingY })}
            onSampleBorderRadiusChange={(wordHighlightBorderRadius) => onChange({ wordHighlightBorderRadius })}
            onSampleWordSpacingChange={(wordHighlightWordSpacing) => onChange({ wordHighlightWordSpacing })}
          />
        ) : (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
            Word highlight is unavailable for the applied narration because word-level timestamps are not available.
          </div>
        )}
      </div>
    </div>
  );
}

function ReelCaptionStylePanel({
  textOverlayEnabled,
  normalizedStyle,
  storyLanguage,
  hasUnsavedStyle,
  isSavingStyle,
  saveState,
  message,
  embedded = false,
  wordHighlightAvailable = true,
  onEnabledChange,
  onChange,
  onCancel,
  onSave,
}: ReelCaptionStylePanelProps) {
  return (
    <section className={embedded ? 'bg-neutral-950' : 'rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl'}>
      {hasUnsavedStyle && (
        <div className="flex justify-end border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSavingStyle}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              Cancel
            </button>
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
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <ReelCaptionStyleControls
          textOverlayEnabled={textOverlayEnabled}
          normalizedStyle={normalizedStyle}
          storyLanguage={storyLanguage}
          wordHighlightAvailable={wordHighlightAvailable}
          onEnabledChange={onEnabledChange}
          onChange={onChange}
        />

        {saveState === 'error' && message && (
          <p className="mt-3 text-xs font-sans text-rose-300">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

interface ReelTransitionPanelProps {
  settings: ReelTransitionSettings;
  hasUnsavedSettings: boolean;
  isSaving: boolean;
  error: string | null;
  embedded?: boolean;
  onChange: (settings: ReelTransitionSettings) => void;
  onCancel: () => void;
  onSave: () => void;
}

function ReelTransitionPanel({
  settings,
  hasUnsavedSettings,
  isSaving,
  error,
  embedded = false,
  onChange,
  onCancel,
  onSave,
}: ReelTransitionPanelProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const selected = REEL_TRANSITION_REGISTRY[settings.type];
  const {
    anchorRef: transitionDropdownAnchorRef,
    menuRef: transitionDropdownMenuRef,
    opensUp: transitionDropdownOpensUp,
    position: transitionDropdownPosition,
    updatePosition: updateTransitionDropdownPosition,
  } = useFloatingListbox(dropdownOpen, setDropdownOpen, REEL_TRANSITION_TYPES.length, 40);

  return (
    <section className={embedded ? 'bg-neutral-950' : 'rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl'}>
      {hasUnsavedSettings && (
        <div className="flex justify-end border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-sans uppercase tracking-wider text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 px-4 py-3">
          <div
            ref={transitionDropdownAnchorRef}
            className="relative"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                !transitionDropdownMenuRef.current?.contains(event.relatedTarget as Node | null)
              ) {
                setDropdownOpen(false);
              }
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (!dropdownOpen) updateTransitionDropdownPosition();
                setDropdownOpen((current) => !current);
              }}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              className="flex min-h-10 w-full items-center justify-between rounded-full border border-white/10 bg-neutral-900 px-4 font-sans text-xs text-neutral-100 transition-colors hover:border-white/20"
            >
              <span>{selected.label}</span>
              <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {typeof document !== 'undefined' && createPortal(
              <AnimatePresence>
                {dropdownOpen && transitionDropdownPosition && (
                  <motion.div
                    ref={transitionDropdownMenuRef}
                    role="listbox"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className={`fixed z-[1000] overflow-y-auto border border-white/10 bg-neutral-950 p-1.5 shadow-2xl ${
                      transitionDropdownOpensUp ? 'rounded-2xl rounded-b-none' : 'rounded-2xl rounded-t-none'
                    }`}
                    style={{
                      bottom: transitionDropdownPosition.bottom,
                      left: transitionDropdownPosition.left,
                      maxHeight: transitionDropdownPosition.maxHeight,
                      maxWidth: transitionDropdownPosition.maxWidth,
                      top: transitionDropdownPosition.top,
                      width: transitionDropdownPosition.width,
                    }}
                  >
                    {REEL_TRANSITION_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        role="option"
                        aria-selected={settings.type === type}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          const durationMs = type === 'fast-cut'
                            ? REEL_TRANSITION_REGISTRY[type].defaultDurationMs
                            : settings.durationMs;
                          onChange(normalizeReelTransitionSettings({ type, durationMs, pauseMs: settings.pauseMs }));
                          setDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left font-sans text-xs transition-colors ${
                          settings.type === type ? 'bg-emerald-400 text-neutral-950' : 'text-neutral-200 hover:bg-white/10'
                        }`}
                      >
                        {REEL_TRANSITION_REGISTRY[type].label}
                        {settings.type === type && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body
            )}
          </div>

          <ReelStyleSliderControl
            label="Duration (ms)"
            value={settings.durationMs}
            min={REEL_TRANSITION_DURATION_MIN_MS}
            max={REEL_TRANSITION_DURATION_MAX_MS}
            step={50}
            onChange={(durationMs) => onChange(normalizeReelTransitionSettings({ ...settings, durationMs }))}
          />

          <ReelStyleSliderControl
            label="Pause before transition (ms)"
            value={settings.pauseMs}
            min={REEL_TRANSITION_PAUSE_MIN_MS}
            max={REEL_TRANSITION_PAUSE_MAX_MS}
            step={50}
            onChange={(pauseMs) => onChange(normalizeReelTransitionSettings({ ...settings, pauseMs }))}
          />

        {error && <p className="text-xs font-sans text-rose-300">{error}</p>}
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
      <div className="px-4 py-3">
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

      {(hasUnsavedText || message) && <div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
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
      </div>}
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
  generatedReferenceUrl?: string;
};

function resolveRenderableGeneratedReferenceUrl(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const r2Reference = parseR2Reference(candidate);
    if (r2Reference) {
      return `/api/media/r2/object?bucket=${encodeURIComponent(r2Reference.bucket)}&key=${encodeURIComponent(r2Reference.objectKey)}`;
    }
    if (
      candidate.startsWith('data:')
      || candidate.startsWith('blob:')
      || candidate.startsWith('http://')
      || candidate.startsWith('https://')
      || candidate.startsWith('/')
    ) {
      return candidate;
    }
  }
  return undefined;
}

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
    const generatedReferenceUrl = resolveRenderableGeneratedReferenceUrl(
      rosterEntry?.portraitUrl,
      character.portraitUrl,
      rosterEntry?.portraitBase64,
      character.portraitBase64
    );
    items.push({
      key: `${character.id}:${items.length}`,
      label: character.name,
      promptText: promptByCharacterId.get(character.id) ?? '',
      characterId: character.id,
      characterName: character.name,
      referenceSheetUrl: activeUrl,
      referenceSheetStorageKey: activeKey,
      referenceSheetGallery: gallery,
      generatedReferenceUrl,
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
  storyTextOverlayWordsPerLine: number;
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
  const activeImageJobNodeIds = useStoryStore((state) => state.activeImageJobNodeIds);
  const audioReadyNodeId = useStoryStore((state) => state.audioReadyNodeId);
  const generateNarrationForNode = useStoryStore((state) => state.generateNarrationForNode);
  const updateStoryboardNarrationTiming = useStoryStore((state) => state.updateStoryboardNarrationTiming);
  const updateReelPanelCaptions = useStoryStore((state) => state.updateReelPanelCaptions);
  const updateReelNarrationSettings = useStoryStore((state) => state.updateReelNarrationSettings);
  const updateReelTextOverlaySettings = useStoryStore((state) => state.updateReelTextOverlaySettings);
  const updateStoryTextOverlaySettings = useStoryStore((state) => state.updateStoryTextOverlaySettings);
  const updateStoryTransitionSettings = useStoryStore((state) => state.updateStoryTransitionSettings);
  const updateStoryEffects = useStoryStore((state) => state.updateStoryEffects);
  const applyStoryEffectsToAll = useStoryStore((state) => state.applyStoryEffectsToAll);
  const generateStoryTextOverlayForNode = useStoryStore((state) => state.generateStoryTextOverlayForNode);
  const generateStoryTextOverlayForCurrentPath = useStoryStore((state) => state.generateStoryTextOverlayForCurrentPath);
  const updateReelTransitionSettings = useStoryStore((state) => state.updateReelTransitionSettings);
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
  const signedUrlRefreshInFlightRef = useRef(false);
  const lastSignedUrlRefreshAtRef = useRef(Date.now());
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
    storyTextOverlayWordsPerLine: 7,
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
    // Pack 1 beat-control flags (fail-closed defaults until this resolves).
    void useStoryStore.getState().loadBeatControlSettings();
    // Pack 2 character-universe flags (library save, episodes, bible).
    void useStoryStore.getState().loadCharacterUniverseSettings();
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

  const refreshSignedUrlsIfNeeded = useCallback(async (force = false) => {
    const refreshIntervalMs = 50 * 60 * 1000;
    if (
      signedUrlRefreshInFlightRef.current
      || (!force && Date.now() - lastSignedUrlRefreshAtRef.current < refreshIntervalMs)
    ) {
      return;
    }

    signedUrlRefreshInFlightRef.current = true;
    try {
      const refreshed = await refreshSignedUrls();
      if (refreshed) lastSignedUrlRefreshAtRef.current = Date.now();
    } finally {
      signedUrlRefreshInFlightRef.current = false;
    }
  }, [refreshSignedUrls]);

  // Refresh before expiry and catch up after browser suspension throttles timers.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshSignedUrlsIfNeeded(true);
    }, 50 * 60 * 1000);
    const handleForeground = () => {
      if (!document.hidden) void refreshSignedUrlsIfNeeded();
    };

    document.addEventListener('visibilitychange', handleForeground);
    window.addEventListener('focus', handleForeground);
    window.addEventListener('online', handleForeground);
    window.addEventListener('pageshow', handleForeground);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleForeground);
      window.removeEventListener('focus', handleForeground);
      window.removeEventListener('online', handleForeground);
      window.removeEventListener('pageshow', handleForeground);
    };
  }, [refreshSignedUrlsIfNeeded]);

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
    <>
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
      activeImageJobNodeIds={activeImageJobNodeIds}
      audioReadyNodeId={audioReadyNodeId}
      generateNarrationForNode={generateNarrationForNode}
      updateStoryboardNarrationTiming={updateStoryboardNarrationTiming}
      updateReelPanelCaptions={updateReelPanelCaptions}
      updateReelNarrationSettings={updateReelNarrationSettings}
      updateReelTextOverlaySettings={updateReelTextOverlaySettings}
      updateStoryTextOverlaySettings={updateStoryTextOverlaySettings}
      updateStoryTransitionSettings={updateStoryTransitionSettings}
      updateStoryEffects={updateStoryEffects}
      applyStoryEffectsToAll={applyStoryEffectsToAll}
      generateStoryTextOverlayForNode={generateStoryTextOverlayForNode}
      generateStoryTextOverlayForCurrentPath={generateStoryTextOverlayForCurrentPath}
      updateReelTransitionSettings={updateReelTransitionSettings}
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
      persistenceUserId={user?.id}
    />
    </>
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
  activeImageJobNodeIds,
  audioReadyNodeId,
  generateNarrationForNode,
  updateStoryboardNarrationTiming,
  updateReelPanelCaptions,
  updateReelNarrationSettings,
  updateReelTextOverlaySettings,
  updateStoryTextOverlaySettings,
  updateStoryTransitionSettings,
  updateStoryEffects,
  applyStoryEffectsToAll,
  generateStoryTextOverlayForNode,
  generateStoryTextOverlayForCurrentPath,
  updateReelTransitionSettings,
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
  persistenceUserId,
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
  activeImageJobNodeIds: string[];
  audioReadyNodeId: string | null;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  updateStoryboardNarrationTiming: (
    nodeId: string,
    timing: StoryBeat['storyboardNarrationTiming'] | null
  ) => Promise<void>;
  updateReelPanelCaptions: (nodeId: string, panelTexts: string[]) => Promise<{
    clearedNarration: boolean;
    deletedPreviewIds: string[];
  }>;
  updateReelNarrationSettings: (
    settings: ReelNarrationSettings,
    options?: { preserveExistingNarration?: boolean }
  ) => Promise<{ clearedNarration: boolean }>;
  updateReelTextOverlaySettings: (settings: { enabled: boolean; style: StoryBeat['reelTextOverlayStyle'] }) => Promise<void>;
  updateStoryTextOverlaySettings: (settings: {
    enabled: boolean;
    mode: NonNullable<StoryBeat['storyTextOverlayMode']>;
    style: StoryBeat['storyTextOverlayStyle'];
  }) => Promise<void>;
  updateStoryTransitionSettings: ReturnType<typeof useStoryStore.getState>['updateStoryTransitionSettings'];
  updateStoryEffects: ReturnType<typeof useStoryStore.getState>['updateStoryEffects'];
  applyStoryEffectsToAll: ReturnType<typeof useStoryStore.getState>['applyStoryEffectsToAll'];
  generateStoryTextOverlayForNode: (nodeId: string, settings: {
    enabled: boolean;
    mode: NonNullable<StoryBeat['storyTextOverlayMode']>;
    style: StoryBeat['storyTextOverlayStyle'];
  }) => Promise<{
    nodeId: string;
    status: 'synced' | 'fallback';
    storyTextOverlayEnabled: boolean;
    storyTextOverlayMode: NonNullable<StoryBeat['storyTextOverlayMode']>;
    storyTextOverlayStyle: NonNullable<StoryBeat['storyTextOverlayStyle']>;
    storyTextOverlayCaptions: NonNullable<StoryBeat['storyTextOverlayCaptions']>;
    storyTextOverlayAlignment: NonNullable<StoryBeat['storyTextOverlayAlignment']>;
  }>;
  generateStoryTextOverlayForCurrentPath: (settings: {
    enabled: boolean;
    mode: NonNullable<StoryBeat['storyTextOverlayMode']>;
    style: StoryBeat['storyTextOverlayStyle'];
  }) => Promise<{
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
  }>;
  updateReelTransitionSettings: (settings: ReelTransitionSettings) => Promise<void>;
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
  persistenceUserId?: string;
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
  const [activeReelEditorSection, setActiveReelEditorSection] = useState<ReelEditorSection>('text');
  const [reelMobilePreviewMode, setReelMobilePreviewMode] = useState<ReelMobilePreviewMode>('work');
  const [reelEditorNavigationMessage, setReelEditorNavigationMessage] = useState<string | null>(null);
  const reelSettingsScrollRef = useRef<HTMLDivElement>(null);
  const [reelSettingsFade, setReelSettingsFade] = useState({ top: false, bottom: false });
  const [narrationPresets, setNarrationPresets] = useState<NarrationPreset[]>([]);
  const [reelNarrationAdminSettings, setReelNarrationAdminSettings] = useState<ReelNarrationAdminSettings | null>(null);
  const [reelNarrationDraft, setReelNarrationDraft] = useState<ReelNarrationSettings>(() =>
    normalizeReelNarrationSettings(session.storyConfig.reel.narrationSettings, {
      storyLanguage: session.storyConfig.language,
    })
  );
  const [reelNarrationAdvancedOpen, setReelNarrationAdvancedOpen] = useState(false);
  const [reelNarrationSaveState, setReelNarrationSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reelNarrationMessage, setReelNarrationMessage] = useState<string | null>(null);
  const [isPreviewingReelNarration, setIsPreviewingReelNarration] = useState(false);
  const [voicePreviews, setVoicePreviews] = useState<ReelNarrationVoicePreview[]>([]);
  const [playingVoicePreviewId, setPlayingVoicePreviewId] = useState<string | null>(null);
  const [pendingAutoPlayVoicePreviewId, setPendingAutoPlayVoicePreviewId] = useState<string | null>(null);
  const playingVoicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [voicePreviewScope, setVoicePreviewScope] = useState<NarrationVoicePreviewScope>('1_beat');

  useEffect(() => {
    let cancelled = false;
    listNarrationPresetsAction()
      .then(({ presets, adminSettings }) => {
        if (cancelled) return;
        setNarrationPresets(presets);
        setReelNarrationAdminSettings(adminSettings);
        setReelNarrationDraft((current) => normalizeReelNarrationSettings(current, {
          storyLanguage: session.storyConfig.language,
          adminSettings,
        }));
      })
      .catch(() => {
        if (!cancelled) setNarrationPresets([]);
      });

    return () => {
      cancelled = true;
    };
  }, [session.storyConfig.language]);

  const [activeReaderPanel, setActiveReaderPanel] = useState<StoryReaderPanel>('story');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showStoryNarrationTiming, setShowStoryNarrationTiming] = useState(false);
  const [showStoryTextOverlay, setShowStoryTextOverlay] = useState(false);
  const [showStoryTransitions, setShowStoryTransitions] = useState(false);
  const [showStoryEffects, setShowStoryEffects] = useState(false);
  // Pack 1 beat-control dialogs
  const [showEditBeatText, setShowEditBeatText] = useState(false);
  const [showRegenerateImage, setShowRegenerateImage] = useState(false);
  const [showImageVersions, setShowImageVersions] = useState(false);
  const [showNarrationRegenConfirm, setShowNarrationRegenConfirm] = useState(false);
  const [optionsRegenState, setOptionsRegenState] = useState<
    | { step: 'confirm' }
    | { step: 'rewrite_confirm'; impact: TimelineImpact; message: string }
    | { step: 'running' }
    | null
  >(null);
  const [optionsRegenError, setOptionsRegenError] = useState<string | null>(null);

  // Pack 1 beat controls: owner-only, saved stories only, never in exploration.
  const canUseBeatControls =
    !session.explorationMode && !session.sourceStoryOwnerId && Boolean(session.savedStoryId);
  const beatIsLocked = hasActiveDescendants(session.storyMap, currentNodeId);
  const regenerateOptionsForNode = useStoryStore((state) => state.regenerateOptionsForNode);
  const beatControlSettings = useStoryStore((state) => state.beatControlSettings);

  // Pack 2 character universe: save-to-library affordance in the character
  // refs panel; owner-only like the beat controls.
  const characterUniverseSettings = useStoryStore((state) => state.characterUniverseSettings);
  const canSaveCharactersToLibrary =
    canUseBeatControls &&
    characterUniverseSettings.libraryEnabled &&
    characterUniverseSettings.globalSaveEnabled;
  const [savingLibraryCharacterId, setSavingLibraryCharacterId] = useState<string | null>(null);
  const [libraryCharacterNotice, setLibraryCharacterNotice] = useState<string | null>(null);
  const [libraryCharacterConflict, setLibraryCharacterConflict] = useState<{
    characterId: string;
    characterName: string;
    existingMaster: CharacterMaster;
  } | null>(null);
  const [savedLibraryCharacterIds, setSavedLibraryCharacterIds] = useState<Record<string, boolean>>({});

  const handleSaveCharacterToLibrary = useCallback(
    async (characterId: string, characterName: string, overwriteMasterId?: string) => {
      if (!session.savedStoryId || savingLibraryCharacterId) return;
      setSavingLibraryCharacterId(characterId);
      setLibraryCharacterNotice(null);
      try {
        const result = await saveCharacterToLibrary({
          storyId: session.savedStoryId,
          characterId,
          overwriteMasterId,
        });
        if (result.status === 'saved') {
          setSavedLibraryCharacterIds((prev) => ({ ...prev, [characterId]: true }));
          setLibraryCharacterConflict(null);
          setLibraryCharacterNotice(`${result.master.name} is now in your library.`);
          return;
        }
        if (result.status === 'conflict') {
          setLibraryCharacterConflict({
            characterId,
            characterName,
            existingMaster: result.existingMaster,
          });
          return;
        }
        setLibraryCharacterNotice(result.error);
      } catch (saveError) {
        setLibraryCharacterNotice(
          saveError instanceof Error ? saveError.message : 'Could not save the character.'
        );
      } finally {
        setSavingLibraryCharacterId(null);
      }
    },
    [session.savedStoryId, savingLibraryCharacterId]
  );

  const isCharacterInLibrary = useCallback(
    (characterId: string): boolean =>
      Boolean(
        savedLibraryCharacterIds[characterId] ||
          session.characters.find((character) => character.id === characterId)?.masterId
      ),
    [savedLibraryCharacterIds, session.characters]
  );

  // Pack 2 episodes: Continue-as-Episode entry point + series navigation
  // links (previous/next stories on the first and last beats). Nav results are
  // keyed by story id so switching stories never shows stale links.
  const [showContinueAsEpisode, setShowContinueAsEpisode] = useState(false);
  const [episodeNavByStory, setEpisodeNavByStory] = useState<Record<string, EpisodeNavigation>>({});
  const episodeNav = session.savedStoryId ? episodeNavByStory[session.savedStoryId] ?? null : null;
  const canContinueAsEpisode =
    canUseBeatControls &&
    characterUniverseSettings.episodesEnabled &&
    session.storyConfig.storyKind !== 'reel';

  useEffect(() => {
    const storyId = session.savedStoryId;
    if (!storyId) return;
    let cancelled = false;
    getEpisodeNavigation(storyId)
      .then((nav) => {
        if (!cancelled && (nav.parent || nav.children.length > 0)) {
          setEpisodeNavByStory((previous) => ({ ...previous, [storyId]: nav }));
        }
      })
      .catch(() => {
        /* navigation is decorative — ignore failures */
      });
    return () => {
      cancelled = true;
    };
  }, [session.savedStoryId]);

  const runOptionsRegeneration = useCallback(
    async (confirmTimelineRewrite: boolean) => {
      setOptionsRegenState({ step: 'running' });
      setOptionsRegenError(null);
      try {
        const result = await regenerateOptionsForNode(currentNodeId, confirmTimelineRewrite);
        if (result.status === 'requires_confirmation') {
          setOptionsRegenState({ step: 'rewrite_confirm', impact: result.impact, message: result.message });
          return;
        }
        if (result.status === 'failed') {
          setOptionsRegenError(result.error);
        }
        setOptionsRegenState(null);
      } catch (error) {
        setOptionsRegenError(error instanceof Error ? error.message : 'Failed to regenerate options.');
        setOptionsRegenState(null);
      }
    },
    [currentNodeId, regenerateOptionsForNode]
  );
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
  const [batchModeNotice, setBatchModeNotice] = useState(false);
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

  useEffect(() => {
    const storyId = session.savedStoryId;
    let cancelled = false;
    playingVoicePreviewAudioRef.current?.pause();
    playingVoicePreviewAudioRef.current = null;
    setVoicePreviews([]);
    setPlayingVoicePreviewId(null);
    setPendingAutoPlayVoicePreviewId(null);
    if (!isReelStory || !storyId) return () => {
      cancelled = true;
    };
    listReelNarrationVoicePreviewsAction(storyId, currentNodeId)
      .then((previews) => {
        if (!cancelled) setVoicePreviews(previews);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentNodeId, isReelStory, session.savedStoryId]);
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
  const persistedStoryId = session.savedStoryId || session.storySessionId;
  const mediaVersionFallback = session.sourceUpdatedAt || 'legacy';
  const imageAsset = useMemo<StoryMediaAsset | undefined>(() => {
    if (!persistenceUserId || !normalizedCurrentBeat.imageUrl || normalizedCurrentBeat.imageUrl.startsWith('data:')) return undefined;
    return {
      assetId: getStableMediaIdentity(normalizedCurrentBeat.imageUrl, 'image'),
      storyId: persistedStoryId,
      pageId: currentNodeId,
      userId: persistenceUserId,
      kind: 'image',
      remoteUrl: normalizedCurrentBeat.imageUrl,
      version: normalizedCurrentBeat.imageVersion || mediaVersionFallback,
    };
  }, [currentNodeId, mediaVersionFallback, normalizedCurrentBeat.imageUrl, normalizedCurrentBeat.imageVersion, persistedStoryId, persistenceUserId]);
  const audioAsset = useMemo<StoryMediaAsset | undefined>(() => {
    if (!persistenceUserId || !normalizedCurrentBeat.audioUrl || normalizedCurrentBeat.audioUrl.startsWith('data:')) return undefined;
    return {
      assetId: getStableMediaIdentity(normalizedCurrentBeat.audioUrl, 'audio'),
      storyId: persistedStoryId,
      pageId: currentNodeId,
      userId: persistenceUserId,
      kind: 'audio',
      remoteUrl: normalizedCurrentBeat.audioUrl,
      version: normalizedCurrentBeat.audioVersion || mediaVersionFallback,
    };
  }, [currentNodeId, mediaVersionFallback, normalizedCurrentBeat.audioUrl, normalizedCurrentBeat.audioVersion, persistedStoryId, persistenceUserId]);
  const resolvedBeatImage = useResolvedStoryMediaState(imageAsset);
  const resolvedBeatImageUrl = imageAsset ? resolvedBeatImage.url : normalizedCurrentBeat.imageUrl;
  const imageIsResolving = Boolean(imageAsset && resolvedBeatImage.isResolving);
  const resolvedBeatAudio = useResolvedStoryMediaState(audioAsset);
  const resolvedBeatAudioUrl = audioAsset ? resolvedBeatAudio.url : normalizedCurrentBeat.audioUrl;
  const audioIsResolving = Boolean(audioAsset && resolvedBeatAudio.isResolving);
  const [restoredAudioTimeMs, setRestoredAudioTimeMs] = useState(0);

  useEffect(() => {
    let active = true;
    setRestoredAudioTimeMs(0);
    if (!persistenceUserId || !session.savedStoryId) return;
    const readerKind = session.explorationMode ? 'explore' : 'story';
    void getStoryPersistence().getProgress({
      readerKind,
      storyId: session.savedStoryId,
      userId: persistenceUserId,
    }).then((progress) => {
      if (active && progress && progress.readerKind !== 'storyline' && progress.currentNodeId === currentNodeId) {
        setRestoredAudioTimeMs(progress.audioTimeMs);
      }
    });
    return () => { active = false; };
  }, [currentNodeId, persistenceUserId, session.explorationMode, session.savedStoryId]);
  const isPromptOnlyStory = session.storyConfig.imageGenerationMode === 'prompt_only';
  // Deferred-delivery stories (cost-saver batch or fast stateful) produce beat
  // images via a background job. Live per-beat (re)generation is disabled so an
  // accidental click can't defeat deferred mode.
  const isBatchDeliveryStory = session.storyConfig.imageDeliveryMode === 'batch'
    || session.storyConfig.imageDeliveryMode === 'stateful';
  const reelTimelineNodes = useMemo(
    () => (isReelStory ? getNodesByBeatNumber(session.storyMap) : undefined),
    [isReelStory, session.storyMap]
  );
  const reelBeatCount = reelTimelineNodes?.length ?? 0;
  const isSingleBeatReel = reelBeatCount <= 1;
  const [reelPlayAllActive, setReelPlayAllActive] = useState(false);
  const reelPlayAllNodeIdsRef = useRef<string[]>([]);
  const pendingReelPlayAllNodeIdRef = useRef<string | null>(null);
  const isVerticalStory = session.storyConfig.isVerticalStory || session.storyConfig.aspectRatio === '9:16';
  const isVerticalReaderStory = !isReelStory && isVerticalStory;
  const hasImpossibleImageState = hasBeatImpossibleImageState(normalizedCurrentBeat);
  const isStoryboard = Boolean(
    normalizedCurrentBeat.imageUrl
    && isStoryboardBeat(normalizedCurrentBeat, {
      assumeGeneratedStoryboard: !isReelStory && !isPromptOnlyStory,
    })
  );
  const displayImageUrl = normalizedCurrentBeat.portraitImageUrl || resolvedBeatImageUrl || (!imageAsset ? getBeatDisplayImageUrl(normalizedCurrentBeat) : undefined);
  const imageKey = resolvedBeatImageUrl || displayImageUrl;
  const visualKey = `${currentNodeId}:${normalizedCurrentBeat.portraitImageUrl ?? normalizedCurrentBeat.imageUrl ?? 'no-image'}`;
  const imageLoadFailed = !!imageKey && failedImageUrl === imageKey;
  const showResolvingImageState = imageIsResolving && Boolean(normalizedCurrentBeat.imageUrl);
  const showPendingImageState = !displayImageUrl && !showResolvingImageState && normalizedCurrentBeat.imageStatus === 'pending';
  // Server-pipeline job in flight: generation is durable server-side, so the
  // pending copy reassures the user the tab can be closed.
  const isServerImageJobPending = activeImageJobNodeIds.includes(currentNodeId)
    && normalizedCurrentBeat.imageStatus === 'pending';
  const showPromptOnlyPlaceholder = isPromptOnlyStory && !displayImageUrl && !showResolvingImageState && !showPendingImageState;
  const showFailedImageState = !showPromptOnlyPlaceholder && !displayImageUrl && !showResolvingImageState && (normalizedCurrentBeat.imageStatus === 'failed' || hasImpossibleImageState);
  const showSaveAlert = Boolean(saveWarning) && saveStatus !== 'unsaved';
  const canRegenerateImage = !isPromptOnlyStory && !isBatchDeliveryStory && (!normalizedCurrentBeat.imageUrl || isFallbackImageUrl(normalizedCurrentBeat.imageUrl) || imageLoadFailed);
  // In batch mode, surface a disabled image control that explains the batch flow
  // instead of silently generating a live image.
  const showBatchModeImageLock = isBatchDeliveryStory && !normalizedCurrentBeat.imageUrl;
  // In batch mode narration is bulk-generated via "Generate all narration", but
  // that server job can leave a beat unfilled (e.g. it stalled, or the beat was
  // added later). Per-beat generation stays available so the user can narrate an
  // individual / missing beat directly — same locked voice, same persist path.
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
  const activeFullVoicePreview = useMemo(
    () => (isReelStory
      ? voicePreviews.find((preview) => preview.isActive && preview.previewScope === 'full' && preview.audioUrl) ?? null
      : null),
    [isReelStory, voicePreviews]
  );
  const activeNarrationMetadata = activeFullVoicePreview?.generationMetadata
    ?? normalizedCurrentBeat.narrationMetadata
    ?? null;
  const activeNarrationHighlightSupported = activeNarrationMetadata?.textHighlightSupported === true;
  const currentBeatPlaybackAudioUrl = !reelPlayAllActive && activeFullVoicePreview?.audioUrl
    ? activeFullVoicePreview.audioUrl
    : resolvedBeatAudioUrl;
  const currentBeatPlaybackKey = isReelStory
    ? `${currentNodeId}:${reelPlayAllActive ? 'play-all' : activeFullVoicePreview?.id ?? 'beat-audio'}`
    : currentNodeId;
  const currentBeatForPlayback = useMemo(() => {
    if (!isReelStory || currentBeatPlaybackAudioUrl === normalizedCurrentBeat.audioUrl) {
      return normalizedCurrentBeat;
    }
    return {
      ...normalizedCurrentBeat,
      audioUrl: currentBeatPlaybackAudioUrl,
    };
  }, [currentBeatPlaybackAudioUrl, isReelStory, normalizedCurrentBeat]);
  const {
    playbackState,
    togglePlayPause,
    play: playAudio,
    pause: pauseAudio,
    stop: stopAudio,
    seekTo: seekAudio,
    currentTimeMs: reelAudioTimeMs,
    durationMs: reelAudioDurationMs,
    isMuted,
    toggleMute,
  } = useAudioPlayer(
    currentBeatPlaybackAudioUrl,
    currentBeatPlaybackKey,
    {
      onEnded: handleReelAudioEnded,
      initialTimeMs: restoredAudioTimeMs,
      onProgress: (audioTimeMs) => {
        if (!persistenceUserId || !session.savedStoryId) return;
        void saveTreeProgress({
          readerKind: session.explorationMode ? 'explore' : 'story',
          storyId: session.savedStoryId,
          userId: persistenceUserId,
          currentNodeId,
          audioTimeMs,
          completed: normalizedCurrentBeat.isEnding,
        });
      },
    }
  );
  const storyboardAudioDurationMs = reelAudioDurationMs > 0
    ? reelAudioDurationMs
    : normalizedCurrentBeat.narrationMetadata?.durationMs ?? 0;
  const storyPanelBoundariesMs = useMemo(
    () => getStoryboardPanelBoundariesMs(
      Math.max(1, storyboardAudioDurationMs),
      normalizedCurrentBeat.storyboardNarrationTiming
    ),
    [normalizedCurrentBeat.storyboardNarrationTiming, storyboardAudioDurationMs]
  );
  const storyTransitionPlayback = useStoryTransitionPlayback({
    enabled: !isReelStory && isStoryboard && storyboardAudioDurationMs > 0,
    narrationBoundariesMs: storyPanelBoundariesMs,
    settings: session.storyConfig.storyTransition,
    narrationTimeMs: reelAudioTimeMs,
    playbackState,
    pause: pauseAudio,
    play: playAudio,
    seekNarration: seekAudio,
  });

  // --- Interactive storyboard panel browsing --------------------------------
  // Viewers can swipe / tap the dots to move between storyboard panels. Doing so
  // pauses narration and hands them manual control, while the displayed panel is
  // mirrored into the reader text below (scroll-to + highlight). Pressing play
  // resumes auto-advance from wherever they left off.
  const [manualStoryboardPanel, setManualStoryboardPanel] = useState<number | null>(null);
  const [activeStoryboardPanel, setActiveStoryboardPanel] = useState(0);
  const manualStoryboardPanelRef = useRef<number | null>(null);
  useEffect(() => {
    manualStoryboardPanelRef.current = manualStoryboardPanel;
  }, [manualStoryboardPanel]);

  useEffect(() => {
    setManualStoryboardPanel(null);
    setActiveStoryboardPanel(0);
  }, [currentNodeId]);

  const handleStoryboardPanelSelect = useCallback((panelIndex: number) => {
    setManualStoryboardPanel(panelIndex);
    stopAutoScroll();
    if (playbackState === 'playing') pauseAudio();
  }, [pauseAudio, playbackState, stopAutoScroll]);

  useEffect(() => {
    // When narration resumes after manual browsing, jump the audio to the panel
    // the viewer left off on, then release manual control back to auto-advance.
    if (playbackState !== 'playing') return;
    const panel = manualStoryboardPanelRef.current;
    if (panel == null) return;
    const boundaryMs = storyPanelBoundariesMs[panel];
    if (typeof boundaryMs === 'number' && boundaryMs >= 0) seekAudio(boundaryMs);
    setManualStoryboardPanel(null);
  }, [playbackState, seekAudio, storyPanelBoundariesMs]);

  // Per-panel slices of the beat text, used to highlight the narration segment
  // that matches the visible storyboard panel. Only available once overlay
  // captions exist for the beat; otherwise the reader shows a plain paragraph.
  const storyReaderSegments = useMemo<string[] | null>(() => {
    if (isReelStory || !isStoryboard) return null;
    const captions = normalizedCurrentBeat.storyTextOverlayCaptions;
    if (!captions?.length) return null;
    const texts = Array.from({ length: STORYBOARD_PANEL_COUNT }, (_, index) => {
      const match = captions.find((caption) => caption.panelIndex === index);
      return match?.text?.trim() ?? '';
    });
    // Only segment the reader when every panel has text — a partial partition
    // would drop part of the story, so fall back to the plain paragraph instead.
    return texts.every((text) => text.length > 0) ? texts : null;
  }, [isReelStory, isStoryboard, normalizedCurrentBeat.storyTextOverlayCaptions]);

  const storyboardSegmentRefs = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    // Only chase the active segment while the viewer is browsing by hand — during
    // narration playback the existing auto-scroll owns the scroll position.
    if (manualStoryboardPanel == null || !storyReaderSegments) return;
    const container = scrollRef.current;
    const target = storyboardSegmentRefs.current[activeStoryboardPanel];
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta = (targetRect.top - containerRect.top)
      - (container.clientHeight / 2 - targetRect.height / 2);
    container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
  }, [activeStoryboardPanel, manualStoryboardPanel, scrollRef, storyReaderSegments]);
  const {
    exportVideo,
    cancel: cancelExport,
    isExporting,
    progress: exportProgress,
    phase: exportPhase,
    error: exportError,
    engine: exportEngine,
    stage: exportStage,
    fallbackReason: exportFallbackReason,
  } = useReelVideoExport();
  const isAudioReady = audioReadyNodeId === currentNodeId;
  const beatPromptText = buildBeatPromptCopyText(normalizedCurrentBeat);
  const characterPromptItems = buildCharacterPromptCopyItems(normalizedCurrentBeat, session);
  const promptToolsOpen = promptToolsModalState.view !== 'closed';
  const needsAttentionCharacters = characterPromptItems.filter((item) => !item.referenceSheetUrl && !item.generatedReferenceUrl);
  const readyInBeatCharacters = characterPromptItems.filter((item) => Boolean(item.referenceSheetUrl || item.generatedReferenceUrl));
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
    : 'Copy prompts, replace this beat image when needed, and add character refs only where continuity still needs them. Successful uploads return here automatically.';
  const promptToolsShellLabel = promptToolsModalState.view === 'beat-upload'
    ? 'Beat image upload tools'
    : promptToolsModalState.view === 'character-upload'
    ? 'Character sheet tools'
    : 'Prompt and image tools';
  const canOpenPromptTools = Boolean(isPromptOnlyStory || beatPromptText || characterPromptItems.length > 0);
  const isPromptToolsOverview = promptToolsModalState.view === 'overview';
  const isBeatUploadView = promptToolsModalState.view === 'beat-upload';
  const isCharacterUploadView = promptToolsModalState.view === 'character-upload';
  const activeCharacterGallery = activeCharacterPromptItem?.referenceSheetGallery ?? [];
  const activeCharacterGeneratedReferenceUrl = activeCharacterPromptItem?.generatedReferenceUrl;
  const activeCharacterStorageKey = activeCharacterPromptItem?.referenceSheetStorageKey;
  const activeCharacterHasSheet = Boolean(activeCharacterPromptItem?.referenceSheetUrl);
  const activeCharacterHasReference = Boolean(activeCharacterPromptItem?.referenceSheetUrl || activeCharacterPromptItem?.generatedReferenceUrl);
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

  // Ending call-to-actions. Rendered compactly (theme-toolbar scale) in two
  // spots: inline at the bottom of the story card on mobile, and as a right-hand
  // column on desktop so they're visible without scrolling past the last beat.
  // `fullWidth` stacks them as a vertical panel for the desktop column.
  const renderEndingActions = (fullWidth: boolean) => {
    const fw = fullWidth ? 'w-full justify-center' : '';
    return (
      <>
        {canContinueAsEpisode && (
          <button
            onClick={() => setShowContinueAsEpisode(true)}
            className={`bg-emerald-400 text-neutral-950 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-300 transition-colors flex items-center gap-2 ${fw}`}
          >
            <Clapperboard className="w-4 h-4" />
            Continue as Episode
          </button>
        )}
        {!lastPublishResult && onSave && canPublishStandardStoryline && (
          <button
            onClick={() => setShowPublishDialog(true)}
            className={`bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-500/30 transition-colors flex items-center gap-2 ${fw}`}
          >
            <Share2 className="w-4 h-4" />
            Publish Storyline
          </button>
        )}
        {!lastPublishResult && onSave && canPublishAudioStoryline && (
          <button
            onClick={() => setShowPublishDialog(true)}
            className={`bg-sky-500/20 text-sky-200 border border-sky-500/30 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-sky-500/30 transition-colors flex items-center gap-2 ${fw}`}
          >
            <Share2 className="w-4 h-4" />
            Publish as Audio Story
          </button>
        )}
        {!lastPublishResult && onSave && isPromptOnlyStory && !canPublishStandardStoryline && !cycleSettings.audioStorylinePublishEnabled && (
          <div className="max-w-xl rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
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
            className={`bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-500/30 transition-colors flex items-center gap-2 ${fw}`}
          >
            <Compass className="w-4 h-4" />
            Explore More Branches
          </button>
        )}
        <button
          onClick={resetStory}
          className={`bg-white text-black px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-neutral-200 transition-colors flex items-center gap-2 ${fw}`}
        >
          Start a New Story
        </button>
      </>
    );
  };

  const prevNodeIdForAutoplay = useRef<string | undefined>(undefined);
  const pendingStoryModeAutoplayNodeIdRef = useRef<string | null>(null);
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
  const savedReelOverlayEnabled = typeof normalizedCurrentBeat.reelTextOverlayEnabled === 'boolean'
    ? normalizedCurrentBeat.reelTextOverlayEnabled
    : session.storyConfig.reel.textOverlayEnabled !== false;
  const savedStoryTextOverlayEnabled = typeof normalizedCurrentBeat.storyTextOverlayEnabled === 'boolean'
    ? normalizedCurrentBeat.storyTextOverlayEnabled
    : session.storyConfig.storyTextOverlay.enabled;
  const savedStoryTextOverlayMode = normalizedCurrentBeat.storyTextOverlayMode
    || session.storyConfig.storyTextOverlay.mode;
  const savedStoryTextOverlayStyle = normalizedCurrentBeat.storyTextOverlayStyle
    || session.storyConfig.storyTextOverlay.style;
  const savedStoryTextOverlayHighlightSupported = normalizedCurrentBeat.storyTextOverlayAlignment?.textHighlightSupported !== false;
  const [reelPanelDraft, setReelPanelDraft] = useState<string[]>(savedReelPanelTexts);
  const [reelTextSaveState, setReelTextSaveState] = useState<'idle' | 'saving' | 'warning' | 'saved' | 'error'>('idle');
  const [reelTextMessage, setReelTextMessage] = useState<string | null>(null);
  const [reelOverlayEnabledDraft, setReelOverlayEnabledDraft] = useState(savedReelOverlayEnabled);
  const [reelOverlayDraft, setReelOverlayDraft] = useState<ReelTextOverlayStyle>(savedReelOverlayStyle);
  const [reelStyleSaveState, setReelStyleSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reelStyleMessage, setReelStyleMessage] = useState<string | null>(null);
  const savedReelTransitionSettings = useMemo(
    () => normalizeReelTransitionSettings(
      session.storyConfig.reel.transitionSettings ?? DEFAULT_REEL_TRANSITION_SETTINGS
    ),
    [session.storyConfig.reel.transitionSettings]
  );
  const savedReelNarrationSettings = useMemo(
    () => normalizeReelNarrationSettings(session.storyConfig.reel.narrationSettings, {
      storyLanguage: session.storyConfig.language,
      adminSettings: reelNarrationAdminSettings ?? undefined,
    }),
    [reelNarrationAdminSettings, session.storyConfig.language, session.storyConfig.reel.narrationSettings]
  );
  const [reelTransitionDraft, setReelTransitionDraft] = useState<ReelTransitionSettings>(
    savedReelTransitionSettings
  );
  const [reelTransitionSaveState, setReelTransitionSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [reelTransitionMessage, setReelTransitionMessage] = useState<string | null>(null);
  const normalizedReelOverlayDraft = useMemo(
    () => normalizeReelTextOverlayStyle(reelOverlayDraft),
    [reelOverlayDraft]
  );
  const normalizedReelTransitionDraft = useMemo(
    () => normalizeReelTransitionSettings(reelTransitionDraft),
    [reelTransitionDraft]
  );
  const effectiveReelNarrationAdminSettings = reelNarrationAdminSettings ?? DEFAULT_REEL_NARRATION_ADMIN_SETTINGS;
  const reelNarrationTier = pricing.snapshot.planKey;
  const reelNarrationLanguageValue = storyLanguageToNarrationLanguage(session.storyConfig.language);
  const reelNarrationLanguageOptions = useMemo(() => {
    const available = getAvailableReelNarrationLanguages(
      effectiveReelNarrationAdminSettings,
      reelNarrationTier
    );
    const configured = available.map((setting) => ({
      value: setting.language,
      label: setting.language === reelNarrationLanguageValue
        ? `Reel language (${session.storyConfig.language})`
        : setting.label,
    }));
    return configured.length > 0
      ? configured
      : [
          {
            value: reelNarrationLanguageValue,
            label: `Reel language (${session.storyConfig.language})`,
          },
          ...REEL_NARRATION_LANGUAGE_OPTIONS.filter((option) => option.value !== reelNarrationLanguageValue),
        ];
  }, [effectiveReelNarrationAdminSettings, reelNarrationLanguageValue, reelNarrationTier, session.storyConfig.language]);
  const selectedReelVoiceGender = reelNarrationDraft.voiceGender;
  const reelGenderVoiceList = useMemo(
    () => getReelNarrationVoiceOptions({
      adminSettings: effectiveReelNarrationAdminSettings,
      language: reelNarrationDraft.language,
      userTier: reelNarrationTier,
      gender: selectedReelVoiceGender,
    }),
    [effectiveReelNarrationAdminSettings, reelNarrationDraft.language, reelNarrationTier, selectedReelVoiceGender]
  );
  const allReelVoiceOptions = useMemo(
    () => getReelNarrationVoiceOptions({
      adminSettings: effectiveReelNarrationAdminSettings,
      language: reelNarrationDraft.language,
      userTier: reelNarrationTier,
    }),
    [effectiveReelNarrationAdminSettings, reelNarrationDraft.language, reelNarrationTier]
  );
  const selectedReelVoice = allReelVoiceOptions.find((voice) => voice.voiceId === reelNarrationDraft.voiceId)
    ?? reelGenderVoiceList.find((voice) => voice.voiceId === reelNarrationDraft.voiceId)
    ?? { voiceId: reelNarrationDraft.voiceId, label: reelNarrationDraft.voiceId };
  const reelVoiceDropdownOptions = useMemo(() => {
    const currentVoiceIsVisible = reelGenderVoiceList.some((voice) => voice.voiceId === reelNarrationDraft.voiceId);
    const options = reelGenderVoiceList.map((voice) => ({
      value: voice.voiceId,
      label: voice.label,
    }));
    return currentVoiceIsVisible || !reelNarrationDraft.voiceId
      ? options
      : [{ value: reelNarrationDraft.voiceId, label: selectedReelVoice.label }, ...options];
  }, [reelGenderVoiceList, reelNarrationDraft.voiceId, selectedReelVoice.label]);
  const reelPresetDropdownOptions = useMemo(() => [
    { value: '', label: 'Custom' },
    ...narrationPresets.map((preset) => ({ value: preset.id, label: preset.name })),
  ], [narrationPresets]);
  const selectedReelPreset = narrationPresets.find((preset) => preset.id === reelNarrationDraft.presetId);
  const selectedReelPresetIsUser = selectedReelPreset?.presetScope === 'user';
  const hasReelNarrationArtifacts = Boolean(
    normalizedCurrentBeat.audioUrl
    || normalizedCurrentBeat.audioStatus === 'ready'
    || normalizedCurrentBeat.audioStatus === 'pending'
    || normalizedCurrentBeat.narrationMetadata
    || normalizedCurrentBeat.activeNarrationPreviewId
    || voicePreviews.length > 0
  );
  const hasUnsavedReelText = isReelStory && reelPanelDraft.some((text, index) =>
    text.trim() !== (savedReelPanelTexts[index] || '').trim()
  );
  const isReelTextSaving = reelTextSaveState === 'saving';
  const hasUnsavedReelOverlayStyle = isReelStory
    && (
      reelOverlayEnabledDraft !== savedReelOverlayEnabled
      || reelOverlayStyleKey(reelOverlayDraft) !== reelOverlayStyleKey(savedReelOverlayStyle)
    );
  const isReelStyleSaving = reelStyleSaveState === 'saving';
  const hasUnsavedReelTransitionSettings = isReelStory
    && reelTransitionSettingsKey(reelTransitionDraft) !== reelTransitionSettingsKey(savedReelTransitionSettings);
  const isReelTransitionSaving = reelTransitionSaveState === 'saving';
  const hasUnsavedReelNarrationSettings = isReelStory
    && reelNarrationSettingsKey(reelNarrationDraft) !== reelNarrationSettingsKey(savedReelNarrationSettings);
  const activeFullPreviewMatchesNarrationDraft = Boolean(
    activeFullVoicePreview
    && reelNarrationSettingsKey(reelNarrationDraft) === reelNarrationSettingsKey(activeFullVoicePreview.settingsSnapshot)
  );
  const hasBlockingUnsavedReelNarrationSettings = hasUnsavedReelNarrationSettings && !activeFullPreviewMatchesNarrationDraft;
  const isReelNarrationSaving = reelNarrationSaveState === 'saving';
  const activeReelSectionHasUnsavedChanges = activeReelEditorSection === 'text'
    ? hasUnsavedReelText
    : activeReelEditorSection === 'style'
    ? hasUnsavedReelOverlayStyle
    : activeReelEditorSection === 'voice'
    ? hasBlockingUnsavedReelNarrationSettings
    : hasUnsavedReelTransitionSettings;
  const activeReelSectionIsSaving = activeReelEditorSection === 'text'
    ? isReelTextSaving
    : activeReelEditorSection === 'style'
    ? isReelStyleSaving
    : activeReelEditorSection === 'voice'
    ? isReelNarrationSaving
    : isReelTransitionSaving;
  const activeReelSectionLabel = activeReelEditorSection === 'text'
    ? 'panel text'
    : activeReelEditorSection === 'style'
    ? 'text settings'
    : activeReelEditorSection === 'voice'
    ? 'voice'
    : 'transitions';
  const reelEditorNavigationBlocked = activeReelSectionHasUnsavedChanges || activeReelSectionIsSaving;
  const reelDistributionBeats = isReelStory && publishPath ? publishPath.beats : [];
  const reelHasCompletePath = reelDistributionBeats.length > 0;
  const reelHasAllImages = reelHasCompletePath && reelDistributionBeats.every((beat) => {
    const normalizedBeat = normalizeBeatMediaFields(beat);
    return Boolean(normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl) && normalizedBeat.imageStatus === 'ready';
  });
  const reelHasAllAudio = reelHasCompletePath && reelDistributionBeats.every((beat) => {
    return hasFinalReelNarration(beat);
  });
  const reelHasAnyFinalNarration = reelDistributionBeats.some(hasFinalReelNarration);
  const reelHasPendingWork = isGeneratingAudio || isRegeneratingImage || showPendingImageState;
  const reelReadyForDistribution = Boolean(
    isReelStory &&
    isEnding &&
    reelHasAllImages &&
    reelHasAllAudio &&
    !hasUnsavedReelText &&
    !hasUnsavedReelOverlayStyle &&
    !hasUnsavedReelTransitionSettings &&
    !hasBlockingUnsavedReelNarrationSettings &&
    !reelHasPendingWork
  );
  const reelDistributionBlockReason = !isEnding
    ? 'Finish generating the reel first.'
    : !reelHasAllImages
    ? 'Reel publishing and export need an image on every beat.'
    : !reelHasAllAudio && !isSingleBeatReel && reelHasAnyFinalNarration
    ? 'Generate narration for all beats to enable export.'
    : !reelHasAllAudio
    ? 'Generate narration before publishing or exporting.'
    : hasUnsavedReelText
    ? 'Save panel text before publishing or exporting.'
    : hasUnsavedReelOverlayStyle
    ? 'Save text settings before publishing or exporting.'
    : hasUnsavedReelTransitionSettings
    ? 'Save transitions before publishing or exporting.'
    : hasBlockingUnsavedReelNarrationSettings
    ? 'Save voice settings before publishing or exporting.'
    : reelHasPendingWork
    ? 'Wait for image and narration generation to finish.'
    : null;
  const reelPlayableNodes = useMemo(
    () => (reelTimelineNodes ?? []).filter((node) => {
      const normalizedBeat = normalizeBeatMediaFields(node.data);
      return Boolean(normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl)
        && normalizedBeat.imageStatus === 'ready'
        && hasFinalReelNarration(normalizedBeat);
    }),
    [reelTimelineNodes]
  );
  const reelBeatsNeedingNarration = useMemo(
    () => (reelTimelineNodes ?? []).filter((node) => !hasFinalReelNarration(node.data)),
    [reelTimelineNodes]
  );
  const shouldHighlightGenerateAllNarration = Boolean(
    isReelStory
    && !isSingleBeatReel
    && reelHasAnyFinalNarration
    && !reelHasAllAudio
  );
  const generateNarrationCtaLabel = isSingleBeatReel
    ? 'Generate narration'
    : 'Generate narration for all beats';
  const generateNarrationCtaTitle = shouldHighlightGenerateAllNarration
    ? 'Generate narration for all beats to enable export.'
    : generateNarrationCtaLabel;
  const reelPreviewSequence = useMemo(
    () => reelPlayableNodes.map((node) => {
      const beat = normalizeBeatMediaFields(node.data);
      return {
        beat,
        imageUrl: (beat.imageUrl || beat.persistedImageUrl)!,
        audioUrl: beat.audioUrl,
        nodeId: node.id,
      };
    }),
    [reelPlayableNodes]
  );
  const canPlayFullReel = Boolean(
    isReelStory
    && reelTimelineNodes?.length
    && reelPlayableNodes.length === reelTimelineNodes.length
    && !hasUnsavedReelText
    && !hasUnsavedReelOverlayStyle
    && !hasUnsavedReelTransitionSettings
    && !hasBlockingUnsavedReelNarrationSettings
    && !reelHasPendingWork
  );
  const canPlayCurrentBeat = Boolean(
    isReelStory
    && normalizedCurrentBeat.imageUrl
    && currentBeatPlaybackAudioUrl
  );
  const narrationIsResolving = Boolean(normalizedCurrentBeat.audioUrl && !currentBeatPlaybackAudioUrl && audioIsResolving);
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
    return stripUnsupportedWordTimings({
      ...normalizedBeat,
      imageUrl: normalizedBeat.imageUrl || normalizedBeat.persistedImageUrl,
    });
  });
  const isCompatibilityExport = exportEngine === 'compatibility';
  const exportPhaseLabel = exportStage === 'checking'
    ? 'Checking fast export'
    : exportStage === 'preparing'
    ? 'Preparing reel assets'
    : exportStage === 'rendering'
    ? 'Rendering reel frames'
    : exportStage === 'audio'
    ? 'Adding narration'
    : exportStage === 'finalizing'
    ? 'Finishing video'
    : exportStage === 'compatibility-loading'
    ? 'Loading compatibility encoder'
    : exportStage === 'compatibility-preparing'
    ? 'Preparing compatibility frames'
    : exportStage === 'compatibility-rendering'
    ? 'Encoding compatibility video'
    : 'Finishing compatibility video';
  const exportSteps = isCompatibilityExport
    ? [
        { key: 'compatibility-loading', label: 'Load' },
        { key: 'compatibility-preparing', label: 'Frames' },
        { key: 'compatibility-rendering', label: 'Encode' },
        { key: 'compatibility-finalizing', label: 'Finish' },
      ]
    : [
        { key: 'checking', label: 'Check' },
        { key: 'preparing', label: 'Assets' },
        { key: 'rendering', label: 'Frames' },
        { key: 'audio', label: 'Audio' },
        { key: 'finalizing', label: 'Finish' },
      ];
  const activeExportStepIndex = Math.max(0, exportSteps.findIndex((step) => step.key === exportStage));

  useEffect(() => {
    setReelPanelDraft(savedReelPanelTexts);
    setReelTextSaveState('idle');
    setReelTextMessage(null);
    setReelEditorNavigationMessage(null);
  }, [currentNodeId, savedReelPanelTexts]);

  useEffect(() => {
    setReelOverlayEnabledDraft(savedReelOverlayEnabled);
    setReelOverlayDraft(savedReelOverlayStyle);
    setReelStyleSaveState('idle');
    setReelStyleMessage(null);
  }, [savedReelOverlayEnabled, savedReelOverlayStyle]);

  useEffect(() => {
    setReelTransitionDraft(savedReelTransitionSettings);
    setReelTransitionSaveState('idle');
    setReelTransitionMessage(null);
  }, [savedReelTransitionSettings]);

  useEffect(() => {
    setReelNarrationDraft(savedReelNarrationSettings);
    setReelNarrationSaveState('idle');
    setReelNarrationMessage(null);
  }, [savedReelNarrationSettings]);

  const updateReelSettingsFade = useCallback(() => {
    const element = reelSettingsScrollRef.current;
    if (!element) return;
    const next = {
      top: element.scrollTop > 1,
      bottom: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
    };
    setReelSettingsFade((current) => (
      current.top === next.top && current.bottom === next.bottom ? current : next
    ));
  }, []);

  useEffect(() => {
    if (!isReelStory) return;
    const element = reelSettingsScrollRef.current;
    if (!element) return;
    element.scrollTop = 0;
    updateReelSettingsFade();
  }, [activeReelEditorSection, isReelStory, reelMobilePreviewMode, updateReelSettingsFade]);

  useEffect(() => {
    if (!isReelStory) return;
    const element = reelSettingsScrollRef.current;
    if (!element) return;
    updateReelSettingsFade();
    const observer = new ResizeObserver(updateReelSettingsFade);
    observer.observe(element);
    if (element.firstElementChild instanceof HTMLElement) {
      observer.observe(element.firstElementChild);
    }
    window.addEventListener('resize', updateReelSettingsFade);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateReelSettingsFade);
    };
  }, [
    activeReelEditorSection,
    hasUnsavedReelOverlayStyle,
    hasUnsavedReelText,
    hasUnsavedReelTransitionSettings,
    isReelStory,
    reelMobilePreviewMode,
    reelStyleMessage,
    reelTextMessage,
    reelTransitionMessage,
    updateReelSettingsFade,
  ]);

  const changeReelMobilePreviewMode = useCallback((mode: ReelMobilePreviewMode) => {
    setReelMobilePreviewMode(mode);
  }, []);

  const updateReelPanelDraft = useCallback((panelIndex: number, value: string) => {
    setReelPanelDraft((current) =>
      Array.from({ length: REEL_PANEL_COUNT }, (_, index) => (
        index === panelIndex ? value : current[index] || ''
      ))
    );
    setReelTextSaveState('idle');
    setReelTextMessage(null);
  }, []);

  const selectReelEditorSection = useCallback((section: ReelEditorSection) => {
    if (section === activeReelEditorSection) return;
    if (reelEditorNavigationBlocked) {
      setReelEditorNavigationMessage(`Save or cancel your ${activeReelSectionLabel} changes before opening another setting.`);
      return;
    }
    setActiveReelEditorSection(section);
    setReelEditorNavigationMessage(null);
  }, [activeReelEditorSection, activeReelSectionLabel, reelEditorNavigationBlocked]);

  const handleSaveReelText = useCallback(async (confirmClearNarration = false) => {
    if (!isReelStory || !hasUnsavedReelText || isReelTextSaving) return;

    if (hasReelNarrationArtifacts && !confirmClearNarration) {
      setReelTextSaveState('warning');
      setReelTextMessage('Saving text will clear the existing narration and voice previews for this beat.');
      return;
    }

    setReelTextSaveState('saving');
    setReelTextMessage(null);

    try {
      const result = await updateReelPanelCaptions(currentNodeId, reelPanelDraft);
      if (result.deletedPreviewIds.length > 0) {
        playingVoicePreviewAudioRef.current?.pause();
        playingVoicePreviewAudioRef.current = null;
        setPlayingVoicePreviewId(null);
        setPendingAutoPlayVoicePreviewId(null);
        const deletedPreviewIds = new Set(result.deletedPreviewIds);
        setVoicePreviews((current) => current.filter((preview) => !deletedPreviewIds.has(preview.id)));
      }
      setReelTextSaveState('saved');
      setReelTextMessage(result.clearedNarration
        ? 'Text saved. Narration was cleared.'
        : 'Text saved.');
      setReelEditorNavigationMessage(null);
    } catch (error) {
      setReelTextSaveState('error');
      setReelTextMessage(error instanceof Error ? error.message : 'Failed to save reel text.');
    }
  }, [
    currentNodeId,
    hasReelNarrationArtifacts,
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
    setReelEditorNavigationMessage(null);
  }, [savedReelPanelTexts]);

  const updateReelOverlayDraft = useCallback((patch: ReelTextOverlayStyle) => {
    setReelOverlayDraft((current) => normalizeReelTextOverlayStyle({
      ...current,
      ...patch,
    }));
    setReelStyleSaveState('idle');
    setReelStyleMessage(null);
  }, []);

  const updateReelOverlayEnabledDraft = useCallback((enabled: boolean) => {
    setReelOverlayEnabledDraft(enabled);
    setReelStyleSaveState('idle');
    setReelStyleMessage(null);
  }, []);

  const handleCancelReelOverlayStyle = useCallback(() => {
    setReelOverlayEnabledDraft(savedReelOverlayEnabled);
    setReelOverlayDraft(savedReelOverlayStyle);
    setReelStyleSaveState('idle');
    setReelStyleMessage(null);
    setReelEditorNavigationMessage(null);
  }, [savedReelOverlayEnabled, savedReelOverlayStyle]);

  const handleSaveReelOverlayStyle = useCallback(async () => {
    if (!isReelStory || !hasUnsavedReelOverlayStyle || isReelStyleSaving) return;

    setReelStyleSaveState('saving');
    setReelStyleMessage(null);

    try {
      await updateReelTextOverlaySettings({
        enabled: reelOverlayEnabledDraft,
        style: reelOverlayDraft,
      });
      setReelStyleSaveState('saved');
      setReelStyleMessage(null);
      setReelEditorNavigationMessage(null);
    } catch (error) {
      setReelStyleSaveState('error');
      setReelStyleMessage(error instanceof Error ? error.message : 'Failed to save text settings.');
    }
  }, [
    hasUnsavedReelOverlayStyle,
    isReelStory,
    isReelStyleSaving,
    reelOverlayEnabledDraft,
    reelOverlayDraft,
    updateReelTextOverlaySettings,
  ]);

  const updateReelTransitionDraft = useCallback((settings: ReelTransitionSettings) => {
    setReelTransitionDraft(normalizeReelTransitionSettings(settings));
    setReelTransitionSaveState('idle');
    setReelTransitionMessage(null);
  }, []);

  const handleCancelReelTransitionSettings = useCallback(() => {
    setReelTransitionDraft(savedReelTransitionSettings);
    setReelTransitionSaveState('idle');
    setReelTransitionMessage(null);
    setReelEditorNavigationMessage(null);
  }, [savedReelTransitionSettings]);

  const handleSaveReelTransitionSettings = useCallback(async () => {
    if (!isReelStory || !hasUnsavedReelTransitionSettings || isReelTransitionSaving) return;

    setReelTransitionSaveState('saving');
    setReelTransitionMessage(null);
    try {
      await updateReelTransitionSettings(normalizedReelTransitionDraft);
      setReelTransitionSaveState('idle');
      setReelEditorNavigationMessage(null);
    } catch (error) {
      setReelTransitionSaveState('error');
      setReelTransitionMessage(error instanceof Error ? error.message : 'Failed to save transitions.');
    }
  }, [
    hasUnsavedReelTransitionSettings,
    isReelStory,
    isReelTransitionSaving,
    normalizedReelTransitionDraft,
    updateReelTransitionSettings,
  ]);

  const updateReelNarrationDraft = useCallback((patch: Partial<ReelNarrationSettings>) => {
    setReelNarrationDraft((current) => normalizeReelNarrationSettings({
      ...current,
      ...patch,
    }, {
      storyLanguage: session.storyConfig.language,
      adminSettings: reelNarrationAdminSettings ?? undefined,
    }));
    setReelNarrationSaveState('idle');
    setReelNarrationMessage(null);
  }, [reelNarrationAdminSettings, session.storyConfig.language]);

  const handleReelVoiceGenderChange = useCallback((voiceGender: NarrationVoiceGender) => {
    const voices = getReelNarrationVoiceOptions({
      adminSettings: effectiveReelNarrationAdminSettings,
      language: reelNarrationDraft.language,
      userTier: reelNarrationTier,
      gender: voiceGender,
    });
    const currentVoiceFitsGender = voices.some((voice) => voice.voiceId === reelNarrationDraft.voiceId);
    updateReelNarrationDraft({
      voiceGender,
      voiceId: currentVoiceFitsGender
        ? reelNarrationDraft.voiceId
        : voices[0]?.voiceId ?? reelNarrationDraft.voiceId,
    });
  }, [
    effectiveReelNarrationAdminSettings,
    reelNarrationDraft.language,
    reelNarrationDraft.voiceId,
    reelNarrationTier,
    updateReelNarrationDraft,
  ]);

  const handleCancelReelNarrationSettings = useCallback(() => {
    setReelNarrationDraft(savedReelNarrationSettings);
    setReelNarrationSaveState('idle');
    setReelNarrationMessage(null);
    setReelEditorNavigationMessage(null);
  }, [savedReelNarrationSettings]);

  const handleReelNarrationPresetChange = useCallback((presetId: string) => {
    const preset = narrationPresets.find((item) => item.id === presetId);
    if (!preset) {
      updateReelNarrationDraft({ presetId: null });
      return;
    }
    setReelNarrationDraft((current) => {
      const next = applyPresetToNarrationSettings(
        current,
        preset,
        reelNarrationAdminSettings ?? undefined
      );
      return {
        ...next,
        voiceGender: current.voiceGender,
        voiceId: current.voiceId,
      };
    });
    setReelNarrationSaveState('idle');
    setReelNarrationMessage(null);
  }, [narrationPresets, reelNarrationAdminSettings, updateReelNarrationDraft]);

  const stopPlayingVoicePreview = useCallback(() => {
    playingVoicePreviewAudioRef.current?.pause();
    playingVoicePreviewAudioRef.current = null;
    setPlayingVoicePreviewId(null);
  }, []);

  const playVoicePreviewAudio = useCallback((preview: ReelNarrationVoicePreview) => {
    stopPlayingVoicePreview();
    if (!preview.audioUrl) return;

    const audio = new Audio(preview.audioUrl);
    audio.onended = () => {
      if (playingVoicePreviewAudioRef.current === audio) {
        playingVoicePreviewAudioRef.current = null;
      }
      setPlayingVoicePreviewId((current) => (current === preview.id ? null : current));
    };
    playingVoicePreviewAudioRef.current = audio;
    setPlayingVoicePreviewId(preview.id);
    audio.play()
      .catch(() => {
        if (playingVoicePreviewAudioRef.current === audio) {
          playingVoicePreviewAudioRef.current = null;
        }
        setPlayingVoicePreviewId((current) => (current === preview.id ? null : current));
      });
  }, [stopPlayingVoicePreview]);

  useEffect(() => {
    if (!pendingAutoPlayVoicePreviewId) return;
    const preview = voicePreviews.find((candidate) => candidate.id === pendingAutoPlayVoicePreviewId);
    if (!preview) return;

    setPendingAutoPlayVoicePreviewId(null);
    playVoicePreviewAudio(preview);
  }, [pendingAutoPlayVoicePreviewId, playVoicePreviewAudio, voicePreviews]);

  const handlePreviewReelNarrationSettings = useCallback(async () => {
    if (isPreviewingReelNarration) return;
    setIsPreviewingReelNarration(true);
    setReelNarrationMessage(null);
    setPendingAutoPlayVoicePreviewId(null);
    stopPlayingVoicePreview();
    try {
      const previewText = voicePreviewScope === 'full'
        ? normalizedCurrentBeat.storyText
        // Sample = one panel caption (short sample, clearly distinct from full beat)
        : normalizedCurrentBeat.reelCaptions?.[0]?.text
          ?? splitTextIntoCompleteCaptionPanels(normalizedCurrentBeat.storyText, REEL_PANEL_COUNT)[0]
          ?? normalizedCurrentBeat.storyText;
      const previewCaptions = voicePreviewScope === 'full'
        ? normalizedCurrentBeat.reelCaptions
        : [{
            panelIndex: 0,
            text: previewText,
          }];

      const result = await previewReelNarrationAction({
        text: previewText,
        settings: reelNarrationDraft,
        scope: voicePreviewScope,
        reelCaptions: previewCaptions,
        storyLanguage: session.storyConfig.language,
        panelPauseMs: normalizedReelTransitionDraft.pauseMs,
      });
      setReelNarrationDraft(result.settings);

      if (!session.savedStoryId) return;
      const saved = await saveReelNarrationVoicePreviewAction({
        storyId: session.savedStoryId,
        nodeId: currentNodeId,
        audioDataUrl: result.audioUrl,
        settings: result.settings,
        scope: voicePreviewScope,
        voiceDisplayName: selectedReelVoice.label,
        generationMetadata: {
          ...result.narrationMetadata,
          scope: voicePreviewScope === 'full' ? 'full' : 'sample',
          voiceName: selectedReelVoice.label,
        },
        reelCaptions: result.reelCaptions,
      });
      // Prefer data URL for immediate playback; R2 signed URL is a fallback for reloaded sessions
      const savedWithAudio = { ...saved, audioUrl: result.audioUrl ?? saved.audioUrl };
      setVoicePreviews((prev) => {
        const without = prev.filter((p) => p.id !== savedWithAudio.id);
        return [...without, savedWithAudio].slice(-MAX_VOICE_PREVIEWS_LOCAL);
      });
      setPendingAutoPlayVoicePreviewId(savedWithAudio.id);
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to preview voice.');
    } finally {
      setIsPreviewingReelNarration(false);
    }
  }, [
    isPreviewingReelNarration,
    currentNodeId,
    voicePreviewScope,
    normalizedCurrentBeat.reelCaptions,
    normalizedCurrentBeat.storyText,
    normalizedReelTransitionDraft.pauseMs,
    reelNarrationDraft,
    session.storyConfig.language,
    session.savedStoryId,
    selectedReelVoice.label,
    stopPlayingVoicePreview,
  ]);

  const handlePlayVoicePreview = useCallback((preview: ReelNarrationVoicePreview) => {
    if (playingVoicePreviewId === preview.id) {
      stopPlayingVoicePreview();
      return;
    }
    playVoicePreviewAudio(preview);
  }, [playVoicePreviewAudio, playingVoicePreviewId, stopPlayingVoicePreview]);

  const applyVoicePreviewResultToLocalBeat = useCallback((
    result: ApplyReelNarrationPreviewResult,
    targetNodeId: string,
    fallbackAudioUrl?: string | null
  ) => {
    useStoryStore.setState((state) => {
      const currentSession = state.session;
      const node = currentSession?.storyMap.nodes[targetNodeId];
      if (!currentSession || !node) return state;
      const appliedAudioUrl = result.preview.activeNarration?.audioUrl
        ?? result.preview.audioR2Key
        ?? result.preview.audioUrl
        ?? fallbackAudioUrl;
      const narrationMetadata = result.preview.activeNarration
        ?? (result.preview.generationMetadata
          ? {
              ...result.preview.generationMetadata,
              previewId: result.preview.id,
              scope: 'full' as const,
            }
          : undefined);
      const updatedMap = {
        ...currentSession.storyMap,
        nodes: {
          ...currentSession.storyMap.nodes,
          [targetNodeId]: {
            ...node,
            data: normalizeBeatMediaFields({
              ...node.data,
              audioUrl: appliedAudioUrl || node.data.audioUrl,
              audioStatus: 'ready',
              audioError: undefined,
              narrationVoiceId: result.settings.voiceId,
              narrationMetadata,
              activeNarrationPreviewId: result.preview.id,
              ...(result.preview.reelCaptions?.length ? { reelCaptions: result.preview.reelCaptions } : {}),
            }),
          },
        },
      };
      return {
        ...state,
        session: {
          ...currentSession,
          storyMap: updatedMap,
        },
      };
    });
  }, []);

  const handleApplyVoicePreview = useCallback(async (preview: ReelNarrationVoicePreview) => {
    if (preview.previewScope !== 'full') {
      setReelNarrationMessage('Only full beat previews can be applied.');
      return;
    }
    try {
      stopPlayingVoicePreview();
      const result = await applyReelNarrationVoicePreviewAction(preview.id, currentNodeId);
      setReelNarrationDraft(result.settings);
      setVoicePreviews((prev) => prev.map((p) => (
        p.id === preview.id
          ? { ...p, ...result.preview, audioUrl: preview.audioUrl ?? result.preview.audioUrl, isActive: true }
          : { ...p, isActive: false, activeNarration: undefined }
      )));
      applyVoicePreviewResultToLocalBeat(result, currentNodeId, preview.audioUrl);
      setReelNarrationMessage(result.preview.generationMetadata?.textHighlightSupported
        ? 'Full preview applied to beat playback with word highlight.'
        : 'Full preview applied. Text highlight is unavailable for this narration.');
    } catch (error) {
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to apply preview.');
    }
  }, [applyVoicePreviewResultToLocalBeat, currentNodeId, setReelNarrationDraft, stopPlayingVoicePreview]);

  const handleDeleteVoicePreview = useCallback(async (previewId: string) => {
    if (playingVoicePreviewId === previewId) stopPlayingVoicePreview();
    const deletingActivePreview = voicePreviews.find((preview) => preview.id === previewId)?.isActive === true;
    try {
      await deleteReelNarrationVoicePreviewAction(previewId);
      setVoicePreviews((prev) => prev.filter((p) => p.id !== previewId));
      if (deletingActivePreview) {
        useStoryStore.setState((state) => {
          const currentSession = state.session;
          const node = currentSession?.storyMap.nodes[currentNodeId];
          if (!currentSession || !node) return state;
          return {
            ...state,
            session: {
              ...currentSession,
              storyMap: {
                ...currentSession.storyMap,
                nodes: {
                  ...currentSession.storyMap.nodes,
                  [currentNodeId]: {
                    ...node,
                    data: normalizeBeatMediaFields({
                      ...node.data,
                      audioUrl: undefined,
                      audioStatus: 'not_requested',
                      audioError: undefined,
                      narrationMetadata: undefined,
                      activeNarrationPreviewId: undefined,
                    }),
                  },
                },
              },
            },
          };
        });
      }
    } catch {
      // best-effort
    }
  }, [currentNodeId, playingVoicePreviewId, stopPlayingVoicePreview, voicePreviews]);

  const getVoiceDisplayNameForSettings = useCallback((settings: ReelNarrationSettings): string => {
    const voiceOptions = getReelNarrationVoiceOptions({
      adminSettings: effectiveReelNarrationAdminSettings,
      language: settings.language,
      userTier: reelNarrationTier,
      gender: settings.voiceGender,
    });
    return voiceOptions.find((voice) => voice.voiceId === settings.voiceId)?.label
      ?? allReelVoiceOptions.find((voice) => voice.voiceId === settings.voiceId)?.label
      ?? settings.voiceId;
  }, [allReelVoiceOptions, effectiveReelNarrationAdminSettings, reelNarrationTier]);

  const generateAndApplyFullNarrationPreview = useCallback(async (
    nodeId: string,
    settingsSeed: ReelNarrationSettings
  ): Promise<ApplyReelNarrationPreviewResult | null> => {
    const latestSession = useStoryStore.getState().session ?? session;
    const node = latestSession.storyMap.nodes[nodeId];
    if (!node) return null;

    if (!latestSession.savedStoryId) {
      await generateNarrationForNode(nodeId);
      return null;
    }

    const beat = normalizeBeatMediaFields(node.data);
    const settings = normalizeReelNarrationSettings(settingsSeed, {
      storyLanguage: latestSession.storyConfig.language,
      adminSettings: effectiveReelNarrationAdminSettings,
    });
    const result = await previewReelNarrationAction({
      text: beat.storyText,
      settings,
      scope: 'full',
      reelCaptions: beat.reelCaptions,
      storyLanguage: latestSession.storyConfig.language,
      panelPauseMs: normalizeReelTransitionSettings(latestSession.storyConfig.reel.transitionSettings).pauseMs,
    });
    const saved = await saveReelNarrationVoicePreviewAction({
      storyId: latestSession.savedStoryId,
      nodeId,
      audioDataUrl: result.audioUrl,
      settings: result.settings,
      scope: 'full',
      voiceDisplayName: getVoiceDisplayNameForSettings(result.settings),
      generationMetadata: {
        ...result.narrationMetadata,
        scope: 'full',
        voiceName: getVoiceDisplayNameForSettings(result.settings),
      },
      reelCaptions: result.reelCaptions,
    });
    const applied = await applyReelNarrationVoicePreviewAction(saved.id, nodeId);
    applyVoicePreviewResultToLocalBeat(applied, nodeId, result.audioUrl);

    if (nodeId === currentNodeId) {
      const generatedPreview = {
        ...saved,
        ...applied.preview,
        audioUrl: result.audioUrl ?? applied.preview.audioUrl ?? saved.audioUrl,
        isActive: true,
      };
      setVoicePreviews((prev) => {
        const cleared = prev.map((preview) => ({ ...preview, isActive: false, activeNarration: undefined }));
        const withoutGenerated = cleared.filter((preview) => preview.id !== generatedPreview.id);
        return [...withoutGenerated, generatedPreview].slice(-MAX_VOICE_PREVIEWS_LOCAL);
      });
    }

    return applied;
  }, [
    applyVoicePreviewResultToLocalBeat,
    currentNodeId,
    effectiveReelNarrationAdminSettings,
    generateNarrationForNode,
    getVoiceDisplayNameForSettings,
    session,
  ]);

  const handleSaveReelNarrationSettings = useCallback(async () => {
    if (!isReelStory || !hasUnsavedReelNarrationSettings || isReelNarrationSaving) return;

    setReelNarrationSaveState('saving');
    setReelNarrationMessage(null);
    try {
      const result = await updateReelNarrationSettings(reelNarrationDraft, {
        preserveExistingNarration: activeFullPreviewMatchesNarrationDraft,
      });
      setReelNarrationSaveState('idle');
      setReelNarrationMessage(result.clearedNarration ? 'Voice saved. Existing narration was cleared.' : 'Voice saved.');
      setReelEditorNavigationMessage(null);
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to save voice settings.');
    }
  }, [
    activeFullPreviewMatchesNarrationDraft,
    hasUnsavedReelNarrationSettings,
    isReelNarrationSaving,
    isReelStory,
    reelNarrationDraft,
    updateReelNarrationSettings,
  ]);

  const handleSaveReelNarrationPreset = useCallback(async () => {
    const name = window.prompt('Preset name', 'My Kissago Voice');
    if (!name?.trim()) return;
    setReelNarrationMessage(null);
    try {
      const created = await saveNarrationSettingsAsPresetAction({
        settings: reelNarrationDraft,
        name: name.trim(),
      });
      setNarrationPresets((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setReelNarrationDraft((current) => normalizeReelNarrationSettings({
        ...current,
        presetId: created.id,
      }, {
        storyLanguage: session.storyConfig.language,
        adminSettings: reelNarrationAdminSettings ?? undefined,
      }));
      setReelNarrationMessage('Preset saved.');
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to save preset.');
    }
  }, [reelNarrationAdminSettings, reelNarrationDraft, session.storyConfig.language]);

  const handleUpdateReelNarrationPreset = useCallback(async () => {
    if (!reelNarrationDraft.presetId) return;
    const preset = narrationPresets.find((item) => item.id === reelNarrationDraft.presetId);
    if (!preset || preset.presetScope !== 'user') return;
    try {
      const updated = await updateNarrationPresetAction(preset.id, {
        ...preset,
        ...reelNarrationDraft,
      });
      setNarrationPresets((current) => current.map((item) => item.id === updated.id ? updated : item));
      setReelNarrationMessage('Preset updated.');
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to update preset.');
    }
  }, [narrationPresets, reelNarrationDraft]);

  const handleSetDefaultReelNarrationPreset = useCallback(async () => {
    if (!reelNarrationDraft.presetId) return;
    const preset = narrationPresets.find((item) => item.id === reelNarrationDraft.presetId);
    if (!preset || preset.presetScope !== 'user') return;
    try {
      await saveDefaultNarrationPresetAction(preset.id);
      setNarrationPresets((current) => current.map((item) => (
        item.presetScope === 'user'
          ? { ...item, isDefault: item.id === preset.id }
          : item
      )));
      setReelNarrationMessage('Default preset updated.');
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to set default preset.');
    }
  }, [narrationPresets, reelNarrationDraft.presetId]);

  const handleDuplicateReelNarrationPreset = useCallback(async () => {
    if (!reelNarrationDraft.presetId) return;
    try {
      const copy = await duplicateNarrationPresetAction(reelNarrationDraft.presetId);
      setNarrationPresets((current) => [...current, copy].sort((a, b) => a.name.localeCompare(b.name)));
      setReelNarrationDraft((current) => normalizeReelNarrationSettings({
        ...current,
        presetId: copy.id,
      }, {
        storyLanguage: session.storyConfig.language,
        adminSettings: reelNarrationAdminSettings ?? undefined,
      }));
      setReelNarrationMessage('Preset duplicated.');
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to duplicate preset.');
    }
  }, [reelNarrationAdminSettings, reelNarrationDraft.presetId, session.storyConfig.language]);

  const handleDeleteReelNarrationPreset = useCallback(async () => {
    if (!reelNarrationDraft.presetId) return;
    const preset = narrationPresets.find((item) => item.id === reelNarrationDraft.presetId);
    if (!preset || preset.presetScope !== 'user') return;
    try {
      await deleteNarrationPresetAction(preset.id);
      setNarrationPresets((current) => current.filter((item) => item.id !== preset.id));
      updateReelNarrationDraft({ presetId: null });
      setReelNarrationMessage('Preset deleted.');
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to delete preset.');
    }
  }, [narrationPresets, reelNarrationDraft.presetId, updateReelNarrationDraft]);

  const handleGenerateNarration = useCallback(async () => {
    if (isReelStory && hasUnsavedReelText) {
      setReelTextSaveState('error');
      setReelTextMessage('Save panel text before generating narration.');
      return;
    }
    if (isReelStory && hasBlockingUnsavedReelNarrationSettings) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage('Save voice settings before generating narration.');
      setActiveReelEditorSection('voice');
      return;
    }
    if (!isReelStory) {
      await generateNarrationForNode(currentNodeId);
      return;
    }

    useStoryStore.setState({ isGeneratingAudio: true });
    try {
      const seedSettings = activeFullVoicePreview?.settingsSnapshot ?? reelNarrationDraft;
      const applied = await generateAndApplyFullNarrationPreview(currentNodeId, seedSettings);
      if (applied) {
        setReelNarrationMessage('Full narration generated and applied to this beat.');
      }
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to generate narration.');
    } finally {
      useStoryStore.setState({ isGeneratingAudio: false });
    }
  }, [
    activeFullVoicePreview,
    currentNodeId,
    generateAndApplyFullNarrationPreview,
    generateNarrationForNode,
    hasBlockingUnsavedReelNarrationSettings,
    hasUnsavedReelText,
    isReelStory,
    reelNarrationDraft,
  ]);

  const handleGenerateAllNarration = useCallback(async () => {
    if (!isReelStory) return;
    if (hasUnsavedReelText) {
      setReelTextSaveState('error');
      setReelTextMessage('Save panel text before generating narration.');
      return;
    }
    if (hasBlockingUnsavedReelNarrationSettings) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage('Save voice settings before generating narration.');
      setActiveReelEditorSection('voice');
      return;
    }
    const pendingIds = reelBeatsNeedingNarration.map((n) => n.id);
    if (pendingIds.length === 0) return;

    useStoryStore.setState({ isGeneratingAudio: true });
    try {
      const seedSettings = activeFullVoicePreview?.settingsSnapshot ?? reelNarrationDraft;
      let generatedCount = 0;
      for (const nodeId of pendingIds) {
        const applied = await generateAndApplyFullNarrationPreview(nodeId, seedSettings);
        if (applied) generatedCount += 1;
      }
      setReelNarrationMessage(generatedCount > 1
        ? `Generated and applied narration for ${generatedCount} beats.`
        : 'Generated and applied narration.');
    } catch (error) {
      setReelNarrationSaveState('error');
      setReelNarrationMessage(error instanceof Error ? error.message : 'Failed to generate narration for all beats.');
    } finally {
      useStoryStore.setState({ isGeneratingAudio: false });
    }
  }, [
    activeFullVoicePreview,
    generateAndApplyFullNarrationPreview,
    hasBlockingUnsavedReelNarrationSettings,
    hasUnsavedReelText,
    isReelStory,
    reelNarrationDraft,
    reelBeatsNeedingNarration,
  ]);

  const handleManualNavigateToNode = useCallback((nodeId: string) => {
    if (isReelStory) {
      if (reelEditorNavigationBlocked) {
        setReelEditorNavigationMessage(`Save or cancel your ${activeReelSectionLabel} changes before switching beats.`);
        return;
      }
      cancelReelPlayAll();
    }
    navigateToNode(nodeId);
  }, [activeReelSectionLabel, cancelReelPlayAll, isReelStory, navigateToNode, reelEditorNavigationBlocked]);

  const handleReelNarrationToggle = useCallback(() => {
    cancelReelPlayAll();
    togglePlayPause();
  }, [cancelReelPlayAll, togglePlayPause]);

  const handleReelGenerateNarration = useCallback(() => {
    cancelReelPlayAll();
    void handleGenerateNarration();
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
    pendingReelPlayAllNodeIdRef.current = firstNodeId;
    setReelPlayAllActive(true);

    if (currentNodeId !== firstNodeId) {
      navigateToNode(firstNodeId);
    }
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
    if (
      !reelPlayAllActive
      || pendingReelPlayAllNodeIdRef.current !== currentNodeId
      || !currentBeatPlaybackAudioUrl
      || audioIsResolving
    ) {
      return;
    }

    pendingReelPlayAllNodeIdRef.current = null;
    playAudio();
  }, [audioIsResolving, currentBeatPlaybackAudioUrl, currentNodeId, playAudio, reelPlayAllActive]);

  useEffect(() => {
    if (!canPlayFullReel && reelPlayAllActive) {
      cancelReelPlayAll();
    }
  }, [canPlayFullReel, cancelReelPlayAll, reelPlayAllActive]);

  // Autoplay narration in story mode when navigating to a node with audio
  useEffect(() => {
    if (!storyMode) {
      pendingStoryModeAutoplayNodeIdRef.current = null;
      prevNodeIdForAutoplay.current = currentNodeId;
      return;
    }

    if (prevNodeIdForAutoplay.current !== currentNodeId) {
      prevNodeIdForAutoplay.current = currentNodeId;
      pendingStoryModeAutoplayNodeIdRef.current = normalizedCurrentBeat.audioUrl ? currentNodeId : null;
    }

    if (
      pendingStoryModeAutoplayNodeIdRef.current === currentNodeId
      && currentBeatPlaybackAudioUrl
      && !audioIsResolving
      && playbackState === 'idle'
    ) {
      pendingStoryModeAutoplayNodeIdRef.current = null;
      playAudio();
    }
  }, [audioIsResolving, currentBeatPlaybackAudioUrl, currentNodeId, storyMode, normalizedCurrentBeat.audioUrl, playbackState, playAudio]);

  // Autoplay when audio becomes ready on current node in story mode
  useEffect(() => {
    if (storyMode && isAudioReady && currentBeatPlaybackAudioUrl && !audioIsResolving && playbackState === 'idle') {
      playAudio();
    }
  }, [audioIsResolving, currentBeatPlaybackAudioUrl, storyMode, isAudioReady, playbackState, playAudio]);

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
    onToggleMinimized: () => {
      if (!isReelStory) setIsMinimized(prev => !prev);
    },
    onToggleNarration: () => {
      if (isReelStory) {
        cancelReelPlayAll();
      }
      if (isReelStory && hasUnsavedReelText) {
        setReelTextSaveState('error');
        setReelTextMessage('Save panel text before using narration.');
        return;
      }
      const hasNarration = isReelStory ? currentBeatPlaybackAudioUrl : normalizedCurrentBeat.audioUrl;
      if (currentBeatPlaybackAudioUrl) {
        togglePlayPause();
      } else if (!hasNarration && !isGeneratingAudio && !audioIsResolving) {
        void handleGenerateNarration();
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

  // Auto-save when a new beat is generated.
  // Suppressed during an automated batch walk: beats are persisted incrementally
  // by saveBeatAction, and one full save runs when the walk finishes. Firing a
  // full-session save per beat here would overlap the next beat's save and trip
  // the benign "retry queued" notice, which used to abort the walk.
  useEffect(() => {
    if (useStoryStore.getState().autoBuildProgress?.active) return;
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
      // Never surface the "save queued" notice during an automated batch walk —
      // it would abort the walk on the store's error channel.
      if (latest.autoBuildProgress?.active) return;

      if (cycleSettings.storyIncrementalAssetSyncEnabled) {
        // Deferred-delivery (batch/stateful) stories generate their images on the
        // server, not via client-side sync — so the "beat media is syncing" notice
        // (and its header warning triangle) doesn't apply and would only confuse.
        if (!isPromptOnlyStory && !isBatchDeliveryStory) {
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
    isBatchDeliveryStory,
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

  const [reelExportDialogOpen, setReelExportDialogOpen] = useState(false);
  const handleExportReelVideo = useCallback(async (enginePreset: ResolvedExportPreset | null = null) => {
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
        exportEnginePreset: enginePreset,
        showWatermark: showVideoWatermark,
        textOverlayEnabled: reelOverlayEnabledDraft,
        textOverlayStyle: normalizedReelOverlayDraft,
        transitionSettings: normalizedReelTransitionDraft,
        vignetteEnabled: cycleSettings.vignetteEnabled,
        vignetteAmountPercent: cycleSettings.vignetteAmountPercent,
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
      exportEnginePreset: enginePreset,
      showWatermark: showVideoWatermark,
      textOverlayEnabled: reelOverlayEnabledDraft,
      textOverlayStyle: normalizedReelOverlayDraft,
      transitionSettings: normalizedReelTransitionDraft,
      vignetteEnabled: cycleSettings.vignetteEnabled,
      vignetteAmountPercent: cycleSettings.vignetteAmountPercent,
    });
  }, [
    adminBypassed,
    canExportReelVideo,
    cycleSettings.vignetteAmountPercent,
    cycleSettings.vignetteEnabled,
    currentNodeId,
    exportVideo,
    isExporting,
    normalizedReelOverlayDraft,
    normalizedReelTransitionDraft,
    reelOverlayEnabledDraft,
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

  const storyReaderGridClassName = `grid shrink-0 items-end gap-4 ${
    isVerticalReaderStory
      ? 'md:grid-cols-[minmax(29rem,32rem)_minmax(20rem,27rem)_22.5rem] md:justify-center md:gap-[30px]'
      : 'md:grid-cols-12 md:gap-8'
  }`;
  const storyTextColumnClassName = isVerticalReaderStory
    ? 'md:col-span-1 md:col-start-1'
    : isVerticalStory
      ? 'md:col-span-4'
      : 'md:col-span-7';
  const storyChoicesColumnClassName = isVerticalReaderStory
    ? 'md:col-span-1 md:col-start-3'
    : isVerticalStory
      ? 'md:col-span-4 md:col-start-9'
      : 'md:col-span-5';

  const mainClassName = `relative z-10 flex-1 flex flex-col w-full min-h-0 transition-opacity duration-300 ${chromeVisibilityClass} ${
    isReelStory
      ? 'justify-start overflow-hidden px-3 pb-2 pt-0 md:justify-center md:px-8 md:pb-4 md:pt-8 max-w-6xl mx-auto'
      : isVerticalReaderStory
        ? 'justify-end px-4 pb-[31px] pt-1 md:px-4 md:py-12 mx-auto max-w-5xl md:max-w-[88rem]'
        : 'justify-end px-4 pb-[31px] pt-1 md:p-12 mx-auto max-w-5xl'
  }`;

  const renderReelPreview = (surface: ReelPreviewSurface) => {
    const previewClassName = surface === 'desktop'
      ? 'hidden h-full rounded-[28px] md:block'
      : surface === 'mobile-work'
      ? 'h-full max-h-full w-auto max-w-[calc(100vw-2rem)] rounded-[18px] md:hidden'
      : surface === 'mobile-full'
      ? 'h-full max-h-full w-auto max-w-[calc(100vw-1.5rem)] rounded-[28px] md:hidden'
      : 'max-w-[19rem] rounded-[24px] md:hidden';

    return (
      <div
        className={`relative mx-auto aspect-[9/16] overflow-hidden border border-white/15 bg-neutral-950/50 shadow-2xl ${previewClassName}`}
      >
        {isStoryboard ? (
          <ReelCanvasPreview
            key={`reel-${surface}:${currentNodeId}:${normalizedCurrentBeat.imageUrl}`}
            beat={currentBeatForPlayback}
            imageUrl={normalizedCurrentBeat.imageUrl!}
            audioDurationMs={reelAudioDurationMs}
            elapsedMs={reelAudioTimeMs}
            sequence={reelPlayAllActive ? reelPreviewSequence : undefined}
            currentNodeId={currentNodeId}
            playAllActive={reelPlayAllActive}
            resetPanelKey={currentBeatPlaybackKey}
            vignetteEnabled={cycleSettings.vignetteEnabled}
            vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
            textOverlayEnabled={reelOverlayEnabledDraft}
            textOverlayStyle={reelOverlayDraft}
            textHighlightSupported={activeNarrationHighlightSupported}
            transitionSettings={normalizedReelTransitionDraft}
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
        ) : showResolvingImageState ? (
          <div className="absolute inset-0 bg-neutral-950" />
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
  };

  const renderReelPlaybackControls = (layout: 'vertical' | 'horizontal' = 'vertical') => {
    const isHorizontal = layout === 'horizontal';

    return (
    <div className={`flex items-center gap-2 ${isHorizontal ? 'flex-row' : 'flex-col'}`}>
      <button
        type="button"
        onClick={handleReelNarrationToggle}
        disabled={!canPlayCurrentBeat}
        title={
          canPlayCurrentBeat
            ? playbackState === 'playing' ? 'Pause (P)' : 'Play narration (P)'
            : !normalizedCurrentBeat.imageUrl
            ? 'Generate an image for this beat first'
            : !currentBeatPlaybackAudioUrl
            ? 'Generate narration for this beat first'
            : 'Play narration'
        }
        className={`flex ${isHorizontal ? 'h-9 w-9' : 'h-11 w-11'} items-center justify-center rounded-full border backdrop-blur-md transition-all ${
          canPlayCurrentBeat
            ? playbackState === 'playing'
              ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
              : 'border-emerald-500/25 bg-neutral-900/60 text-emerald-200 hover:border-emerald-400/45 hover:bg-neutral-800'
            : 'cursor-not-allowed border-white/10 bg-neutral-900/35 text-neutral-600'
        }`}
      >
        {playbackState === 'playing' ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="h-5 w-5" />
        )}
      </button>
      <button
        type="button"
        onClick={toggleMute}
        title={isMuted ? 'Unmute' : 'Mute'}
        className={`${isHorizontal ? 'flex h-9 w-9 items-center justify-center p-0' : 'p-2.5'} backdrop-blur-md rounded-full transition-all duration-300 bg-neutral-900/60 border border-white/10 hover:border-white/20 hover:bg-neutral-800 cursor-pointer text-neutral-400 hover:text-neutral-200`}
      >
        {isMuted ? (
          <VolumeX className={isHorizontal ? 'h-4 w-4' : 'w-5 h-5'} />
        ) : (
          <Volume2 className={isHorizontal ? 'h-4 w-4' : 'w-5 h-5'} />
        )}
      </button>
      <button
        type="button"
        onClick={toggleStoryMode}
        className={`${isHorizontal ? 'h-9 px-2' : 'px-2 py-1'} rounded-full text-[10px] font-sans uppercase tracking-wider transition-all duration-300 backdrop-blur-md border ${
          storyMode
            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
            : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300 hover:border-white/20'
        }`}
        title={storyMode ? 'Story Mode: ON — narration autoplays' : 'Story Mode: OFF — click to autoplay narration'}
      >
        auto
      </button>
    </div>
    );
  };

  const renderReelMobileModeControls = (layout: 'horizontal' | 'vertical' = 'horizontal') => (
    <div className={`flex ${layout === 'vertical' ? 'flex-col' : 'items-center'} gap-0.5 rounded-full border border-white/10 bg-neutral-950/75 p-0.5 shadow-lg backdrop-blur-md md:hidden`}>
      {REEL_MOBILE_PREVIEW_MODES.map((mode) => {
        const Icon = mode.icon;
        const active = reelMobilePreviewMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => changeReelMobilePreviewMode(mode.id)}
            aria-pressed={active}
            title={mode.label}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              active
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'text-neutral-400 hover:bg-white/10 hover:text-neutral-100'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderReelBeatTimeline = (layout: 'horizontal' | 'vertical' = 'horizontal') => {
    const timelineNodes = reelTimelineNodes ?? [];

    if (timelineNodes.length === 0) return null;

    if (layout === 'horizontal') {
      return (
        <div className="min-w-0 overflow-x-auto scrollbar-none">
          <Timeline
            storyMap={session.storyMap}
            onNodeClick={handleManualNavigateToNode}
            focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
            nodes={timelineNodes}
            compact
          />
        </div>
      );
    }

    return (
      <div className="max-h-[4.5rem] overflow-y-auto scrollbar-none">
        <div className="flex flex-col items-center">
          {timelineNodes.map((node, index) => {
            const isCurrent = node.id === session.storyMap.currentNodeId;
            const isFocused = focusMode === 'timeline' && node.id === session.storyMap.currentNodeId;
            const isLast = index === timelineNodes.length - 1;

            return (
              <div key={node.id} className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => handleManualNavigateToNode(node.id)}
                  title={`Beat ${node.beatNumber}: ${node.data.title}`}
                  className="relative group"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: index * 0.04, type: 'spring', stiffness: 300 }}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 ${
                      isCurrent
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                        : 'border border-neutral-600 bg-neutral-800 text-neutral-400 hover:border-neutral-400'
                    } ${isFocused ? 'ring-2 ring-white/50' : ''}`}
                  >
                    {node.beatNumber}
                  </motion.div>
                  {isCurrent && (
                    <motion.div
                      animate={{ scale: [1, 1.45, 1], opacity: [0.4, 0, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-emerald-500"
                    />
                  )}
                </button>
                {!isLast && <div className="h-3 w-px bg-neutral-700" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const reelSectionHasChanges = (section: ReelEditorDestination): boolean => {
    if (section === 'text') return hasUnsavedReelText;
    if (section === 'style') return hasUnsavedReelOverlayStyle;
    if (section === 'transitions') return hasUnsavedReelTransitionSettings;
    if (section === 'voice') return hasUnsavedReelNarrationSettings;
    return false;
  };

  const renderReelDestinationButton = (destination: (typeof REEL_EDITOR_DESTINATIONS)[number]) => {
    const Icon = destination.icon;
    const active = destination.id === activeReelEditorSection;
    const hasChanges = reelSectionHasChanges(destination.id);
    const panelId = `reel-editor-panel-${destination.id}`;
    const isFirstDestination = destination.id === REEL_EDITOR_DESTINATIONS[0].id;
    return (
      <button
        key={destination.id}
        id={`reel-editor-tab-${destination.id}`}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={!destination.disabled ? panelId : undefined}
        aria-disabled={destination.disabled || undefined}
        aria-label={destination.disabled ? `${destination.label} (coming soon)` : destination.label}
        title={destination.disabled ? `${destination.label} (coming soon)` : destination.label}
        onClick={() => {
          if (!destination.disabled) {
            selectReelEditorSection(destination.id);
          }
        }}
        className={`relative flex h-11 w-12 shrink-0 items-center justify-center transition-colors ${
          isFirstDestination ? 'rounded-tl-[1.45rem] rounded-tr-xl' : 'rounded-t-xl'
        } ${
          destination.disabled
            ? 'cursor-not-allowed text-neutral-600'
            : active
            ? 'z-20 bg-neutral-950 text-emerald-200'
            : 'text-neutral-400 hover:bg-white/[0.05] hover:text-white'
        }`}
      >
        <Icon className={`h-4 w-4 ${active ? 'text-emerald-300' : ''}`} />
        <span className="sr-only">{destination.label}</span>
        {active && (
          <>
            <span aria-hidden="true" className="absolute inset-x-3 top-0 h-px rounded-full bg-emerald-300/90 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
            <span aria-hidden="true" className="absolute -bottom-px inset-x-0 h-0.5 bg-neutral-950" />
            {!isFirstDestination && (
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-px -left-2 h-2 w-2 rounded-br-lg shadow-[4px_4px_0_4px_#0a0a0a]" />
            )}
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-px -right-2 h-2 w-2 rounded-bl-lg shadow-[-4px_4px_0_4px_#0a0a0a]" />
          </>
        )}
        {hasChanges && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-300"
          />
        )}
      </button>
    );
  };

  const reelSettingsContent = activeReelEditorSection === 'text' ? (
    <section id="reel-editor-panel-text" role="tabpanel" aria-labelledby="reel-editor-tab-text" className="bg-neutral-950">
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
    </section>
  ) : activeReelEditorSection === 'style' ? (
    <div id="reel-editor-panel-style" role="tabpanel" aria-labelledby="reel-editor-tab-style">
      <ReelCaptionStylePanel
        textOverlayEnabled={reelOverlayEnabledDraft}
        normalizedStyle={normalizedReelOverlayDraft}
        storyLanguage={session.storyConfig.language}
        hasUnsavedStyle={hasUnsavedReelOverlayStyle}
        isSavingStyle={isReelStyleSaving}
        saveState={reelStyleSaveState}
        message={reelStyleMessage}
        embedded
        wordHighlightAvailable={!activeNarrationMetadata || activeNarrationHighlightSupported}
        onEnabledChange={updateReelOverlayEnabledDraft}
        onChange={updateReelOverlayDraft}
        onCancel={handleCancelReelOverlayStyle}
        onSave={handleSaveReelOverlayStyle}
      />
    </div>
  ) : activeReelEditorSection === 'transitions' ? (
    <div id="reel-editor-panel-transitions" role="tabpanel" aria-labelledby="reel-editor-tab-transitions">
      <ReelTransitionPanel
        settings={normalizedReelTransitionDraft}
        hasUnsavedSettings={hasUnsavedReelTransitionSettings}
        isSaving={isReelTransitionSaving}
        error={reelTransitionMessage}
        embedded
        onChange={updateReelTransitionDraft}
        onCancel={handleCancelReelTransitionSettings}
        onSave={handleSaveReelTransitionSettings}
      />
    </div>
  ) : (
    <section id="reel-editor-panel-voice" role="tabpanel" aria-labelledby="reel-editor-tab-voice" className="bg-neutral-950 px-4 py-4">
      <div className="flex flex-col gap-4">
        <div className="order-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-sans text-[11px] uppercase tracking-[0.22em] text-neutral-400">
            <Volume2 className="h-4 w-4 text-emerald-300/80" />
            Voice
          </div>
          <div className="flex items-center gap-2">
            <ReelInfoPopover title="Advanced voice settings">
              <p>
                Opens detailed narration controls for model, stability, clarity, pacing, pauses, and delivery direction. Use these when the basic voice controls need finer tuning.
              </p>
            </ReelInfoPopover>
            <button
              type="button"
              onClick={() => setReelNarrationAdvancedOpen((value) => !value)}
              aria-pressed={reelNarrationAdvancedOpen}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                reelNarrationAdvancedOpen
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200 shadow-[0_0_16px_rgba(16,185,129,0.22)]'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10'
              }`}
              title={reelNarrationAdvancedOpen ? 'Hide advanced voice controls' : 'Show advanced voice controls'}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="order-3 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 space-y-1">
              <ReelFieldLabel>Language</ReelFieldLabel>
              <FilterDropdown
                value={reelNarrationDraft.language}
                options={reelNarrationLanguageOptions}
                onChange={(value) => {
                  const voices = getReelNarrationVoiceOptions({
                    adminSettings: effectiveReelNarrationAdminSettings,
                    language: value,
                    userTier: reelNarrationTier,
                    gender: reelNarrationDraft.voiceGender,
                  });
                  updateReelNarrationDraft({
                    language: value,
                    languageSource: 'user_selected',
                    voiceId: voices.some((voice) => voice.voiceId === reelNarrationDraft.voiceId)
                      ? reelNarrationDraft.voiceId
                      : voices[0]?.voiceId ?? reelNarrationDraft.voiceId,
                  });
                }}
                fullWidth
                size="compact"
                ariaLabel="Reel narration language"
              />
            </label>

            <div className="min-w-0 space-y-1">
              <ReelFieldLabel>Voice type</ReelFieldLabel>
              <div className="grid h-10 grid-cols-2 rounded-xl border border-white/10 bg-neutral-900 p-0.5">
                {REEL_NARRATION_GENDER_OPTIONS.map((option) => {
                  const isSelected = selectedReelVoiceGender === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleReelVoiceGenderChange(option.value)}
                      className={`rounded-lg px-2 py-1 text-sm font-medium transition-colors ${
                        isSelected
                          ? 'bg-emerald-500 text-neutral-950'
                          : 'text-neutral-300 hover:bg-white/10 hover:text-white'
                      }`}
                      aria-pressed={isSelected}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <label className="space-y-1">
            <ReelFieldLabel>Voice</ReelFieldLabel>
            <FilterDropdown
              value={reelNarrationDraft.voiceId}
              options={reelVoiceDropdownOptions}
              onChange={(value) => updateReelNarrationDraft({ voiceId: value })}
              fullWidth
              size="compact"
              ariaLabel="Reel narration voice"
            />
            {selectedReelVoice.description && (
              <span className="block text-xs leading-relaxed text-neutral-500">
                {selectedReelVoice.description}
              </span>
            )}
          </label>

          <div className="space-y-2.5 rounded-xl border border-white/10 bg-neutral-900/60 p-3">
            <label className="space-y-1">
              <ReelFieldLabel>Preset</ReelFieldLabel>
              <FilterDropdown
                value={reelNarrationDraft.presetId || ''}
                options={reelPresetDropdownOptions}
                onChange={handleReelNarrationPresetChange}
                fullWidth
                size="compact"
                ariaLabel="Reel narration preset"
              />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleSetDefaultReelNarrationPreset()}
                disabled={!selectedReelPresetIsUser || selectedReelPreset?.isDefault}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Set default
              </button>
              <button
                type="button"
                onClick={() => void handleDuplicateReelNarrationPreset()}
                disabled={!reelNarrationDraft.presetId}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => void handleUpdateReelNarrationPreset()}
                disabled={!selectedReelPresetIsUser}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Update
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteReelNarrationPreset()}
                disabled={!selectedReelPresetIsUser}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="button"
                onClick={() => void handleSaveReelNarrationPreset()}
                className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs text-neutral-300 transition-colors hover:bg-white/10"
              >
                <Save className="h-3.5 w-3.5" />
                Save preset
              </button>
            </div>
          </div>

          <label className="space-y-1">
            <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-neutral-500">
              <span>Speed</span>
              <span>{reelNarrationDraft.speed.toFixed(2)}x</span>
            </span>
            <input
              type="range"
              min={0.7}
              max={1.2}
              step={0.01}
              value={reelNarrationDraft.speed}
              onChange={(event) => updateReelNarrationDraft({ speed: Number(event.target.value) })}
              className="w-full accent-emerald-500"
            />
          </label>

          <label className="space-y-1">
            <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-neutral-500">
              <span>Emotion</span>
              <span>{Math.round(reelNarrationDraft.emotionalIntensity * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={reelNarrationDraft.emotionalIntensity}
              onChange={(event) => updateReelNarrationDraft({ emotionalIntensity: Number(event.target.value) })}
              className="w-full accent-emerald-500"
            />
          </label>
        </div>

        {reelNarrationAdvancedOpen && (
          <div className="order-2 space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 shadow-[0_12px_36px_rgba(16,185,129,0.08)]">
            <label className="space-y-1">
              <ReelFieldLabel
                infoTitle="Model"
                info="The ElevenLabs model used for final narration. Keep the admin default unless you are testing a newer voice engine."
              >
                Model
              </ReelFieldLabel>
              <input
                value={reelNarrationDraft.model}
                onChange={(event) => updateReelNarrationDraft({ model: event.target.value })}
                className="w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
              />
            </label>
            <div className="grid gap-3">
              {[
                {
                  label: 'Stability',
                  key: 'stability',
                  value: reelNarrationDraft.stability,
                  info: 'Higher stability keeps the voice more consistent. Lower stability allows more variation and emotion.',
                },
                {
                  label: 'Clarity',
                  key: 'similarityBoost',
                  value: reelNarrationDraft.similarityBoost,
                  info: 'Higher clarity keeps the voice closer to the selected speaker and can make words sharper.',
                },
                {
                  label: 'Style',
                  key: 'style',
                  value: reelNarrationDraft.style,
                  info: 'Adds more performance style from the voice. Too much can sound dramatic or less predictable.',
                },
              ].map(({ label, key, value, info }) => (
                <label key={key} className="space-y-1">
                  <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                    <span className="flex items-center gap-2">
                      <span>{label}</span>
                      <ReelInfoPopover title={label}>
                        {info}
                      </ReelInfoPopover>
                    </span>
                    <span>{Math.round(Number(value) * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(value)}
                    onChange={(event) => updateReelNarrationDraft({ [key]: Number(event.target.value) } as Partial<ReelNarrationSettings>)}
                    className="w-full accent-emerald-500"
                  />
                </label>
              ))}
            </div>
            <div className="grid gap-2">
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
                <span className="flex items-center gap-2">
                  <span>Speaker boost</span>
                  <ReelInfoPopover title="Speaker boost">
                    Makes the chosen voice sound fuller and more present. It is useful for reels where narration must cut through music.
                  </ReelInfoPopover>
                </span>
                <input
                  type="checkbox"
                  checked={reelNarrationDraft.speakerBoost}
                  onChange={(event) => updateReelNarrationDraft({ speakerBoost: event.target.checked })}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
                <span className="flex items-center gap-2">
                  <span>Expressive tags</span>
                  <ReelInfoPopover title="Expressive tags">
                    Lets supported ElevenLabs models read hints like warm, softly, or pause to shape the delivery.
                  </ReelInfoPopover>
                </span>
                <input
                  type="checkbox"
                  checked={reelNarrationDraft.useExpressiveTags}
                  disabled={reelNarrationAdminSettings?.expressiveTagsEnabled === false}
                  onChange={(event) => updateReelNarrationDraft({ useExpressiveTags: event.target.checked })}
                  className="h-4 w-4 accent-emerald-500 disabled:opacity-40"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
                <span className="flex items-center gap-2">
                  <span>Pronunciation dictionary</span>
                  <ReelInfoPopover title="Pronunciation dictionary">
                    Uses admin-approved pronunciation rules for names, brand words, and difficult terms.
                  </ReelInfoPopover>
                </span>
                <input
                  type="checkbox"
                  checked={reelNarrationDraft.usePronunciationDictionary}
                  disabled={reelNarrationAdminSettings?.pronunciationDictionaryEnabled !== true}
                  onChange={(event) => updateReelNarrationDraft({ usePronunciationDictionary: event.target.checked })}
                  className="h-4 w-4 accent-emerald-500 disabled:opacity-40"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <ReelFieldLabel
                  infoTitle="Pacing"
                  info="Controls how quickly the narration moves through the text. Slower pacing leaves more room for feeling."
                >
                  Pacing
                </ReelFieldLabel>
                <FilterDropdown
                  value={reelNarrationDraft.pacing}
                  options={REEL_NARRATION_PACING_OPTIONS}
                  onChange={(value) => updateReelNarrationDraft({ pacing: value })}
                  fullWidth
                  size="compact"
                  ariaLabel="Reel narration pacing"
                />
              </label>
              <label className="space-y-1">
                <ReelFieldLabel
                  infoTitle="Pause"
                  info="Controls pauses inside the spoken line. Panel-to-panel silence is controlled in transitions."
                >
                  Pause
                </ReelFieldLabel>
                <FilterDropdown
                  value={reelNarrationDraft.pauseStyle}
                  options={REEL_NARRATION_PAUSE_OPTIONS}
                  onChange={(value) => updateReelNarrationDraft({ pauseStyle: value })}
                  fullWidth
                  size="compact"
                  ariaLabel="Reel narration pause style"
                />
              </label>
            </div>
            <label className="space-y-1">
              <ReelFieldLabel
                infoTitle="Direction"
                info="Extra instruction for the narrator, such as gentle documentary, urgent reel hook, or calm bedtime tone."
              >
                Direction
              </ReelFieldLabel>
              <textarea
                value={reelNarrationDraft.narrationInstruction}
                onChange={(event) => updateReelNarrationDraft({ narrationInstruction: event.target.value })}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
              />
            </label>
            <div className="rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-xs text-neutral-400">
              Fallback: Gemini TTS
            </div>
          </div>
        )}

        {activeNarrationMetadata && !activeNarrationHighlightSupported && (
          <div className="order-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
            {activeNarrationMetadata.provider === 'gemini_tts'
              ? 'Text highlight is unavailable for this narration because Gemini TTS does not provide word-level timestamps.'
              : 'Text highlight is unavailable because this narration did not return word-level timestamps.'}
          </div>
        )}

        {voicePreviews.length > 0 && (
          <div className="order-4 space-y-1.5">
            <span className="block text-[11px] uppercase tracking-[0.16em] text-neutral-500">Voice previews</span>
            {voicePreviews.map((preview) => {
              const canApplyPreview = Boolean(preview.audioUrl);
              const providerModel = preview.generationMetadata
                ? `${formatNarrationProvider(preview.generationMetadata.provider)} · ${preview.generationMetadata.model}`
                : null;
              return (
                <div
                  key={preview.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${preview.isActive ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}
                >
                  <button
                    type="button"
                    onClick={() => handlePlayVoicePreview(preview)}
                    disabled={!preview.audioUrl}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={playingVoicePreviewId === preview.id ? 'Stop' : 'Play'}
                  >
                    {playingVoicePreviewId === preview.id
                      ? <Square className="h-3 w-3 fill-current" />
                      : <Play className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="text-xs font-medium text-neutral-200">{preview.label}</span>
                      {preview.voiceDisplayName && (
                        <span className="ml-1.5 text-xs text-neutral-500">{preview.voiceDisplayName}</span>
                      )}
                      {preview.previewScope && (
                        <span className="ml-1.5 text-[10px] text-neutral-600">
                          {preview.previewScope === 'full' ? '- full' : '- sample'}
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 truncate text-[10px] text-neutral-500"
                      title={preview.generationMetadata?.textHighlightSupported ? undefined : getHighlightUnavailableReason(preview)}
                    >
                      {providerModel ?? 'Metadata unavailable'}
                      <span className="mx-1 text-neutral-700">·</span>
                      {getHighlightStatusLabel(preview)}
                      {preview.generationMetadata?.fallbackUsed && (
                        <>
                          <span className="mx-1 text-neutral-700">·</span>
                          Fallback used
                        </>
                      )}
                    </div>
                  </div>
                  {preview.previewScope === 'full' && (
                    <button
                      type="button"
                      onClick={() => void handleApplyVoicePreview(preview)}
                      disabled={!canApplyPreview}
                      title={canApplyPreview ? 'Apply preview to beat playback' : 'Preview audio is not ready'}
                      className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apply
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteVoicePreview(preview.id)}
                    className="shrink-0 rounded-lg p-1 text-neutral-600 transition-colors hover:text-neutral-400"
                    aria-label="Delete preview"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="order-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Preview scope</span>
            <InfoPopover title="Full preview scope" ariaLabel="About full preview scope">
              <p>
                <strong className="text-neutral-200">Sample</strong> generates a short one-panel clip - fast and low cost. Use it to quickly audition a voice.
              </p>
              <p>
                <strong className="text-neutral-200">Full</strong> generates this beat&apos;s complete narration. Apply it to hear the beat with that voice before saving and generating final narration.
              </p>
            </InfoPopover>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-neutral-900 p-0.5">
            <button
              type="button"
              onClick={() => setVoicePreviewScope('1_beat')}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${voicePreviewScope === '1_beat' ? 'bg-white/10 text-neutral-100' : 'text-neutral-500 hover:text-neutral-400'}`}
            >
              Sample
            </button>
            <button
              type="button"
              onClick={() => setVoicePreviewScope('full')}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${voicePreviewScope === 'full' ? 'bg-white/10 text-neutral-100' : 'text-neutral-500 hover:text-neutral-400'}`}
            >
              Full
            </button>
          </div>
        </div>

        <div className="order-6 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleCancelReelNarrationSettings}
            disabled={!hasUnsavedReelNarrationSettings || isReelNarrationSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handlePreviewReelNarrationSettings()}
            disabled={isPreviewingReelNarration}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
          >
            {isPreviewingReelNarration ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Preview
          </button>
          <button
            type="button"
            onClick={() => void handleSaveReelNarrationSettings()}
            disabled={!hasUnsavedReelNarrationSettings || isReelNarrationSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-medium text-neutral-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isReelNarrationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>

        {reelBeatsNeedingNarration.length > 0 && (
          <button
            type="button"
            onClick={() => void handleGenerateAllNarration()}
            disabled={isGeneratingAudio || hasBlockingUnsavedReelNarrationSettings || hasUnsavedReelText}
            title={generateNarrationCtaTitle}
            className={`order-7 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              shouldHighlightGenerateAllNarration
                ? 'border-amber-400/40 bg-amber-400/10 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.16)] hover:bg-amber-400/15'
                : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10'
            }`}
          >
            {isGeneratingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
            {generateNarrationCtaLabel}
          </button>
        )}

        {reelNarrationMessage && (
          <p className={`order-8 text-xs ${reelNarrationSaveState === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
            {reelNarrationMessage}
          </p>
        )}
      </div>
    </section>
  );

  const renderReelPublishButton = () => (
    reelPublishingEnabled ? (
      <button
        type="button"
        onClick={() => canPublishReel && setShowPublishDialog(true)}
        disabled={!canPublishReel}
        aria-label="Publish reel"
        title={!onSave ? 'Sign in to publish this reel.' : reelDistributionBlockReason ?? 'Publish reel'}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-neutral-600"
      >
        <Share2 className="h-4 w-4" />
      </button>
    ) : null
  );

  const renderReelExportButton = () => (
    canExportReelVideo ? (
      <button
        type="button"
        onClick={() => {
          if (!isExporting) setReelExportDialogOpen(true);
        }}
        disabled={isExporting}
        aria-label={isExporting ? `Exporting reel video, ${exportProgress} percent` : 'Export reel video'}
        title={isExporting ? `Exporting... ${exportProgress}%` : 'Export reel video'}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-70"
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : exportProgress === 100 ? (
          <Check className="h-4 w-4" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>
    ) : reelReadyForDistribution && videoDownloadGlobalOn && !canAccessVideoExport ? (
      <button
        type="button"
        onClick={() => window.open('/wallet', '_blank')}
        aria-label="Export reel video, upgrade required"
        title="Video export is available on eligible plans."
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200"
      >
        <Lock className="h-4 w-4" />
      </button>
    ) : (
      <button
        type="button"
        disabled
        aria-label="Export reel video unavailable"
        title={!videoDownloadGlobalOn ? 'Video export is disabled in Global Settings.' : reelDistributionBlockReason ?? 'Export reel video'}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/5 bg-white/[0.03] text-neutral-600 disabled:cursor-not-allowed"
      >
        <Download className="h-4 w-4" />
      </button>
    )
  );

  const renderReelDiscardButton = () => (
    <button
      type="button"
      onClick={() => {
        setDiscardReelError(null);
        setShowDiscardReelDialog(true);
      }}
      disabled={!session.savedStoryId || isDiscardingReel}
      aria-label="Discard reel draft"
      title={session.savedStoryId ? 'Discard this reel draft' : 'Save must finish before this reel can be discarded.'}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-500/20 bg-rose-500/10 text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-neutral-600"
    >
      {isDiscardingReel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );

  const renderReelImageUploadButton = () => (
    <button
      type="button"
      onClick={togglePromptTools}
      disabled={!canOpenPromptTools}
      aria-expanded={promptToolsOpen}
      aria-haspopup="dialog"
      aria-label={canOpenPromptTools ? 'Prompt and image tools' : 'No prompt tools available'}
      title={canOpenPromptTools ? 'Prompt and image tools' : 'No prompt tools available'}
      className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
        !canOpenPromptTools
          ? 'cursor-not-allowed border-white/5 bg-white/[0.03] text-neutral-700'
          : promptToolsOpen
          ? 'border-sky-400/25 bg-sky-500/20 text-sky-200 hover:bg-sky-500/25'
          : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10'
      }`}
    >
      <Layers className="h-4 w-4" />
    </button>
  );

  const reelToolbarActions = (
    <>
      {renderReelPublishButton()}
      {renderReelExportButton()}
      {renderReelDiscardButton()}
    </>
  );

  const renderReelMobileActionControls = () => (
    <div className="flex items-center justify-end gap-2">
      {renderReelImageUploadButton()}
      {renderReelExportButton()}
      {renderReelDiscardButton()}
    </div>
  );

  const renderReelWorkMobileRail = () => (
    <div className="md:hidden">
      <div className="flex justify-end pr-1">
        {renderReelMobileModeControls('horizontal')}
      </div>
      <div className="mt-1 flex min-h-11 items-center gap-2 rounded-2xl border border-white/5 bg-neutral-950/55 px-1 py-1 shadow-[0_-10px_24px_rgba(0,0,0,0.16)] backdrop-blur-sm">
        <div className="min-w-0 flex-1">
          {renderReelBeatTimeline('horizontal')}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {renderReelPlaybackControls('horizontal')}
          {renderReelMobileActionControls()}
        </div>
      </div>
    </div>
  );

  const reelEditorLayout = isReelStory ? (
    <>
    <div className={`${reelMobilePreviewMode === 'full' ? 'hidden md:grid' : 'flex'} h-full min-h-0 w-full flex-1 flex-col gap-2 md:h-[min(80dvh,calc(100dvh_-_7rem))] md:flex-none md:grid md:grid-cols-[3.25rem_auto_minmax(20rem,24rem)] md:items-stretch md:justify-center md:gap-6`}>
      <div className="flex basis-[45%] min-h-[14rem] shrink-0 items-center justify-center md:hidden">
        <div className="flex h-full min-h-0 w-full items-center justify-center">
          {renderReelPreview('mobile-work')}
        </div>
      </div>

      <div className="hidden h-full items-end justify-center pb-4 md:flex">
        {renderReelPlaybackControls()}
      </div>

      {renderReelPreview('desktop')}

      <div className="flex min-h-0 w-full flex-1 basis-[55%] flex-col gap-2 md:h-full md:self-stretch md:justify-end">
        {renderReelWorkMobileRail()}
        <div className="hidden md:block">
          <ReelToolbar
            storyMap={session.storyMap}
            onNodeClick={handleManualNavigateToNode}
            focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
            nodes={reelTimelineNodes}
            canOpenPromptTools={canOpenPromptTools}
            promptToolsOpen={promptToolsOpen}
            onTogglePromptTools={togglePromptTools}
            actions={reelToolbarActions}
          />
        </div>

        {reelEditorNavigationMessage && (
          <p role="alert" className="shrink-0 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-sans text-amber-200">
            {reelEditorNavigationMessage}
          </p>
        )}

        {lastPublishResult && (
          <div className={`flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
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

        {exportError && (
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{exportError}</span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col md:flex-none">
          <div className="relative z-20 flex w-fit shrink-0 items-end rounded-t-3xl border border-b-0 border-white/10 bg-neutral-900/80 pr-1 pt-1 shadow-[0_-10px_24px_rgba(0,0,0,0.12)]">
            <div role="tablist" aria-label="Reel settings" className="flex items-end">
              {REEL_EDITOR_DESTINATIONS.map((destination) => renderReelDestinationButton(destination))}
            </div>
          </div>

          <div className="relative -mt-px min-h-0 flex-1 overflow-hidden rounded-b-3xl rounded-tr-3xl border border-white/10 bg-neutral-950 shadow-2xl md:flex-none">
            <div
              ref={reelSettingsScrollRef}
              onScroll={updateReelSettingsFade}
              className="h-full overflow-y-auto scrollbar-none md:h-auto md:max-h-[calc(min(80dvh,calc(100dvh_-_7rem))_-_6.5rem)]"
            >
              {reelSettingsContent}
            </div>
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-neutral-950 via-neutral-950/80 to-transparent transition-opacity duration-200 ${
                reelSettingsFade.top ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent transition-opacity duration-200 ${
                reelSettingsFade.bottom ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
        </div>
      </div>
    </div>

    {reelMobilePreviewMode === 'full' && (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col md:hidden">
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-3 pt-1">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_58%)]"
          />
          <div className="relative z-10 flex h-full min-h-0 w-full items-center justify-center">
            <div className="relative flex h-full min-h-0 w-fit max-w-full items-center justify-center">
              {renderReelPreview('mobile-full')}
              <div className="absolute bottom-3 right-3 z-20">
                {renderReelMobileModeControls('horizontal')}
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-20 shrink-0 border-t border-white/5 bg-neutral-950/80 px-1 pb-2 pt-1 shadow-[0_-16px_36px_rgba(0,0,0,0.35)] backdrop-blur-md">
          <div className="flex min-h-11 items-center gap-2">
            <div className="min-w-0 flex-1">
              {renderReelBeatTimeline('horizontal')}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {renderReelPlaybackControls('horizontal')}
              {renderReelMobileActionControls()}
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  ) : null;

  const storyEditorTransition = session.storyConfig.storyTransition;
  const storyEditorTransitionSeconds = storyEditorTransition.durationMs / 1000;
  const storyEditorTransitionIsBlack = storyEditorTransition.type === 'fade-black';
  const storyEditorTransitionIsSoft = storyEditorTransition.type === 'soft-fade';
  const storyEditorTransitionIsFast = storyEditorTransition.type === 'fast-cut';
  const storyEditorTransitionMotionSeconds = storyEditorTransitionIsBlack
    ? storyEditorTransitionSeconds / 2
    : storyEditorTransitionSeconds;
  const nextStoryTransitionBeat = session.storyMap.nodes[
    session.storyMap.nodes[currentNodeId]?.children[0] ?? ''
  ]?.data;

  return (
    <div className="relative h-dvh bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode={isReelStory || storyEditorTransitionIsBlack ? 'wait' : 'sync'} initial={isReelStory}>
          <motion.div
            key={isReelStory ? 'reel-workspace-background' : visualKey}
            initial={isReelStory
              ? { opacity: 0 }
              : storyEditorTransitionIsFast
                ? { opacity: 1 }
                : storyEditorTransitionIsSoft
                  ? { opacity: 0, filter: 'blur(8px)' }
                  : { opacity: 0 }}
            animate={isReelStory || !storyEditorTransitionIsSoft
              ? (isReelStory || isStoryboard ? { opacity: 1 } : { opacity: 1, scale: [1, 1.08] })
              : (isStoryboard
                  ? { opacity: 1, filter: 'blur(0px)' }
                  : { opacity: 1, filter: 'blur(0px)', scale: [1, 1.08] })}
            exit={isReelStory
              ? { opacity: 0 }
              : storyEditorTransitionIsFast
                ? { opacity: 1 }
                : storyEditorTransitionIsSoft
                  ? { opacity: 0, filter: 'blur(8px)' }
                  : { opacity: 0 }}
            transition={{
              opacity: { duration: isReelStory ? 1.5 : storyEditorTransitionMotionSeconds, ease: "easeOut" },
              filter: { duration: storyEditorTransitionMotionSeconds, ease: 'easeInOut' },
              scale: { duration: 20, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" },
            }}
            className={isReelStory ? 'absolute inset-0' : isVerticalStory ? 'absolute inset-0' : 'absolute inset-0 scale-110 blur-2xl md:scale-100 md:blur-none'}
          >
            <div className={isReelStory
              ? 'absolute inset-0'
              : isVerticalStory
              ? 'absolute inset-0 md:scale-110 md:blur-2xl'
              : 'contents'}
            >
            {isReelStory ? (
              <div
                className="absolute inset-0"
                style={{
                  background: [
                    'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0) 32%, rgba(0,0,0,0.48) 100%)',
                    'linear-gradient(90deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 22%, rgba(0,0,0,0.22) 100%)',
                    'linear-gradient(135deg, #070708 0%, #161719 42%, #101114 68%, #050506 100%)',
                  ].join(', '),
                }}
              />
            ) : isStoryboard && resolvedBeatImageUrl ? (
              <StoryStoryboardPlayer
                key={`${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                gridUrl={resolvedBeatImageUrl!}
                audioUrl={resolvedBeatAudioUrl}
                audioElapsedMs={reelAudioTimeMs}
                audioDurationMs={storyboardAudioDurationMs}
                cycleOverride={cycleSettings.cycleOverride}
                cycleMs={cycleSettings.cycleMs}
                vignetteEnabled={cycleSettings.vignetteEnabled}
                vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                playbackState={playbackState}
                captions={normalizedCurrentBeat.reelCaptions}
                narrationTiming={normalizedCurrentBeat.storyboardNarrationTiming}
                textOverlayEnabled={isReelStory ? reelOverlayEnabledDraft : false}
                textOverlayStyle={isReelStory ? reelOverlayDraft : undefined}
                storyTextOverlayCaptions={!isReelStory ? normalizedCurrentBeat.storyTextOverlayCaptions : undefined}
                storyTextOverlayEnabled={!isReelStory && savedStoryTextOverlayEnabled}
                storyTextOverlayMode={savedStoryTextOverlayMode}
                storyTextOverlayStyle={savedStoryTextOverlayStyle}
                storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
                storyTextOverlayTextHighlightSupported={savedStoryTextOverlayHighlightSupported}
                storyTransitionSettings={!isReelStory ? session.storyConfig.storyTransition : undefined}
                activeStoryTransition={!isReelStory ? storyTransitionPlayback.activeTransition : null}
                storyEffects={!isReelStory ? normalizedCurrentBeat.storyEffects : undefined}
                effectSeed={currentNodeId}
                // Full-bleed backdrop sits under <main> (z-0), so its dots can't be
                // clicked — keep it synced to the panel but non-interactive/dot-less.
                interactive={false}
                showIndicators={false}
                manualPanel={manualStoryboardPanel}
                onActivePanelChange={setActiveStoryboardPanel}
                onImageLoad={() => setFailedImageUrl((prev) => (prev === resolvedBeatImageUrl ? null : prev))}
                onImageError={() => setFailedImageUrl(resolvedBeatImageUrl!)}
              />
            ) : displayImageUrl ? (
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
            ) : showResolvingImageState ? (
              <div className="absolute inset-0 bg-neutral-950" />
            ) : null}
            </div>
            {!isReelStory && isVerticalStory && (displayImageUrl || showResolvingImageState) && (
              <div className="absolute inset-0 hidden px-4 pb-[31px] pt-1 md:block md:px-4 md:py-12">
                <div className={`${storyReaderGridClassName} h-full w-full`}>
                  <div className="flex h-full min-h-0 items-end justify-center md:col-start-2">
                    <div
                      className="relative aspect-[9/16] overflow-hidden rounded-[28px] border border-white/15 bg-neutral-950/50 shadow-2xl"
                      style={{ width: 'min(100%, calc((100dvh - 4rem) * 9 / 16))' }}
                    >
                  {isStoryboard && resolvedBeatImageUrl ? (
                    <StoryStoryboardPlayer
                      key={`vertical-window:${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                      gridUrl={resolvedBeatImageUrl!}
                      audioUrl={resolvedBeatAudioUrl}
                      audioElapsedMs={reelAudioTimeMs}
                      audioDurationMs={storyboardAudioDurationMs}
                      cycleOverride={cycleSettings.cycleOverride}
                      cycleMs={cycleSettings.cycleMs}
                      vignetteEnabled={cycleSettings.vignetteEnabled}
                      vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                      playbackState={playbackState}
                      captions={normalizedCurrentBeat.reelCaptions}
                      narrationTiming={normalizedCurrentBeat.storyboardNarrationTiming}
                      textOverlayEnabled={isReelStory ? reelOverlayEnabledDraft : false}
                      textOverlayStyle={isReelStory ? reelOverlayDraft : undefined}
                      storyTextOverlayCaptions={!isReelStory ? normalizedCurrentBeat.storyTextOverlayCaptions : undefined}
                      storyTextOverlayEnabled={!isReelStory && savedStoryTextOverlayEnabled}
                      storyTextOverlayMode={savedStoryTextOverlayMode}
                      storyTextOverlayStyle={savedStoryTextOverlayStyle}
                      storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
                      storyTextOverlayTextHighlightSupported={savedStoryTextOverlayHighlightSupported}
                      storyTransitionSettings={session.storyConfig.storyTransition}
                      activeStoryTransition={storyTransitionPlayback.activeTransition}
                      storyEffects={normalizedCurrentBeat.storyEffects}
                      effectSeed={currentNodeId}
                      // 9:16 window also lives in the z-0 background layer (behind
                      // <main>), so its dots aren't clickable — sync only.
                      interactive={false}
                      showIndicators={false}
                      manualPanel={manualStoryboardPanel}
                      onActivePanelChange={setActiveStoryboardPanel}
                      onImageLoad={() => setFailedImageUrl((prev) => (prev === resolvedBeatImageUrl ? null : prev))}
                      onImageError={() => setFailedImageUrl(resolvedBeatImageUrl!)}
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
                  ) : showResolvingImageState ? (
                    <div className="absolute inset-0 bg-neutral-950" />
                  ) : null}
                  {isReelStory && !normalizedCurrentBeat.audioUrl && (
                    <button
                      onClick={() => !isGeneratingAudio && void handleGenerateNarration()}
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
        {!displayImageUrl && showFailedImageState && (
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center px-6 text-center md:flex">
            <div className="pointer-events-auto rounded-3xl border border-white/10 bg-neutral-950/65 px-6 py-5 backdrop-blur-md">
              <div className="mb-3 flex justify-center">
                <AlertTriangle className="h-8 w-8 text-amber-300" />
              </div>
              <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">Beat Image Needs Retry</p>
            </div>
          </div>
        )}
        {isReelStory && !displayImageUrl && showPendingImageState && !showFailedImageState && !isBatchDeliveryStory && (
          // Reel view keeps the centered overlay. Non-reel stories show a compact
          // right-aligned indicator above the story-card toggles instead (below).
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center px-6 md:flex">
            <div className="pointer-events-auto flex flex-col items-center gap-3 text-center">
              <div
                className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-neutral-950/70 backdrop-blur-md"
                role="status"
                aria-label="Painting this scene"
              >
                <ImageIcon className="h-4 w-4 text-neutral-300" />
                <Loader2 className="absolute h-10 w-10 animate-spin text-emerald-300/70" strokeWidth={1} />
              </div>
              <div className="max-w-[16rem] rounded-2xl border border-white/10 bg-neutral-950/70 px-4 py-2 backdrop-blur-md">
                <p className="text-xs font-medium text-neutral-200">Painting this scene…</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-400">
                  {isServerImageJobPending
                    ? 'It appears here automatically — safe to keep reading or leave and come back.'
                    : 'Syncing this beat’s image — it appears here automatically.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Header */}
      <header className={`${headerGradientClass} transition-opacity duration-300 ${chromeVisibilityClass}`}>
        <div className={`order-2 min-w-0 items-start gap-2 self-stretch md:order-1 md:items-center md:gap-3 md:self-auto ${isReelStory ? 'hidden md:flex' : 'flex'}`}>
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
          {(displayImageUrl || showResolvingImageState || showPendingImageState || showFailedImageState || showPromptOnlyPlaceholder) && (
            <div className="relative w-full aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/40 shadow-2xl">
              {isStoryboard && resolvedBeatImageUrl ? (
                <StoryStoryboardPlayer
                  key={`mobile-window:${normalizedCurrentBeat.imageUrl}:${normalizedCurrentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                  gridUrl={resolvedBeatImageUrl!}
                  audioUrl={resolvedBeatAudioUrl}
                  audioElapsedMs={reelAudioTimeMs}
                  audioDurationMs={storyboardAudioDurationMs}
                  cycleOverride={cycleSettings.cycleOverride}
                  cycleMs={cycleSettings.cycleMs}
                  vignetteEnabled={cycleSettings.vignetteEnabled}
                  vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                  playbackState={playbackState}
                  imageClassName="mobile-scene-shuttle"
                  captions={normalizedCurrentBeat.reelCaptions}
                  narrationTiming={normalizedCurrentBeat.storyboardNarrationTiming}
                  textOverlayEnabled={isReelStory ? reelOverlayEnabledDraft : false}
                  textOverlayStyle={isReelStory ? reelOverlayDraft : undefined}
                  storyTextOverlayCaptions={!isReelStory ? normalizedCurrentBeat.storyTextOverlayCaptions : undefined}
                  storyTextOverlayEnabled={!isReelStory && savedStoryTextOverlayEnabled}
                  storyTextOverlayMode={savedStoryTextOverlayMode}
                  storyTextOverlayStyle={savedStoryTextOverlayStyle}
                  storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
                  storyTextOverlayTextHighlightSupported={savedStoryTextOverlayHighlightSupported}
                  storyTransitionSettings={session.storyConfig.storyTransition}
                  activeStoryTransition={storyTransitionPlayback.activeTransition}
                  storyEffects={normalizedCurrentBeat.storyEffects}
                  effectSeed={currentNodeId}
                  interactive={!isReelStory}
                  manualPanel={manualStoryboardPanel}
                  onPanelSelect={handleStoryboardPanelSelect}
                  onActivePanelChange={setActiveStoryboardPanel}
                  onImageLoad={() => setFailedImageUrl((prev) => (prev === resolvedBeatImageUrl ? null : prev))}
                  onImageError={() => setFailedImageUrl(resolvedBeatImageUrl!)}
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
              ) : showResolvingImageState ? (
                <div className="absolute inset-0 bg-neutral-950" />
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
                      <div
                        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-neutral-950/60"
                        role="status"
                        aria-label="Image generating in background"
                      >
                        <ImageIcon className="h-4 w-4 text-neutral-300" />
                        <Loader2 className="absolute h-10 w-10 animate-spin text-emerald-300/70" strokeWidth={1} />
                      </div>
                      <p className="px-8 text-[11px] leading-relaxed text-neutral-400">
                        {isServerImageJobPending
                          ? 'Generating in the background — it will appear automatically. Safe to leave and come back.'
                          : 'Image syncing — it will appear automatically.'}
                      </p>
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

        <div className={storyReaderGridClassName}>

          {/* Story Text Card + Toggle */}
          <div
            className={`${storyTextColumnClassName} flex-col items-center relative ${
              isReelStory && isMinimized
                ? 'hidden'
                : !isMinimized && visibleReaderPanel === 'story'
                ? 'flex'
                : 'hidden md:flex'
            }`}
            onMouseEnter={() => setIsCardHovered(true)}
            onMouseLeave={() => setIsCardHovered(false)}
          >
            {/* Image-still-painting indicator — compact, right-aligned with the
                story box and sitting just above the card toggle controls. */}
            {!isReelStory && showPendingImageState && !showFailedImageState && !isBatchDeliveryStory && (
              <div className="mb-2 flex w-full justify-end">
                <div
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-neutral-950/70 py-1 pl-1.5 pr-3 backdrop-blur-md"
                  role="status"
                  aria-label="Painting this scene"
                  title={isServerImageJobPending
                    ? 'Painting this scene — it appears here automatically. Safe to keep reading or leave and come back.'
                    : 'Syncing this beat’s image — it appears here automatically.'}
                >
                  <span className="relative flex h-6 w-6 items-center justify-center">
                    <ImageIcon className="h-3.5 w-3.5 text-neutral-300" />
                    <Loader2 className="absolute h-6 w-6 animate-spin text-emerald-300/70" strokeWidth={1.25} />
                  </span>
                  <span className="text-xs font-medium text-neutral-300">Painting this scene…</span>
                </div>
              </div>
            )}
            {/* Card chrome toggles — minimize + prompt-tools popover */}
            <div className={`relative mb-2 w-full items-center gap-2 ${isReelStory ? 'hidden' : 'flex'} ${!isReelStory ? 'md:pl-[3.75rem]' : ''}`}>
              {/* Storyboard panel dots — desktop only (mobile uses the on-image
                  dots on the framed card, which the backdrop can't provide). */}
              {isStoryboard && resolvedBeatImageUrl && (
                <div
                  className={`items-center gap-0.5 ${isVerticalStory ? 'flex' : 'hidden md:flex'}`}
                  role="tablist"
                  aria-label="Storyboard panels"
                >
                  {Array.from({ length: STORYBOARD_PANEL_COUNT }).map((_, panelIndex) => (
                    <button
                      key={panelIndex}
                      type="button"
                      role="tab"
                      aria-selected={panelIndex === activeStoryboardPanel}
                      aria-label={`Show panel ${panelIndex + 1}`}
                      onClick={() => handleStoryboardPanelSelect(panelIndex)}
                      className="flex cursor-pointer items-center justify-center p-1.5"
                      title={`Panel ${panelIndex + 1}`}
                    >
                      <span
                        className={`block h-2 rounded-full transition-all duration-300 ${
                          panelIndex === activeStoryboardPanel
                            ? 'w-5 bg-emerald-400'
                            : 'w-2 bg-white/30 hover:bg-white/60'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
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
                    title="Prompt & image tools"
                  >
                    <Layers className="w-5 h-5" />
                  </button>
                </>
              )}
              {isStoryboard && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (!normalizedCurrentBeat.imageUrl) return;
                      stopAudio();
                      setShowStoryTextOverlay(true);
                    }}
                    disabled={!normalizedCurrentBeat.imageUrl}
                    className="rounded-full bg-white/5 p-2 text-neutral-300 backdrop-blur-md transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-white/5"
                    title={normalizedCurrentBeat.imageUrl ? 'Story Text Overlay' : 'Create storyboard image first'}
                    aria-label={normalizedCurrentBeat.imageUrl ? 'Open Story Text Overlay' : 'Create storyboard image first'}
                  >
                    <Type className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!normalizedCurrentBeat.imageUrl) return;
                      stopAudio();
                      setShowStoryEffects(true);
                    }}
                    disabled={!normalizedCurrentBeat.imageUrl}
                    className="rounded-full bg-white/5 p-2 text-neutral-300 backdrop-blur-md transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-white/5"
                    title={normalizedCurrentBeat.imageUrl ? 'Story Effects' : 'Create storyboard image first'}
                    aria-label={normalizedCurrentBeat.imageUrl ? 'Open Story Effects' : 'Create storyboard image first'}
                  >
                    <Clapperboard className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!normalizedCurrentBeat.imageUrl || !normalizedCurrentBeat.audioUrl) return;
                      stopAudio();
                      setShowStoryTransitions(true);
                    }}
                    disabled={!normalizedCurrentBeat.imageUrl || !normalizedCurrentBeat.audioUrl}
                    className="rounded-full bg-white/5 p-2 text-neutral-300 backdrop-blur-md transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-white/5"
                    title={normalizedCurrentBeat.audioUrl ? 'Story Transitions' : 'Generate narration first'}
                    aria-label={normalizedCurrentBeat.audioUrl ? 'Open Story Transitions' : 'Generate narration first'}
                  >
                    <Blend className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!normalizedCurrentBeat.audioUrl) return;
                      stopAudio();
                      setShowStoryNarrationTiming(true);
                    }}
                    disabled={!normalizedCurrentBeat.audioUrl}
                    className="rounded-full bg-white/5 p-2 text-neutral-300 backdrop-blur-md transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-white/5"
                    title={normalizedCurrentBeat.audioUrl ? 'Story Narration Timing' : 'Generate narration first'}
                    aria-label={normalizedCurrentBeat.audioUrl ? 'Open Story Narration Timing' : 'Generate narration first'}
                  >
                    <Clock3 className="h-5 w-5" />
                  </button>
                </>
              )}
              </div>
            </div>

          {/* Card + Narration button row — fully hidden when minimized so only
              the chrome controls (and the choices column) remain on screen */}
          <div className={`items-end gap-3 w-full md:gap-5 ${isMinimized ? 'hidden' : 'flex'}`}>
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
                {/* Batch-mode: image generation is disabled — explain the batch flow */}
                {showBatchModeImageLock && (
                  <div className="relative flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => {
                        setBatchModeNotice(true);
                        window.setTimeout(() => setBatchModeNotice(false), 4000);
                      }}
                      aria-disabled="true"
                      className="p-2.5 backdrop-blur-md rounded-full bg-neutral-900/60 border border-white/10 text-neutral-500 cursor-not-allowed"
                      title="Batch mode — finish all beats, then tap Create all visuals on the last beat"
                    >
                      <ImageOff className="w-5 h-5" />
                    </button>
                    <AnimatePresence>
                      {batchModeNotice && (
                        <motion.p
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -6 }}
                          className="absolute left-full ml-2 top-1/2 z-50 -translate-y-1/2 w-56 rounded-xl border border-white/10 bg-neutral-900/95 px-3 py-2 text-xs leading-relaxed text-neutral-200 shadow-xl backdrop-blur-md"
                        >
                          You&apos;re in batch mode. Finish all beats, then tap “Create all visuals” on the last beat.
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {!isReelStory && cycleSettings.storyUiAutoScrollEnabled && (
                  <AutoScrollButton
                    active={isAutoScrolling}
                    onClick={toggleAutoScroll}
                    disabled={scrollState.atBottom}
                  />
                )}
                <div className="relative flex flex-col items-center">
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
                    disabled={narrationIsResolving || (isReelStory && hasUnsavedReelText)}
                    disabledReason={narrationIsResolving ? 'Preparing narration...' : 'Save panel text before generating narration'}
                  />
                </div>
                {canUseBeatControls && !isReelStory && (
                  <BeatActionsMenu
                    key={currentNodeId}
                    nodeId={currentNodeId}
                    isLocked={beatIsLocked}
                    allowImageRegeneration={!isPromptOnlyStory}
                    onEditText={() => setShowEditBeatText(true)}
                    onRegenerateImage={() => setShowRegenerateImage(true)}
                    onRegenerateNarration={() => setShowNarrationRegenConfirm(true)}
                    onRegenerateOptions={() => {
                      setOptionsRegenError(null);
                      setOptionsRegenState({ step: 'confirm' });
                    }}
                    onViewVersions={() => setShowImageVersions(true)}
                  />
                )}
              </div>
            )}

          <div className="flex min-w-0 flex-1 flex-col">
          {/* Batch visuals CTA — sits directly above the card, matching its width (all breakpoints) */}
          <BatchVisualsBanner />
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
                      title="Prompt & image tools"
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
                            Text settings
                          </div>
                          {hasUnsavedReelOverlayStyle && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleCancelReelOverlayStyle}
                                disabled={isReelStyleSaving}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-sans uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
                              >
                                Cancel
                              </button>
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
                                Save settings
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="mt-3">
                          <ReelCaptionStyleControls
                            textOverlayEnabled={reelOverlayEnabledDraft}
                            normalizedStyle={normalizedReelOverlayDraft}
                            storyLanguage={session.storyConfig.language}
                            wordHighlightAvailable={!activeNarrationMetadata || activeNarrationHighlightSupported}
                            onEnabledChange={updateReelOverlayEnabledDraft}
                            onChange={updateReelOverlayDraft}
                          />
                        </div>

                        {reelStyleSaveState === 'error' && reelStyleMessage && (
                          <p className="mt-3 text-xs font-sans text-rose-300">
                            {reelStyleMessage}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {episodeNav && currentNodeId === session.storyMap.rootNodeId && !isMinimized && (
                        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-2.5 text-xs font-sans">
                          {episodeNav.parent && (
                            <Link
                              href={`/story/${episodeNav.parent.storyId}`}
                              className="group flex min-w-0 items-center gap-1.5 text-indigo-200 transition-colors hover:text-indigo-100"
                            >
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 rotate-180 transition-transform group-hover:-translate-x-0.5" />
                              <span className="truncate">
                                {episodeNav.parent.episodeNumber
                                  ? `Part ${episodeNav.parent.episodeNumber}: `
                                  : 'Previous: '}
                                {episodeNav.parent.title}
                              </span>
                            </Link>
                          )}
                          {episodeNav.children.map((child) => (
                            <Link
                              key={child.storyId}
                              href={`/story/${child.storyId}`}
                              className="group flex min-w-0 items-center gap-1.5 text-indigo-200 transition-colors hover:text-indigo-100"
                            >
                              <span className="truncate">
                                {child.episodeNumber ? `Part ${child.episodeNumber}: ` : 'Next: '}
                                {child.title}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                          ))}
                        </div>
                      )}
                      {storyReaderSegments && !isMinimized ? (
                        <p className="text-neutral-300">
                          {storyReaderSegments.map((segment, index) => {
                            if (!segment) return null;
                            const isActiveSegment = index === activeStoryboardPanel;
                            return (
                              <span key={index}>
                                <span
                                  ref={(node) => { storyboardSegmentRefs.current[index] = node; }}
                                  className={`rounded px-1 transition-colors duration-500 [box-decoration-break:clone] [-webkit-box-decoration-break:clone] ${
                                    isActiveSegment
                                      ? 'bg-emerald-500/45 text-white'
                                      : 'text-neutral-300'
                                  }`}
                                >
                                  {segment}
                                </span>
                                {index < storyReaderSegments.length - 1 ? ' ' : ''}
                              </span>
                            );
                          })}
                        </p>
                      ) : (
                        <p className={`transition-colors duration-500 ${
                          isMinimized ? 'text-neutral-500 line-clamp-2' : 'text-neutral-300'
                        }`}>
                          {currentBeat.storyText}
                        </p>
                      )}
                    </>
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

                      {episodeNav?.parent && (
                        <Link
                          href={`/story/${episodeNav.parent.storyId}`}
                          className="group mt-6 flex items-center gap-1.5 text-sm font-sans text-indigo-200 transition-colors hover:text-indigo-100"
                        >
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 rotate-180 transition-transform group-hover:-translate-x-0.5" />
                          <span className="truncate">
                            {episodeNav.parent.episodeNumber
                              ? `Back to Part ${episodeNav.parent.episodeNumber}: `
                              : 'Back to: '}
                            {episodeNav.parent.title}
                          </span>
                        </Link>
                      )}

                      {episodeNav && episodeNav.children.length > 0 && (
                        <div className="mt-6 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                          <p className="text-[11px] font-sans uppercase tracking-[0.18em] text-indigo-300">
                            This story continues
                          </p>
                          <div className="mt-2 flex flex-col gap-1.5">
                            {episodeNav.children.map((child) => (
                              <Link
                                key={child.storyId}
                                href={`/story/${child.storyId}`}
                                className="group flex items-center gap-2 text-sm text-indigo-200 transition-colors hover:text-indigo-100"
                              >
                                <span className="truncate">
                                  {child.episodeNumber ? `Part ${child.episodeNumber}: ` : ''}
                                  {child.title}
                                </span>
                                <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Ending actions — inline at card bottom on mobile only.
                          On desktop these move to the right-hand column (below)
                          so they're visible without scrolling. Reel stories keep
                          them inline on every breakpoint (no desktop column). */}
                      <div className={`mt-8 flex flex-wrap gap-3 ${!isReelStory ? 'md:hidden' : ''}`}>
                        {renderEndingActions(false)}
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
          </div>{/* end banner + card stack */}
          </div>{/* end card + narration button row */}

          </div>

          {/* Ending actions — desktop right column. Mirrors the "What happens
              next?" slot so the final CTAs sit where readers already look for
              actions, instead of below the scrolled story text. Mobile keeps
              them inline in the card (rendered above). */}
          {isEnding && !isReelStory && !isMinimized && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className={`hidden md:flex md:flex-col md:justify-end ${storyChoicesColumnClassName}`}
            >
              <div className="mb-3 px-1">
                <h3 className="text-xs font-sans uppercase tracking-widest text-neutral-500">
                  What next?
                </h3>
              </div>
              <div className="flex flex-col gap-3 px-1">
                {renderEndingActions(true)}
              </div>
            </motion.div>
          )}

          {/* Choices Column */}
          {!isEnding && !isReelStory && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className={`flex-col justify-end ${storyChoicesColumnClassName} ${
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
                                {option.source === 'user_custom' && (
                                  <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-sans uppercase tracking-[0.18em] text-sky-300">
                                    Yours
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
                      {optionsRegenError && (
                        <p className="px-1 text-xs leading-snug text-rose-300">{optionsRegenError}</p>
                      )}
                      {canUseBeatControls && !isReelStory && beatControlSettings.customOptionsEnabled && (
                        <CustomOptionInput nodeId={currentNodeId} disabled={isLoading} />
                      )}
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
                      ? activeCharacterHasReference
                        ? 'Manage Character Sheets'
                        : 'Upload Character Sheet'
                      : 'Prompt and Image Tools'}
                  </p>
                  <h3 className="mt-2 text-2xl font-serif text-neutral-100">
                    {isBeatUploadView
                      ? `Add a ${isVerticalStory ? '9:16' : '16:9'} storyboard image`
                      : isCharacterUploadView
                      ? activeCharacterSheetTarget?.characterName
                      : isPromptOnlyStory
                      ? 'Copy prompts and keep going'
                      : 'Copy prompts and manage images'}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                    {isBeatUploadView
                      ? 'Saved images stay attached to this beat so you can swap between them later.'
                      : isCharacterUploadView
                      ? 'Reference sheets persist with this character so future episodes and continuations can reuse them.'
                      : isPromptOnlyStory
                      ? `Copy the exact prompts for this beat, then upload a ${isVerticalStory ? '9:16' : '16:9'} image or add only the character refs still missing.`
                      : 'Copy the exact prompt text for this beat, replace the generated image if needed, and add character refs where continuity still needs them.'}
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
                      <button
                        type="button"
                        onClick={openBeatUploadView}
                        className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-xs uppercase tracking-[0.18em] text-emerald-200 transition-colors hover:bg-emerald-500/25"
                        title={displayImageUrl ? 'Replace this beat image' : `Upload a ${isVerticalStory ? '9:16' : '16:9'} image for this beat`}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {displayImageUrl ? 'Replace Image' : 'Upload Image'}
                      </button>
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
                                  {canSaveCharactersToLibrary && (
                                    <button
                                      type="button"
                                      onClick={() => void handleSaveCharacterToLibrary(item.characterId, item.characterName)}
                                      disabled={savingLibraryCharacterId === item.characterId || isCharacterInLibrary(item.characterId)}
                                      className={`rounded-full border p-2 transition-colors ${
                                        isCharacterInLibrary(item.characterId)
                                          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                                          : 'border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10'
                                      } disabled:cursor-not-allowed`}
                                      title={isCharacterInLibrary(item.characterId) ? `${item.characterName} is in your library` : `Save ${item.characterName} to My Library`}
                                      aria-label={isCharacterInLibrary(item.characterId) ? `${item.characterName} is in your library` : `Save ${item.characterName} to My Library`}
                                    >
                                      {savingLibraryCharacterId === item.characterId ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : isCharacterInLibrary(item.characterId) ? (
                                        <BookmarkCheck className="h-4 w-4" />
                                      ) : (
                                        <BookmarkPlus className="h-4 w-4" />
                                      )}
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
                                      {item.referenceSheetGallery.length > 0
                                        ? `${item.referenceSheetGallery.length} saved`
                                        : item.generatedReferenceUrl
                                        ? 'Generated reference'
                                        : 'No saved sheet'}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
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
                                    {canSaveCharactersToLibrary && (
                                      <button
                                        type="button"
                                        onClick={() => void handleSaveCharacterToLibrary(item.characterId, item.characterName)}
                                        disabled={savingLibraryCharacterId === item.characterId || isCharacterInLibrary(item.characterId)}
                                        className={`rounded-full border p-2 transition-colors ${
                                          isCharacterInLibrary(item.characterId)
                                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                                            : 'border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10'
                                        } disabled:cursor-not-allowed`}
                                        title={isCharacterInLibrary(item.characterId) ? `${item.characterName} is in your library` : `Save ${item.characterName} to My Library`}
                                        aria-label={isCharacterInLibrary(item.characterId) ? `${item.characterName} is in your library` : `Save ${item.characterName} to My Library`}
                                      >
                                        {savingLibraryCharacterId === item.characterId ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : isCharacterInLibrary(item.characterId) ? (
                                          <BookmarkCheck className="h-4 w-4" />
                                        ) : (
                                          <BookmarkPlus className="h-4 w-4" />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {libraryCharacterConflict && (
                          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
                            <p className="text-sm text-amber-200">
                              Your library already has a character named{' '}
                              <span className="font-medium">{libraryCharacterConflict.existingMaster.name}</span>.
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleSaveCharacterToLibrary(
                                    libraryCharacterConflict.characterId,
                                    libraryCharacterConflict.characterName,
                                    libraryCharacterConflict.existingMaster.id
                                  )
                                }
                                disabled={savingLibraryCharacterId !== null}
                                className="rounded-full bg-amber-400 px-4 py-1.5 text-xs font-semibold text-neutral-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
                              >
                                Update the existing character
                              </button>
                              <button
                                type="button"
                                onClick={() => setLibraryCharacterConflict(null)}
                                disabled={savingLibraryCharacterId !== null}
                                className="rounded-full border border-white/10 px-4 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 disabled:opacity-50"
                              >
                                Keep both — rename it in My Library later
                              </button>
                            </div>
                          </div>
                        )}
                        {libraryCharacterNotice && (
                          <p className="mt-3 text-xs leading-snug text-emerald-300">{libraryCharacterNotice}</p>
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
                  const activeImagePreviewUrl = displayImageUrl && !gallery.some((entry) => (
                    entry.storageKey === activeStorageKey || entry.url === displayImageUrl
                  ))
                    ? displayImageUrl
                    : null;

                  return (
                    <>
                      {activeImagePreviewUrl && (
                        <div className="mb-5">
                          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                            Current Image
                          </p>
                          <div className="mt-3 flex flex-wrap gap-3">
                            <div className={`relative overflow-hidden rounded-xl border border-emerald-400/70 ring-2 ring-emerald-400/40 ${
                              isVerticalStory ? 'aspect-[9/16] w-20' : 'aspect-video w-32'
                            }`}>
                              <Image
                                src={activeImagePreviewUrl}
                                alt="Current beat image"
                                fill
                                className="object-cover"
                                unoptimized
                              />
                              <span className="absolute bottom-1 left-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-950">
                                Active
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

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
                            title={activeImagePreviewUrl ? 'Clear active image' : 'Clear active image (keeps it in saved images)'}
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
                      {activeCharacterGeneratedReferenceUrl && (
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                            Generated Reference
                          </p>
                          <div className="mt-3 flex flex-wrap gap-3">
                            <div className="relative">
                              <div className="relative block aspect-square w-28 overflow-hidden rounded-xl border border-emerald-400/40 bg-neutral-950/70 ring-1 ring-emerald-400/20">
                                <Image
                                  src={activeCharacterGeneratedReferenceUrl}
                                  alt={`${activeCharacterSheetTarget.characterName} generated reference`}
                                  fill
                                  className="object-cover"
                                  unoptimized
                                />
                                <span className="absolute bottom-1 left-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-950">
                                  AI
                                </span>
                              </div>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] text-neutral-500">
                            Generated by the story image pipeline and used for continuity. Upload a sheet below only when you want to replace or improve this reference.
                          </p>
                        </div>
                      )}

                      {activeCharacterGallery.length > 0 && (
                        <div className={activeCharacterGeneratedReferenceUrl ? 'mt-5' : undefined}>
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

      <StoryNarrationTimingDialog
        open={showStoryNarrationTiming}
        nodeId={currentNodeId}
        beat={normalizedCurrentBeat}
        aspectRatio={session.storyConfig.aspectRatio}
        vignetteEnabled={cycleSettings.vignetteEnabled}
        vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
        storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
        onClose={() => setShowStoryNarrationTiming(false)}
        onSave={(timing) => updateStoryboardNarrationTiming(currentNodeId, timing)}
      />
      <StoryTextOverlayDialog
        open={showStoryTextOverlay}
        nodeId={currentNodeId}
        beat={normalizedCurrentBeat}
        aspectRatio={session.storyConfig.aspectRatio}
        language={session.storyConfig.language}
        vignetteEnabled={cycleSettings.vignetteEnabled}
        vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
        wordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
        onClose={() => setShowStoryTextOverlay(false)}
        onSave={updateStoryTextOverlaySettings}
        onGenerateBeat={(settings) => generateStoryTextOverlayForNode(currentNodeId, settings)}
        onGenerateStory={generateStoryTextOverlayForCurrentPath}
      />
      <StoryTransitionDialog
        open={showStoryTransitions}
        nodeId={currentNodeId}
        beat={normalizedCurrentBeat}
        nextBeat={nextStoryTransitionBeat}
        aspectRatio={session.storyConfig.aspectRatio}
        vignetteEnabled={cycleSettings.vignetteEnabled}
        vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
        storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
        settings={session.storyConfig.storyTransition}
        onClose={() => setShowStoryTransitions(false)}
        onSave={updateStoryTransitionSettings}
      />
      <StoryEffectsDialog
        open={showStoryEffects}
        nodeId={currentNodeId}
        beat={normalizedCurrentBeat}
        aspectRatio={session.storyConfig.aspectRatio}
        vignetteEnabled={cycleSettings.vignetteEnabled}
        vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
        totalBeatCount={Object.keys(session.storyMap.nodes).length}
        onClose={() => setShowStoryEffects(false)}
        onSave={(config) => updateStoryEffects(currentNodeId, config)}
        onApplyAll={applyStoryEffectsToAll}
      />

      {/* Pack 1 beat-control dialogs */}
      {canUseBeatControls && (
        <>
          <EditBeatTextDialog
            open={showEditBeatText}
            nodeId={currentNodeId}
            initialText={normalizedCurrentBeat.storyText}
            onClose={() => setShowEditBeatText(false)}
          />
          {session.savedStoryId && (
            <ContinueAsEpisodeDialog
              open={showContinueAsEpisode}
              storyId={session.savedStoryId}
              nodeId={currentNodeId}
              onClose={() => setShowContinueAsEpisode(false)}
            />
          )}
          <RegenerateImageDialog
            open={showRegenerateImage}
            nodeId={currentNodeId}
            isStoryboard={isStoryboardBeat(normalizedCurrentBeat)}
            onClose={() => setShowRegenerateImage(false)}
          />
          <ImageVersionHistoryDialog
            open={showImageVersions}
            nodeId={currentNodeId}
            onClose={() => setShowImageVersions(false)}
          />
          <ConfirmDialog
            open={showNarrationRegenConfirm}
            title="Regenerate narration?"
            message="This will regenerate narration for this beat only. Story text and image will not change."
            confirmLabel="Regenerate narration"
            onConfirm={() => {
              setShowNarrationRegenConfirm(false);
              void handleGenerateNarration();
            }}
            onCancel={() => setShowNarrationRegenConfirm(false)}
          />
          <ConfirmDialog
            open={optionsRegenState?.step === 'confirm'}
            title="Regenerate options?"
            message="This will replace the current generated options for this beat. Story text and image will not change. Options you wrote yourself are kept."
            confirmLabel="Regenerate options"
            busy={false}
            onConfirm={() => void runOptionsRegeneration(false)}
            onCancel={() => setOptionsRegenState(null)}
          />
          <ConfirmDialog
            open={optionsRegenState?.step === 'rewrite_confirm'}
            title="Rewrite the story from this beat?"
            message={
              <span>
                Options for this beat already shaped the later story. Regenerating them will remove all later beats,
                generated images, narration, and options after this beat.
                {optionsRegenState?.step === 'rewrite_confirm' && (
                  <span className="mt-2 block text-xs text-neutral-500">
                    This will remove {optionsRegenState.impact.affectedBeatCount} later beat
                    {optionsRegenState.impact.affectedBeatCount === 1 ? '' : 's'}.
                  </span>
                )}
              </span>
            }
            confirmLabel="Rewrite from this beat"
            tone="danger"
            onConfirm={() => void runOptionsRegeneration(true)}
            onCancel={() => setOptionsRegenState(null)}
          />
        </>
      )}

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

      <VideoExportDialog
        open={reelExportDialogOpen}
        onClose={() => setReelExportDialogOpen(false)}
        coinCost={pricing.actionCosts?.export_video_future ?? null}
        onSelect={(enginePreset) => {
          setReelExportDialogOpen(false);
          void handleExportReelVideo(enginePreset);
        }}
      />

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

                {isCompatibilityExport && (
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3.5 py-3 text-sm font-sans text-amber-100">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div>
                        <p>Fast export was unavailable. Continuing with compatibility export, which takes longer.</p>
                        {process.env.NODE_ENV !== 'production' && exportFallbackReason && (
                          <p className="mt-1 line-clamp-2 text-xs text-amber-100/65" title={exportFallbackReason}>
                            {exportFallbackReason}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className={`mt-5 grid gap-1.5 ${isCompatibilityExport ? 'grid-cols-4' : 'grid-cols-5'}`}>
                  {exportSteps.map((step, index) => {
                    const isActive = index === activeExportStepIndex;
                    const isComplete = index < activeExportStepIndex;
                    return (
                      <div
                        key={step.key}
                        className={`rounded-xl border px-2 py-2 text-center text-[10px] font-sans uppercase tracking-[0.14em] ${
                          isActive
                            ? 'border-emerald-400/35 bg-emerald-400/15 text-emerald-200'
                            : isComplete
                            ? 'border-white/10 bg-white/10 text-neutral-200'
                            : 'border-white/10 bg-white/[0.04] text-neutral-500'
                        }`}
                      >
                        {isComplete ? <Check className="mx-auto mb-1 h-3 w-3" /> : null}
                        {step.label}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs font-sans uppercase tracking-[0.22em] text-neutral-300/80">
                    <span>{isCompatibilityExport ? 'Compatibility Progress' : 'Progress'}</span>
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
