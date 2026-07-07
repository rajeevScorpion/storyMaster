'use client';

import { useEffect, useState } from 'react';
import { loadStorylineWithBeats } from '@/app/actions/exploration';
import { loadCachedStoryline, saveStorylineAndPrefetch } from '@/lib/persistence/runtime';
import type { StorylineManifestPayload } from '@/lib/persistence';
import { preloadImageForDisplay } from '@/lib/hooks/useImagePreload';
import { preloadAudioForPlayback } from '@/lib/media/audio-preload';
import { getBeatFirstVisualUrl } from '@/lib/story/first-visual';
import OpenFlowLoader from './OpenFlowLoader';
import StorylinePlayer from './StorylinePlayer';

interface StorylinePersistenceLoaderProps {
  storylineId: string;
  storyId: string;
  userId: string;
  title: string;
  authorName: string | null;
  coverImageUrl?: string | null;
  beatCount?: number | null;
  isOwner: boolean;
  isSaved: boolean;
  isLiked: boolean;
  likeCount: number;
  isVerticalStory: boolean;
  aspectRatio: '16:9' | '9:16';
  /** Validated unlisted share token (server-checked) for RLS-hidden storylines. */
  shareToken?: string | null;
}

async function preloadFirstStorylineMedia(beats: StorylineManifestPayload['beats']) {
  await Promise.all([
    preloadImageForDisplay(getBeatFirstVisualUrl(beats[0])),
    preloadAudioForPlayback(beats[0]?.audioUrl),
  ]);
}

export default function StorylinePersistenceLoader(props: StorylinePersistenceLoaderProps) {
  const [payload, setPayload] = useState<StorylineManifestPayload | null>(null);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadMessage, setLoadMessage] = useState('Checking saved copy...');
  const [loadPhaseIndex, setLoadPhaseIndex] = useState(0);

  useEffect(() => {
    let active = true;
    let hasDisplayedPayload = false;
    void (async () => {
      setLoadMessage('Checking saved copy...');
      setLoadPhaseIndex(0);
      const cachePromise = loadCachedStoryline({
        storylineId: props.storylineId,
        storyId: props.storyId,
        userId: props.userId,
      }).catch(() => null);

      const networkPromise = loadStorylineWithBeats(props.storylineId, { shareToken: props.shareToken ?? null });

      void cachePromise.then(async (cached) => {
        if (!active || !cached || cached.manifest.payload.beats.length === 0) return;
        setLoadMessage('Preparing saved scenes...');
        setLoadPhaseIndex(2);
        await preloadFirstStorylineMedia(cached.manifest.payload.beats);
        if (!active || hasDisplayedPayload) return;
        hasDisplayedPayload = true;
        setPayload({
          ...cached.manifest.payload,
          isOwner: props.isOwner,
          isSaved: props.isSaved,
          isLiked: props.isLiked,
          likeCount: props.likeCount,
          isLoggedIn: true,
        });
        setSourceUpdatedAt(cached.manifest.sourceUpdatedAt);
        setLoadMessage('Refreshing latest version...');
        setLoadPhaseIndex(1);
      });

      try {
        setLoadMessage('Loading latest published version...');
        setLoadPhaseIndex(1);
        const loaded = await networkPromise;
        if (loaded.beats.length === 0) {
          throw new Error('This storyline is still preparing its pages. Please try again shortly.');
        }
        setLoadMessage('Preparing the first scene...');
        setLoadPhaseIndex(2);
        await preloadFirstStorylineMedia(loaded.beats);
        const nextPayload: StorylineManifestPayload = {
          storylineId: props.storylineId,
          storyId: props.storyId,
          title: props.title,
          isVerticalStory: loaded.storyline.is_vertical_story,
          aspectRatio: loaded.storyline.aspect_ratio === '9:16' ? '9:16' : '16:9',
          storyTransition: loaded.storyline.story_transition,
          beats: loaded.beats,
          choices: loaded.choices,
          authorName: props.authorName,
          isOwner: props.isOwner,
          isSaved: props.isSaved,
          isLiked: props.isLiked,
          likeCount: props.likeCount,
          isLoggedIn: true,
        };
        if (!active) return;
        setLoadPhaseIndex(3);
        hasDisplayedPayload = true;
        setPayload(nextPayload);
        setSourceUpdatedAt(loaded.storyline.source_updated_at);
        setError(null);
        void saveStorylineAndPrefetch({
          payload: nextPayload,
          userId: props.userId,
          sourceUpdatedAt: loaded.storyline.source_updated_at,
          currentPageIndex: 0,
        });
      } catch (loadError) {
        const cached = await cachePromise;
        if (active && !hasDisplayedPayload && !cached) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load storyline');
        }
      }
    })();
    return () => { active = false; };
  }, [
    props.authorName,
    props.isLiked,
    props.isOwner,
    props.isSaved,
    props.likeCount,
    props.storyId,
    props.storylineId,
    props.title,
    props.userId,
    props.shareToken,
  ]);

  if (error && !payload) {
    return <div className="min-h-screen bg-neutral-950 p-8 text-center text-neutral-300">{error}</div>;
  }
  if (!payload) {
    return (
      <OpenFlowLoader
        kind="storyline"
        title={props.title}
        coverImageUrl={props.coverImageUrl}
        beatCount={props.beatCount ?? 0}
        activePhaseIndex={loadPhaseIndex}
        statusText={loadMessage}
      />
    );
  }

  return (
    <StorylinePlayer
      storylineId={payload.storylineId}
      storyId={payload.storyId}
      title={payload.title}
      isVerticalStory={payload.isVerticalStory}
      aspectRatio={payload.aspectRatio}
      storyTransition={payload.storyTransition}
      beats={payload.beats}
      choices={payload.choices}
      authorName={payload.authorName}
      isOwner={payload.isOwner}
      isSaved={payload.isSaved}
      isLiked={payload.isLiked}
      likeCount={payload.likeCount}
      isLoggedIn={payload.isLoggedIn}
      persistenceUserId={props.userId}
      sourceUpdatedAt={sourceUpdatedAt}
    />
  );
}
