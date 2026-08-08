'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookOpen, Bookmark, BookmarkCheck, Play } from 'lucide-react';
import StoryboardThumbnail from '@/components/story/StoryboardThumbnail';
import { STORYBOARD_PANEL_SEQUENCE } from '@/lib/storyboard/layout';
import { writeOpenFlowNavMeta } from '@/lib/story/open-flow-nav';
import { getStoryGenreLabel } from '@/lib/story/genres';
import { getStoryAudienceProfile } from '@/lib/ai/story-audience';
import type { GalleryItem } from '@/lib/types/database';

const ROTATE_INTERVAL_MS = 8000;
/** Delay before the second slide is mounted; see `renderCount`. */
const PRELOAD_NEXT_SLIDE_MS = 2500;

/**
 * Capped deliberately rather than a plain `100vw`.
 *
 * A storyboard cover is cropped to one quadrant, and StoryboardThumbnail scales
 * `sizes` by ~2.12× to compensate, so `100vw` would ask the optimiser for a
 * 3840px-wide source per slide and saturate it. 960px scales to ~2035px, which
 * lands in the 2048 bucket — ample for a backdrop under two gradient scrims.
 */
const HERO_SIZES = '(max-width: 768px) 100vw, 960px';

/**
 * One slot per panel in the vertical strip below, so all four panels resolve to
 * the same source and the browser fetches the grid once. StoryboardThumbnail
 * scales this by ~2.12× for the crop box, and a panel occupying a quarter of
 * the hero needs a grid two panels wide — which is exactly what 25vw × 2.12
 * asks for. The mobile branch matches Tailwind's `md`, where the strip
 * collapses to panel 1 alone at full width.
 */
const HERO_VERTICAL_PANEL_SIZES = '(max-width: 767px) 100vw, 25vw';

/**
 * The billboard shows its artwork full-bleed, so it prefers the storyline's
 * opening beat over its cover: a cover can be poster art with the title burned
 * in, and a wide crop slices the lettering. Beat artwork is always a 2×2
 * storyboard grid — hence `isStoryboard` unconditionally, rather than a flag
 * that is only ever written when true. The cover is the fallback for
 * storylines whose opening beat has no image, and keeps its own flag because a
 * poster must not be cropped to a quadrant.
 */
function getBackdrop(item: GalleryItem): { url: string | null; isStoryboard: boolean } {
  return item.openingImageUrl
    ? { url: item.openingImageUrl, isStoryboard: true }
    : { url: item.coverImageUrl, isStoryboard: item.coverIsStoryboard };
}

/**
 * The backdrop for one slide. Never cycles panels — `isPreviewing` is pinned
 * false and the vertical strip pins a panel outright — so the billboard holds
 * still whatever the pointer does.
 *
 * A 9:16 panel stretched across a 16:9-and-wider billboard magnifies the art
 * past legibility, so vertical storylines lay all four panels side by side
 * instead: 4 × 9:16 is about 2.25:1, which suits the slot. Below `md` there is
 * no room for four, and it falls back to panel 1 alone.
 */
