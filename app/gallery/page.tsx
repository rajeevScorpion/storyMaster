'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import GenreShowcase, { GenreShowcaseSkeleton } from '@/components/gallery/GenreShowcase';
import GalleryFiltersBar from '@/components/gallery/GalleryFilters';
import GalleryItemCard from '@/components/gallery/GalleryItemCard';
import { getTopByGenre, getGalleryItems } from '@/app/actions/gallery';
import { saveStorylineToProfile, unsaveStoryline } from '@/app/actions/persistence';
import type { GalleryItem, GalleryFilters, GenreSection } from '@/lib/types/database';

const DEFAULT_FILTERS: GalleryFilters = {
  search: '',
  type: 'all',
  genre: 'all',
  ageGroup: 'all',
  country: 'all',
};

const PAGE_SIZE = 12;

export default function GalleryPage() {
  const { user } = useAuth();
  const [showMyStories, setShowMyStories] = useState(false);

  // Genre showcase state
  const [genreSections, setGenreSections] = useState<GenreSection[]>([]);
  const [genreLoading, setGenreLoading] = useState(true);

  // Grid state
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [filters, setFilters] = useState<GalleryFilters>(DEFAULT_FILTERS);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [gridLoading, setGridLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const gridRef = useRef<HTMLDivElement>(null);

  // Fetch genre showcase on mount
  useEffect(() => {
    getTopByGenre()
      .then(setGenreSections)
      .catch(console.error)
      .finally(() => setGenreLoading(false));
  }, []);

  // Fetch gallery grid
  const fetchGrid = useCallback(async (f: GalleryFilters, off: number, append: boolean) => {
    setGridLoading(true);
    try {
      const result = await getGalleryItems(f, PAGE_SIZE, off);
      setItems((prev) => append ? [...prev, ...result.items] : result.items);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setSavedIds(new Set(result.savedStorylineIds));
    } catch (err) {
      console.error('Failed to fetch gallery:', err);
    } finally {
      setGridLoading(false);
    }
  }, []);

  // Initial load + filter changes
  useEffect(() => {
    setOffset(0);
    fetchGrid(filters, 0, false);
  }, [filters, fetchGrid]);

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    fetchGrid(filters, newOffset, true);
  };

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
    setFilters((prev) => ({ ...prev, genre }));
    gridRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-32 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-40 md:h-48"
      />
      {/* Kissago logo — fixed top-left */}
      <Link
        href="/"
        className="fixed top-4 left-4 z-40 px-5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xl font-serif font-semibold tracking-wide text-emerald-400 hover:bg-white/10 hover:border-emerald-500/30 transition-all duration-200"
      >
        kissago
      </Link>


      {/* User menu — fixed top-right */}
      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer
        isOpen={showMyStories}
        onClose={() => setShowMyStories(false)}
      />

      {/* Page content */}
      <div className="pt-[clamp(7rem,25vh,15rem)] pb-16 px-4 max-w-7xl mx-auto">
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
              onFiltersChange={setFilters}
            />
          </div>

          {/* Grid */}
          {gridLoading && items.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(PAGE_SIZE)].map((_, i) => (
                <div
                  key={i}
                  className="aspect-[16/10] rounded-2xl bg-neutral-900/50 border border-white/5 animate-pulse"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-neutral-500 text-sm">No stories found matching your filters.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((item, index) => (
                  <motion.div
                    key={`${item.type}-${item.id}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: (index % PAGE_SIZE) * 0.05 }}
                  >
                    <GalleryItemCard
                      item={item}
                      isSaved={savedIds.has(item.id)}
                      isLoggedIn={!!user}
                      onToggleSave={handleToggleSave}
                    />
                  </motion.div>
                ))}
              </div>

              {/* Load More */}
              {hasMore && (
                <div className="text-center mt-10">
                  <button
                    onClick={handleLoadMore}
                    disabled={gridLoading}
                    className="px-8 py-3 rounded-2xl bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-sm font-medium disabled:opacity-50"
                  >
                    {gridLoading ? 'Loading...' : `Load More (${items.length} of ${total})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
