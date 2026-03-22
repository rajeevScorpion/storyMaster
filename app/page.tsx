'use client';

import { useState } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { useAuth } from '@/lib/hooks/useAuth';
import LandingScreen from '@/components/story/LandingScreen';
import StoryScreen from '@/components/story/StoryScreen';
import LoadingState from '@/components/story/LoadingState';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import { AnimatePresence } from 'motion/react';
import type { StoryConfig } from '@/lib/types/story';

export default function Home() {
  const session = useStoryStore((state) => state.session);
  const isLoading = useStoryStore((state) => state.isLoading);
  const error = useStoryStore((state) => state.error);
  const resetStory = useStoryStore((state) => state.resetStory);
  const { user, signInWithGoogle } = useAuth();
  const [showMyStories, setShowMyStories] = useState(false);

  const handleBegin = async (prompt: string, config?: StoryConfig) => {
    if (!user) {
      // Store prompt so it persists across redirect
      sessionStorage.setItem('kissago_pending_prompt', prompt);
      if (config) {
        sessionStorage.setItem('kissago_pending_config', JSON.stringify(config));
      }
      await signInWithGoogle();
      return;
    }
    // User is authenticated, start the story
    const startStory = useStoryStore.getState().startStory;
    startStory(prompt, config);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      {/* Kissago logo — fixed top-left across all views */}
      <button
        onClick={resetStory}
        className="fixed top-4 left-4 z-40 px-5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xl font-serif font-semibold tracking-wide text-emerald-400 hover:bg-white/10 hover:border-emerald-500/30 transition-all duration-200 cursor-pointer"
      >
        kissago
      </button>

      {/* User menu — fixed top-right across all views */}
      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />

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
          <LandingScreen key="landing" onBegin={handleBegin} />
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
