'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '@/lib/hooks/useAuth';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import GenreShowcase, { GenreShowcaseSkeleton } from '@/components/gallery/GenreShowcase';
import GalleryFiltersBar from '@/components/gallery/GalleryFilters';
import GalleryItemCard from '@/components/gallery/GalleryItemCard';
import { getTopByGenre, getGalleryItems, getSavedStorylineIds } from '@/app/actions/gallery';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import type { GalleryItem, GalleryFilters, GenreSection } from '@/lib/types/database';

/** Fisher-Yates shuffle (returns a new array). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a Set of indices that should be "big" (2×2) in a bento grid.
 * Each group of 5 items fills 2 rows of 4 cols: 1 big (2×2) + 4 small (1×1).
 * The big item is randomly placed on the left (index 0) or right (index 2)
 * within each group, so the layout changes on every mount.
 */
function generateBentoPattern(count: number): Set<number> {
  const bigIndices = new Set<number>();
  for (let g = 0; g * 5 < count; g++) {
    const base = g * 5;
    // Randomly pick left-aligned (offset 0) or right-aligned (offset 2)
    const offset = Math.random() < 0.5 ? 0 : 2;
    bigIndices.add(base + offset);
  }
  return bigIndices;
}

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
  const { user, signInWithGoogle } = useAuth();
  const [showMyStories, setShowMyStories] = useState(false);

  // Genre showcase state
  const [genreSections, setGenreSections] = useState<GenreSection[]>([]);
  const [genreLoading, setGenreLoading] = useState(true);

  // Grid state
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filters, setFilters] = useState<GalleryFilters>(DEFAULT_FILTERS);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [initialGridLoading, setInitialGridLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [supportsInfiniteScroll, setSupportsInfiniteScroll] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, GalleryCacheEntry>>(new Map());
  const inFlightRequestsRef = useRef<Set<string>>(new Set());
  const activeFilterKeyRef = useRef(getFilterKey(DEFAULT_FILTERS));
  const activeRequestTokenRef = useRef(0);
  const hasHydratedOnceRef = useRef(false);
  const [bentoPattern, setBentoPattern] = useState<Set<number>>(new Set());

  // Generate bento pattern client-side only to avoid hydration mismatch
  useEffect(() => {
    setBentoPattern(generateBentoPattern(50));
  }, []);

  // Fetch genre showcase on mount
  useEffect(() => {
    getTopByGenre()
      .then(setGenreSections)
      .catch(console.error)
      .finally(() => setGenreLoading(false));
  }, []);

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
      const nextItems = append && cachedEntry
        ? [...cachedEntry.items, ...result.items]
        : shuffle(result.items);

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
        hasHydratedOnceRef.current = true;
      }
    } catch (err) {
      console.error('Failed to fetch gallery:', err);
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

  const loadFilterResults = useCallback((nextFilters: GalleryFilters) => {
    const normalizedFilters = normalizeFilters(nextFilters);
    const filterKey = getFilterKey(normalizedFilters);
    const cachedEntry = cacheRef.current.get(filterKey);
    const token = activeRequestTokenRef.current + 1;

    activeFilterKeyRef.current = filterKey;
    activeRequestTokenRef.current = token;
    setIsLoadingMore(false);

    if (cachedEntry && isCacheFresh(cachedEntry)) {
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
    if (!hasMore || isRefreshing) return;

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
  }, [handleLoadMore, hasMore, isRefreshing, supportsInfiniteScroll]);

  const handleFiltersChange = useCallback((nextFilters: GalleryFilters) => {
    const normalizedFilters = normalizeFilters(nextFilters);
    if (getFilterKey(normalizedFilters) === getFilterKey(filters)) return;
    setBentoPattern(generateBentoPattern(50));
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

  const handleGenreClick = (genre: string) => {
    handleFiltersChange({ ...filters, genre });
    gridRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-32 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-40 md:h-48"
      />
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

      {/* Page content */}
      <div className="pt-[clamp(5.125rem,17vh,8.125rem)] pb-16 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h1 className="text-3xl md:text-4xl font-serif text-neutral-100 mb-3">
            Discover Stories
          </h1>
          <p className="text-sm text-neutral-500 max-w-lg mx-auto">
            Explore branching story trees or experience published storylines created by people like us.
          </p>
        </motion.div>

        {/* Genre Showcase */}
        <section className="mb-16">
          {genreLoading ? (
            <GenreShowcaseSkeleton />
          ) : (
            <GenreShowcase
              sections={genreSections}
              savedIds={savedIds}
              isLoggedIn={!!user}
              onToggleSave={handleToggleSave}
              onGenreClick={handleGenreClick}
              onAuthRequired={signInWithGoogle}
            />
          )}
        </section>

        {/* Browse All section */}
        <div ref={gridRef} className="scroll-mt-20">
          <h2 className="text-xl md:text-2xl font-serif text-neutral-200 mb-6">
            Browse All
          </h2>

          {/* Filters */}
          <div className="mb-8">
            <GalleryFiltersBar
              filters={filters}
              onFiltersChange={handleFiltersChange}
            />
          </div>

          <div className="mb-4 flex items-center justify-between gap-3 text-xs text-neutral-500">
            <span>{total > 0 ? `${total} stories` : 'No stories found'}</span>
            {isRefreshing && (
              <span className="text-emerald-400/80">Updating results...</span>
            )}
          </div>

          {/* Grid */}
          {initialGridLoading && items.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[200px]">
              {[...Array(PAGE_SIZE)].map((_, i) => (
                <div
                  key={i}
                  className={`rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse ${bentoPattern.has(i) ? 'sm:col-span-2 sm:row-span-2' : ''}`}
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-neutral-500 text-sm">No stories found matching your filters.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[200px]">
                {items.map((item, index) => {
                  const isBig = bentoPattern.has(index);
                  return (
                    <motion.div
                      key={`${item.type}-${item.id}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: (index % PAGE_SIZE) * 0.05 }}
                      className={isBig ? 'sm:col-span-2 sm:row-span-2' : ''}
                    >
                      <GalleryItemCard
                        item={item}
                        isSaved={savedIds.has(item.id)}
                        isLoggedIn={!!user}
                        isWide={isBig}
                        onToggleSave={handleToggleSave}
                        onAuthRequired={signInWithGoogle}
                      />
                    </motion.div>
                  );
                })}
              </div>

              {isLoadingMore && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[200px] mt-4">
                  {[...Array(4)].map((_, index) => (
                    <div
                      key={`loading-more-${index}`}
                      className="rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse"
                    />
                  ))}
                </div>
              )}

              {hasMore && !isRefreshing && (
                <>
                  <div ref={sentinelRef} className="h-1" aria-hidden="true" />
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="mt-10 mx-auto block px-8 py-3 rounded-2xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-sm font-medium disabled:opacity-50"
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
    </main>
  );
}
