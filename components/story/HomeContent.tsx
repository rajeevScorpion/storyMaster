'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useStoryStore } from '@/lib/store/story-store';
import { useAuth } from '@/lib/hooks/useAuth';
import LandingScreen from '@/components/story/LandingScreen';
import StoryScreen from '@/components/story/StoryScreen';
import LoadingState from '@/components/story/LoadingState';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import KissagoLogo from '@/components/ui/KissagoLogo';
import ManagedFooter from '@/components/layout/ManagedFooter';
import { AnimatePresence } from 'motion/react';
import type { StoryConfig } from '@/lib/types/story';
import type { LandingInitialData } from '@/lib/story/landing-ui';
import type { PricingRuntimeContext } from '@/lib/types/pricing';

interface HomeContentProps {
  initialLandingData?: LandingInitialData | null;
  initialPricing?: PricingRuntimeContext | null;
}

export default function HomeContent({ initialLandingData, initialPricing }: HomeContentProps) {
  const session = useStoryStore((state) => state.session);
  const isLoading = useStoryStore((state) => state.isLoading);
  const error = useStoryStore((state) => state.error);
  const errorAction = useStoryStore((state) => state.errorAction);
  const clearError = useStoryStore((state) => state.clearError);
  const resetStory = useStoryStore((state) => state.resetStory);
  const { user, openAuthDialog } = useAuth();
  const router = useRouter();
  const [showMyStories, setShowMyStories] = useState(false);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (
      session?.savedStoryId &&
      !session.explorationMode &&
      !hasRedirected.current
    ) {
      hasRedirected.current = true;
      router.replace(`/story/${session.savedStoryId}`);
    }
    if (!session) {
      hasRedirected.current = false;
    }
  }, [session, router]);

  const handleBegin = async (prompt: string, config?: StoryConfig) => {
    if (!user) {
      sessionStorage.setItem('kissago_pending_prompt', prompt);
      if (config) {
        sessionStorage.setItem('kissago_pending_config', JSON.stringify(config));
      }
      openAuthDialog('sign_in');
      return;
    }

    const startStory = useStoryStore.getState().startStory;
    startStory(prompt, config);
  };

  const handleLogoClick = () => {
    if (!session) return;
    hasRedirected.current = false;
    resetStory();
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <KissagoLogo onClick={handleLogoClick} />

      <div className="fixed top-4 right-4 z-40 flex items-center gap-2">
        <Link
          href="/gallery"
          className="px-5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-sm font-sans text-neutral-300 hover:bg-white/10 hover:border-emerald-500/30 hover:text-neutral-100 transition-all duration-200"
        >
          Gallery
        </Link>
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />

      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/50 text-red-200 px-6 py-3 rounded-2xl flex items-center gap-4 shadow-2xl backdrop-blur-md">
          <p className="text-sm font-medium">{error}</p>
          {errorAction && (
            <button
              onClick={() => router.push(errorAction.href)}
              className="text-xs uppercase tracking-wider font-bold hover:text-white transition-colors"
            >
              {errorAction.label}
            </button>
          )}
          <button
            onClick={clearError}
            className="text-xs uppercase tracking-wider font-bold hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!session ? (
          <LandingScreen
            key="landing"
            onBegin={handleBegin}
            initialData={initialLandingData}
            initialPricing={initialPricing}
          />
        ) : (
          <StoryScreen key="story" />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isLoading && <LoadingState key="loading" />}
      </AnimatePresence>

      {!session && <ManagedFooter />}
    </main>
  );
}
