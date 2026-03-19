'use client';

import { useStoryStore } from '@/lib/store/story-store';
import LandingScreen from '@/components/story/LandingScreen';
import StoryScreen from '@/components/story/StoryScreen';
import LoadingState from '@/components/story/LoadingState';
import { AnimatePresence } from 'motion/react';

export default function Home() {
  const session = useStoryStore((state) => state.session);
  const isLoading = useStoryStore((state) => state.isLoading);
  const error = useStoryStore((state) => state.error);
  const resetStory = useStoryStore((state) => state.resetStory);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/50 text-red-200 px-6 py-3 rounded-2xl flex items-center gap-4 shadow-2xl backdrop-blur-md">
          <p className="text-sm font-medium">{error}</p>
          <button 
            onClick={resetStory}
            className="text-xs uppercase tracking-wider font-bold hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!session ? (
          <LandingScreen key="landing" />
        ) : (
          <StoryScreen key="story" />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isLoading && <LoadingState key="loading" />}
      </AnimatePresence>
    </main>
  );
}
