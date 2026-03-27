'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStoryStore } from '@/lib/store/story-store';
import KissagoLogo from '@/components/ui/KissagoLogo';
import {
  ChevronLeft,
  ChevronRight,
  Home,
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
  EyeOff,
} from 'lucide-react';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import { refreshStorylineSignedUrls } from '@/app/actions/exploration';
import { toggleLike, recordView } from '@/app/actions/engagement';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from './MyStoriesDrawer';
import ChoiceTransition from './ChoiceTransition';
import { useSwipeNavigation } from '@/lib/hooks/useSwipeNavigation';
import { useFullscreenLandscape } from '@/lib/hooks/useFullscreenLandscape';
import type { StoryBeat } from '@/lib/types/story';
import type { StorylineChoice } from '@/lib/utils/storyline';

const SIGNED_URL_REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes
const MOBILE_CONTROL_BUTTON_CLASS = 'p-2.5 rounded-full border transition-all cursor-pointer';
const MOBILE_CONTROL_ICON_CLASS = 'w-[1.125rem] h-[1.125rem]';
const DESKTOP_CONTROL_BUTTON_CLASS = 'p-3 rounded-full border transition-all cursor-pointer';
const DESKTOP_CONTROL_ICON_CLASS = 'w-5 h-5';

interface StorylinePlayerProps {
  storylineId: string;
  storyId: string;
  title: string;
  beats: StoryBeat[];
  choices: StorylineChoice[];
  authorName: string | null;
  isOwner: boolean;
  isSaved?: boolean;
  isLiked?: boolean;
  likeCount?: number;
  isLoggedIn?: boolean;
}

