'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import StorylineCard from '@/components/gallery/StorylineCard';
import type { GalleryRail as GalleryRailData } from '@/lib/types/database';

const SCROLL_EPSILON_PX = 4;

const CARD_SIZES = {
  wide: '(max-width: 640px) 260px, (max-width: 1280px) 300px, 340px',
  portrait: '(max-width: 640px) 150px, 180px',
} as const;

interface GalleryRailProps {
  rail: GalleryRailData;
  savedIds: Set<string>;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
  /** Optional "see all" affordance, e.g. jumping to the filtered grid. */
  onSeeAll?: () => void;
  seeAllLabel?: string;
  hideEngagementCounts?: boolean;
}

/**
 * Edge-bleeding horizontal rail. Cards run past the page gutter on wide
 * screens for the cinematic look, while scroll padding keeps snap points
 * aligned with the gutter so the first card never sits under the edge.
 */
export default function GalleryRail({
  rail,
  savedIds,
  isLoggedIn,
  onToggleSave,
  onSeeAll,
  seeAllLabel = 'See all',
  hideEngagementCounts = false,
}: GalleryRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > SCROLL_EPSILON_PX);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - SCROLL_EPSILON_PX);
  }, []);

  useEffect(() => {
    updateScrollState();

    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState, rail.items.length]);

  const scrollByPage = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.85, 240);
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (rail.items.length === 0) return null;

  const headingId = `rail-heading-${rail.key.replace(/[^a-z0-9]+/gi, '-')}`;
  // Tall edge paddles rather than small floating circles: they cover the card
  // strip, so the click target matches where the eye already is. Pointer-only —
  // touch users swipe, and the edge fades signal there is more to scroll.
  const paddleClass =
    'pointer-fine-only absolute bottom-2 top-0 z-20 w-12 items-center justify-center text-neutral-200 opacity-0 transition-opacity duration-200 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70 group-hover/rail:opacity-100';

  return (
    <section className="group/rail relative" aria-labelledby={headingId}>
      <div className="mb-3 flex items-baseline justify-between gap-4 px-4 lg:px-8">
        <h2
          id={headingId}
          className="font-serif text-xl text-neutral-100 md:text-[1.375rem]"
        >
          {rail.title}
        </h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="shrink-0 rounded-lg text-xs font-medium text-neutral-500 transition-colors hover:text-emerald-400 focus-visible:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 md:opacity-0 md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100"
          >
            {seeAllLabel} <span aria-hidden="true">→</span>
          </button>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => scrollByPage('left')}
          aria-label={`Scroll ${rail.title} left`}
          className={`${paddleClass} left-0 bg-gradient-to-r from-neutral-950 via-neutral-950/80 to-transparent ${
            canScrollLeft ? '' : 'pointer-events-none !opacity-0'
          }`}
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={() => scrollByPage('right')}
          aria-label={`Scroll ${rail.title} right`}
          className={`${paddleClass} right-0 bg-gradient-to-l from-neutral-950 via-neutral-950/80 to-transparent ${
            canScrollRight ? '' : 'pointer-events-none !opacity-0'
          }`}
        >
          <ChevronRight className="h-7 w-7" />
        </button>

        {/* Edge fades double as the touch scroll affordance. */}
        {canScrollLeft && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-neutral-950 to-transparent"
          />
        )}
        {canScrollRight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-neutral-950 to-transparent"
          />
        )}

        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [overscroll-behavior-x:contain] sm:gap-4 lg:scroll-px-8 lg:px-8"
        >
          {rail.items.map((item) => (
            <div
              key={item.id}
              className={`shrink-0 snap-start ${
                rail.layout === 'portrait'
                  ? 'w-[150px] sm:w-[180px]'
                  : 'w-[260px] md:w-[300px] xl:w-[340px]'
              }`}
            >
              <StorylineCard
                item={item}
                layout={rail.layout}
                sizes={CARD_SIZES[rail.layout]}
                isSaved={savedIds.has(item.id)}
                isLoggedIn={isLoggedIn}
                hideEngagementCounts={hideEngagementCounts}
                onToggleSave={onToggleSave}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
