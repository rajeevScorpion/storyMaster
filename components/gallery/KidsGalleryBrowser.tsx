'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import ManagedFooter from '@/components/layout/ManagedFooter';
import GalleryRail from '@/components/gallery/GalleryRail';
import StorylineCard from '@/components/gallery/StorylineCard';
import { GalleryErrorState } from '@/components/gallery/GalleryStates';
import { GalleryRailsSkeleton, GridSkeleton } from '@/components/gallery/GallerySkeletons';
import { getGalleryRails, getGalleryItems } from '@/app/actions/gallery';
import { useSavedStorylines } from '@/lib/hooks/useSavedStorylines';
import type {
  GalleryFilters,
  GalleryItem,
  GalleryPage,
  GalleryRailsResponse,
} from '@/lib/types/database';

export const KIDS_FILTERS: GalleryFilters = {
  search: '',
  type: 'storylines',
  genre: 'all',
  ageGroup: 'all',
  country: 'all',
  language: 'all',
};

export const PAGE_SIZE = 12;
const GRID_CLASS = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3';
const CARD_SIZES = '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 31vw';

interface KidsGalleryBrowserProps {
  initialRails: GalleryRailsResponse | null;
  initialGrid: GalleryPage | null;
  /** Undefined only if the server could not resolve them; see useSavedStorylines. */
  initialSavedIds?: string[];
}

/**
 * Kids discovery, roughly ages 3–8.
 *
 * A separate route rather than a toggle on /gallery: the audience scope is
 * decided server-side per request, so there is no client state a curious child
 * can flip to widen the catalogue. Following the product rules for this band,
 * the surface also drops popularity counts and infinite scroll — browsing here
 * is deliberate, not endless.
 */
