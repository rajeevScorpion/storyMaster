'use client';

import { useState, useEffect } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { getStoryLoadingProgress } from '@/lib/story/loading-progress';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react';

interface LoadingStateProps {
  backdropMode?: 'scene' | 'blocking';
  className?: string;
}

function RotatingClue({ clues, clueKey }: { clues: string[]; clueKey: string }) {
  const [currentClueIndex, setCurrentClueIndex] = useState(0);

  useEffect(() => {
    if (!clues || clues.length === 0) return;

    const interval = setInterval(() => {
      setCurrentClueIndex((prev) => (prev + 1) % clues.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [clues]);

  return (
    <div className="min-h-24 flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.p
          key={`${clueKey}-${currentClueIndex}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.5 }}
          className="text-xl font-serif text-neutral-200 italic"
        >
          &quot;{clues[currentClueIndex]}&quot;
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

export default function LoadingState({
  backdropMode = 'scene',
  className = '',
}: LoadingStateProps) {
  const loadingClues = useStoryStore((state) => state.loadingClues);
  const loadingStage = useStoryStore((state) => state.loadingStage);

  const defaultClues = [
    "Kissago is weaving the next moment...",
    "Gathering stardust for the next scene...",
    "Consulting the ancient scrolls...",
    "Painting the landscape of imagination..."
  ];

  const cluesToUse = loadingClues?.length > 0 ? loadingClues : defaultClues;
  const backdropStyle = backdropMode === 'blocking'
    ? 'radial-gradient(ellipse at center, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.58) 58%, rgba(0,0,0,0.82) 100%)'
    : 'radial-gradient(ellipse at center, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.5) 58%, rgba(0,0,0,0.76) 100%)';
  const progress = loadingStage ? getStoryLoadingProgress(loadingStage) : 0;
  const activeStepIndex = loadingStage
    ? loadingStage.steps.findIndex((step) => step.key === loadingStage.currentStepKey)
    : -1;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 ${className}`}
      style={{ background: backdropStyle }}
    >
      <div className="max-w-lg w-full p-8 rounded-3xl bg-neutral-900/35 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col items-center text-center space-y-8">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="relative w-24 h-24 flex items-center justify-center"
        >
          <div className="absolute inset-0 rounded-full border-t-2 border-emerald-500 opacity-50" />
          <div className="absolute inset-2 rounded-full border-r-2 border-indigo-500 opacity-50" />
          <div className="absolute inset-4 rounded-full border-b-2 border-purple-500 opacity-50" />
          <Sparkles className="w-8 h-8 text-white animate-pulse" />
        </motion.div>

        <div className="w-full space-y-5">
          {loadingStage && (
            <div className="space-y-4 text-left">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans uppercase tracking-[0.35em] text-neutral-500">
                  <span>{loadingStage.flow === 'start_story' ? 'Starting your story' : 'Continuing your story'}</span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(progress * 100, 8)}%` }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {loadingStage.steps.map((step, index) => {
                  const isComplete = activeStepIndex > index;
                  const isActive = activeStepIndex === index;
                  return (
                    <div
                      key={step.key}
                      className={`rounded-2xl border px-3 py-3 text-center transition-colors ${
                        isActive
                          ? 'border-emerald-400/60 bg-emerald-500/12'
                          : isComplete
                          ? 'border-white/10 bg-white/5'
                          : 'border-white/8 bg-transparent'
                      }`}
                    >
                      <div className="mb-2 flex justify-center">
                        {isComplete ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                        ) : (
                          <div className={`h-4 w-4 rounded-full border ${isActive ? 'border-emerald-300 bg-emerald-400/40' : 'border-white/20'}`} />
                        )}
                      </div>
                      <p className={`text-[10px] font-sans uppercase tracking-[0.22em] ${isActive ? 'text-emerald-200' : 'text-neutral-500'}`}>
                        {step.label}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-sm font-sans uppercase tracking-[0.28em] text-emerald-300">
                  {loadingStage.steps[activeStepIndex]?.label || 'Working'}
                </p>
                <p className="mt-2 text-base font-sans leading-relaxed text-neutral-300">
                  {loadingStage.detail}
                </p>
              </div>
            </div>
          )}

          <div className="min-h-24 flex items-center justify-center">
            <RotatingClue
              key={`${loadingStage?.currentStepKey || 'idle'}:${cluesToUse.length}`}
              clues={cluesToUse}
              clueKey={loadingStage?.currentStepKey || 'clue'}
            />
          </div>
        </div>

        <div className="flex gap-2 items-center text-sm text-neutral-500 font-sans uppercase tracking-widest">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{loadingStage ? 'Creating your next moment' : 'Generating'}</span>
        </div>
      </div>
    </div>
  );
}
