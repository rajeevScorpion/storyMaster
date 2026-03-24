'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStoryStore } from '@/lib/store/story-store';
import { useAuth } from '@/lib/hooks/useAuth';
import LandingScreen from '@/components/story/LandingScreen';
import StoryScreen from '@/components/story/StoryScreen';
import LoadingState from '@/components/story/LoadingState';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import { AnimatePresence } from 'motion/react';
import type { StoryConfig } from '@/lib/types/story';

function HomeContent() {
  const session = useStoryStore((state) => state.session);
  const isLoading = useStoryStore((state) => state.isLoading);
  const error = useStoryStore((state) => state.error);
  const resetStory = useStoryStore((state) => state.resetStory);
  const { user, signInWithGoogle } = useAuth();
  const [showMyStories, setShowMyStories] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const searchParams = useSearchParams();

  // Clear stale exploration sessions so root URL always shows landing page
  useEffect(() => {
    if (session?.explorationMode) {
      resetStory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show auth-required message from redirects
  useEffect(() => {
    const authRequired = searchParams.get('authRequired');
    if (authRequired === 'explore') {
      setAuthMessage('Sign in to explore story trees');
    } else if (authRequired === 'storyline') {
      setAuthMessage('Sign in to experience full stories');
    }
    // Auto-dismiss after 5 seconds
    if (authRequired) {
      const timer = setTimeout(() => setAuthMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

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

      {authMessage && !user && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-emerald-500/10 border border-emerald-500/40 text-emerald-200 px-6 py-3 rounded-2xl flex items-center gap-4 shadow-2xl backdrop-blur-md">
          <p className="text-sm font-medium">{authMessage}</p>
          <button
            onClick={() => setAuthMessage(null)}
            className="text-xs uppercase tracking-wider font-bold hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

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

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
