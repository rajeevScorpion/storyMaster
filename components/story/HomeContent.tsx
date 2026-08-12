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
import type { Character, StoryConfig } from '@/lib/types/story';
import { consumeHomeStoryResetRequest, hasHomeStoryResetRequest } from '@/lib/story/home-navigation';
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
  const [isClearingStaleSession, setIsClearingStaleSession] = useState(
    // The store is a module singleton with no persistence, so a session is still
    // in memory after any client-side navigation — including the one that just
    // brought us here from a story. Arriving with one already saved would make
    // the redirect below fire on mount and throw the visitor straight back into
    // that story, which would leave Create looking broken for anyone who had
    // opened anything in this tab. Asking for /create means asking for the
    // composer, so a stale session is cleared instead of resumed.
    //
    // Only when it has a `savedStoryId`: that story is durable, reachable at
    // /story/[id] and listed in My Stories. A session without one exists nowhere
    // else — it is mid-generation — so it is left alone and StoryScreen picks it
    // up rather than discarding work.
    () => hasHomeStoryResetRequest() || !!useStoryStore.getState().session?.savedStoryId
  );
  const hasRedirected = useRef(false);
  const sessionForDisplay = isClearingStaleSession ? null : session;

  useEffect(() => {
    if (!isClearingStaleSession) return;
    consumeHomeStoryResetRequest();
    hasRedirected.current = false;
    resetStory();
    const timeoutId = window.setTimeout(() => setIsClearingStaleSession(false), 0);
    return () => window.clearTimeout(timeoutId);
  }, [isClearingStaleSession, resetStory]);

  // The redirect that remains is the tail of the creation flow, not a resume:
  // a story started here gains a `savedStoryId` on its early save, and that is
  // the moment the author is handed over to the real story route.
  useEffect(() => {
    if (isClearingStaleSession) return;
    if (
      sessionForDisplay?.savedStoryId &&
      !sessionForDisplay.explorationMode &&
      !hasRedirected.current
    ) {
      hasRedirected.current = true;
      router.replace(`/story/${sessionForDisplay.savedStoryId}`);
    }
    if (!sessionForDisplay) {
      hasRedirected.current = false;
    }
  }, [isClearingStaleSession, sessionForDisplay, router]);

  const handleBegin = async (
    prompt: string,
    config?: StoryConfig,
    opts?: { autoBuild?: boolean; seedCharacters?: Character[] }
  ) => {
    if (!user) {
      sessionStorage.setItem('kissago_pending_prompt', prompt);
      if (config) {
        sessionStorage.setItem('kissago_pending_config', JSON.stringify(config));
      }
      if (opts?.autoBuild) {
        sessionStorage.setItem('kissago_pending_autobuild', '1');
      } else {
        sessionStorage.removeItem('kissago_pending_autobuild');
      }
      openAuthDialog('sign_in');
      return;
    }

    if (opts?.autoBuild) {
      const generateAutomatedStory = useStoryStore.getState().generateAutomatedStory;
      generateAutomatedStory(prompt, config);
      return;
    }

    const startStory = useStoryStore.getState().startStory;
    startStory(
      prompt,
      config,
      opts?.seedCharacters?.length ? { seedCharacters: opts.seedCharacters } : undefined
    );
  };

  const handleLogoClick = () => {
    if (!sessionForDisplay) return;
    hasRedirected.current = false;
    resetStory();
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <KissagoLogo onClick={handleLogoClick} />

      <div className="fixed top-4 right-4 z-40 flex items-center gap-2">
        {/* The mirror of the gallery's Create pill: the way back out of
            authoring and into watching. Points at the root, which is the
            gallery now, so it never pays for the /gallery redirect hop. */}
        <Link
          href="/"
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
        {!sessionForDisplay ? (
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

      {!sessionForDisplay && <ManagedFooter />}
    </main>
  );
}
