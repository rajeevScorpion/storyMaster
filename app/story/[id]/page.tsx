'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStoryStore } from '@/lib/store/story-store';
import { useAuth } from '@/lib/hooks/useAuth';
import StoryScreen from '@/components/story/StoryScreen';
import LoadingState from '@/components/story/LoadingState';
import LoadingAmbientBackdrop from '@/components/story/LoadingAmbientBackdrop';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import KissagoLogo from '@/components/ui/KissagoLogo';

export default function StoryPage() {
  const params = useParams();
  const router = useRouter();
  const storyId = params.id as string;
  const { user, isLoading: authLoading, openAuthDialog } = useAuth();
  const [showMyStories, setShowMyStories] = useState(false);
  const hasRequestedAuthRef = useRef(false);
  const isNavigatingHomeRef = useRef(false);

  const session = useStoryStore((s) => s.session);
  const isLoading = useStoryStore((s) => s.isLoading);
  const error = useStoryStore((s) => s.error);
  const errorAction = useStoryStore((s) => s.errorAction);
  const clearError = useStoryStore((s) => s.clearError);
  const loadStoryFromCloud = useStoryStore((s) => s.loadStoryFromCloud);
  const resetStory = useStoryStore((s) => s.resetStory);
  const hasMatchingSession = !!session && session.savedStoryId === storyId;

  useEffect(() => {
    if (isNavigatingHomeRef.current) return;
    if (authLoading) return;

    if (!user) {
      if (!hasRequestedAuthRef.current) {
        hasRequestedAuthRef.current = true;
        openAuthDialog('sign_in', `/story/${storyId}`);
      }
      return;
    }

    hasRequestedAuthRef.current = false;

    // Only load if we don't already have this story loaded
    if (!session || session.savedStoryId !== storyId) {
      loadStoryFromCloud(storyId);
    }
  }, [storyId, user, authLoading, session, loadStoryFromCloud, openAuthDialog]);

  const handleLogoClick = () => {
    isNavigatingHomeRef.current = true;
    resetStory();
  };

  if (error && !hasMatchingSession) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-xl font-serif text-neutral-200 mb-2">Unable to load story</h2>
          <p className="text-neutral-500 mb-6">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-white/10 text-neutral-200 rounded-2xl hover:bg-white/20 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      {/* Kissago logo — fixed top-left */}
      <KissagoLogo onClick={handleLogoClick} />

      {/* User menu — fixed top-right */}
      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />

      {hasMatchingSession && error && (
        <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-red-500/50 bg-red-500/10 px-6 py-3 text-red-200 shadow-2xl backdrop-blur-md">
          <p className="text-sm font-medium">{error}</p>
          {errorAction && (
            <button
              onClick={() => router.push(errorAction.href)}
              className="text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
            >
              {errorAction.label}
            </button>
          )}
          <button
            onClick={clearError}
            className="text-xs font-bold uppercase tracking-wider transition-colors hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {hasMatchingSession ? (
        <StoryScreen />
      ) : (
        <div className="relative min-h-screen overflow-hidden">
          <LoadingAmbientBackdrop />
        </div>
      )}

      {(authLoading || isLoading) && <LoadingState backdropMode="scene" />}
    </div>
  );
}
