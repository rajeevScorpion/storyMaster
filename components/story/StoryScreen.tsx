'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import { ArrowRight, RefreshCcw, BookOpen, Check, ChevronDown, ChevronUp, Save, Loader2, Share2, ExternalLink, Compass, CloudOff, CloudUpload, CheckCircle2, ImageIcon, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import PublishDialog from './PublishDialog';
import Timeline from './Timeline';
import Link from 'next/link';
import NarrationButton from './NarrationButton';
import AutoScrollButton from './AutoScrollButton';
import { findChildForOption, getCurrentNode } from '@/lib/utils/story-map';
import { useKeyboardNavigation } from '@/lib/hooks/useKeyboardNavigation';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { useStoryAutoScroll } from '@/lib/hooks/useStoryAutoScroll';
import { getStoryboardSettings } from '@/app/actions/admin';
import StoryboardVignette from './StoryboardVignette';
import { getStoryboardPanelCropStyle, STORYBOARD_PANEL_SEQUENCE } from '@/lib/storyboard/layout';

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

type StoryReaderPanel = 'story' | 'branches';

interface StoryRuntimeSettings {
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  cloudSaveTimeoutMs: number;
  storyAssetSignedUrlSwapEnabled: boolean;
  storyIncrementalAssetSyncEnabled: boolean;
  storyAssetUploadPauseDuringGenerationEnabled: boolean;
  storyAssetSyncWarningTimeoutMs: number;
  loadingReaderScrollSpeedPxPerSecond: number;
  storyUiTextLineCount: number;
  storyUiAutoScrollEnabled: boolean;
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
  const { user } = useAuth();
  const { data: pricing } = usePricingRuntime();

  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const [cycleSettings, setCycleSettings] = useState<StoryRuntimeSettings>({
    cycleOverride: false,
    cycleMs: STORYBOARD_ADVANCE_MS,
    vignetteEnabled: true,
    vignetteAmountPercent: 100,
    cloudSaveTimeoutMs: 20000,
    storyAssetSignedUrlSwapEnabled: false,
    storyIncrementalAssetSyncEnabled: false,
    storyAssetUploadPauseDuringGenerationEnabled: false,
    storyAssetSyncWarningTimeoutMs: 15000,
    loadingReaderScrollSpeedPxPerSecond: 24,
    storyUiTextLineCount: 7,
    storyUiAutoScrollEnabled: true,
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

  const currentBeat = currentNode.data;
  const isEnding = currentBeat.isEnding;
  const continueCoinCost = (pricing.actionCosts.continue_story_new_beat ?? 1) * 10;
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
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [scrollState, setScrollState] = useState({ atTop: true, atBottom: false });
  const visibleReaderPanel: StoryReaderPanel = isEnding ? 'story' : activeReaderPanel;
  const { scrollRef, isAutoScrolling, toggleAutoScroll, stopAutoScroll } = useStoryAutoScroll<HTMLDivElement>({
    enabled: cycleSettings.storyUiAutoScrollEnabled && !isMinimized && visibleReaderPanel === 'story',
    resetKey: currentNodeId,
    pxPerSecond: cycleSettings.loadingReaderScrollSpeedPxPerSecond,
  });
  const thumbRef = useRef<HTMLDivElement>(null);
  const autoMinimizedForLoadingRef = useRef(false);

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

  // Audio player
  const isStoryboard = !!currentBeat.isStoryboard && !!currentBeat.imageUrl;
  const displayImageUrl = currentBeat.portraitImageUrl || currentBeat.imageUrl;
  const imageKey = currentBeat.imageUrl || displayImageUrl;
  const imageLoadFailed = !!imageKey && failedImageUrl === imageKey;
  const showPendingImageState = !displayImageUrl && currentBeat.imageStatus === 'pending';
  const showFailedImageState = !displayImageUrl && currentBeat.imageStatus === 'failed';
  const showSaveAlert = Boolean(saveWarning) && saveStatus !== 'unsaved';
  const canRegenerateImage = !currentBeat.imageUrl || isFallbackImageUrl(currentBeat.imageUrl) || imageLoadFailed;
  const { playbackState, togglePlayPause, play: playAudio, stop: stopAudio } = useAudioPlayer(currentBeat.audioUrl, currentNodeId);
  const isAudioReady = audioReadyNodeId === currentNodeId;
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
      if (storyMode && currentBeat.audioUrl && playbackState === 'idle') {
        playAudio();
      }
    }
  }, [currentNodeId, storyMode, currentBeat.audioUrl, playbackState, playAudio]);

  // Autoplay when audio becomes ready on current node in story mode
  useEffect(() => {
    if (storyMode && isAudioReady && currentBeat.audioUrl && playbackState === 'idle') {
      playAudio();
    }
  }, [storyMode, isAudioReady, currentBeat.audioUrl, playbackState, playAudio]);

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
      if (currentBeat.audioUrl) {
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
        useStoryStore.setState({
          saveWarning: latest.saveWarning || 'Beat media is syncing in the background.',
        });
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

  const backgroundImageOpacity = isLoading
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

  return (
    <div className="relative h-dvh bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={displayImageUrl}
            initial={isStoryboard ? { opacity: 0 } : { opacity: 0, scale: 1.05 }}
            animate={isStoryboard ? { opacity: 1 } : { opacity: 1, scale: [1, 1.08] }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.5, ease: "easeOut" },
              scale: { duration: 20, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" },
            }}
            className="absolute inset-0 scale-110 blur-2xl md:scale-100 md:blur-none"
          >
            {isStoryboard ? (
              <StoryboardCycler
                key={`${currentBeat.imageUrl}:${currentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                gridUrl={currentBeat.imageUrl!}
                audioUrl={currentBeat.audioUrl}
                cycleOverride={cycleSettings.cycleOverride}
                cycleMs={cycleSettings.cycleMs}
                vignetteEnabled={cycleSettings.vignetteEnabled}
                vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                playbackState={playbackState}
                onImageLoad={() => setFailedImageUrl((prev) => (prev === currentBeat.imageUrl ? null : prev))}
                onImageError={() => setFailedImageUrl(currentBeat.imageUrl!)}
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
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
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
      <main className={`relative z-10 flex-1 flex flex-col px-4 pb-4 pt-1 md:justify-end md:p-12 max-w-5xl mx-auto w-full min-h-0 transition-opacity duration-300 ${chromeVisibilityClass}`}>
        <div className="flex min-h-0 flex-none items-start justify-center pb-3 md:hidden">
          {(displayImageUrl || showPendingImageState || showFailedImageState) && (
            <div className="relative w-full aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/40 shadow-2xl">
              {isStoryboard ? (
                <StoryboardCycler
                  key={`mobile-window:${currentBeat.imageUrl}:${currentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                  gridUrl={currentBeat.imageUrl!}
                  audioUrl={currentBeat.audioUrl}
                  cycleOverride={cycleSettings.cycleOverride}
                  cycleMs={cycleSettings.cycleMs}
                  vignetteEnabled={cycleSettings.vignetteEnabled}
                  vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                  playbackState={playbackState}
                  imageClassName="mobile-scene-shuttle"
                  onImageLoad={() => setFailedImageUrl((prev) => (prev === currentBeat.imageUrl ? null : prev))}
                  onImageError={() => setFailedImageUrl(currentBeat.imageUrl!)}
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
            {/* Minimize/maximize toggle — attached above card */}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="mb-2 hidden p-2 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-colors md:block"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? (
                <ChevronUp className="w-5 h-5 text-neutral-300" />
              ) : (
                <ChevronDown className="w-5 h-5 text-neutral-300" />
              )}
            </button>

          {/* Card + Narration button row */}
          <div className="flex items-end gap-3 w-full md:gap-5">
            {/* Narration + Regenerate image buttons — outside card, left side */}
            {!isMinimized && (
              <div className="shrink-0 pb-3 flex flex-col items-center gap-2 md:pb-4">
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
                  hasAudio={!!currentBeat.audioUrl}
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
                              <Link
                                href={`/storyline/${lastPublishResult.storylineId}`}
                                className="ml-auto flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors"
                              >
                                View <ExternalLink className="w-3 h-3" />
                              </Link>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                              <Share2 className="w-4 h-4 shrink-0" />
                              <span>Storyline published!</span>
                              <Link
                                href={`/storyline/${lastPublishResult.storylineId}`}
                                className="ml-auto flex items-center gap-1 text-emerald-300 hover:text-emerald-200 transition-colors"
                              >
                                View <ExternalLink className="w-3 h-3" />
                              </Link>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-8 flex flex-wrap gap-3">
                        {!lastPublishResult && onSave && (
                          <button
                            onClick={() => setShowPublishDialog(true)}
                            className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-6 py-3 rounded-2xl font-medium hover:bg-emerald-500/30 transition-colors flex items-center gap-2"
                          >
                            <Share2 className="w-4 h-4" />
                            Publish Storyline
                          </button>
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

      {/* Publish Dialog */}
      {isEnding && (
        <PublishDialog
          isOpen={showPublishDialog}
          onClose={() => setShowPublishDialog(false)}
          endingNodeId={session.storyMap.currentNodeId}
        />
      )}
    </div>
  );
}
