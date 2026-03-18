'use client';

import { useState } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';
import { ArrowRight, RefreshCcw, BookOpen, ChevronDown, ChevronUp, Check } from 'lucide-react';
import Timeline from './Timeline';
import { findChildForOption, getCurrentNode } from '@/lib/utils/story-map';

export default function StoryScreen() {
  const session = useStoryStore((state) => state.session);
  const continueStory = useStoryStore((state) => state.continueStory);
  const navigateToNode = useStoryStore((state) => state.navigateToNode);
  const isLoading = useStoryStore((state) => state.isLoading);
  const resetStory = useStoryStore((state) => state.resetStory);

  const [isMinimized, setIsMinimized] = useState(false);

  if (!session || !session.storyMap) return null;

  const currentNode = getCurrentNode(session.storyMap);
  if (!currentNode) return null;

  const currentBeat = currentNode.data;
  const isEnding = currentBeat.isEnding;

  const hasExistingBranch = (optionId: string) =>
    findChildForOption(session.storyMap, session.storyMap.currentNodeId, optionId) !== null;

  return (
    <div className="relative min-h-screen bg-neutral-950 text-white overflow-hidden flex flex-col">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentBeat.imageUrl}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: "easeOut" }}
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
            <motion.div
              initial={false}
              animate={{
                height: isMinimized ? "40%" : "100%",
              }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950 via-neutral-950/90 to-transparent"
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Header */}
      <header className="relative z-10 p-6 flex justify-between items-center bg-gradient-to-b from-neutral-950/80 to-transparent">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-emerald-400" />
          <h1 className="text-xl font-serif tracking-wide text-neutral-200">
            {session.title || "Story Master"}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm font-sans uppercase tracking-widest text-neutral-400">
          <span>Beat {currentBeat.beatNumber} / {session.maxBeats}</span>
          <button
            onClick={resetStory}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Restart Story"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Timeline */}
      <Timeline storyMap={session.storyMap} onNodeClick={navigateToNode} />

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col justify-end p-4 md:p-12 max-w-5xl mx-auto w-full">
        <motion.div layout className="grid md:grid-cols-12 gap-8 items-end">

          {/* Story Text Card */}
          <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className={`relative md:col-span-7 backdrop-blur-xl border border-white/10 rounded-3xl p-8 md:p-12 shadow-2xl transition-colors duration-500 ${isMinimized ? 'bg-neutral-950/40' : 'bg-neutral-900/80'}`}
          >
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="absolute top-6 right-6 p-2 bg-white/5 hover:bg-white/10 rounded-xl backdrop-blur-md transition-colors z-20"
              title={isMinimized ? "Maximize story" : "Minimize story"}
            >
              {isMinimized ? <ChevronUp className="w-5 h-5 text-neutral-300" /> : <ChevronDown className="w-5 h-5 text-neutral-300" />}
            </button>

            <motion.div layout className="pr-8">
              <p className={`text-xl md:text-2xl font-serif leading-relaxed transition-colors duration-500 ${isMinimized ? 'text-neutral-500 line-clamp-4' : 'text-neutral-100'}`}>
                {currentBeat.storyText}
              </p>
            </motion.div>

            <AnimatePresence>
              {isEnding && !isMinimized && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-8 pt-8 border-t border-white/10 overflow-hidden"
                >
                  <h3 className="text-sm font-sans uppercase tracking-widest text-emerald-400 mb-4">
                    The End
                  </h3>
                  <p className="text-neutral-400 font-sans italic">
                    {currentBeat.nextBeatGoal}
                  </p>
                  <button
                    onClick={resetStory}
                    className="mt-8 bg-white text-black px-8 py-4 rounded-2xl font-medium hover:bg-neutral-200 transition-colors flex items-center gap-2"
                  >
                    Start a New Story
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Choices Column */}
          {!isEnding && (
            <motion.div layout className="md:col-span-5 flex flex-col justify-end relative">
              <motion.div layout className="flex items-center justify-between mb-4 px-4">
                <h3 className="text-xs font-sans uppercase tracking-widest text-neutral-500">
                  What happens next?
                </h3>
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-xl backdrop-blur-md transition-colors z-20"
                  title={isMinimized ? "Maximize options" : "Minimize options"}
                >
                  {isMinimized ? <ChevronUp className="w-4 h-4 text-neutral-300" /> : <ChevronDown className="w-4 h-4 text-neutral-300" />}
                </button>
              </motion.div>

              <AnimatePresence>
                {!isMinimized && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="space-y-4 overflow-hidden"
                  >
                    {currentBeat.options.map((option, index) => {
                      const explored = hasExistingBranch(option.id);
                      return (
                        <motion.button
                          key={option.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.1 }}
                          onClick={() => continueStory(option.id)}
                          disabled={isLoading}
                          className={`w-full text-left group backdrop-blur-md rounded-2xl p-6 transition-all duration-300 flex items-center justify-between ${
                            explored
                              ? 'bg-neutral-900/60 hover:bg-neutral-800 border border-emerald-500/20 hover:border-emerald-500/40'
                              : 'bg-neutral-900/60 hover:bg-neutral-800 border border-white/5 hover:border-white/20'
                          }`}
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
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
