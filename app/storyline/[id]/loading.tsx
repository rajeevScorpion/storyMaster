'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2 } from 'lucide-react';

const NAV_QUOTES = [
  "Turning to the next chapter...",
  "The story awaits beyond this threshold...",
  "Every tale has a door \u2014 you\u2019ve found yours...",
  "Stepping into someone\u2019s imagination...",
  "A world unfolds in the pages ahead...",
];

interface NavMeta {
  title: string;
  coverImageUrl: string | null;
  authorName: string | null;
  beatCount: number | null;
}

function readNavMeta(): NavMeta | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('storyline-nav-meta');
    if (raw) {
      sessionStorage.removeItem('storyline-nav-meta');
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

export default function StorylineLoading() {
  const [meta] = useState<NavMeta | null>(readNavMeta);
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((i) => (i + 1) % NAV_QUOTES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 overflow-hidden">
      {/* Background cover image with Ken Burns */}
      {meta?.coverImageUrl && (
        <motion.div
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: 1.15, opacity: 1 }}
          transition={{
            scale: { duration: 20, ease: 'linear' },
            opacity: { duration: 1.2, ease: 'easeOut' },
          }}
          className="absolute inset-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={meta.coverImageUrl}
            alt=""
            className="w-full h-full object-cover blur-[2px]"
          />
        </motion.div>
      )}

      {/* Dark radial overlay */}
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

      {/* Content */}
      <div className="relative z-10 h-full flex items-center justify-center px-4">
        <div className="max-w-md w-full p-8 rounded-3xl bg-neutral-900/30 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col items-center text-center space-y-8">
          {/* Triple-ring spinner */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            className="relative w-24 h-24 flex items-center justify-center"
          >
            <div className="absolute inset-0 rounded-full border-t-2 border-emerald-500 opacity-50" />
            <div className="absolute inset-2 rounded-full border-r-2 border-indigo-500 opacity-50" />
            <div className="absolute inset-4 rounded-full border-b-2 border-purple-500 opacity-50" />
            <Sparkles className="w-8 h-8 text-white animate-pulse" />
          </motion.div>

          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-2"
          >
            <h1 className="text-2xl md:text-3xl font-serif text-white leading-snug">
              {meta?.title || 'Opening storyline...'}
            </h1>
            {meta?.authorName && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.35 }}
                className="text-sm text-neutral-400 font-sans"
              >
                by {meta.authorName}
              </motion.p>
            )}
          </motion.div>

          {/* Rotating quotes */}
          <div className="h-16 flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={quoteIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5 }}
                className="text-base font-serif text-neutral-300 italic"
              >
                &quot;{NAV_QUOTES[quoteIndex]}&quot;
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Status */}
          <div className="flex gap-2 items-center text-sm text-neutral-500 font-sans uppercase tracking-widest">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Entering storyline</span>
          </div>
        </div>
      </div>
    </div>
  );
}