export default function KidsGalleryBrowser({
  initialRails,
  initialGrid,
  initialSavedIds,
}: KidsGalleryBrowserProps) {
  const { user } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const [showMyStories, setShowMyStories] = useState(false);

  const [railsData, setRailsData] = useState<GalleryRailsResponse | null>(initialRails);
  const [railsLoading, setRailsLoading] = useState(!initialRails);
  const [railsError, setRailsError] = useState(false);

  const [items, setItems] = useState<GalleryItem[]>(initialGrid?.items ?? []);
  const [total, setTotal] = useState(initialGrid?.total ?? 0);
  const [hasMore, setHasMore] = useState(initialGrid?.hasMore ?? false);
  const [gridLoading, setGridLoading] = useState(!initialGrid);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [gridError, setGridError] = useState(false);
  const { savedIds, toggleSave } = useSavedStorylines(!!user, initialSavedIds);

  // Bumping a token re-runs the fetch effect; every state change then happens
  // in an async callback rather than synchronously during the effect. Starting
  // above zero when the server already delivered data keeps the effect inert
  // until a retry asks for a refetch.
  const [railsToken, setRailsToken] = useState(0);
  const [gridToken, setGridToken] = useState(0);

  useEffect(() => {
    if (initialRails && railsToken === 0) return;

    let cancelled = false;

    getGalleryRails('kids')
      .then((data) => {
        if (!cancelled) setRailsData(data);
      })
      .catch((error) => {
        console.error('Failed to fetch kids rails:', error);
        if (!cancelled) setRailsError(true);
      })
      .finally(() => {
        if (!cancelled) setRailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialRails, railsToken]);

  useEffect(() => {
    if (initialGrid && gridToken === 0) return;

    let cancelled = false;

    getGalleryItems(KIDS_FILTERS, PAGE_SIZE, 0, 'kids')
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setHasMore(page.hasMore);
      })
      .catch((error) => {
        console.error('Failed to fetch kids stories:', error);
        if (!cancelled) setGridError(true);
      })
      .finally(() => {
        if (!cancelled) setGridLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialGrid, gridToken]);

  const retryRails = useCallback(() => {
    setRailsLoading(true);
    setRailsError(false);
    setRailsToken((token) => token + 1);
  }, []);

  const retryGrid = useCallback(() => {
    setGridLoading(true);
    setGridError(false);
    setGridToken((token) => token + 1);
  }, []);

  const loadMore = useCallback(async () => {
    setIsLoadingMore(true);
    try {
      const page = await getGalleryItems(KIDS_FILTERS, PAGE_SIZE, items.length, 'kids');
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
      setGridError(false);
    } catch (error) {
      console.error('Failed to fetch more kids stories:', error);
      setGridError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [items.length]);

  const enterProps = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4 },
      };

  const isEmpty = !gridLoading && !gridError && items.length === 0 && (railsData?.rails.length ?? 0) === 0;

  return (
    <main className="relative min-h-dvh bg-neutral-950 font-sans text-neutral-200 selection:bg-emerald-500/30">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(8rem+var(--safe-top))] bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-[calc(10rem+var(--safe-top))]"
      />
      <KissagoLogo />
      <div className="fixed right-[max(1rem,var(--safe-right))] top-[max(1rem,var(--safe-top))] z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer isOpen={showMyStories} onClose={() => setShowMyStories(false)} />

      <div className="pb-[calc(4rem+var(--safe-bottom))]">
        <header className="px-4 pb-10 pt-[calc(clamp(5.125rem,17vh,8.125rem)+var(--safe-top))] text-center lg:px-8">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
            Kissago Kids
          </p>
          <h1 className="mb-3 font-serif text-3xl text-neutral-100 md:text-4xl">
            Stories for younger readers
          </h1>
          <p className="mx-auto max-w-lg text-sm text-neutral-500">
            Picture-led adventures written for ages 3 to 8.
          </p>
          <Link
            href="/gallery"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 text-sm text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Kissago
          </Link>
        </header>

        <section className="space-y-10">
          {railsLoading ? (
            <GalleryRailsSkeleton />
          ) : railsError ? (
            <div className="px-4 lg:px-8">
              <GalleryErrorState
                title="Couldn't load the kids rows"
                message="The featured rows are unavailable right now."
                onRetry={retryRails}
              />
            </div>
          ) : (
            railsData?.rails.map((rail) => (
              <motion.div key={rail.key} {...enterProps}>
                <GalleryRail
                  rail={rail}
                  savedIds={savedIds}
                  isLoggedIn={!!user}
                  hideEngagementCounts
                  onToggleSave={toggleSave}
                />
              </motion.div>
            ))
          )}
        </section>

        <div className="mt-16 border-t border-white/[0.06] bg-neutral-900/25 pb-4 pt-12">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <h2 className="mb-6 font-serif text-2xl text-neutral-100 md:text-3xl">All Kids Stories</h2>

            {gridLoading && items.length === 0 ? (
              <GridSkeleton count={PAGE_SIZE} className={GRID_CLASS} />
            ) : gridError && items.length === 0 ? (
              <GalleryErrorState onRetry={retryGrid} />
            ) : isEmpty ? (
              <div className="px-6 py-16 text-center">
                <p className="font-serif text-lg text-neutral-300">No kids stories yet</p>
                <p className="mt-1 text-sm text-neutral-500">
                  Stories appear here once they are published for ages 3 to 8.
                </p>
              </div>
            ) : (
              <>
                <div className={GRID_CLASS}>
                  {items.map((item) => (
                    <motion.div key={item.id} {...enterProps}>
                      <StorylineCard
                        item={item}
                        layout="wide"
                        sizes={CARD_SIZES}
                        isSaved={savedIds.has(item.id)}
                        isLoggedIn={!!user}
                        hideEngagementCounts
                        onToggleSave={toggleSave}
                      />
                    </motion.div>
                  ))}
                </div>

                {isLoadingMore && (
                  <GridSkeleton count={3} className={`${GRID_CLASS} mt-5`} />
                )}

                {/* Deliberate paging rather than infinite scroll. */}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={isLoadingMore}
                    className="mx-auto mt-10 block min-h-12 rounded-2xl border border-white/10 bg-white/5 px-8 text-sm font-medium text-neutral-300 transition-all hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
                  >
                    {isLoadingMore ? 'Loading...' : `Show more (${items.length} of ${total})`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <ManagedFooter />
    </main>
  );
}
