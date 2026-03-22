'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, BookOpen, Home, Play, Pause, Bookmark, BookmarkCheck, Compass } from 'lucide-react';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import ChoiceTransition from './ChoiceTransition';
import type { StoryBeat } from '@/lib/types/story';
import type { StorylineChoice } from '@/lib/utils/storyline';

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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showChoice, setShowChoice] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isSavingToProfile, setIsSavingToProfile] = useState(false);

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

  const currentBeat = beats[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === beats.length - 1;

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

  const { playbackState, togglePlayPause } = useAudioPlayer(
    currentBeat.audioUrl || undefined,
    `storyline-${currentIndex}`
  );

  // Auto-advance when audio finishes (playbackState goes from 'playing' to 'idle')
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (playbackState === 'playing') {
      wasPlayingRef.current = true;
    } else if (playbackState === 'idle' && wasPlayingRef.current && autoPlay && !isLast) {
      wasPlayingRef.current = false;
      // Schedule outside effect to satisfy lint rule
      queueMicrotask(() => goNext());
    } else if (playbackState === 'idle') {
      wasPlayingRef.current = false;
    }
  }, [playbackState, autoPlay, isLast, goNext]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'p') {
        togglePlayPause();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, togglePlayPause]);

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
                className="object-cover opacity-40"
                referrerPolicy="no-referrer"
                priority
              />
            )}
            <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-neutral-950 via-neutral-950/90 to-transparent" />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Header */}
      <header className="relative z-10 p-6 flex justify-between items-center bg-gradient-to-b from-neutral-950/80 to-transparent shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-emerald-400" />
          <div>
            <h1 className="text-xl font-serif tracking-wide text-neutral-200">{title}</h1>
            {authorName && (
              <p className="text-xs text-neutral-500 font-sans">by {authorName}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm font-sans uppercase tracking-widest text-neutral-400">
          <span className="text-xs">Beat {currentIndex + 1} / {beats.length}</span>

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
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col justify-end p-4 md:p-12 max-w-4xl mx-auto w-full min-h-0">
        {/* Choice Transition */}
        <AnimatePresence>
          {showChoice && currentChoice && (
            <ChoiceTransition optionLabel={currentChoice.optionLabel} />
          )}
        </AnimatePresence>

        {/* Story Text Card */}
        <AnimatePresence mode="wait">
          {!showChoice && (
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="bg-neutral-900/10 backdrop-blur-sm border border-white/5 rounded-3xl p-8 md:p-10 max-h-[60vh] overflow-y-auto"
            >
              <p className="text-xl md:text-2xl font-serif leading-relaxed text-neutral-300">
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
            </motion.div>
          )}
        </AnimatePresence>

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

          <div className="flex items-center gap-3">
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

            {/* Progress dots */}
            <div className="flex gap-1">
              {beats.map((_, i) => (
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
    </div>
  );
}
