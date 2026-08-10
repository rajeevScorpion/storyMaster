'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import StorylineCard from '@/components/gallery/StorylineCard';
import {
  resolveExpandedGeometry,
  resolveScrollAdjustment,
  type ExpandedGeometry,
} from '@/lib/gallery/card-expansion';
import type { GalleryRail as GalleryRailData } from '@/lib/types/database';

const SCROLL_EPSILON_PX = 4;

/**
 * Hover intent. Long enough that sweeping the pointer across a rail on the way
 * somewhere else never opens anything, short enough that a deliberate hover
 * does not feel stuck.
 */
const HOVER_EXPAND_DELAY_MS = 400;

/**
 * Grace period on leave, so crossing the seam between artwork and side panel —
 * or clipping a corner on the way to the CTA — does not slam it shut.
 */
const HOVER_COLLAPSE_DELAY_MS = 180;

/** Matches the width transition, so snapping resumes only once motion stops. */
const SNAP_RESTORE_DELAY_MS = 350;

/** Window in which our own smooth scroll must not be mistaken for the reader's. */
const PROGRAMMATIC_SCROLL_MS = 450;

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
 *
 * The rail also owns card expansion, because every part of it is a rail-level
 * concern: only one card may be open, snapping has to stand down while one is,
 * the edge paddles and fades have to get out of the way, and the open card may
 * need scrolling into view.
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
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<ExpandedGeometry | null>(null);
  const [snapSuspended, setSnapSuspended] = useState(false);

  const expandTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const snapRestoreTimerRef = useRef<number | null>(null);
  const programmaticScrollUntilRef = useRef(0);

  const clearTimer = (ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > SCROLL_EPSILON_PX);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - SCROLL_EPSILON_PX);
  }, []);

  const collapseNow = useCallback(() => {
    clearTimer(expandTimerRef);
    clearTimer(collapseTimerRef);
    setExpandedId(null);
    setGeometry(null);
    clearTimer(snapRestoreTimerRef);
    snapRestoreTimerRef.current = window.setTimeout(() => {
      setSnapSuspended(false);
      snapRestoreTimerRef.current = null;
    }, SNAP_RESTORE_DELAY_MS);
  }, []);

  /**
   * Measure the resting slot and commit the expansion. Measuring here rather
   * than from breakpoint constants keeps the geometry honest at any width, and
   * only one card is ever open, so the slot being measured is always at rest.
   */
  const expandNow = useCallback((id: string) => {
    const scroller = scrollRef.current;
    const item = itemRefs.current.get(id);
    if (!scroller || !item) return;

    const restingWidth = item.getBoundingClientRect().width;
    if (restingWidth <= 0) return;

    clearTimer(snapRestoreTimerRef);
    setSnapSuspended(true);
    setGeometry(
      resolveExpandedGeometry({
        restingWidth,
        layout: rail.layout,
        containerWidth: scroller.clientWidth,
      })
    );
    setExpandedId(id);
  }, [rail.layout]);

  const requestExpand = useCallback((id: string, options?: { immediate?: boolean }) => {
    clearTimer(collapseTimerRef);
    if (expandedId === id) return;
    clearTimer(expandTimerRef);

    if (options?.immediate) {
      expandNow(id);
      return;
    }

    expandTimerRef.current = window.setTimeout(() => {
      expandTimerRef.current = null;
      expandNow(id);
    }, HOVER_EXPAND_DELAY_MS);
  }, [expandNow, expandedId]);

  const requestCollapse = useCallback((options?: { immediate?: boolean }) => {
    clearTimer(expandTimerRef);
    if (options?.immediate) {
      collapseNow();
      return;
    }
    clearTimer(collapseTimerRef);
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      collapseNow();
    }, HOVER_COLLAPSE_DELAY_MS);
  }, [collapseNow]);

  useEffect(() => {
    updateScrollState();

    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState, rail.items.length]);

  // A rail that unmounts (filter change, navigation) must not leave timers
  // running against a gone component.
  useEffect(() => () => {
    clearTimer(expandTimerRef);
    clearTimer(collapseTimerRef);
    clearTimer(snapRestoreTimerRef);
  }, []);

  // Bring a freshly opened card fully into view. `scrollIntoView` is the wrong
  // tool: it also scrolls ancestors, sliding the page under the fixed top scrim.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !expandedId || !geometry) return;

    const item = itemRefs.current.get(expandedId);
    if (!item) return;

    const itemLeft =
      item.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;

    const delta = resolveScrollAdjustment({
      itemLeft,
      itemWidth: geometry.width,
      scrollLeft: scroller.scrollLeft,
      clientWidth: scroller.clientWidth,
    });

    if (delta === 0) return;

    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_MS;
    scroller.scrollTo({
      left: scroller.scrollLeft + delta,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [expandedId, geometry, prefersReducedMotion]);

  const handleScroll = useCallback(() => {
    updateScrollState();
    // The reader scrolling away is a dismissal — but our own scroll-into-view
    // fires this too, so ignore anything inside that window.
    if (expandedId && Date.now() > programmaticScrollUntilRef.current) {
      collapseNow();
    }
  }, [collapseNow, expandedId, updateScrollState]);

  const scrollByPage = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.85, 240);
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (rail.items.length === 0) return null;

  const headingId = `rail-heading-${rail.key.replace(/[^a-z0-9]+/gi, '-')}`;
  const hasExpanded = expandedId !== null;
  // Tall edge paddles rather than small floating circles: they cover the card
  // strip, so the click target matches where the eye already is. Pointer-only —
  // touch users swipe, and the edge fades signal there is more to scroll.
  const paddleClass =
    'pointer-fine-only absolute bottom-2 top-0 z-20 w-12 items-center justify-center text-neutral-200 opacity-0 transition-opacity duration-200 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70 group-hover/rail:opacity-100';

  return (
    <section
      className="group/rail relative"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && hasExpanded) {
          event.stopPropagation();
          collapseNow();
        }
      }}
    >
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
        {/* Paddles and fades sit above the card strip, so an expanded card at
            either end would slide under them. Stand them down instead of
            fighting the stacking order. */}
        <button
          type="button"
          onClick={() => scrollByPage('left')}
          aria-label={`Scroll ${rail.title} left`}
          className={`${paddleClass} left-0 bg-gradient-to-r from-neutral-950 via-neutral-950/80 to-transparent ${
            canScrollLeft && !hasExpanded ? '' : 'pointer-events-none !opacity-0'
          }`}
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={() => scrollByPage('right')}
          aria-label={`Scroll ${rail.title} right`}
          className={`${paddleClass} right-0 bg-gradient-to-l from-neutral-950 via-neutral-950/80 to-transparent ${
            canScrollRight && !hasExpanded ? '' : 'pointer-events-none !opacity-0'
          }`}
        >
          <ChevronRight className="h-7 w-7" />
        </button>

        {/* Edge fades double as the touch scroll affordance. */}
        {canScrollLeft && !hasExpanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-neutral-950 to-transparent"
          />
        )}
        {canScrollRight && !hasExpanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-neutral-950 to-transparent"
          />
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // `items-start` is load-bearing: a flex row stretches its children by
          // default, and a stretched card's `h-full` beats its `aspect-*`, so
          // one expanded card would flatten every sibling in the rail.
          // Mandatory snapping re-snaps on every layout change, so it has to
          // stand down while a card is growing.
          className={`scrollbar-hide flex items-start gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [overscroll-behavior-x:contain] sm:gap-4 lg:scroll-px-8 lg:px-8 ${
            snapSuspended ? 'snap-none' : 'snap-x snap-mandatory'
          }`}
        >
          {rail.items.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <div
                key={item.id}
                ref={(node) => {
                  if (node) itemRefs.current.set(item.id, node);
                  else itemRefs.current.delete(item.id);
                }}
                style={
                  isExpanded && geometry
                    ? { width: geometry.width, willChange: 'width' }
                    : undefined
                }
                // Growing an in-flow flex item is what makes the siblings slide
                // right and the rail grow taller — no FLIP, no measurement of
                // anything but this card.
                className={`shrink-0 snap-start transition-[width] duration-300 ease-out motion-reduce:transition-none ${
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
                  isExpanded={isExpanded}
                  panelPlacement={geometry?.placement ?? 'below'}
                  panelWidth={geometry?.panelWidth ?? 0}
                  onRequestExpand={(options) => requestExpand(item.id, options)}
                  onRequestCollapse={requestCollapse}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
