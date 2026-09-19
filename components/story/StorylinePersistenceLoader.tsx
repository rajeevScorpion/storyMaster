'use client';

import { useEffect, useState } from 'react';
import { loadStorylineWithBeats } from '@/app/actions/exploration';
import { loadCachedStoryline, saveStorylineAndPrefetch } from '@/lib/persistence/runtime';
import type { StorylineManifestPayload } from '@/lib/persistence';
import type { StorylineSeriesContext } from '@/lib/types/series';
import { preloadStorylineMedia } from '@/lib/media/storyline-preload';
import { getWatchQuotaView } from '@/app/actions/watch-quota';
import { isLastWatchSlot, type WatchQuotaView } from '@/lib/pricing/watch-quota.shared';
import { WatchQuotaExhausted, WatchQuotaLastSlotConfirm } from './WatchQuotaNotice';
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
  /**
   * Resolved server-side and threaded straight through as a prop, never into
   * the cached manifest: a device holding a manifest saved before this existed
   * would otherwise serve a storyline that forgets it is part of a series.
   */
  series?: StorylineSeriesContext | null;
}

export default function StorylinePersistenceLoader(props: StorylinePersistenceLoaderProps) {
  const [payload, setPayload] = useState<StorylineManifestPayload | null>(null);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [watchQuotaExhausted, setWatchQuotaExhausted] = useState(false);
  const [loadMessage, setLoadMessage] = useState('Checking saved copy...');
  const [loadPhaseIndex, setLoadPhaseIndex] = useState(0);
  /**
   * Payments Phase 3, Unit D. Resolved before the beats are fetched, because
   * `loadStorylineWithBeats` SPENDS a slot: there is no way to ask "use your last one on this?"
   * after the call that would have used it. `null` means the answer has not arrived yet.
   */
  const [quotaView, setQuotaView] = useState<WatchQuotaView | null>(null);
  const [lastSlotConfirmed, setLastSlotConfirmed] = useState(false);

  // Reading the quota is a separate effect from loading the storyline so that the confirmation can
  // sit between them. It short-circuits server-side for an admin or an exempt plan before it ever
  // touches the slots table, so the cost for a reader who has no limit is one cheap call.
  useEffect(() => {
    let active = true;
    setQuotaView(null);
    setLastSlotConfirmed(false);
    void getWatchQuotaView(props.storylineId)
      .then((view) => {
        if (active) setQuotaView(view);
      })
      .catch((error) => {
        // Fail open, exactly as every other reference to this capability does: a quota lookup that
        // errors must not stop someone reading. The server still enforces the real limit.
        console.warn('[watch-quota] could not read the quota view, continuing unrestricted:', error);
        if (active) setQuotaView({ unlimited: true, used: 0, limit: 0, isReplay: false, upsell: null });
      });
    return () => { active = false; };
  }, [props.storylineId]);

  const awaitingLastSlotConfirm = quotaView !== null && isLastWatchSlot(quotaView) && !lastSlotConfirmed;

  useEffect(() => {
    // Wait for the quota answer, and for the reader's yes when this would be their last slot.
    // Nothing below is started until then -- the network call is what spends the slot.
    if (quotaView === null || awaitingLastSlotConfirm) return;

    let active = true;
    let hasDisplayedPayload = false;
    void (async () => {
      setLoadMessage('Checking saved copy...');
      setLoadPhaseIndex(0);
      setWatchQuotaExhausted(false);
      const cachePromise = loadCachedStoryline({
        storylineId: props.storylineId,
        storyId: props.storyId,
        userId: props.userId,
      }).catch(() => null);

      const networkPromise = loadStorylineWithBeats(props.storylineId, { shareToken: props.shareToken ?? null });

      void cachePromise.then(async (cached) => {
        if (!active || !cached || cached.manifest.payload.beats.length === 0) return;
        setLoadMessage('Preparing all saved scenes and narration...');
        setLoadPhaseIndex(2);
        await preloadStorylineMedia(cached.manifest.payload.beats);
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
        if (loaded.status === 'watch_quota_exhausted') {
          if (!active) return;
          // The cache read races this call and can paint the story before the refusal arrives
          // (the cachePromise.then handler above). Setting hasDisplayedPayload true -- not false --
          // both clears anything already shown AND stops a cache resolution still in flight from
          // painting it afterwards: that handler bails out whenever the flag is true, and it stays
          // true for the rest of this effect run.
          hasDisplayedPayload = true;
          setPayload(null);
          setError(null);
          setWatchQuotaExhausted(true);
          return;
        }
        if (loaded.beats.length === 0) {
          throw new Error('This storyline is still preparing its pages. Please try again shortly.');
        }
        setLoadMessage('Preparing all scenes and narration...');
        setLoadPhaseIndex(2);
        await preloadStorylineMedia(loaded.beats);
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
        // Only genuine failures reach here -- a quota refusal is returned as data above, because a
        // production build would not carry a marker on a thrown action's message this far
        // (GOTCHAS.md). Keeping a displayed cached copy is right for these and wrong for a refusal.
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
    quotaView,
    awaitingLastSlotConfirm,
  ]);

  if (watchQuotaExhausted) {
    // The peek's own numbers, with `used` pinned to the limit: the server refused, so the day is
    // full whatever the peek saw a moment earlier (another device may have spent the last slot
    // in between). `quotaView` is only null if the refusal beat the peek back, which cannot
    // normally happen -- the fallback is there so this surface can never render blank.
    const view: WatchQuotaView = quotaView
      ? { ...quotaView, used: quotaView.limit, isReplay: false }
      : { unlimited: false, used: 0, limit: 0, isReplay: false, upsell: null };
    return <WatchQuotaExhausted view={view} />;
  }

  if (awaitingLastSlotConfirm && quotaView) {
    return (
      <WatchQuotaLastSlotConfirm
        view={quotaView}
        title={props.title}
        onConfirm={() => setLastSlotConfirmed(true)}
      />
    );
  }
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
      series={props.series ?? null}
    />
  );
}