function HeroBackdrop({ item, priority }: { item: GalleryItem; priority: boolean }) {
  const { url, isStoryboard } = getBackdrop(item);
  if (!url) return null;

  if (isStoryboard && item.isVerticalStory) {
    return (
      <div className="absolute inset-0 flex">
        {STORYBOARD_PANEL_SEQUENCE.map((panel) => (
          <div
            key={panel}
            // Panels 2–4 are hidden rather than unmounted below `md`: they
            // share panel 1's resolved source, so hiding them costs no extra
            // fetch and avoids a layout swap on resize.
            className={`relative h-full ${panel === 0 ? 'flex-1' : 'hidden md:block md:flex-1'}`}
          >
            <StoryboardThumbnail
              src={url}
              alt=""
              sizes={HERO_VERTICAL_PANEL_SIZES}
              isPreviewing={false}
              previewSessionId={0}
              isStoryboard
              panel={panel}
              priority={priority && panel === 0}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <StoryboardThumbnail
      src={url}
      alt=""
      sizes={HERO_SIZES}
      isPreviewing={false}
      previewSessionId={0}
      isStoryboard={isStoryboard}
      panel={0}
      priority={priority}
    />
  );
}

interface GalleryHeroProps {
  items: GalleryItem[];
  savedIds: Set<string>;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
}

/**
 * Rotating billboard over the day's spotlight storylines. Backdrops crossfade
 * on a timer (paused for reduced motion, hidden tabs, and while the pointer
 * rests on the hero so the copy stays readable), and storyboard covers are
 * cropped to a single panel by StoryboardThumbnail rather than showing the raw
 * 2×2 grid.
 */
export default function GalleryHero({
  items,
  savedIds,
  isLoggedIn,
  onToggleSave,
}: GalleryHeroProps) {
  const prefersReducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPointerOver, setIsPointerOver] = useState(false);
  // Backdrops are full-bleed, so mounting every slide would put five large
  // images on the critical path and starve the image optimiser. Only the first
  // is mounted for the initial paint; the second follows shortly after so the
  // first crossfade still has a decoded image, and the rest arrive as the
  // rotation reaches them. Slides already shown stay mounted so a crossfade
  // always has something to fade out of.
  const [renderCount, setRenderCount] = useState(1);

  // A refreshed featured list may be shorter than the previous one.
  const safeIndex = items.length > 0 ? activeIndex % items.length : 0;
  const active = items[safeIndex];

  const showSlide = useCallback((index: number) => {
    setActiveIndex(index);
    setRenderCount((count) => Math.max(count, Math.min(items.length, index + 2)));
  }, [items.length]);

  const advance = useCallback(() => {
    if (items.length === 0) return;
    showSlide((safeIndex + 1) % items.length);
  }, [items.length, safeIndex, showSlide]);

  useEffect(() => {
    if (items.length < 2) return;

    // Off the critical path: the first slide has had time to load by now.
    const id = window.setTimeout(
      () => setRenderCount((count) => Math.max(count, 2)),
      PRELOAD_NEXT_SLIDE_MS
    );
    return () => window.clearTimeout(id);
  }, [items.length]);

  useEffect(() => {
    if (items.length < 2 || prefersReducedMotion || isPointerOver) return;

    const id = window.setInterval(() => {
      if (!document.hidden) advance();
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [advance, isPointerOver, items.length, prefersReducedMotion]);

  if (!active) return null;

  const genreLabel = getStoryGenreLabel(active.genre);
  // Only label a band the storyline actually declares — an unclassified story
  // must not read as "All Ages".
  const audienceLabel = active.ageGroup ? getStoryAudienceProfile(active.ageGroup).label : null;
  const isSaved = savedIds.has(active.id);

  const handleOpen = () => {
    writeOpenFlowNavMeta({
      kind: 'storyline',
      title: active.title,
      coverImageUrl: active.coverImageUrl,
      coverIsStoryboard: active.coverIsStoryboard,
      beatCount: active.beatCount,
    });
  };

  return (
    <section
      aria-label="Featured storylines"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setIsPointerOver(true);
      }}
      onPointerLeave={() => setIsPointerOver(false)}
      className="relative h-[62dvh] min-h-[420px] w-full max-h-[560px] overflow-hidden md:h-[72dvh] md:max-h-[720px]"
    >
      {/* Stacked backdrops crossfade via opacity; every slide stays mounted so
          the next image is already decoded when its turn comes. */}
      {items.slice(0, Math.max(renderCount, safeIndex + 1)).map((item, index) => {
        const isActive = index === safeIndex;
        return (
          <div
            key={item.id}
            aria-hidden={!isActive}
            className={`absolute inset-0 transition-opacity duration-1000 ease-out ${
              isActive ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className={`absolute inset-0 ${isActive && !prefersReducedMotion ? 'hero-kenburns' : ''}`}>
              <HeroBackdrop item={item} priority={index === 0} />
            </div>
          </div>
        );
      })}

      {/* Scrims: bottom fade into the page, left fade behind the copy. */}
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/45 to-neutral-950/15" />
      <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/90 via-neutral-950/40 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-4 pb-14 lg:px-8 lg:pb-20">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.id}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="max-w-2xl space-y-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
              Featured storyline
            </p>

            <h1 className="font-serif text-3xl leading-tight text-neutral-50 drop-shadow-sm md:text-5xl">
              {active.title}
            </h1>

            {active.intro && (
              <p className="line-clamp-2 max-w-xl text-sm text-neutral-200 md:line-clamp-3 md:text-base">
                {active.intro}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-300">
              {genreLabel && (
                <span className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-200">
                  {genreLabel}
                </span>
              )}
              {audienceLabel && (
                <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-neutral-200 backdrop-blur-sm">
                  {audienceLabel}
                </span>
              )}
              {!!active.beatCount && (
                <span className="flex items-center gap-1 text-neutral-300">
                  <BookOpen className="h-3.5 w-3.5" />
                  {active.beatCount} beats
                </span>
              )}
              {active.authorName && <span className="text-neutral-400">by {active.authorName}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1.5">
              <Link
                href={`/storyline/${active.id}`}
                onClick={handleOpen}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 hover:shadow-emerald-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
              >
                <Play className="h-4 w-4 fill-current" />
                Start reading
              </Link>

              {isLoggedIn && (
                <button
                  type="button"
                  onClick={() => onToggleSave(active.id, isSaved)}
                  aria-pressed={isSaved}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm text-neutral-200 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                >
                  {isSaved ? (
                    <>
                      <BookmarkCheck className="h-4 w-4 text-emerald-400" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4 w-4" />
                      My List
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {items.length > 1 && (
          <div className="mt-5 flex items-center gap-1" role="tablist" aria-label="Featured storylines">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={index === safeIndex}
                aria-label={`Show featured storyline ${index + 1} of ${items.length}: ${item.title}`}
                onClick={() => showSlide(index)}
                className="group/dot flex h-8 items-center px-1 focus-visible:outline-none"
              >
                <span
                  className={`h-1 rounded-full transition-all duration-300 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-emerald-400/70 ${
                    index === safeIndex
                      ? 'w-7 bg-emerald-400'
                      : 'w-3 bg-white/25 group-hover/dot:bg-white/50'
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
