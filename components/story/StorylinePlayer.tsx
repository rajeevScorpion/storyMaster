'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import KissagoLogo from '@/components/ui/KissagoLogo';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Bookmark,
  BookmarkCheck,
  Heart,
  Compass,
  Maximize2,
  Minimize2,
  RotateCcw,
  Volume2,
  VolumeX,
  FastForward,
  Repeat,
  BookOpen,
  Eye,
  EyeOff,
  Share2,
  Download,
  Lock,
  Loader2,
  Check,
  AlertTriangle,
  X,
  SkipForward,
  ListVideo,
} from 'lucide-react';
import { writeOpenFlowNavMeta } from '@/lib/story/open-flow-nav';
import type { StorylineSeriesContext } from '@/lib/types/series';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { useStoryTransitionPlayback } from '@/lib/hooks/useStoryTransitionPlayback';
import { useStoryAutoScroll } from '@/lib/hooks/useStoryAutoScroll';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { useStoryVideoExport } from '@/lib/hooks/useStoryVideoExport';
import {
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { authorizeCurrentUserVideoExport } from '@/app/actions/video-export';
import { checkIsAdmin } from '@/app/actions/admin';
import { getStoryboardSettings } from '@/app/actions/admin';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import { refreshStorylineSignedUrls } from '@/app/actions/exploration';
import { toggleLike, recordView, recordStorylineProgress } from '@/app/actions/engagement';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from './MyStoriesDrawer';
import ChoiceTransition from './ChoiceTransition';
import AutoScrollButton from './AutoScrollButton';
import StoryStoryboardPlayer from './StoryStoryboardPlayer';
import VideoExportDialog from './VideoExportDialog';
import type { ResolvedExportPreset } from '@/lib/video-export/presets';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import { getStoryboardPanelBoundariesMs } from '@/lib/storyboard/narration-timing';
import {
  normalizeStoryTransitionSettings,
  type StoryTransitionSettings,
} from '@/lib/story-transitions/settings';
import { getFirstBeatShareExcerpt } from '@/lib/story/share-message';
import { useSwipeNavigation } from '@/lib/hooks/useSwipeNavigation';
import { useFullscreenLandscape } from '@/lib/hooks/useFullscreenLandscape';
import type { StoryBeat } from '@/lib/types/story';
import type { StorylineChoice } from '@/lib/utils/storyline';
import { resolveVideoExportWatermarkVisibility } from '@/lib/types/pricing';
import { mergeRefreshedStorylineBeatAssetUrls } from '@/lib/media/refresh-merge';
import { preloadAudioForPlayback } from '@/lib/media/audio-preload';
import { useResolvedStoryMediaState } from '@/lib/hooks/useResolvedStoryMedia';
import { getStableMediaIdentity, getStoryPersistence, type StoryMediaAsset, type StorylineManifestPayload } from '@/lib/persistence';
import { saveStorylineAndPrefetch, saveStorylineProgress } from '@/lib/persistence/runtime';
import { requestHomeStoryReset } from '@/lib/story/home-navigation';

const SIGNED_URL_REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes
const CHOICE_TRANSITION_FADE_MS = 600;

/**
 * Long enough to read "The End" and decide to stop, short enough that letting
 * a series run does not feel like waiting.
 */
const NEXT_EPISODE_COUNTDOWN_SECONDS = 10;

const MOBILE_CONTROL_BUTTON_CLASS = 'p-2.5 rounded-full border transition-all cursor-pointer motion-safe:hover:scale-110 motion-safe:active:scale-95';
const MOBILE_CONTROL_ICON_CLASS = 'w-[1.125rem] h-[1.125rem]';
const DESKTOP_CONTROL_BUTTON_CLASS = 'p-3 rounded-full border transition-all cursor-pointer motion-safe:hover:scale-110 motion-safe:active:scale-95';
const DESKTOP_CONTROL_ICON_CLASS = 'w-5 h-5';

function StoryMediaLoadingFallback({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-300 ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
      <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">Loading scene</span>
    </div>
  );
}

interface StorylinePlayerProps {
  storylineId: string;
  storyId: string;
  title: string;
  isVerticalStory?: boolean;
  aspectRatio?: '16:9' | '9:16';
  storyTransition?: StoryTransitionSettings;
  beats: StoryBeat[];
  choices: StorylineChoice[];
  authorName: string | null;
  isOwner: boolean;
  isSaved?: boolean;
  isLiked?: boolean;
  likeCount?: number;
  isLoggedIn?: boolean;
  persistenceUserId?: string;
  sourceUpdatedAt?: string;
  /** Null for a standalone storyline, which is most of them. */
  series?: StorylineSeriesContext | null;
}

export default function StorylinePlayer({
  storylineId,
  storyId,
  title,
  isVerticalStory = false,
  aspectRatio = '16:9',
  storyTransition,
  beats,
  choices,
  authorName,
  isOwner,
  isSaved: initialSaved = false,
  isLiked: initialLiked = false,
  likeCount: initialLikeCount = 0,
  isLoggedIn = false,
  persistenceUserId,
  sourceUpdatedAt = 'legacy',
  series = null,
}: StorylinePlayerProps) {
  const normalizedStoryTransition = useMemo(
    () => normalizeStoryTransitionSettings(storyTransition),
    [storyTransition]
  );
  const isVerticalStoryline = isVerticalStory || aspectRatio === '9:16';
  const nextEpisode = series?.nextEpisode ?? null;
  const [currentBeats, setCurrentBeats] = useState(beats);
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const beatParam = new URLSearchParams(window.location.search).get('beat');
    if (beatParam) {
      const parsed = parseInt(beatParam, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < beats.length) return parsed;
    }
    return 0;
  });
  const [showChoice, setShowChoice] = useState(false);
  const [transitionChoice, setTransitionChoice] = useState<StorylineChoice | null>(null);
  const [autoPlay, setAutoPlay] = useState(true);
  const [autoReplay, setAutoReplay] = useState(false);
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isSavingToProfile, setIsSavingToProfile] = useState(false);
  const [isLiked, setIsLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [isTogglingLike, setIsTogglingLike] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [storyTextOverlayVisible, setStoryTextOverlayVisible] = useState(true);
  const [showMyStories, setShowMyStories] = useState(false);
  const [shareToastVisible, setShareToastVisible] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  /** Seconds left before the next episode takes over; null when not counting. */
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);
  const [showEpisodePicker, setShowEpisodePicker] = useState(false);
  const [restoredAudioTimeMs, setRestoredAudioTimeMs] = useState(0);
  const [audioEndedCount, setAudioEndedCount] = useState(0);
  const [cycleSettings, setCycleSettings] = useState<{
    cycleOverride: boolean;
    cycleMs: number;
    vignetteEnabled: boolean;
    vignetteAmountPercent: number;
    loadingReaderScrollSpeedPxPerSecond: number;
    storyUiTextLineCount: number;
    storyUiAutoScrollEnabled: boolean;
    storyTextOverlayWordsPerLine: number;
    storylineChoiceFlashEnabled: boolean;
    storylineChoiceFlashMs: number;
    videoDownloadEnabled: boolean;
    videoDownloadAdminBypass: boolean;
  }>({
    cycleOverride: false,
    cycleMs: STORYBOARD_ADVANCE_MS,
    vignetteEnabled: true,
    vignetteAmountPercent: 100,
    loadingReaderScrollSpeedPxPerSecond: 24,
    storyUiTextLineCount: 7,
    storyUiAutoScrollEnabled: true,
    storyTextOverlayWordsPerLine: 7,
    storylineChoiceFlashEnabled: true,
    storylineChoiceFlashMs: 3000,
    videoDownloadEnabled: false,
    videoDownloadAdminBypass: false,
  });
  const [isAdminUser, setIsAdminUser] = useState(false);
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const choiceHoldTimerRef = useRef<number | null>(null);
  const choiceAdvanceTimerRef = useRef<number | null>(null);
  // Tracked so it can be cancelled: once the modal can navigate away, an
  // orphaned timer fires against an unmounted tree.
  const endModalTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const signedUrlRefreshInFlightRef = useRef(false);
  const lastSignedUrlRefreshAtRef = useRef(Date.now());
  const progressRestoredRef = useRef(false);
  const exportParamHandledRef = useRef(false);
  const { data: pricing } = usePricingRuntime();
  // Video download gating:
  // 1. Global master toggle must be ON (admin Global Settings)
  // 2. Either: plan-level canAccessDownloads is true (via Pricing Studio)
  //    OR: admin bypass is on AND current user is the actual admin (server-verified)
  const videoDownloadGlobalOn = cycleSettings.videoDownloadEnabled;
  const adminBypassed = cycleSettings.videoDownloadAdminBypass && isAdminUser;
  const storylineHasAllBeatImages = currentBeats.every((beat) => Boolean(beat.imageUrl));
  const canDownload = videoDownloadGlobalOn
    && storylineHasAllBeatImages
    && (adminBypassed || pricing.snapshot.canAccessDownloads);
  const videoExportPreset = pricing.snapshot.videoExportPreset;
  const showVideoWatermark = resolveVideoExportWatermarkVisibility(
    videoExportPreset,
    pricing.snapshot.canAccessUnbrandedExports
  );
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
  } = useStoryVideoExport();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const { isFullscreen, showRotateHint, toggle: toggleFullscreen, dismissHint } = useFullscreenLandscape(containerRef);

  useEffect(() => {
    getStoryboardSettings().then(setCycleSettings).catch(() => {/* use defaults */});
  }, []);

  useEffect(() => {
    setCurrentBeats(beats);
  }, [beats]);

  // Check if current user is admin (for bypass gating — server-verified against ADMIN_USER_ID)
  useEffect(() => {
    if (isLoggedIn) {
      checkIsAdmin().then(setIsAdminUser).catch(() => setIsAdminUser(false));
    }
  }, [isLoggedIn]);

  // Auto-open the export dialog when arriving via the post-publish "Export
  // Video" link (?export=1). Download gating resolves asynchronously (settings
  // + pricing), so wait for canDownload before consuming the param; if the
  // user isn't allowed to export, the param is left alone and the standard
  // locked/upsell export button applies.
  useEffect(() => {
    if (exportParamHandledRef.current || !canDownload) return;
    const url = new URL(window.location.href);
    exportParamHandledRef.current = true;
    if (url.searchParams.get('export') !== '1') return;
    url.searchParams.delete('export');
    window.history.replaceState(null, '', url.toString());
    setExportDialogOpen(true);
  }, [canDownload]);

  // Sync current beat index to URL for persistence across refresh
  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentIndex === 0) {
      url.searchParams.delete('beat');
    } else {
      url.searchParams.set('beat', String(currentIndex));
    }
    window.history.replaceState(null, '', url.toString());
  }, [currentIndex]);

  useEffect(() => {
    if (!persistenceUserId || progressRestoredRef.current) return;
    progressRestoredRef.current = true;
    void getStoryPersistence().getProgress({
      readerKind: 'storyline',
      storyId,
      storylineId,
      userId: persistenceUserId,
    }).then((progress) => {
      if (!progress || progress.readerKind !== 'storyline') return;
      const hasExplicitBeat = new URLSearchParams(window.location.search).has('beat');
      const nextIndex = !hasExplicitBeat
        && progress.currentPageIndex >= 0
        && progress.currentPageIndex < currentBeats.length
        ? progress.currentPageIndex
        : currentIndex;
      setCurrentIndex(nextIndex);
      if (progress.currentPageIndex === nextIndex) setRestoredAudioTimeMs(progress.audioTimeMs);
    });
  }, [currentBeats.length, currentIndex, persistenceUserId, storyId, storylineId]);

  // Refresh signed URLs before they expire (every 50 minutes)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const refreshed = await refreshStorylineSignedUrls(storylineId);
        setCurrentBeats((current) => mergeRefreshedStorylineBeatAssetUrls(current, refreshed));
        lastSignedUrlRefreshAtRef.current = Date.now();
      } catch {
        // Silent fail — URLs will still work until full expiry
      }
    }, SIGNED_URL_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [storylineId]);

  useEffect(() => {
    const handleForeground = async () => {
      if (
        document.hidden
        || signedUrlRefreshInFlightRef.current
        || Date.now() - lastSignedUrlRefreshAtRef.current < SIGNED_URL_REFRESH_INTERVAL
      ) {
        return;
      }

      signedUrlRefreshInFlightRef.current = true;
      try {
        const refreshed = await refreshStorylineSignedUrls(storylineId);
        setCurrentBeats((current) => mergeRefreshedStorylineBeatAssetUrls(current, refreshed));
        lastSignedUrlRefreshAtRef.current = Date.now();
      } catch {
        // Retry on the next foreground event while the current URLs remain usable.
      } finally {
        signedUrlRefreshInFlightRef.current = false;
      }
    };

    const resume = () => void handleForeground();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [storylineId]);

  const handleToggleSave = async () => {
    if (isSavingToProfile) return;
    setIsSavingToProfile(true);
    try {
      if (isSaved) {
        await unsaveStoryline(storylineId);
        setIsSaved(false);
      } else {
        await saveStorylineToProfile(storylineId);
        setIsSaved(true);
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
    } finally {
      setIsSavingToProfile(false);
    }
  };

  const handleToggleLike = async () => {
    if (isTogglingLike) return;
    setIsTogglingLike(true);
    try {
      const result = await toggleLike(storylineId);
      setIsLiked(result.liked);
      setLikeCount(result.likeCount);
    } catch (error) {
      console.error('Failed to toggle like:', error);
    } finally {
      setIsTogglingLike(false);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/storyline/${storylineId}`;
    const text = getFirstBeatShareExcerpt(currentBeats) ?? undefined;
    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {});
    } else {
      try {
        await navigator.clipboard.writeText(text ? `${title}\n\n${text}\n\n${url}` : url);
        setShareToastVisible(true);
        setTimeout(() => setShareToastVisible(false), 3000);
      } catch (error) {
        console.error('Failed to copy share link:', error);
      }
    }
  };
  const handleLogoClick = () => {
    requestHomeStoryReset();
  };

  // Record view on mount (fire-and-forget)
  useEffect(() => {
    if (isLoggedIn) {
      recordView(storylineId).catch(() => {});
    }
  }, [storylineId, isLoggedIn]);

  const currentBeat = currentBeats[currentIndex];
  const imageAsset = useMemo<StoryMediaAsset | undefined>(() => {
    if (!persistenceUserId || !currentBeat.imageUrl || currentBeat.imageUrl.startsWith('data:')) return undefined;
    return {
      assetId: getStableMediaIdentity(currentBeat.imageUrl, 'image'),
      storyId,
      storylineId,
      pageId: String(currentIndex),
      userId: persistenceUserId,
      kind: 'image',
      remoteUrl: currentBeat.imageUrl,
      version: currentBeat.imageVersion || sourceUpdatedAt,
    };
  }, [currentBeat.imageUrl, currentBeat.imageVersion, currentIndex, persistenceUserId, sourceUpdatedAt, storyId, storylineId]);
  const audioAsset = useMemo<StoryMediaAsset | undefined>(() => {
    if (!persistenceUserId || !currentBeat.audioUrl || currentBeat.audioUrl.startsWith('data:')) return undefined;
    return {
      assetId: getStableMediaIdentity(currentBeat.audioUrl, 'audio'),
      storyId,
      storylineId,
      pageId: String(currentIndex),
      userId: persistenceUserId,
      kind: 'audio',
      remoteUrl: currentBeat.audioUrl,
      version: currentBeat.audioVersion || sourceUpdatedAt,
    };
  }, [currentBeat.audioUrl, currentBeat.audioVersion, currentIndex, persistenceUserId, sourceUpdatedAt, storyId, storylineId]);
  const resolvedImage = useResolvedStoryMediaState(imageAsset);
  const resolvedImageUrl = imageAsset ? resolvedImage.url : currentBeat.imageUrl;
  const imageIsResolving = Boolean(imageAsset && resolvedImage.isResolving);
  const resolvedAudio = useResolvedStoryMediaState(audioAsset);
  const resolvedAudioUrl = audioAsset ? resolvedAudio.url : currentBeat.audioUrl;
  const nextBeatAudioUrl = currentBeats[currentIndex + 1]?.audioUrl;
  const followingBeatAudioUrl = currentBeats[currentIndex + 2]?.audioUrl;
  const isStoryboard = Boolean(currentBeat.imageUrl && isStoryboardBeat(currentBeat));
  const hasStoryTextOverlay = Boolean(currentBeat.storyTextOverlayCaptions?.length);
  const storyTextOverlayEnabled = storyTextOverlayVisible && currentBeat.storyTextOverlayEnabled !== false;
  const storyTextOverlayHighlightSupported = currentBeat.storyTextOverlayAlignment?.textHighlightSupported !== false;
  const displayImageUrl = currentBeat.portraitImageUrl || resolvedImageUrl;
  const visualKey = `storyline-${currentIndex}:${currentBeat.portraitImageUrl ?? currentBeat.imageUrl ?? 'audio'}`;
  const {
    scrollRef: storyScrollRef,
    isAutoScrolling,
    toggleAutoScroll,
    stopAutoScroll,
  } = useStoryAutoScroll<HTMLDivElement>({
    enabled: cycleSettings.storyUiAutoScrollEnabled && !isMinimized,
    resetKey: currentIndex,
    pxPerSecond: cycleSettings.loadingReaderScrollSpeedPxPerSecond,
  });
  const storyTextViewportStyle = {
    height: `min(46vh, calc(${cycleSettings.storyUiTextLineCount} * 1lh))`,
  } satisfies CSSProperties;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === currentBeats.length - 1;
  const exportPhaseLabel = exportPhase === 'loading'
    ? 'Loading encoder'
    : exportPhase === 'preparing'
    ? 'Preparing scenes'
    : exportPhase === 'encoding'
    ? 'Rendering video'
    : exportPhase === 'finalizing'
    ? 'Finalizing file'
    : 'Exporting video';
  const isCompatibilityExport = exportEngine === 'compatibility';

  const {
    playbackState,
    togglePlayPause,
    play: playAudio,
    pause: pauseAudio,
    stop: stopAudio,
    seekTo: seekAudio,
    currentTimeMs: audioElapsedMs,
    durationMs: audioDurationMs,
    volume,
    setVolume,
  } = useAudioPlayer(
    resolvedAudioUrl || undefined,
    `storyline-${currentIndex}`,
    {
      initialTimeMs: restoredAudioTimeMs,
      onEnded: () => setAudioEndedCount((count) => count + 1),
      onProgress: (audioTimeMs) => {
        if (!persistenceUserId) return;
        void saveStorylineProgress({
          storylineId,
          storyId,
          userId: persistenceUserId,
          currentPageIndex: currentIndex,
          audioTimeMs,
          completed: currentIndex === currentBeats.length - 1 && currentBeat.isEnding,
        });
      },
    }
  );

  useEffect(() => {
    const urls = [nextBeatAudioUrl, followingBeatAudioUrl]
      .filter((url): url is string => Boolean(url));
    urls.forEach((url) => {
      void preloadAudioForPlayback(url);
    });
  }, [followingBeatAudioUrl, nextBeatAudioUrl]);
  const storyboardAudioDurationMs = audioDurationMs > 0
    ? audioDurationMs
    : currentBeat.narrationMetadata?.durationMs ?? 0;
  const storyPanelBoundariesMs = useMemo(
    () => getStoryboardPanelBoundariesMs(
      Math.max(1, storyboardAudioDurationMs),
      currentBeat.storyboardNarrationTiming
    ),
    [currentBeat.storyboardNarrationTiming, storyboardAudioDurationMs]
  );
  const storyTransitionPlayback = useStoryTransitionPlayback({
    enabled: isStoryboard && storyboardAudioDurationMs > 0,
    narrationBoundariesMs: storyPanelBoundariesMs,
    settings: normalizedStoryTransition,
    narrationTimeMs: audioElapsedMs,
    playbackState,
    pauseNarrationDuringTransition: false,
    pause: pauseAudio,
    play: playAudio,
    seekNarration: seekAudio,
  });

  useEffect(() => {
    if (!persistenceUserId) return;
    const payload: StorylineManifestPayload = {
      storylineId,
      storyId,
      title,
      isVerticalStory: isVerticalStoryline,
      aspectRatio: isVerticalStoryline ? '9:16' : '16:9',
      storyTransition: normalizedStoryTransition,
      beats: currentBeats,
      choices,
      authorName,
      isOwner,
      isSaved,
      isLiked,
      likeCount,
      isLoggedIn,
    };
    void saveStorylineAndPrefetch({
      payload,
      userId: persistenceUserId,
      sourceUpdatedAt,
      currentPageIndex: currentIndex,
    });
  }, [authorName, choices, currentBeats, currentIndex, isLoggedIn, isLiked, isOwner, isSaved, isVerticalStoryline, likeCount, normalizedStoryTransition, persistenceUserId, sourceUpdatedAt, storyId, storylineId, title]);

  const persistPage = useCallback((pageIndex: number) => {
    if (!persistenceUserId) return;
    const beat = currentBeats[pageIndex];
    const completed = pageIndex === currentBeats.length - 1 && Boolean(beat?.isEnding);

    void saveStorylineProgress({
      storylineId,
      storyId,
      userId: persistenceUserId,
      currentPageIndex: pageIndex,
      completed,
    });

    // Server copy for the gallery's Continue Watching rail and finished badge.
    // Written on page turns only — the local save above also runs on every
    // audio tick, which is far too often for a network round-trip.
    if (isLoggedIn) {
      void recordStorylineProgress({
        storylineId,
        beatIndex: pageIndex,
        beatCount: currentBeats.length,
        completed,
      });
    }
  }, [currentBeats, isLoggedIn, persistenceUserId, storyId, storylineId]);

  const clearChoiceTransitionTimers = useCallback(() => {
    if (choiceHoldTimerRef.current) {
      window.clearTimeout(choiceHoldTimerRef.current);
      choiceHoldTimerRef.current = null;
    }
    if (choiceAdvanceTimerRef.current) {
      window.clearTimeout(choiceAdvanceTimerRef.current);
      choiceAdvanceTimerRef.current = null;
    }
  }, []);

  const clearEndModalTimer = useCallback(() => {
    if (endModalTimerRef.current !== null) {
      window.clearTimeout(endModalTimerRef.current);
      endModalTimerRef.current = null;
    }
  }, []);

  const cancelNextEpisodeCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setNextEpisodeCountdown(null);
  }, []);

  /**
   * Hand off to the next episode.
   *
   * A full route push and remount is the right shape, not a compromise: the
   * loader has to re-run its cache-versus-network race and preload a different
   * set of media, and the player holds an audio element, a signed-URL refresh
   * interval and a few dozen state atoms all keyed to this storyline.
   *
   * `?beat=0` is load-bearing. The player treats an explicit beat param as a
   * signal to ignore saved progress, so without it, auto-advancing into an
   * episode the viewer already finished would restore them to its last beat and
   * reopen this very modal. Opening an episode from the gallery passes no beat
   * param and still resumes, which is the behaviour we want in that direction.
   */
  const goToNextEpisode = useCallback(() => {
    const next = series?.nextEpisode;
    if (!next) return;

    cancelNextEpisodeCountdown();
    clearEndModalTimer();
    stopAudio();
    setShowEndModal(false);

    writeOpenFlowNavMeta({
      kind: 'storyline',
      title: next.title,
      coverImageUrl: null,
      coverIsStoryboard: false,
      beatCount: next.beatCount,
    });

    router.push(`/storyline/${next.storylineId}?beat=0`);
  }, [cancelNextEpisodeCountdown, clearEndModalTimer, router, series, stopAudio]);

  // Read by the countdown so the interval never has to be torn down and rebuilt
  // just because a dependency of the navigation changed.
  const goToNextEpisodeRef = useRef(goToNextEpisode);
  useEffect(() => {
    goToNextEpisodeRef.current = goToNextEpisode;
  }, [goToNextEpisode]);

  const clearChoiceTransition = useCallback(() => {
    clearChoiceTransitionTimers();
    setShowChoice(false);
    setTransitionChoice(null);
  }, [clearChoiceTransitionTimers]);

  const goNext = useCallback(() => {
    if (isLast || showChoice) return;

    const nextChoice = choices[currentIndex];
    const advanceToNextBeat = () => {
      const nextIndex = Math.min(currentIndex + 1, currentBeats.length - 1);
      setRestoredAudioTimeMs(0);
      setCurrentIndex(nextIndex);
      persistPage(nextIndex);
    };

    if (cycleSettings.storylineChoiceFlashEnabled && nextChoice) {
      if (playbackState !== 'idle') stopAudio();
      clearChoiceTransitionTimers();
      setTransitionChoice(nextChoice);
      setShowChoice(true);

      if (autoPlay) {
        // Keep the choice flash as a visual overlay, but do not hold the next
        // beat's narration while autoplay is active.
        advanceToNextBeat();
        choiceHoldTimerRef.current = window.setTimeout(() => {
          setShowChoice(false);
          choiceHoldTimerRef.current = null;
          choiceAdvanceTimerRef.current = window.setTimeout(() => {
            setTransitionChoice(null);
            choiceAdvanceTimerRef.current = null;
          }, CHOICE_TRANSITION_FADE_MS);
        }, Math.max(500, cycleSettings.storylineChoiceFlashMs));
        return;
      }

      choiceHoldTimerRef.current = window.setTimeout(() => {
        advanceToNextBeat();
        setShowChoice(false);
        choiceHoldTimerRef.current = null;
        choiceAdvanceTimerRef.current = window.setTimeout(() => {
          setTransitionChoice(null);
          choiceAdvanceTimerRef.current = null;
        }, CHOICE_TRANSITION_FADE_MS);
      }, Math.max(500, cycleSettings.storylineChoiceFlashMs));
      return;
    }

    clearChoiceTransition();
    advanceToNextBeat();
  }, [
    clearChoiceTransition,
    clearChoiceTransitionTimers,
    autoPlay,
    currentBeats.length,
    currentIndex,
    cycleSettings.storylineChoiceFlashEnabled,
    cycleSettings.storylineChoiceFlashMs,
    isLast,
    persistPage,
    playbackState,
    choices,
    showChoice,
    stopAudio,
  ]);

  const goPrev = useCallback(() => {
    if (isFirst) return;
    stopAudio();
    clearChoiceTransition();
    const nextIndex = currentIndex - 1;
    setRestoredAudioTimeMs(0);
    setCurrentIndex(nextIndex);
    persistPage(nextIndex);
  }, [clearChoiceTransition, currentIndex, isFirst, persistPage, stopAudio]);

  const jumpToBeat = useCallback((index: number) => {
    if (index === currentIndex) return;
    stopAudio();
    clearChoiceTransition();
    setRestoredAudioTimeMs(0);
    setCurrentIndex(index);
    persistPage(index);
  }, [clearChoiceTransition, currentIndex, persistPage, stopAudio]);

  const replay = useCallback(() => {
    stopAudio();
    clearChoiceTransition();
    setShowEndModal(false);
    setRestoredAudioTimeMs(0);
    setCurrentIndex(0);
    persistPage(0);
  }, [clearChoiceTransition, persistPage, stopAudio]);

  // Auto-play narration when beat changes and autoPlay is on
  const prevIndexRef = useRef(currentIndex);
  const pendingAutoPlayIndexRef = useRef<number | null>(autoPlay ? currentIndex : null);
  const previousAutoPlayRef = useRef(autoPlay);
  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      prevIndexRef.current = currentIndex;
      pendingAutoPlayIndexRef.current = currentIndex;
    }
    if (autoPlay && !previousAutoPlayRef.current) {
      pendingAutoPlayIndexRef.current = currentIndex;
    }
    previousAutoPlayRef.current = autoPlay;
    if (!autoPlay) {
      pendingAutoPlayIndexRef.current = null;
      return;
    }
    if (
      pendingAutoPlayIndexRef.current === currentIndex
      && resolvedAudioUrl
      && playbackState === 'idle'
    ) {
      pendingAutoPlayIndexRef.current = null;
      playAudio();
    }
  }, [currentIndex, autoPlay, resolvedAudioUrl, playbackState, playAudio]);

  // Advance only for a genuine media-ended event. Pauses and manual navigation must not advance.
  const handledAudioEndedCountRef = useRef(0);
  useEffect(() => {
    if (handledAudioEndedCountRef.current === audioEndedCount) return;
    handledAudioEndedCountRef.current = audioEndedCount;
    if (!autoPlay) return;

    if (isLast && currentBeat.isEnding) {
      // Loop is an explicit request and outranks anything the ending would
      // otherwise offer. Checked inside this branch rather than after it: the
      // ending case used to match first and swallow it, so turning loop on and
      // reaching a proper ending silently did nothing.
      if (autoReplay) {
        queueMicrotask(() => replay());
        return;
      }
      clearEndModalTimer();
      endModalTimerRef.current = window.setTimeout(() => {
        endModalTimerRef.current = null;
        setShowEndModal(true);
      }, 1500);
      return;
    }

    if (isLast && autoReplay) {
      queueMicrotask(() => replay());
    } else if (!isLast) {
      queueMicrotask(() => goNext());
    }
  }, [audioEndedCount, autoPlay, autoReplay, isLast, currentBeat.isEnding, goNext, replay, clearEndModalTimer]);

  // Show end modal after delay when manually navigating to ending beat without audio
  useEffect(() => {
    if (isLast && currentBeat.isEnding && !currentBeat.audioUrl) {
      const timer = setTimeout(() => setShowEndModal(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [isLast, currentBeat.isEnding, currentBeat.audioUrl]);

  useEffect(() => {
    if (isMinimized) {
      stopAutoScroll();
    }
  }, [isMinimized, stopAutoScroll]);

  useEffect(() => {
    return () => {
      clearChoiceTransitionTimers();
      clearEndModalTimer();
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [clearChoiceTransitionTimers, clearEndModalTimer]);

  /**
   * Auto-advance into the next episode once the ending has landed.
   *
   * Only when the reader had autoplay on — they were already letting it run —
   * and never when loop is on, which is an explicit request to stay put.
   * Reduced motion opts out too: an unrequested navigation is motion.
   */
  useEffect(() => {
    if (!showEndModal || !series?.nextEpisode) return;
    if (!autoPlay || autoReplay || prefersReducedMotion) return;

    setNextEpisodeCountdown(NEXT_EPISODE_COUNTDOWN_SECONDS);
    countdownTimerRef.current = window.setInterval(() => {
      setNextEpisodeCountdown((remaining) => {
        if (remaining === null) return null;
        if (remaining > 1) return remaining - 1;
        if (countdownTimerRef.current !== null) {
          window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        // Deferred: navigating from inside a state updater would run a router
        // push during render.
        queueMicrotask(() => goToNextEpisodeRef.current());
        return null;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [showEndModal, series, autoPlay, autoReplay, prefersReducedMotion]);

  // Warm the next episode's route only once the reader is actually at the end,
  // rather than for every storyline anyone opens.
  useEffect(() => {
    if (!isLast || !series?.nextEpisode) return;
    router.prefetch(`/storyline/${series.nextEpisode.storylineId}`);
  }, [isLast, router, series]);

  // Keyboard navigation
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (key === 'p') {
        togglePlayPause();
      } else if (key === 'm') {
        setIsMinimized(prev => !prev);
      } else if (key === 'r') {
        replay();
      } else if (key === 'v') {
        setVolume(volumeRef.current === 0 ? 1 : 0);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, togglePlayPause, replay, setVolume]);

  // Swipe navigation for mobile
  const { dragX, onPan, onPanEnd } = useSwipeNavigation({
    onSwipeLeft: goNext,
    onSwipeRight: goPrev,
  });

  const beatTransitionSeconds = normalizedStoryTransition.durationMs / 1000;
  const beatTransitionIsBlack = normalizedStoryTransition.type === 'fade-black';
  const beatTransitionIsSoft = normalizedStoryTransition.type === 'soft-fade';
  const beatTransitionIsFast = normalizedStoryTransition.type === 'fast-cut';
  const beatTransitionMotionSeconds = beatTransitionIsBlack
    ? beatTransitionSeconds / 2
    : beatTransitionSeconds;
  const beatTransitionInitial = beatTransitionIsFast
    ? { opacity: 1 }
    : beatTransitionIsSoft
      ? { opacity: 0, filter: 'blur(8px)' }
      : { opacity: 0 };
  const beatTransitionAnimate = beatTransitionIsSoft
    ? { opacity: 1, filter: 'blur(0px)', scale: [1, 1.06] }
    : { opacity: 1, scale: [1, 1.06] };
  const beatTransitionExit = beatTransitionIsFast
    ? { opacity: 1 }
    : beatTransitionIsSoft
      ? { opacity: 0, filter: 'blur(8px)' }
      : { opacity: 0 };

  return (
    <div ref={containerRef} className="relative h-dvh bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode={beatTransitionIsBlack ? 'wait' : 'sync'} initial={false}>
          <motion.div
            key={visualKey}
            initial={beatTransitionInitial}
            animate={beatTransitionAnimate}
            exit={beatTransitionExit}
            transition={{
              opacity: { duration: beatTransitionMotionSeconds, ease: 'easeInOut' },
              filter: { duration: beatTransitionMotionSeconds, ease: 'easeInOut' },
              scale: { duration: 20, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
            }}
            // The perpetual ambient scale animates a blur-2xl fullscreen
            // layer; will-change promotes it so the blur rasterizes once
            // instead of repainting on every animation frame.
            style={{ willChange: 'transform' }}
            className={isVerticalStoryline ? 'absolute inset-0' : 'absolute inset-0 scale-110 blur-2xl md:scale-100 md:blur-none'}
          >
            <div className={isVerticalStoryline ? 'absolute inset-0 md:scale-110 md:blur-2xl' : 'contents'}>
            {isStoryboard && resolvedImageUrl ? (
              <div className={`absolute inset-0 transition-opacity duration-500 ${
                isVerticalStoryline ? (isMinimized ? 'opacity-95 md:opacity-60' : 'opacity-95 md:opacity-40') : (isMinimized ? 'opacity-60' : 'opacity-40')
              }`}>
                <StoryStoryboardPlayer
                  key={`${currentBeat.imageUrl}:${currentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                  gridUrl={resolvedImageUrl!}
                  audioUrl={resolvedAudioUrl || undefined}
                  audioElapsedMs={audioElapsedMs}
                  audioDurationMs={storyboardAudioDurationMs}
                  cycleOverride={cycleSettings.cycleOverride}
                  cycleMs={cycleSettings.cycleMs}
                  vignetteEnabled={cycleSettings.vignetteEnabled}
                  vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                  playbackState={playbackState}
                  narrationTiming={currentBeat.storyboardNarrationTiming}
                  textOverlayEnabled={false}
                  storyTextOverlayCaptions={currentBeat.storyTextOverlayCaptions}
                  storyTextOverlayEnabled={storyTextOverlayEnabled}
                  storyTextOverlayMode={currentBeat.storyTextOverlayMode}
                  storyTextOverlayStyle={currentBeat.storyTextOverlayStyle}
                  storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
                  storyTextOverlayTextHighlightSupported={storyTextOverlayHighlightSupported}
                  storyTransitionSettings={normalizedStoryTransition}
                  activeStoryTransition={storyTransitionPlayback.activeTransition}
                  storyEffects={currentBeat.storyEffects}
                  effectSeed={`${storylineId}:${currentIndex}`}
                />
              </div>
            ) : displayImageUrl ? (
              <Image
                src={displayImageUrl}
                alt={currentBeat.sceneSummary}
                fill
                className={`object-cover transition-opacity duration-500 ${
                  isVerticalStoryline ? (isMinimized ? 'opacity-95 md:opacity-60' : 'opacity-95 md:opacity-40') : (isMinimized ? 'opacity-60' : 'opacity-40')
                }`}
                referrerPolicy="no-referrer"
                priority
                unoptimized
              />
            ) : imageIsResolving ? (
              <StoryMediaLoadingFallback />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.86),rgba(2,6,23,0.96))] px-6 text-center">
                <div className="max-w-md rounded-3xl border border-white/10 bg-neutral-950/35 px-6 py-5 backdrop-blur-md">
                  <div className="flex justify-center">
                    <BookOpen className="h-8 w-8 text-sky-200" />
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-[0.22em] text-sky-200">Audio Story</p>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-300">
                    This beat was published without a storyboard image. Narration and text continue normally.
                  </p>
                </div>
              </div>
            )}
            </div>
            {isVerticalStoryline && (displayImageUrl || imageIsResolving) && (
              <div className="absolute inset-0 hidden items-center justify-center px-8 py-20 md:flex">
                <div className="relative h-full max-h-[min(78vh,900px)] aspect-[9/16] overflow-hidden rounded-[28px] border border-white/15 bg-neutral-950/50 shadow-2xl">
                  {isStoryboard && resolvedImageUrl ? (
                    <StoryStoryboardPlayer
                      key={`vertical-window:${currentBeat.imageUrl}:${currentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                      gridUrl={resolvedImageUrl!}
                      audioUrl={resolvedAudioUrl || undefined}
                      audioElapsedMs={audioElapsedMs}
                      audioDurationMs={storyboardAudioDurationMs}
                      cycleOverride={cycleSettings.cycleOverride}
                      cycleMs={cycleSettings.cycleMs}
                      vignetteEnabled={cycleSettings.vignetteEnabled}
                      vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                      playbackState={playbackState}
                      narrationTiming={currentBeat.storyboardNarrationTiming}
                      textOverlayEnabled={false}
                      storyTextOverlayCaptions={currentBeat.storyTextOverlayCaptions}
                      storyTextOverlayEnabled={storyTextOverlayEnabled}
                      storyTextOverlayMode={currentBeat.storyTextOverlayMode}
                      storyTextOverlayStyle={currentBeat.storyTextOverlayStyle}
                      storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
                      storyTextOverlayTextHighlightSupported={storyTextOverlayHighlightSupported}
                      storyTransitionSettings={normalizedStoryTransition}
                      activeStoryTransition={storyTransitionPlayback.activeTransition}
                      storyEffects={currentBeat.storyEffects}
                      effectSeed={`${storylineId}:${currentIndex}`}
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
                    />
                  ) : imageIsResolving ? (
                    <StoryMediaLoadingFallback />
                  ) : null}
                </div>
              </div>
            )}
            <motion.div
              initial={false}
              animate={{
                height: isMinimized ? '20%' : '60%',
                opacity: isMinimized ? 0.5 : 0.7,
              }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950 via-neutral-950/90 to-transparent"
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Header */}
      <header className="relative z-20 shrink-0 bg-gradient-to-b from-neutral-950/80 to-transparent px-4 pb-2 pt-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-4">
            {/* Kissago branding — matches main page style */}
            <KissagoLogo fixed={false} onClick={handleLogoClick} />
            <div className="hidden md:block">
              {series && (
                <p className="max-w-[22rem] truncate text-[10px] font-sans font-semibold uppercase tracking-[0.14em] text-emerald-400/90">
                  Ep {series.episodeNumber}
                  {series.seriesTitle ? ` · ${series.seriesTitle}` : ''}
                </p>
              )}
              <h1 className="text-lg font-serif tracking-wide text-neutral-200">{title}</h1>
              {authorName && (
                <p className="text-xs text-neutral-500 font-sans">by {authorName}</p>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto pl-1 text-sm font-sans uppercase tracking-widest text-neutral-400 scrollbar-none [&>*]:shrink-0 md:gap-3 md:overflow-visible md:pl-0">
              <span className="shrink-0 text-xs">Beat {currentIndex + 1} / {currentBeats.length}</span>

          {/* Episode picker. Sits inside the scrolling action row rather than
              beside the title so it survives the mobile overflow. */}
          {series && series.episodes.length > 1 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setShowEpisodePicker((open) => !open)}
                aria-expanded={showEpisodePicker}
                aria-haspopup="true"
                title={`Episode ${series.episodeNumber}${series.seriesTitle ? ` of ${series.seriesTitle}` : ''}`}
                className={`flex items-center gap-1 rounded-full px-2 py-2 text-xs transition-all ${
                  showEpisodePicker
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-neutral-500 hover:bg-white/10 hover:text-neutral-200'
                }`}
              >
                <ListVideo className="w-4 h-4" />
                Ep {series.episodeNumber}
              </button>

              <AnimatePresence>
                {showEpisodePicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full z-30 mt-2 max-h-72 w-64 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur-xl"
                  >
                    {series.seriesTitle && (
                      <p className="truncate px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                        {series.seriesTitle}
                      </p>
                    )}
                    {series.episodes.map((episode) => {
                      const isCurrent = episode.storylineId === storylineId;
                      return (
                        <button
                          key={episode.storylineId}
                          onClick={() => {
                            setShowEpisodePicker(false);
                            if (isCurrent) return;
                            stopAudio();
                            writeOpenFlowNavMeta({
                              kind: 'storyline',
                              title: episode.title,
                              coverImageUrl: null,
                              coverIsStoryboard: false,
                              beatCount: episode.beatCount,
                            });
                            router.push(`/storyline/${episode.storylineId}`);
                          }}
                          aria-current={isCurrent ? 'true' : undefined}
                          className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs normal-case tracking-normal transition-colors ${
                            isCurrent
                              ? 'bg-emerald-500/15 text-emerald-200'
                              : 'text-neutral-300 hover:bg-white/5 hover:text-neutral-100'
                          }`}
                        >
                          <span
                            className={`w-8 shrink-0 tabular-nums ${
                              isCurrent ? 'text-emerald-300' : 'text-neutral-500'
                            }`}
                          >
                            Ep {episode.episodeNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{episode.title}</span>
                          {isCurrent && <Play className="h-3 w-3 shrink-0 fill-current" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Save to profile button — logged-in only */}
          {isLoggedIn && (
            <button
              onClick={handleToggleSave}
              disabled={isSavingToProfile}
              className={`p-2 rounded-full transition-all ${
                isSaved
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'hover:bg-white/10 text-neutral-500 hover:text-neutral-200'
              }`}
              title={isSaved ? 'Remove from saved' : 'Save to my storylines'}
            >
              {isSaved ? (
                <BookmarkCheck className="w-4 h-4" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Like button — logged-in only */}
          {isLoggedIn && (
            <button
              onClick={handleToggleLike}
              disabled={isTogglingLike}
              className={`p-2 rounded-full transition-all flex items-center gap-1 ${
                isLiked
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'hover:bg-white/10 text-neutral-500 hover:text-neutral-200'
              }`}
              title={isLiked ? 'Unlike' : 'Like this storyline'}
            >
              {isLiked ? (
                <Heart className="w-4 h-4" fill="currentColor" strokeWidth={0} />
              ) : (
                <Heart className="w-4 h-4" />
              )}
              {likeCount > 0 && (
                <span className="text-xs">{likeCount}</span>
              )}
            </button>
          )}

          {/* Share button — logged-in only */}
          {isLoggedIn && (
            <button
              onClick={handleShare}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-neutral-500 hover:text-neutral-200"
              title="Share storyline"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}

          {/* Download video — hidden when global toggle is off; locked upsell for unpaid plans */}
          {videoDownloadGlobalOn && (
            canDownload ? (
              <button
                onClick={() => {
                  if (!isExporting) setExportDialogOpen(true);
                }}
                disabled={isExporting}
                className={`flex items-center gap-1.5 rounded-full p-2 text-xs font-sans uppercase tracking-widest transition-all duration-300 [&>span]:hidden md:px-2.5 md:py-1.5 md:[&>span]:inline ${
                  isExporting
                    ? 'bg-white/5 text-neutral-500 cursor-wait'
                    : 'bg-white/5 hover:bg-white/10 text-neutral-300 cursor-pointer'
                }`}
                title={isExporting ? `Exporting… ${exportProgress}%` : 'Download storyline as video'}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{exportPhase === 'loading' ? 'Loading…' : `${exportProgress}%`}</span>
                  </>
                ) : exportProgress === 100 ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Saved</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </>
                )}
              </button>
            ) : storylineHasAllBeatImages ? (
              <button
                onClick={() => window.open('/wallet', '_blank')}
                className="flex items-center gap-1.5 rounded-full bg-white/5 p-2 text-xs font-sans uppercase tracking-widest text-neutral-500 transition-all duration-300 cursor-pointer hover:bg-white/10 hover:text-neutral-400 [&>span]:hidden md:px-2.5 md:py-1.5 md:[&>span]:inline"
                title="Video export — available on Plus and above"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
            ) : (
              <button
                disabled
                className="flex items-center gap-1.5 rounded-full bg-white/5 p-2 text-xs font-sans uppercase tracking-widest text-neutral-500 transition-all duration-300 cursor-not-allowed [&>span]:hidden md:px-2.5 md:py-1.5 md:[&>span]:inline"
                title="Video export needs an image on every beat."
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Images Needed</span>
              </button>
            )
          )}
          {exportError && (
            <span className="text-xs text-red-400" title={exportError}>
              <AlertTriangle className="w-3.5 h-3.5 inline" />
            </span>
          )}
          <VideoExportDialog
            open={exportDialogOpen}
            onClose={() => setExportDialogOpen(false)}
            onSelect={async (enginePreset: ResolvedExportPreset) => {
              setExportDialogOpen(false);
              if (isExporting) return;
              const exportOptions = {
                aspectRatio: (isVerticalStoryline ? '9:16' : '16:9') as '9:16' | '16:9',
                videoExportPreset,
                exportEnginePreset: enginePreset,
                showWatermark: showVideoWatermark,
                cycleOverride: cycleSettings.cycleOverride,
                cycleMs: cycleSettings.cycleMs,
                storyTextOverlayWordsPerLine: cycleSettings.storyTextOverlayWordsPerLine,
                storyTransition: normalizedStoryTransition,
              };
              // Admin bypass skips billing; regular users go through beat authorization
              if (!adminBypassed) {
                const auth = await authorizeCurrentUserVideoExport({
                  presetId: enginePreset.id,
                  idempotencyKey: `export-${storylineId}-${Date.now()}`,
                  relatedStorylineId: storylineId,
                });
                if (auth.status === 'denied') {
                  window.open('/wallet', '_blank');
                  return;
                }
                const ok = await exportVideo(currentBeats, title, exportOptions);
                if (auth.status === 'allowed' && auth.reservationId) {
                  if (ok) {
                    await finalizeCurrentUserBillableAction({ reservationId: auth.reservationId, storylineId });
                  } else {
                    await releaseCurrentUserBillableAction({ reservationId: auth.reservationId, reason: 'export_failed' });
                  }
                }
              } else {
                await exportVideo(currentBeats, title, exportOptions);
              }
            }}
          />

          {/* Explore full story tree — logged-in only */}
          {isLoggedIn && (
            <Link
              href={`/explore/${storyId}`}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-neutral-500 hover:text-indigo-300"
              title="Explore full story tree"
            >
              <Compass className="w-4 h-4" />
            </Link>
          )}
          </div>


          {/* User menu — logged-in only */}
          <div className="relative z-30 shrink-0">
            <UserMenu onMyStories={() => setShowMyStories(true)} />
          </div>
        </div>
        </div>

        <div className="mt-3 md:hidden">
          {series && (
            <p className="truncate text-[10px] font-sans font-semibold uppercase tracking-[0.14em] text-emerald-400/90">
              Ep {series.episodeNumber}
              {series.seriesTitle ? ` · ${series.seriesTitle}` : ''}
            </p>
          )}
          <h1 className="text-lg font-serif leading-snug tracking-wide text-neutral-200">{title}</h1>
          {authorName && (
            <p className="text-xs text-neutral-500 font-sans">by {authorName}</p>
          )}
        </div>
      </header>

      {/* Main Content */}
      <motion.main
        className="relative z-10 flex-1 flex flex-col p-4 md:justify-end md:p-12 max-w-4xl mx-auto w-full min-h-0"
        onPan={onPan}
        onPanEnd={onPanEnd}
        style={{ x: dragX }}
      >
        <div className={`min-h-0 flex-none items-start justify-center pb-3 md:hidden ${isVerticalStoryline ? 'hidden' : 'flex'}`}>
          <div className="relative w-full aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/40 shadow-2xl">
            {isStoryboard && resolvedImageUrl ? (
              <StoryStoryboardPlayer
                key={`mobile-window:${currentBeat.imageUrl}:${currentBeat.audioUrl ?? 'no-audio'}:${cycleSettings.cycleOverride}:${cycleSettings.cycleMs}:${cycleSettings.vignetteEnabled}:${cycleSettings.vignetteAmountPercent}`}
                gridUrl={resolvedImageUrl!}
                audioUrl={resolvedAudioUrl || undefined}
                audioElapsedMs={audioElapsedMs}
                audioDurationMs={storyboardAudioDurationMs}
                cycleOverride={cycleSettings.cycleOverride}
                cycleMs={cycleSettings.cycleMs}
                vignetteEnabled={cycleSettings.vignetteEnabled}
                vignetteAmountPercent={cycleSettings.vignetteAmountPercent}
                playbackState={playbackState}
                imageClassName="mobile-scene-shuttle"
                narrationTiming={currentBeat.storyboardNarrationTiming}
                textOverlayEnabled={false}
                storyTextOverlayCaptions={currentBeat.storyTextOverlayCaptions}
                storyTextOverlayEnabled={storyTextOverlayEnabled}
                storyTextOverlayMode={currentBeat.storyTextOverlayMode}
                storyTextOverlayStyle={currentBeat.storyTextOverlayStyle}
                storyTextOverlayWordsPerLine={cycleSettings.storyTextOverlayWordsPerLine}
                storyTextOverlayTextHighlightSupported={storyTextOverlayHighlightSupported}
                storyTransitionSettings={normalizedStoryTransition}
                activeStoryTransition={storyTransitionPlayback.activeTransition}
                storyEffects={currentBeat.storyEffects}
                effectSeed={`${storylineId}:${currentIndex}`}
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
                />
              </div>
            ) : imageIsResolving ? (
              <StoryMediaLoadingFallback />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.88),rgba(2,6,23,0.96))] px-5 text-center text-neutral-200">
                <BookOpen className="h-8 w-8 text-sky-200" />
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-sky-200">Audio Story</p>
                  <p className="mt-2 text-sm text-neutral-400">
                    This beat does not have an image yet, so the player is showing the audio-story placeholder instead.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Story Text Card */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-end md:flex-none">
          <AnimatePresence mode="wait">
            {!isMinimized && (
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-full border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-500 bg-neutral-900/80"
              >
                <div className="p-5 md:p-8">
                  <div
                    ref={storyScrollRef}
                    style={storyTextViewportStyle}
                    className="overflow-y-auto scrollbar-none text-xl md:text-2xl font-serif leading-relaxed"
                  >
                    <p className="transition-colors duration-500 text-neutral-300">
                      {currentBeat.storyText}
                    </p>

                    {/* Ending state */}
                    {currentBeat.isEnding && (
                      <div className="mt-8 pt-8 border-t border-white/10">
                        <h3 className="text-sm font-sans uppercase tracking-widest text-emerald-400 mb-4">
                          The End
                        </h3>
                        <p className="text-neutral-400 font-sans italic">
                          {currentBeat.nextBeatGoal}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {showChoice && transitionChoice && cycleSettings.storylineChoiceFlashEnabled && (
            <ChoiceTransition
              key={`${transitionChoice.fromBeat}:${transitionChoice.optionLabel}`}
              optionLabel={transitionChoice.optionLabel}
              className="mb-3 md:mb-4"
            />
          )}
        </AnimatePresence>

        {/* Navigation Controls */}
        <div className="mb-0 mt-3 space-y-3 md:mb-4 md:mt-6 md:space-y-0">
          {/* Mobile Row 1: Prev/Next buttons — right-aligned, above controls */}
          <div className="flex items-center justify-end gap-2 md:hidden">
            <button
              onClick={goPrev}
              disabled={isFirst}
              className="p-2.5 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goNext}
              disabled={isLast || showChoice}
              className="p-2.5 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile Row 2: Playback controls + beat dots */}
          <div className="flex min-w-0 items-center justify-between gap-1.5 md:hidden">
            {/* Controls cluster */}
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-none pr-1">
              <button
                onClick={replay}
                className={`${MOBILE_CONTROL_BUTTON_CLASS} bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200`}
                title="Replay from start (R)"
              >
                <RotateCcw className={MOBILE_CONTROL_ICON_CLASS} />
              </button>

              {cycleSettings.storyUiAutoScrollEnabled && !isMinimized && (
                <AutoScrollButton
                  active={isAutoScrolling}
                  onClick={toggleAutoScroll}
                />
              )}

              {currentBeat.audioUrl && (
                <button
                  onClick={togglePlayPause}
                  className={`${MOBILE_CONTROL_BUTTON_CLASS} ${
                    playbackState === 'playing'
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {playbackState === 'playing' ? (
                    <Pause className={MOBILE_CONTROL_ICON_CLASS} />
                  ) : (
                    <Play className={MOBILE_CONTROL_ICON_CLASS} />
                  )}
                </button>
              )}

              {currentBeat.audioUrl && (
                <button
                  onClick={() => setVolume(volume === 0 ? 1 : 0)}
                  className={`${MOBILE_CONTROL_BUTTON_CLASS} bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200 transition-colors`}
                  title={volume === 0 ? 'Unmute (V)' : 'Mute (V)'}
                >
                  {volume === 0 ? (
                    <VolumeX className={MOBILE_CONTROL_ICON_CLASS} />
                  ) : (
                    <Volume2 className={MOBILE_CONTROL_ICON_CLASS} />
                  )}
                </button>
              )}

              <button
                onClick={() => setAutoPlay(!autoPlay)}
                className={`${MOBILE_CONTROL_BUTTON_CLASS} ${
                  autoPlay
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                }`}
                title="Auto-play"
              >
                <FastForward className={MOBILE_CONTROL_ICON_CLASS} />
              </button>

              <button
                onClick={() => setAutoReplay(!autoReplay)}
                className={`${MOBILE_CONTROL_BUTTON_CLASS} ${
                  autoReplay
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                    : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                }`}
                title="Loop"
              >
                <Repeat className={MOBILE_CONTROL_ICON_CLASS} />
              </button>

              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className={`${MOBILE_CONTROL_BUTTON_CLASS} ${
                  isMinimized
                    ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                    : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                }`}
                title={isMinimized ? 'Show text (M)' : 'Hide text (M)'}
              >
                {isMinimized ? (
                  <BookOpen className={MOBILE_CONTROL_ICON_CLASS} />
                ) : (
                  <EyeOff className={MOBILE_CONTROL_ICON_CLASS} />
                )}
              </button>

              {hasStoryTextOverlay && (
                <button
                  onClick={() => setStoryTextOverlayVisible((visible) => !visible)}
                  className={`${MOBILE_CONTROL_BUTTON_CLASS} ${
                    storyTextOverlayVisible
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                  }`}
                  title={storyTextOverlayVisible ? 'Hide overlay text' : 'Show overlay text'}
                >
                  {storyTextOverlayVisible ? (
                    <Eye className={MOBILE_CONTROL_ICON_CLASS} />
                  ) : (
                    <EyeOff className={MOBILE_CONTROL_ICON_CLASS} />
                  )}
                </button>
              )}

              {!isVerticalStoryline && (
                <button
                  onClick={toggleFullscreen}
                  className={`${MOBILE_CONTROL_BUTTON_CLASS} ${
                    isFullscreen
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                  }`}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen landscape'}
                >
                  {isFullscreen ? (
                    <Minimize2 className={MOBILE_CONTROL_ICON_CLASS} />
                  ) : (
                    <Maximize2 className={MOBILE_CONTROL_ICON_CLASS} />
                  )}
                </button>
              )}
            </div>

            {/* Beat dots — mobile */}
            <div className="flex gap-1 items-center flex-shrink-0">
              {currentBeats.map((_, i) => (
                <button
                  key={i}
                  onClick={() => jumpToBeat(i)}
                  title={`Beat ${i + 1}`}
                  className={`rounded-full transition-all duration-200 cursor-pointer ${
                    i === currentIndex
                      ? 'bg-emerald-400 w-3.5 h-1.5'
                      : i < currentIndex
                        ? 'bg-neutral-600 w-1.5 h-1.5'
                        : 'bg-neutral-800 w-1.5 h-1.5'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Desktop: Single row with all controls */}
          <div className="hidden md:flex items-center justify-between">
            {/* Previous */}
            <button
              onClick={goPrev}
              disabled={isFirst}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-sm font-sans">Previous</span>
            </button>

            {/* Desktop center controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={replay}
                className={`${DESKTOP_CONTROL_BUTTON_CLASS} bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200`}
                title="Replay from start (R)"
              >
                <RotateCcw className={DESKTOP_CONTROL_ICON_CLASS} />
              </button>

              {cycleSettings.storyUiAutoScrollEnabled && !isMinimized && (
                <AutoScrollButton
                  active={isAutoScrolling}
                  onClick={toggleAutoScroll}
                  className="p-3"
                />
              )}

              {currentBeat.audioUrl && (
                <button
                  onClick={togglePlayPause}
                  className={`${DESKTOP_CONTROL_BUTTON_CLASS} ${
                    playbackState === 'playing'
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {playbackState === 'playing' ? (
                    <Pause className={DESKTOP_CONTROL_ICON_CLASS} />
                  ) : (
                    <Play className={DESKTOP_CONTROL_ICON_CLASS} />
                  )}
                </button>
              )}

              {currentBeat.audioUrl && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setVolume(volume === 0 ? 1 : 0)}
                    className="p-2 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                    title={volume === 0 ? 'Unmute (V)' : 'Mute (V)'}
                  >
                    {volume === 0 ? (
                      <VolumeX className={DESKTOP_CONTROL_ICON_CLASS} />
                    ) : (
                      <Volume2 className={DESKTOP_CONTROL_ICON_CLASS} />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-20 h-1 accent-emerald-400 cursor-pointer"
                  />
                </div>
              )}

              <button
                onClick={() => setAutoPlay(!autoPlay)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border cursor-pointer ${
                  autoPlay
                    ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
                }`}
              >
                auto
              </button>

              <button
                onClick={() => setAutoReplay(!autoReplay)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border cursor-pointer ${
                  autoReplay
                    ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                    : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
                }`}
              >
                loop
              </button>

              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border cursor-pointer ${
                  isMinimized
                    ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
                    : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
                }`}
                title={isMinimized ? 'Show text (M)' : 'Hide text (M)'}
              >
                {isMinimized ? 'read' : 'hide'}
              </button>

              {hasStoryTextOverlay && (
                <button
                  onClick={() => setStoryTextOverlayVisible((visible) => !visible)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border cursor-pointer ${
                    storyTextOverlayVisible
                      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                      : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
                  }`}
                  title={storyTextOverlayVisible ? 'Hide overlay text' : 'Show overlay text'}
                >
                  {storyTextOverlayVisible ? 'overlay' : 'text'}
                </button>
              )}

              {/* Progress dots */}
              <div className="flex gap-1 items-center">
                {currentBeats.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => jumpToBeat(i)}
                    title={`Beat ${i + 1}`}
                    className={`rounded-full transition-all duration-200 cursor-pointer hover:scale-[2] ${
                      i === currentIndex
                        ? 'bg-emerald-400 w-4 h-1.5'
                        : i < currentIndex
                          ? 'bg-neutral-600 w-1.5 h-1.5 hover:bg-emerald-400/60'
                          : 'bg-neutral-800 w-1.5 h-1.5 hover:bg-neutral-600'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Next */}
            <button
              onClick={goNext}
              disabled={isLast || showChoice}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <span className="text-sm font-sans">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.main>

      {/* Rotate hint toast — shown on iOS / devices that can't lock orientation */}
      <AnimatePresence>
        {showRotateHint && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-neutral-900/90 border border-white/10 backdrop-blur-md rounded-2xl px-5 py-3 flex items-center gap-3 shadow-2xl"
            onClick={dismissHint}
          >
            <span className="text-2xl">📱↪️</span>
            <p className="text-sm text-neutral-200 font-sans">Rotate your phone for landscape view</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share link copied toast */}
      <AnimatePresence>
        {shareToastVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-neutral-900/90 border border-emerald-500/20 backdrop-blur-md rounded-2xl px-5 py-3 shadow-2xl"
          >
            <p className="text-sm text-emerald-300 font-sans">Link copied!</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* End-of-story modal */}
      <AnimatePresence>
        {showEndModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setShowEndModal(false)}
          >
            {/* Dark radial overlay — matches loader */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.95) 100%)',
              }}
            />

            {/* Ambient glow orbs */}
            <div className="absolute inset-0 pointer-events-none">
              <motion.div
                animate={{ opacity: [0.15, 0.3, 0.15], scale: [1, 1.2, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute top-1/4 left-1/3 w-64 h-64 rounded-full bg-emerald-500/20 blur-3xl"
              />
              <motion.div
                animate={{ opacity: [0.1, 0.25, 0.1], scale: [1, 1.15, 1] }}
                transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
                className="absolute bottom-1/3 right-1/4 w-48 h-48 rounded-full bg-indigo-500/20 blur-3xl"
              />
            </div>

            {/* Modal card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 max-w-sm w-full p-8 rounded-3xl bg-neutral-900/30 backdrop-blur-xl border border-white/10 shadow-2xl text-center"
              // Any deliberate touch inside the modal means the reader is
              // making the decision themselves; stop counting at them.
              onClick={(e) => { e.stopPropagation(); cancelNextEpisodeCountdown(); }}
              onPointerDown={cancelNextEpisodeCountdown}
              onKeyDown={cancelNextEpisodeCountdown}
            >
              <h3 className="text-xs font-sans uppercase tracking-widest text-emerald-400 mb-3">
                The End
              </h3>
              <p className="text-xl md:text-2xl font-serif text-white leading-snug mb-8">
                {title}
              </p>

              <div className="space-y-3">
                {nextEpisode ? (
                  <button
                    onClick={goToNextEpisode}
                    className="relative w-full overflow-hidden flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-emerald-500 border border-emerald-400 text-neutral-950 font-semibold hover:bg-emerald-400 transition-all cursor-pointer font-sans text-sm"
                  >
                    {/* The countdown reads as the button filling up, so the
                        thing about to happen is the thing being measured. */}
                    {nextEpisodeCountdown !== null && (
                      <motion.span
                        aria-hidden="true"
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{ duration: NEXT_EPISODE_COUNTDOWN_SECONDS, ease: 'linear' }}
                        className="absolute inset-y-0 left-0 bg-emerald-300/50"
                      />
                    )}
                    <span className="relative flex items-center gap-2">
                      <SkipForward className="w-4 h-4 fill-current" />
                      <span className="flex flex-col items-start leading-tight">
                        <span>
                          Next Episode
                          {nextEpisodeCountdown !== null ? ` · ${nextEpisodeCountdown}s` : ''}
                        </span>
                        <span className="text-[11px] font-normal text-neutral-900/80">
                          Ep {nextEpisode.episodeNumber} · {nextEpisode.title}
                        </span>
                      </span>
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowEndModal(false); router.push('/'); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-500/40 transition-all cursor-pointer font-sans text-sm"
                  >
                    <Compass className="w-4 h-4" />
                    Find More Stories
                  </button>
                )}

                <div className="flex gap-2">
                  {/* Browsing on demotes to a peer of Replay and Share once
                      there is a next episode to offer. */}
                  {nextEpisode && (
                    <button
                      onClick={() => { setShowEndModal(false); router.push('/'); }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-3.5 rounded-xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer font-sans text-xs"
                    >
                      <Compass className="w-4 h-4 shrink-0" />
                      Browse
                    </button>
                  )}

                  <button
                    onClick={replay}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer font-sans ${
                      nextEpisode ? 'px-2 py-3.5 text-xs' : 'px-4 py-3.5 text-sm gap-2'
                    }`}
                  >
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    Replay
                  </button>

                  <button
                    onClick={() => { setShowEndModal(false); handleShare(); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer font-sans ${
                      nextEpisode ? 'px-2 py-3.5 text-xs' : 'px-4 py-3.5 text-sm gap-2'
                    }`}
                  >
                    <Share2 className="w-4 h-4 shrink-0" />
                    Share
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My Stories drawer — logged-in only */}
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
                  Keep this tab open while your video is being rendered. Leaving, refreshing, or closing the tab can stop the export.
                </p>

                {isCompatibilityExport && (
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3.5 py-3 text-sm font-sans text-amber-100">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div>
                        <p>Fast export was unavailable. Continuing with compatibility export, which takes longer.</p>
                        {process.env.NODE_ENV !== 'production' && exportFallbackReason && (
                          <p className="mt-1 line-clamp-2 text-xs text-amber-100/65" title={exportFallbackReason}>
                            {exportFallbackReason} ({exportStage})
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

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

                <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3">
                  <p className="text-xs font-sans uppercase tracking-[0.22em] text-amber-200/80">
                    Browser Prompt
                  </p>
                  <p className="mt-1 text-sm font-sans text-amber-100/90">
                    If you still try to leave, the browser will show its native confirmation prompt.
                  </p>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
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

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />
    </div>
  );
}