export default function StorylinePlayer({
  storylineId,
  storyId,
  title,
  beats,
  choices,
  authorName,
  isOwner,
  isSaved: initialSaved = false,
  isLiked: initialLiked = false,
  likeCount: initialLikeCount = 0,
  isLoggedIn = false,
}: StorylinePlayerProps) {
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
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoReplay, setAutoReplay] = useState(false);
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isSavingToProfile, setIsSavingToProfile] = useState(false);
  const [isLiked, setIsLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [isTogglingLike, setIsTogglingLike] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showMyStories, setShowMyStories] = useState(false);
  const router = useRouter();
  const resetStory = useStoryStore((state) => state.resetStory);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, showRotateHint, toggle: toggleFullscreen, dismissHint } = useFullscreenLandscape(containerRef);

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

  // Refresh signed URLs before they expire (every 50 minutes)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const refreshed = await refreshStorylineSignedUrls(storylineId);
        setCurrentBeats(refreshed);
      } catch {
        // Silent fail — URLs will still work until full expiry
      }
    }, SIGNED_URL_REFRESH_INTERVAL);

    return () => clearInterval(interval);
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

  // Record view on mount (fire-and-forget, idempotent)
  useEffect(() => {
    if (isLoggedIn) {
      recordView(storylineId).catch(() => {});
    }
  }, [storylineId, isLoggedIn]);

  const currentBeat = currentBeats[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === currentBeats.length - 1;

  // Get the choice that led to the current beat
  const currentChoice = currentIndex > 0 ? choices[currentIndex - 1] : null;

  const goNext = useCallback(() => {
    if (isLast) return;

    // Show choice transition briefly before advancing
    if (choices[currentIndex]) {
      setShowChoice(true);
      setTimeout(() => {
        setShowChoice(false);
        setCurrentIndex((i) => i + 1);
      }, 1500);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, isLast, choices]);

  const goPrev = useCallback(() => {
    if (isFirst) return;
    setShowChoice(false);
    setCurrentIndex((i) => i - 1);
  }, [isFirst]);

  const { playbackState, togglePlayPause, play: playAudio, stop: stopAudio, volume, setVolume } = useAudioPlayer(
    currentBeat.audioUrl || undefined,
    `storyline-${currentIndex}`
  );

  const replay = useCallback(() => {
    stopAudio();
    setCurrentIndex(0);
  }, [stopAudio]);

  // Auto-play narration when beat changes and autoPlay is on
  const prevIndexRef = useRef(currentIndex);
  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      prevIndexRef.current = currentIndex;
      if (autoPlay && currentBeat.audioUrl && playbackState === 'idle') {
        playAudio();
      }
    }
  }, [currentIndex, autoPlay, currentBeat.audioUrl, playbackState, playAudio]);

  // Auto-advance when audio finishes (playbackState goes from 'playing' to 'idle')
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (playbackState === 'playing') {
      wasPlayingRef.current = true;
    } else if (playbackState === 'idle' && wasPlayingRef.current && autoPlay) {
      wasPlayingRef.current = false;
      if (isLast && autoReplay) {
        queueMicrotask(() => replay());
      } else if (!isLast) {
        queueMicrotask(() => goNext());
      }
    } else if (playbackState === 'idle') {
      wasPlayingRef.current = false;
    }
  }, [playbackState, autoPlay, autoReplay, isLast, goNext, replay]);

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

  return (
    <div ref={containerRef} className="relative h-dvh bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentBeat.imageUrl}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: [1, 1.08] }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.5, ease: 'easeOut' },
              scale: { duration: 20, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
            }}
            className="absolute inset-0"
          >
            {(currentBeat.portraitImageUrl || currentBeat.imageUrl) && (
              <Image
                src={currentBeat.portraitImageUrl || currentBeat.imageUrl!}
                alt={currentBeat.sceneSummary}
                fill
                className={`object-cover transition-opacity duration-500 ${isMinimized ? 'opacity-60' : 'opacity-40'}`}
                referrerPolicy="no-referrer"
                priority
                unoptimized
              />
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
      <header className="relative z-10 p-4 md:p-6 flex justify-between items-center bg-gradient-to-b from-neutral-950/80 to-transparent shrink-0">
        <div className="flex items-center gap-4">
          {/* Kissago branding — matches main page style */}
          <KissagoLogo fixed={false} />
          <div className="hidden md:block">
            <h1 className="text-lg font-serif tracking-wide text-neutral-200">{title}</h1>
            {authorName && (
              <p className="text-xs text-neutral-500 font-sans">by {authorName}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-sans uppercase tracking-widest text-neutral-400">
          <span className="text-xs">Beat {currentIndex + 1} / {currentBeats.length}</span>

          {/* Save to profile button */}
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

          {/* Like button */}
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

          {/* Explore full story tree */}
          {isLoggedIn && (
            <Link
              href={`/explore/${storyId}`}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-neutral-500 hover:text-indigo-300"
              title="Explore full story tree"
            >
              <Compass className="w-4 h-4" />
            </Link>
          )}

          {isOwner && (
            <button
              onClick={() => {
                resetStory();
                router.push('/');
              }}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="Back to home"
            >
              <Home className="w-4 h-4" />
            </button>
          )}

          {/* User menu */}
          <UserMenu onMyStories={() => setShowMyStories(true)} />
        </div>
      </header>

      {/* Mobile title (shown below header on small screens) */}
      <div className="relative z-10 px-4 md:hidden">
        <h1 className="text-lg font-serif tracking-wide text-neutral-200">{title}</h1>
        {authorName && (
          <p className="text-xs text-neutral-500 font-sans">by {authorName}</p>
        )}
      </div>

      {/* Main Content */}
      <motion.main
        className="relative z-10 flex-1 flex flex-col justify-end p-4 md:p-12 max-w-4xl mx-auto w-full min-h-0"
        onPan={onPan}
        onPanEnd={onPanEnd}
        style={{ x: dragX }}
      >
        {/* Choice Transition */}
        <AnimatePresence>
          {showChoice && currentChoice && (
            <ChoiceTransition optionLabel={currentChoice.optionLabel} />
          )}
        </AnimatePresence>

        {/* Story Text Card */}
        <div className="flex flex-col items-center">
          <AnimatePresence mode="wait">
            {!showChoice && !isMinimized && (
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-full border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-500 bg-neutral-900/80 max-h-[50vh]"
              >
                <div className="p-5 md:p-10 flex-1 overflow-y-auto scrollbar-none">
                  <p className="text-xl md:text-2xl font-serif leading-relaxed transition-colors duration-500 text-neutral-300">
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Controls */}
        <div className="mt-6 mb-4 space-y-3 md:space-y-0">
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
              disabled={isLast}
              className="p-2.5 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile Row 2: Playback controls + beat dots */}
          <div className="flex items-center justify-between gap-1.5 md:hidden">
            {/* Controls cluster */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={replay}
                className={`${MOBILE_CONTROL_BUTTON_CLASS} bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200`}
                title="Replay from start (R)"
              >
                <RotateCcw className={MOBILE_CONTROL_ICON_CLASS} />
              </button>

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
            </div>

            {/* Beat dots — mobile */}
            <div className="flex gap-1 items-center flex-shrink-0">
              {currentBeats.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
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

              {/* Progress dots */}
              <div className="flex gap-1 items-center">
                {currentBeats.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
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
              disabled={isLast}
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

      {/* My Stories drawer */}
      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />
    </div>
  );
}
