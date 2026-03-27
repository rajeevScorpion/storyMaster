'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStoryStore } from '@/lib/store/story-store';
import { useAuth } from '@/lib/hooks/useAuth';
import StoryScreen from '@/components/story/StoryScreen';
import LoadingState from '@/components/story/LoadingState';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import KissagoLogo from '@/components/ui/KissagoLogo';

export default function ExplorePage() {
  const params = useParams();
  const router = useRouter();
  const storyId = params.id as string;
  const { user, isLoading: authLoading } = useAuth();
  const [showMyStories, setShowMyStories] = useState(false);

  const session = useStoryStore((s) => s.session);
  const isLoading = useStoryStore((s) => s.isLoading);
  const error = useStoryStore((s) => s.error);
  const exploreStoryTree = useStoryStore((s) => s.exploreStoryTree);
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Redirect to home with auth prompt
      router.push('/?authRequired=explore');
      return;
    }

    // Only load if we don't already have this story loaded
    if (!session || session.savedStoryId !== storyId) {
      exploreStoryTree(storyId);
    }
  }, [storyId, user, authLoading, session, exploreStoryTree, router]);

  if (authLoading || isLoading) {
    return <LoadingState />;
  }

  if (error) {
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

  if (!session) return null;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      {/* Kissago logo — fixed top-left */}
      <KissagoLogo />


      {/* User menu — fixed top-right */}
      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />

      <StoryScreen />
    </div>
  );
}
