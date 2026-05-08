'use client';

import { useState, useRef, useEffect, useCallback, type ChangeEvent, type CSSProperties } from 'react';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import { ArrowRight, RefreshCcw, BookOpen, Check, ChevronDown, ChevronUp, Save, Loader2, Share2, ExternalLink, Compass, CloudOff, CloudUpload, CheckCircle2, ImageIcon, ImageOff, AlertTriangle, Copy, Upload, Trash2, X, Layers } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import PublishDialog from './PublishDialog';
import ManageStorylineCoverDialog from './ManageStorylineCoverDialog';
import Timeline from './Timeline';
import Link from 'next/link';
import NarrationButton from './NarrationButton';
import AutoScrollButton from './AutoScrollButton';
import { findChildForOption, getCurrentNode } from '@/lib/utils/story-map';
import { extractStoryline } from '@/lib/utils/storyline';
import { useKeyboardNavigation } from '@/lib/hooks/useKeyboardNavigation';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { useStoryAutoScroll } from '@/lib/hooks/useStoryAutoScroll';
import { getStoryboardSettings } from '@/app/actions/admin';
import StoryboardVignette from './StoryboardVignette';
import { getStoryboardPanelCropStyle, STORYBOARD_PANEL_SEQUENCE } from '@/lib/storyboard/layout';
import { getActiveGalleryStorageKey, getBeatDisplayImageUrl, hasBeatImpossibleImageState, normalizeBeatMediaFields } from '@/lib/types/beat-media';
import type { StoryBeat, StorySession } from '@/lib/types/story';
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
}) {
  const [activePanel, setActivePanel] = useState(0);
  const [resolvedAudioDurationMs, setResolvedAudioDurationMs] = useState<number | null>(null);
  const hasAudio = !!audioUrl;
  const prevPlaybackStateRef = useRef<'idle' | 'playing' | 'paused'>('idle');
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
  }, [panelDurationMs, playbackState, hasAudio, cycleOverride]);

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
  cloudSaveTimeoutMs: number;
  storyAssetSignedUrlSwapEnabled: boolean;
  storyIncrementalAssetSyncEnabled: boolean;
  storyAssetUploadPauseDuringGenerationEnabled: boolean;
  storyAssetSyncWarningTimeoutMs: number;
  loadingReaderScrollSpeedPxPerSecond: number;
  storyUiTextLineCount: number;
  storyUiAutoScrollEnabled: boolean;
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
  const [cycleSettings, setCycleSettings] = useState<StoryRuntimeSettings>({
    cycleOverride: false,
    cycleMs: STORYBOARD_ADVANCE_MS,
    vignetteEnabled: true,
    vignetteAmountPercent: 100,
    audioStorylinePublishEnabled: false,
    cloudSaveTimeoutMs: 20000,
    storyAssetSignedUrlSwapEnabled: false,
    storyIncrementalAssetSyncEnabled: false,
    storyAssetUploadPauseDuringGenerationEnabled: false,
    storyAssetSyncWarningTimeoutMs: 15000,
    loadingReaderScrollSpeedPxPerSecond: 24,
    storyUiTextLineCount: 7,
    storyUiAutoScrollEnabled: true,
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
  const continueCoinCost = (
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
  const visibleReaderPanel: StoryReaderPanel = isEnding ? 'story' : activeReaderPanel;
  const { scrollRef, isAutoScrolling, toggleAutoScroll, stopAutoScroll } = useStoryAutoScroll<HTMLDivElement>({
    enabled: cycleSettings.storyUiAutoScrollEnabled && !isMinimized && visibleReaderPanel === 'story',
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
  const { playbackState, togglePlayPause, play: playAudio, stop: stopAudio } = useAudioPlayer(normalizedCurrentBeat.audioUrl, currentNodeId);
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
    onNavigateNode: navigateToNode,
    onSelectOption: continueStory,
    onToggleMinimized: () => setIsMinimized(prev => !prev),
    onToggleNarration: () => {
      if (normalizedCurrentBeat.audioUrl) {
        togglePlayPause();
      } else if (!isGeneratingAudio) {
        generateNarrationForNode(currentNodeId);
      }
    },
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
            {isVerticalStory && displayImageUrl && (
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
      <main className={`relative z-10 flex-1 flex flex-col justify-end px-4 pb-[31px] pt-1 md:p-12 max-w-5xl mx-auto w-full min-h-0 transition-opacity duration-300 ${chromeVisibilityClass}`}>
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
          {!isMinimized && (
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

        <div className="grid shrink-0 md:grid-cols-12 gap-4 md:gap-8 items-end">

          {/* Story Text Card + Toggle */}
          <div
            className={`md:col-span-7 flex-col items-center relative ${
              !isMinimized && visibleReaderPanel === 'story' ? 'flex' : 'hidden md:flex'
            }`}
            onMouseEnter={() => setIsCardHovered(true)}
            onMouseLeave={() => setIsCardHovered(false)}
          >
            {/* Card chrome toggles — minimize + prompt-tools popover */}
            <div className="relative mb-2 flex items-center gap-2 self-end">
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
                {cycleSettings.storyUiAutoScrollEnabled && (
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
                  onGenerateNarration={() => generateNarrationForNode(currentNodeId)}
                  onClearGlow={clearAudioReady}
                  storyMode={storyMode}
                  onToggleStoryMode={toggleStoryMode}
                />
              </div>
            )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            style={{ opacity: isCardHovered ? 1 : 0.1 }}
            className={`touch-visible relative w-full border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-500 ${
              isMinimized ? 'bg-neutral-950/40' : 'bg-neutral-900/80'
            }`}
          >
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
                style={!isMinimized ? storyTextViewportStyle : undefined}
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

                  <p className={`transition-colors duration-500 ${
                    isMinimized ? 'text-neutral-500 line-clamp-2' : 'text-neutral-300'
                  }`}>
                    {currentBeat.storyText}
                  </p>

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
          {!isEnding && (
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

      {/* Publish Dialog */}
      {isEnding && (
        <PublishDialog
          isOpen={showPublishDialog}
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
