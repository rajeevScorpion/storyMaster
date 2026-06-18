'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { loadStorylineWithBeats } from '@/app/actions/exploration';
import { loadCachedStoryline, saveStorylineAndPrefetch } from '@/lib/persistence/runtime';
import type { StorylineManifestPayload } from '@/lib/persistence';
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
}

function StorylineInitialLoader({
  title,
  authorName,
  coverImageUrl,
  beatCount,
  message,
}: {
  title: string;
  authorName: string | null;
  coverImageUrl?: string | null;
  beatCount: number;
  message: string;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {coverImageUrl && (
        <div className="absolute inset-0 opacity-35">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverImageUrl} alt="" className="h-full w-full object-cover blur-sm" />
        </div>
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.72),rgba(10,10,10,0.96))]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-5">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <BookOpen className="h-7 w-7 text-emerald-200" />
          </div>
          <h1 className="mt-6 text-2xl font-serif leading-snug text-white">{title || 'Opening storyline'}</h1>
          {authorName && <p className="mt-2 text-sm text-neutral-400">by {authorName}</p>}
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
            <span>{message}</span>
          </div>
          <p className="mt-3 text-xs uppercase tracking-[0.22em] text-neutral-500">
            {beatCount > 0 ? `${beatCount} beats` : 'Preparing reader'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function StorylinePersistenceLoader(props: StorylinePersistenceLoaderProps) {
  const [payload, setPayload] = useState<StorylineManifestPayload | null>(null);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadMessage, setLoadMessage] = useState('Checking saved copy...');

  useEffect(() => {
    let active = true;
    let hasDisplayedPayload = false;
    void (async () => {
      setLoadMessage('Checking saved copy...');
      const cachePromise = loadCachedStoryline({
        storylineId: props.storylineId,
        storyId: props.storyId,
        userId: props.userId,
      }).catch(() => null);

      const networkPromise = loadStorylineWithBeats(props.storylineId);

      void cachePromise.then((cached) => {
        if (!active || !cached || cached.manifest.payload.beats.length === 0) return;
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
      });

      try {
        setLoadMessage('Opening latest storyline...');
        const loaded = await networkPromise;
        if (loaded.beats.length === 0) {
          throw new Error('This storyline is still preparing its pages. Please try again shortly.');
        }
        const nextPayload: StorylineManifestPayload = {
          storylineId: props.storylineId,
          storyId: props.storyId,
          title: props.title,
          isVerticalStory: loaded.storyline.is_vertical_story,
          aspectRatio: loaded.storyline.aspect_ratio === '9:16' ? '9:16' : '16:9',
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
  ]);

  if (error && !payload) {
    return <div className="min-h-screen bg-neutral-950 p-8 text-center text-neutral-300">{error}</div>;
  }
  if (!payload) {
    return (
      <StorylineInitialLoader
        title={props.title}
        authorName={props.authorName}
        coverImageUrl={props.coverImageUrl}
        beatCount={props.beatCount ?? 0}
        message={loadMessage}
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
