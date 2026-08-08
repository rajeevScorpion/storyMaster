'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '@/lib/hooks/useAuth';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import ManagedFooter from '@/components/layout/ManagedFooter';
import GalleryFiltersBar from '@/components/gallery/GalleryFilters';
import GalleryHero from '@/components/gallery/GalleryHero';
import GalleryRail from '@/components/gallery/GalleryRail';
import StorylineCard from '@/components/gallery/StorylineCard';
import { GalleryEmptyState, GalleryErrorState } from '@/components/gallery/GalleryStates';
import {
  GalleryRailsSkeleton,
  GridSkeleton,
  HeroSkeleton,
} from '@/components/gallery/GallerySkeletons';
import { getGalleryRails, getGalleryItems, getSavedStorylineIds } from '@/app/actions/gallery';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import type { GalleryItem, GalleryFilters, GalleryRailsResponse } from '@/lib/types/database';

const DEFAULT_FILTERS: GalleryFilters = {
  search: '',
  type: 'storylines',
  genre: 'all',
  ageGroup: 'all',
  country: 'all',
  language: 'all',
};

const PAGE_SIZE = 12;
const CACHE_TTL_MS = 5 * 60 * 1000;

const GRID_CLASS = {
  wide: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  portrait: 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6',
} as const;

const GRID_CARD_SIZES = {
  wide: '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, (max-width: 1280px) 31vw, 23vw',
  portrait: '(max-width: 640px) 46vw, (max-width: 768px) 31vw, (max-width: 1280px) 23vw, 16vw',
} as const;

