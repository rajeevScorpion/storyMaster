'use client';

import { useState, useEffect } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2 } from 'lucide-react';

export default function LoadingState() {
  const loadingClues = useStoryStore((state) => state.loadingClues);
  const [currentClueIndex, setCurrentClueIndex] = useState(0);

  useEffect(() => {
    if (!loadingClues || loadingClues.length === 0) return;

    const interval = setInterval(() => {
      setCurrentClueIndex((prev) => (prev + 1) % loadingClues.length);
    }, 4000); // Rotate every 4 seconds

    return () => clearInterval(interval);
  }, [loadingClues]);

  const defaultClues = [
    "Kissago is weaving the next moment...",
    "Gathering stardust for the next scene...",
    "Consulting the ancient scrolls...",
    "Painting the landscape of imagination..."
  ];

  const cluesToUse = loadingClues?.length > 0 ? loadingClues : defaultClues;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-md">
      <div className="max-w-md w-full p-8 rounded-3xl bg-neutral-900 border border-white/10 shadow-2xl flex flex-col items-center text-center space-y-8">
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

        <div className="h-24 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={currentClueIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5 }}
              className="text-xl font-serif text-neutral-200 italic"
            >
              &quot;{cluesToUse[currentClueIndex]}&quot;
            </motion.p>
          </AnimatePresence>
        </div>
        
        <div className="flex gap-2 items-center text-sm text-neutral-500 font-sans uppercase tracking-widest">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating</span>
        </div>
      </div>
    </div>
  );
}
