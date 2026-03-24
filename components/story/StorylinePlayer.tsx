'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Home,
  Play,
  Pause,
  Bookmark,
  BookmarkCheck,
  Compass,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import { refreshStorylineSignedUrls } from '@/app/actions/exploration';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from './MyStoriesDrawer';
import ChoiceTransition from './ChoiceTransition';
import type { StoryBeat } from '@/lib/types/story';
import type { StorylineChoice } from '@/lib/utils/storyline';

const SIGNED_URL_REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes

interface StorylinePlayerProps {
  storylineId: string;
  storyId: string;
  title: string;
  beats: StoryBeat[];
  choices: StorylineChoice[];
  authorName: string | null;
  isOwner: boolean;
  isSaved?: boolean;
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
  isLoggedIn = false,
}: StorylinePlayerProps) {
  const [currentBeats, setCurrentBeats] = useState(beats);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showChoice, setShowChoice] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoReplay, setAutoReplay] = useState(false);
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isSavingToProfile, setIsSavingToProfile] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showMyStories, setShowMyStories] = useState(false);

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

  return (
    <div className="relative h-screen bg-neutral-950 text-neutral-200 overflow-hidden flex flex-col">
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
            {currentBeat.imageUrl && (
              <Image
                src={currentBeat.imageUrl}
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
          <Link
            href="/"
            className="px-5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xl font-serif font-semibold tracking-wide text-emerald-400 hover:bg-white/10 hover:border-emerald-500/30 transition-all duration-200"
          >
            kissago
          </Link>
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
            <Link
              href="/"
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="Return to full story"
            >
              <Home className="w-4 h-4" />
            </Link>
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
      <main className="relative z-10 flex-1 flex flex-col justify-end p-4 md:p-12 max-w-4xl mx-auto w-full min-h-0">
        {/* Choice Transition */}
        <AnimatePresence>
          {showChoice && currentChoice && (
            <ChoiceTransition optionLabel={currentChoice.optionLabel} />
          )}
        </AnimatePresence>

        {/* Story Text Card + Toggle */}
        <div className="flex flex-col items-center">
          {/* Minimize/maximize toggle */}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="mb-2 p-2 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-colors"
            title={isMinimized ? 'Expand (M)' : 'Minimize (M)'}
          >
            {isMinimized ? (
              <ChevronUp className="w-5 h-5 text-neutral-300" />
            ) : (
              <ChevronDown className="w-5 h-5 text-neutral-300" />
            )}
          </button>

          <AnimatePresence mode="wait">
            {!showChoice && (
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className={`w-full border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-500 ${
                  isMinimized
                    ? 'bg-neutral-950/40'
                    : 'bg-neutral-900/80 max-h-[50vh]'
                }`}
              >
                <div className={`p-8 md:p-10 ${isMinimized ? '' : 'flex-1 overflow-y-auto scrollbar-none'}`}>
                  <p className={`text-xl md:text-2xl font-serif leading-relaxed transition-colors duration-500 ${
                    isMinimized ? 'text-neutral-500 line-clamp-2' : 'text-neutral-300'
                  }`}>
                    {currentBeat.storyText}
                  </p>

                  {/* Ending state */}
                  {!isMinimized && currentBeat.isEnding && (
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
        <div className="flex items-center justify-between mt-6 mb-4">
          <button
            onClick={goPrev}
            disabled={isFirst}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-sans">Previous</span>
          </button>

          <div className="flex items-center gap-2 md:gap-3">
            {/* Replay from start */}
            <button
              onClick={replay}
              className="p-2.5 rounded-full border bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200 transition-all"
              title="Replay from start (R)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Audio play/pause */}
            {currentBeat.audioUrl && (
              <button
                onClick={togglePlayPause}
                className={`p-2.5 rounded-full border transition-all ${
                  playbackState === 'playing'
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {playbackState === 'playing' ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Volume control */}
            {currentBeat.audioUrl && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setVolume(volume === 0 ? 1 : 0)}
                  className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
                  title={volume === 0 ? 'Unmute (V)' : 'Mute (V)'}
                >
                  {volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-16 md:w-20 h-1 accent-emerald-400 cursor-pointer"
                />
              </div>
            )}

            {/* Auto-play toggle */}
            <button
              onClick={() => setAutoPlay(!autoPlay)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border ${
                autoPlay
                  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                  : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              auto
            </button>

            {/* Auto-replay (loop) toggle */}
            <button
              onClick={() => setAutoReplay(!autoReplay)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border ${
                autoReplay
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                  : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              loop
            </button>

            {/* Minimize/maximize toggle */}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-sans uppercase tracking-wider transition-all border ${
                isMinimized
                  ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
                  : 'bg-neutral-900/60 border-white/10 text-neutral-500 hover:text-neutral-300'
              }`}
              title={isMinimized ? 'Expand text (M)' : 'Minimize text (M)'}
            >
              {isMinimized ? 'max' : 'min'}
            </button>

            {/* Progress dots */}
            <div className="hidden md:flex gap-1">
              {currentBeats.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === currentIndex
                      ? 'bg-emerald-400 w-4'
                      : i < currentIndex
                        ? 'bg-neutral-600'
                        : 'bg-neutral-800'
                  }`}
                />
              ))}
            </div>
          </div>

          <button
            onClick={goNext}
            disabled={isLast}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="text-sm font-sans">Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </main>

      {/* My Stories drawer */}
      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />
    </div>
  );
}
