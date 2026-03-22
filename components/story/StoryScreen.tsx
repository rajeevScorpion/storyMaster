'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import { ArrowRight, RefreshCcw, BookOpen, Check, ChevronDown, ChevronUp, Save, Loader2, Share2, ExternalLink, Compass } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import PublishDialog from './PublishDialog';
import Timeline from './Timeline';
import Link from 'next/link';
import NarrationButton from './NarrationButton';
import { findChildForOption, getCurrentNode } from '@/lib/utils/story-map';
import { useKeyboardNavigation } from '@/lib/hooks/useKeyboardNavigation';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';

export default function StoryScreen() {
  const session = useStoryStore((state) => state.session);
  const continueStory = useStoryStore((state) => state.continueStory);
  const navigateToNode = useStoryStore((state) => state.navigateToNode);
  const isLoading = useStoryStore((state) => state.isLoading);
  const resetStory = useStoryStore((state) => state.resetStory);
  const isGeneratingAudio = useStoryStore((state) => state.isGeneratingAudio);
  const audioReadyNodeId = useStoryStore((state) => state.audioReadyNodeId);
  const generateNarrationForNode = useStoryStore((state) => state.generateNarrationForNode);
  const clearAudioReady = useStoryStore((state) => state.clearAudioReady);
  const storyMode = useStoryStore((state) => state.storyMode);
  const toggleStoryMode = useStoryStore((state) => state.toggleStoryMode);
  const isSaving = useStoryStore((state) => state.isSaving);
  const saveStoryToCloud = useStoryStore((state) => state.saveStoryToCloud);
  const lastPublishResult = useStoryStore((state) => state.lastPublishResult);
  const { user } = useAuth();

  const optionsContainerRef = useRef<HTMLDivElement>(null);

  if (!session || !session.storyMap) return null;

  const currentNode = getCurrentNode(session.storyMap);
  if (!currentNode) return null;

  const currentBeat = currentNode.data;
  const isEnding = currentBeat.isEnding;

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
      hasExistingBranch={hasExistingBranch}
      isGeneratingAudio={isGeneratingAudio}
      audioReadyNodeId={audioReadyNodeId}
      generateNarrationForNode={generateNarrationForNode}
      clearAudioReady={clearAudioReady}
      storyMode={storyMode}
      toggleStoryMode={toggleStoryMode}
      isSaving={isSaving}
      onSave={user ? () => saveStoryToCloud(user.id) : undefined}
      lastPublishResult={lastPublishResult}
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
  hasExistingBranch,
  isGeneratingAudio,
  audioReadyNodeId,
  generateNarrationForNode,
  clearAudioReady,
  storyMode,
  toggleStoryMode,
  isSaving,
  onSave,
  lastPublishResult,
}: {
  session: NonNullable<ReturnType<typeof useStoryStore.getState>['session']>;
  currentBeat: NonNullable<ReturnType<typeof useStoryStore.getState>['session']>['beats'][number];
  isEnding: boolean;
  isLoading: boolean;
  continueStory: (optionId: string) => void;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  hasExistingBranch: (optionId: string) => boolean;
  isGeneratingAudio: boolean;
  audioReadyNodeId: string | null;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  clearAudioReady: () => void;
  storyMode: boolean;
  toggleStoryMode: () => void;
  isSaving: boolean;
  onSave?: () => void;
  lastPublishResult: { alreadyPublished: boolean; storylineId: string } | null;
}) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const optionsContainerRef = useRef<HTMLDivElement>(null);

  const [isMinimized, setIsMinimized] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [scrollState, setScrollState] = useState({ atTop: true, atBottom: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

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
  }, []);

  // Audio player
  const currentNodeId = session.storyMap.currentNodeId;
  const { playbackState, togglePlayPause, play: playAudio, stop: stopAudio } = useAudioPlayer(currentBeat.audioUrl, currentNodeId);
  const isAudioReady = audioReadyNodeId === currentNodeId;
  const prevNodeIdForAutoplay = useRef<string | undefined>(undefined);

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
    options: currentBeat.options,
    onNavigateNode: navigateToNode,
    onSelectOption: continueStory,
    onSetMinimized: setIsMinimized,
    onToggleNarration: () => {
      if (currentBeat.audioUrl) {
        togglePlayPause();
      }
    },
    isLoading,
    isEnding,
  });

  // Auto-scroll focused option into view
  useEffect(() => {
    if (focusedOptionIndex >= 0 && optionRefs.current[focusedOptionIndex]) {
      optionRefs.current[focusedOptionIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [focusedOptionIndex]);

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
              opacity: { duration: 1.5, ease: "easeOut" },
              scale: { duration: 20, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" },
            }}
            className="absolute inset-0"
          >
            {currentBeat.imageUrl && (
              <Image
                src={currentBeat.imageUrl}
                alt={currentBeat.sceneSummary}
                fill
                className={`object-cover transition-opacity duration-700 ${isMinimized ? 'opacity-60' : 'opacity-40'}`}
                referrerPolicy="no-referrer"
                priority
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
      <header className="relative z-10 p-6 pl-36 flex justify-between items-center bg-gradient-to-b from-neutral-950/80 to-transparent shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-emerald-400" />
          <h1 className="text-xl font-serif tracking-wide text-neutral-200">
            {session.title || "Kissago"}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm font-sans uppercase tracking-widest text-neutral-400">
          <span>Beat {currentBeat.beatNumber} / {session.maxBeats}</span>
          {onSave && (
            <button
              onClick={onSave}
              disabled={isSaving}
              className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
              title={isSaving ? 'Saving...' : 'Save Story'}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={resetStory}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Restart Story"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col justify-end p-4 md:p-12 max-w-5xl mx-auto w-full min-h-0">
        <div className="grid md:grid-cols-12 gap-8 items-end">

          {/* Story Text Card + Toggle */}
          <div
            className="md:col-span-7 flex flex-col items-center relative"
            onMouseEnter={() => setIsCardHovered(true)}
            onMouseLeave={() => setIsCardHovered(false)}
          >
            {/* Minimize/maximize toggle — attached above card */}
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="mb-2 p-2 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-colors"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? (
                <ChevronUp className="w-5 h-5 text-neutral-300" />
              ) : (
                <ChevronDown className="w-5 h-5 text-neutral-300" />
              )}
            </button>

          {/* Card + Narration button row */}
          <div className="flex items-end gap-5 w-full">
            {/* Narration button — outside card, left side */}
            {!isMinimized && (
              <div className="shrink-0 pb-4">
                <NarrationButton
                  isGeneratingAudio={isGeneratingAudio}
                  isAudioReady={isAudioReady}
                  playbackState={playbackState}
                  hasAudio={!!currentBeat.audioUrl}
                  onTogglePlayPause={togglePlayPause}
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
            className={`relative w-full border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-500 ${
              isMinimized ? 'bg-neutral-950/40' : 'max-h-[50vh] bg-neutral-900/80'
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
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className={`p-8 md:p-12 ${isMinimized ? '' : 'flex-1 overflow-y-auto scrollbar-none'}`}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={session.storyMap.currentNodeId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <p className={`text-xl md:text-2xl font-serif leading-relaxed transition-colors duration-500 ${
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
                          {lastPublishResult.alreadyPublished ? (
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
              className="md:col-span-5 flex flex-col justify-end"
            >
              {/* Timeline — positioned above choices */}
              <div className="shrink-0">
                <Timeline
                  storyMap={session.storyMap}
                  onNodeClick={navigateToNode}
                  focusedNodeId={focusMode === 'timeline' ? session.storyMap.currentNodeId : undefined}
                />
              </div>

              {/* Header with toggle */}
              <div className="flex items-center justify-between mb-3 px-4 shrink-0">
                <h3 className="text-xs font-sans uppercase tracking-widest text-neutral-500">
                  What happens next?
                </h3>
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-1.5 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-colors"
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
                    className="relative shrink-0 overflow-hidden"
                  >
                    <div
                      ref={optionsContainerRef}
                      className="h-full overflow-y-auto scrollbar-none space-y-4 px-1 pt-1"
                      style={{
                        maskImage: 'linear-gradient(to bottom, black 82%, transparent 100%)',
                        WebkitMaskImage: 'linear-gradient(to bottom, black 82%, transparent 100%)',
                      }}
                    >
                      {currentBeat.options.map((option, index) => {
                        const explored = hasExistingBranch(option.id);
                        const isFocused = focusMode === 'options' && focusedOptionIndex === index;
                        return (
                          <motion.button
                            key={option.id}
                            ref={(el) => { optionRefs.current[index] = el; }}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            onClick={() => continueStory(option.id)}
                            disabled={isLoading}
                            className={`w-full text-left group backdrop-blur-md rounded-2xl p-6 transition-all duration-300 flex items-center justify-between ${
                              explored
                                ? 'bg-neutral-900/60 hover:bg-neutral-800 border border-emerald-500/20 hover:border-emerald-500/40 glow-pulse-mild'
                                : 'bg-neutral-900/60 hover:bg-neutral-800 border border-white/5 hover:border-white/20'
                            } ${isFocused ? 'ring-2 ring-emerald-400/50 border-emerald-500/40' : ''}`}
                          >
                            <div>
                              <p className="text-lg font-serif text-neutral-200 group-hover:text-white transition-colors">
                                {option.label}
                              </p>
                              <p className="text-xs font-sans text-neutral-500 mt-1 uppercase tracking-wider">
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
