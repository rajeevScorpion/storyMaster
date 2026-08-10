'use client';

import { useEffect, useRef } from 'react';
import GalleryFiltersBar from '@/components/gallery/GalleryFilters';
import GalleryResultsGrid, {
  RESULTS_GRID_CLASS,
} from '@/components/gallery/GalleryResultsGrid';
import { GalleryEmptyState, GalleryErrorState } from '@/components/gallery/GalleryStates';
import { GridSkeleton } from '@/components/gallery/GallerySkeletons';
import { hasActiveRefinement, isBrowseAll } from '@/lib/gallery/search-params';
import type { UseGalleryResultsValue } from '@/lib/hooks/useGalleryResults';
import type { GalleryFilters, GalleryRailLayout } from '@/lib/types/database';

/** Height of the fixed top bar: 0.75rem padding + 2.75rem control + 0.75rem. */
const TOP_BAR_OFFSET = 'calc(4.25rem + var(--safe-top))';

interface GallerySearchPanelProps {
  filters: GalleryFilters;
  onFiltersChange: (filters: GalleryFilters) => void;
  onClearFilters: () => void;
  results: UseGalleryResultsValue;
  savedIds: Set<string>;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
  pageSize: number;
  variant?: 'full' | 'kids';
  /** Kids browsing is deliberate: a button, never an endless feed. */
  infiniteScroll?: boolean;
  hideEngagementCounts?: boolean;
  gridClassName?: string;
  sizes?: string;
}

/**
 * Search results, standing in for the whole discovery feed while search is open.
 *
 * With no query and no refinement this is the full catalogue — the browse-all
 * grid that used to be bolted to the bottom of the feed, now reachable on
 * purpose instead of by scrolling past everything else. A genuinely blank page
 * while you type would read as broken and would leave nowhere to see the whole
 * library from.
 */
export default function GallerySearchPanel({
  filters,
  onFiltersChange,
  onClearFilters,
  results,
  savedIds,
  isLoggedIn,
  onToggleSave,
  pageSize,
  variant = 'full',
  infiniteScroll = true,
  hideEngagementCounts = false,
  gridClassName,
  sizes,
}: GallerySearchPanelProps) {
  const { items, total, hasMore, status, isLoadingMore, isRefreshing, loadMore, retry } = results;
  const layout: GalleryRailLayout = filters.type === 'vertical' ? 'portrait' : 'wide';
  const sentinelRef = useRef<HTMLDivElement>(null);

  const query = filters.search.trim();
  const browsingAll = isBrowseAll(filters);

  useEffect(() => {
    // The Show more button renders either way, so a browser without the
    // observer loses the automatic fetch and nothing else.
    if (!infiniteScroll || !('IntersectionObserver' in window)) return;
    if (!hasMore || isRefreshing || status !== 'ready') return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '400px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, infiniteScroll, isRefreshing, loadMore, status]);

  const skeletonCount = layout === 'portrait' ? 12 : pageSize;

  const heading = browsingAll
    ? 'Explore all stories'
    : query
      ? `Results for “${query}”`
      : 'Filtered stories';

  const countLine =
    status === 'ready' && items.length > 0
      ? total > 0
        ? `${total} ${total === 1 ? 'story' : 'stories'}`
        : `${items.length} ${items.length === 1 ? 'story' : 'stories'}`
      : '';

  return (
    <div
      className="min-h-dvh pb-[calc(4rem+var(--safe-bottom))]"
      style={{ paddingTop: TOP_BAR_OFFSET }}
    >
      <div
        className="sticky z-20 border-b border-white/[0.06] bg-neutral-950/85 backdrop-blur-xl"
        style={{ top: TOP_BAR_OFFSET }}
      >
        <div className="mx-auto max-w-7xl px-4 py-3 lg:px-8">
          <GalleryFiltersBar
            filters={filters}
            onFiltersChange={onFiltersChange}

            variant={variant}
          />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="font-serif text-2xl text-neutral-100 md:text-3xl">{heading}</h1>
          <p className="text-xs text-neutral-500" aria-live="polite">
            {isRefreshing ? 'Updating results…' : countLine}
          </p>
        </div>

        {status === 'loading' || status === 'idle' ? (
          <GridSkeleton
            count={skeletonCount}
            layout={layout}
            className={gridClassName ?? RESULTS_GRID_CLASS[layout]}
          />
        ) : status === 'error' ? (
          <GalleryErrorState onRetry={retry} />
        ) : items.length === 0 ? (
          <GalleryEmptyState
            onClearFilters={
              query || hasActiveRefinement(filters) ? onClearFilters : undefined
            }
          />
        ) : (
          <>
            <GalleryResultsGrid
              items={items}
              layout={layout}
              savedIds={savedIds}
              isLoggedIn={isLoggedIn}
              onToggleSave={onToggleSave}
              hideEngagementCounts={hideEngagementCounts}
              gridClassName={gridClassName}
              sizes={sizes}
              pageSize={pageSize}
            />

            {isLoadingMore && (
              <GridSkeleton
                count={layout === 'portrait' ? 6 : 4}
                layout={layout}
                className={`${gridClassName ?? RESULTS_GRID_CLASS[layout]} mt-5`}
              />
            )}

            {hasMore && !isRefreshing && (
              <>
                {infiniteScroll && (
                  <div ref={sentinelRef} className="h-1" aria-hidden="true" />
                )}
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="mx-auto mt-10 block min-h-12 rounded-2xl border border-white/10 bg-white/5 px-8 text-sm font-medium text-neutral-300 transition-all duration-200 hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
                >
                  {isLoadingMore
                    ? 'Loading…'
                    : `Show more${total > 0 ? ` (${items.length} of ${total})` : ''}`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