interface GalleryCacheEntry {
  items: GalleryItem[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
  cachedAt: number;
}

function normalizeFilters(filters: GalleryFilters): GalleryFilters {
  return {
    ...filters,
    search: filters.search.trim(),
  };
}

function getFilterKey(filters: GalleryFilters): string {
  return [
    filters.type,
    filters.search.trim().toLowerCase(),
    filters.genre,
    filters.ageGroup,
    filters.country,
    filters.language,
  ].join('|');
}

function isCacheFresh(entry?: GalleryCacheEntry): boolean {
  return !!entry && Date.now() - entry.cachedAt <= CACHE_TTL_MS;
}

export default function GalleryPage() {
  const { user } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const [showMyStories, setShowMyStories] = useState(false);

  // Hero + rails
  const [railsData, setRailsData] = useState<GalleryRailsResponse | null>(null);
  const [railsLoading, setRailsLoading] = useState(true);
  const [railsError, setRailsError] = useState(false);

  // Browse All grid
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filters, setFilters] = useState<GalleryFilters>(DEFAULT_FILTERS);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [initialGridLoading, setInitialGridLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [gridError, setGridError] = useState(false);
  const [supportsInfiniteScroll, setSupportsInfiniteScroll] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, GalleryCacheEntry>>(new Map());
  const inFlightRequestsRef = useRef<Set<string>>(new Set());
  const activeFilterKeyRef = useRef(getFilterKey(DEFAULT_FILTERS));
  const activeRequestTokenRef = useRef(0);
  const hasHydratedOnceRef = useRef(false);

  const loadRails = useCallback(() => {
    setRailsLoading(true);
    setRailsError(false);
    getGalleryRails()
      .then(setRailsData)
      .catch((error) => {
        console.error('Failed to fetch gallery rails:', error);
        setRailsError(true);
      })
      .finally(() => setRailsLoading(false));
  }, []);

  useEffect(() => {
    loadRails();
  }, [loadRails]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSupportsInfiniteScroll('IntersectionObserver' in window);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setSavedIds(new Set());
      return () => {
        cancelled = true;
      };
    }

    getSavedStorylineIds()
      .then((ids) => {
        if (!cancelled) {
          setSavedIds(new Set(ids));
        }
      })
      .catch((error) => {
        console.error('Failed to fetch saved storyline IDs:', error);
        if (!cancelled) {
          setSavedIds(new Set());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const applyCacheEntry = useCallback((entry: GalleryCacheEntry) => {
    setItems(entry.items);
    setTotal(entry.total);
    setHasMore(entry.hasMore);
  }, []);

  const fetchGridPage = useCallback(async (
    targetFilters: GalleryFilters,
    offset: number,
    append: boolean,
    token: number
  ) => {
    const normalizedFilters = normalizeFilters(targetFilters);
    const filterKey = getFilterKey(normalizedFilters);
    const requestKey = `${filterKey}:${offset}`;

    if (inFlightRequestsRef.current.has(requestKey)) return;
    inFlightRequestsRef.current.add(requestKey);

    try {
      const result = await getGalleryItems(normalizedFilters, PAGE_SIZE, offset);
      const cachedEntry = cacheRef.current.get(filterKey);
      // Server order (created_at desc) is preserved so appended pages line up
      // with what is already on screen.
      const nextItems = append && cachedEntry
        ? [...cachedEntry.items, ...result.items]
        : result.items;

      const nextEntry: GalleryCacheEntry = {
        items: nextItems,
        total: result.total,
        hasMore: result.hasMore,
        nextOffset: offset + result.items.length,
        cachedAt: Date.now(),
      };

      cacheRef.current.set(filterKey, nextEntry);

      if (activeFilterKeyRef.current === filterKey && activeRequestTokenRef.current === token) {
        applyCacheEntry(nextEntry);
        setGridError(false);
        hasHydratedOnceRef.current = true;
      }
    } catch (err) {
      console.error('Failed to fetch gallery:', err);
      if (activeFilterKeyRef.current === filterKey && activeRequestTokenRef.current === token) {
        setGridError(true);
      }
    } finally {
      inFlightRequestsRef.current.delete(requestKey);

      if (activeFilterKeyRef.current === filterKey && activeRequestTokenRef.current === token) {
        if (offset === 0) {
          setInitialGridLoading(false);
          setIsRefreshing(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    }
  }, [applyCacheEntry]);

  const loadFilterResults = useCallback((nextFilters: GalleryFilters, force = false) => {
    const normalizedFilters = normalizeFilters(nextFilters);
    const filterKey = getFilterKey(normalizedFilters);
    const cachedEntry = cacheRef.current.get(filterKey);
    const token = activeRequestTokenRef.current + 1;

    activeFilterKeyRef.current = filterKey;
    activeRequestTokenRef.current = token;
    setIsLoadingMore(false);
    setGridError(false);

    if (!force && cachedEntry && isCacheFresh(cachedEntry)) {
      applyCacheEntry(cachedEntry);
      setInitialGridLoading(false);
      setIsRefreshing(false);
      hasHydratedOnceRef.current = true;
      return;
    }

    if (hasHydratedOnceRef.current) {
      setIsRefreshing(true);
    } else {
      setInitialGridLoading(true);
    }

    void fetchGridPage(normalizedFilters, 0, false, token);
  }, [applyCacheEntry, fetchGridPage]);

  useEffect(() => {
    loadFilterResults(filters);
  }, [filters, loadFilterResults]);

  const handleLoadMore = useCallback(() => {
    if (initialGridLoading || isRefreshing || isLoadingMore) return;

    const filterKey = getFilterKey(filters);
    const cachedEntry = cacheRef.current.get(filterKey);
    if (!cachedEntry || !cachedEntry.hasMore) return;

    const nextOffset = cachedEntry.nextOffset;
    const requestKey = `${filterKey}:${nextOffset}`;
    if (inFlightRequestsRef.current.has(requestKey)) return;

    setIsLoadingMore(true);
    void fetchGridPage(filters, nextOffset, true, activeRequestTokenRef.current);
  }, [fetchGridPage, filters, initialGridLoading, isLoadingMore, isRefreshing]);

  useEffect(() => {
    if (!supportsInfiniteScroll) return;
    if (!hasMore || isRefreshing || gridError) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          handleLoadMore();
        }
      },
      { rootMargin: '400px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [gridError, handleLoadMore, hasMore, isRefreshing, supportsInfiniteScroll]);

  const handleFiltersChange = useCallback((nextFilters: GalleryFilters) => {
    const normalizedFilters = normalizeFilters(nextFilters);
    if (getFilterKey(normalizedFilters) === getFilterKey(filters)) return;
    setFilters(normalizedFilters);
  }, [filters]);

  const handleToggleSave = async (storylineId: string, currentlySaved: boolean) => {
    // Optimistic update
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (currentlySaved) {
        next.delete(storylineId);
      } else {
        next.add(storylineId);
      }
      return next;
    });

    try {
      if (currentlySaved) {
        await unsaveStoryline(storylineId);
      } else {
        await saveStorylineToProfile(storylineId);
      }
    } catch {
      // Revert on error
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (currentlySaved) {
          next.add(storylineId);
        } else {
          next.delete(storylineId);
        }
        return next;
      });
    }
  };

  const scrollToGrid = useCallback(() => {
    gridRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleGenreSeeAll = useCallback((genre: string) => {
    handleFiltersChange({ ...filters, genre });
    scrollToGrid();
  }, [filters, handleFiltersChange, scrollToGrid]);

  const handleVerticalSeeAll = useCallback(() => {
    handleFiltersChange({ ...filters, type: 'vertical' });
    scrollToGrid();
  }, [filters, handleFiltersChange, scrollToGrid]);

  const gridLayout = filters.type === 'vertical' ? 'portrait' : 'wide';
  const gridClass = GRID_CLASS[gridLayout];
  const loadingPlaceholderCount = gridLayout === 'portrait' ? 12 : PAGE_SIZE;
  const loadingMorePlaceholderCount = gridLayout === 'portrait' ? 6 : 4;

  // Entrance motion is decorative: skip the travel and the stagger entirely
  // when the viewer prefers reduced motion.
  const enterProps = (delay: number) =>
    prefersReducedMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.4, delay },
        };

  const railSeeAll = (railKey: string) => {
    if (railKey === 'vertical') return handleVerticalSeeAll;
    if (railKey.startsWith('genre:')) {
      const genre = railKey.slice('genre:'.length);
      return () => handleGenreSeeAll(genre);
    }
    return undefined;
  };

  return (
    <main className="relative min-h-dvh bg-neutral-950 font-sans text-neutral-200 selection:bg-emerald-500/30">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(8rem+var(--safe-top))] bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-[calc(10rem+var(--safe-top))] md:h-[calc(12rem+var(--safe-top))]"
      />
      {/* Kissago logo — fixed top-left */}
      <KissagoLogo />

      {/* User menu — fixed top-right */}
      <div className="fixed right-[max(1rem,var(--safe-right))] top-[max(1rem,var(--safe-top))] z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />

      {/* Hero + rails run full-bleed; only the grid is width-constrained. */}
      <div className="pb-[calc(4rem+var(--safe-bottom))]">
        {railsLoading ? (
          <HeroSkeleton />
        ) : railsData?.hero ? (
          <GalleryHero
            item={railsData.hero}
            isSaved={savedIds.has(railsData.hero.id)}
            isLoggedIn={!!user}
            onToggleSave={handleToggleSave}
          />
        ) : (
          <header className="px-4 pb-8 pt-[calc(clamp(5.125rem,17vh,8.125rem)+var(--safe-top))] text-center lg:px-8">
            <h1 className="mb-3 font-serif text-3xl text-neutral-100 md:text-4xl">
              Discover Stories
            </h1>
            <p className="mx-auto max-w-lg text-sm text-neutral-500">
              Experience published storylines created by people like us.
            </p>
          </header>
        )}

        <section className="mt-10 space-y-10">
          {railsLoading ? (
            <GalleryRailsSkeleton />
          ) : railsError ? (
            <div className="px-4 lg:px-8">
              <GalleryErrorState
                title="Couldn't load the highlights"
                message="The featured rows are unavailable right now. Browse All below still works."
                onRetry={loadRails}
              />
            </div>
          ) : (
            railsData?.rails.map((rail) => (
              <motion.div key={rail.key} {...enterProps(0)}>
                <GalleryRail
                  rail={rail}
                  savedIds={savedIds}
                  isLoggedIn={!!user}
                  onToggleSave={handleToggleSave}
                  onSeeAll={railSeeAll(rail.key)}
                />
              </motion.div>
            ))
          )}
        </section>

        {/* Browse All */}
        <div ref={gridRef} className="mx-auto mt-16 max-w-7xl scroll-mt-20 px-4 lg:px-8">
          <h2 className="mb-6 font-serif text-xl text-neutral-200 md:text-2xl">
            Browse All
          </h2>

          <div className="mb-8">
            <GalleryFiltersBar
              filters={filters}
              onFiltersChange={handleFiltersChange}
            />
          </div>

          <div className="mb-4 flex items-center justify-between gap-3 text-xs text-neutral-500">
            <span>{total > 0 ? `${total} stories` : ''}</span>
            {isRefreshing && (
              <span className="text-emerald-400/80">Updating results...</span>
            )}
          </div>

          {initialGridLoading && items.length === 0 ? (
            <GridSkeleton count={loadingPlaceholderCount} layout={gridLayout} className={gridClass} />
          ) : gridError && items.length === 0 ? (
            <GalleryErrorState onRetry={() => loadFilterResults(filters, true)} />
          ) : items.length === 0 ? (
            <GalleryEmptyState onClearFilters={() => setFilters(DEFAULT_FILTERS)} />
          ) : (
            <>
              <div className={gridClass}>
                {items.map((item, index) => (
                  <motion.div key={item.id} {...enterProps((index % PAGE_SIZE) * 0.04)}>
                    <StorylineCard
                      item={item}
                      layout={gridLayout}
                      sizes={GRID_CARD_SIZES[gridLayout]}
                      isSaved={savedIds.has(item.id)}
                      isLoggedIn={!!user}
                      onToggleSave={handleToggleSave}
                    />
                  </motion.div>
                ))}
              </div>

              {isLoadingMore && (
                <GridSkeleton
                  count={loadingMorePlaceholderCount}
                  layout={gridLayout}
                  className={`${gridClass} mt-4`}
                />
              )}

              {gridError && (
                <p className="mt-6 text-center text-xs text-amber-400/80">
                  Couldn&apos;t load more stories. Try again in a moment.
                </p>
              )}

              {hasMore && !isRefreshing && (
                <>
                  <div ref={sentinelRef} className="h-1" aria-hidden="true" />
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="mx-auto mt-10 block rounded-2xl border border-white/10 bg-white/5 px-8 py-3 text-sm font-medium text-neutral-300 transition-all duration-200 hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
                  >
                    {isLoadingMore ? 'Loading...' : `Load More (${items.length} of ${total})`}
                  </button>
                  {!supportsInfiniteScroll && (
                    <p className="mt-3 text-center text-xs text-neutral-600">
                      Automatic loading is unavailable in this browser.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <ManagedFooter />
    </main>
  );
}
