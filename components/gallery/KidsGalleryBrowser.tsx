'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { LibraryBig } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import ManagedFooter from '@/components/layout/ManagedFooter';
import GalleryRail from '@/components/gallery/GalleryRail';
import GalleryTopBar from '@/components/gallery/GalleryTopBar';
import GallerySearchPanel from '@/components/gallery/GallerySearchPanel';
import { GalleryErrorState } from '@/components/gallery/GalleryStates';
import { GalleryRailsSkeleton } from '@/components/gallery/GallerySkeletons';
import { getGalleryRails } from '@/app/actions/gallery';
import { useSavedStorylines } from '@/lib/hooks/useSavedStorylines';
import { useGallerySearchMode } from '@/lib/hooks/useGallerySearchMode';
import { useGalleryResults } from '@/lib/hooks/useGalleryResults';
import type { GalleryFilters, GalleryPage, GalleryRailsResponse } from '@/lib/types/database';

export const PAGE_SIZE = 12;
const GRID_CLASS = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3';
const CARD_SIZES = '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 31vw';

interface KidsGalleryBrowserProps {
  initialRails: GalleryRailsResponse | null;
  /** Resolved from the request URL, so a shared search link renders as one. */
  initialSearchOpen?: boolean;
  initialSearchFilters?: GalleryFilters | null;
  initialSearchPage?: GalleryPage | null;
  /** Undefined only if the server could not resolve them; see useSavedStorylines. */
  initialSavedIds?: string[];
}

/**
 * Kids discovery, roughly ages 3–8.
 *
 * A separate route rather than a toggle on /gallery: the audience scope is
 * decided server-side per request, so there is no client state a curious child
 * can flip to widen the catalogue. Search here is the same surface as the main
 * gallery, still pinned to `mode: 'kids'` on every request, and the lane and
 * audience controls are dropped because neither is the viewer's to choose.
 *
 * Following the product rules for this band, the surface also drops popularity
 * counts and infinite scroll — browsing here is deliberate, not endless.
 */
export default function KidsGalleryBrowser({
  initialRails,
  initialSearchOpen = false,
  initialSearchFilters = null,
  initialSearchPage = null,
  initialSavedIds,
}: KidsGalleryBrowserProps) {
  const { user } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const [showMyStories, setShowMyStories] = useState(false);

  const [railsData, setRailsData] = useState<GalleryRailsResponse | null>(initialRails);
  const [railsLoading, setRailsLoading] = useState(!initialRails);
  const [railsError, setRailsError] = useState(false);
  const { savedIds, toggleSave } = useSavedStorylines(!!user, initialSavedIds);

  const search = useGallerySearchMode({
    initialOpen: initialSearchOpen,
    initialFilters: initialSearchFilters,
  });

  // A hand-typed `?type=vertical&age=teen` must not widen anything here. The
  // server would ignore it anyway — this keeps the controls honest too.
  const filters = useMemo<GalleryFilters>(
    () => ({ ...search.filters, type: 'storylines', ageGroup: 'all' }),
    [search.filters]
  );

  const results = useGalleryResults({
    filters,
    pageSize: PAGE_SIZE,
    enabled: search.isOpen,
    mode: 'kids',
    initialPage: initialSearchPage,
    initialFilters: initialSearchFilters,
  });

  // Bumping a token re-runs the fetch effect; every state change then happens
  // in an async callback rather than synchronously during the effect.
  const [railsToken, setRailsToken] = useState(0);

  useEffect(() => {
    if (initialRails && railsToken === 0) return;

    let cancelled = false;

    getGalleryRails('kids')
      .then((data) => {
        if (cancelled) return;
        setRailsData(data);
        setRailsError(false);
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

  const retryRails = useCallback(() => {
    setRailsLoading(true);
    setRailsError(false);
    setRailsToken((token) => token + 1);
  }, []);

  const feedScrollRef = useRef(0);
  const wasSearchOpenRef = useRef(search.isOpen);

  useEffect(() => {
    if (search.isOpen === wasSearchOpenRef.current) return;
    wasSearchOpenRef.current = search.isOpen;

    if (search.isOpen) {
      feedScrollRef.current = window.scrollY;
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    const restoreTo = feedScrollRef.current;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: restoreTo, behavior: 'auto' })
    );
    return () => cancelAnimationFrame(frame);
  }, [search.isOpen]);

  const { isOpen: searchIsOpen, close: closeSearch } = search;

  useEffect(() => {
    if (!searchIsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeSearch, searchIsOpen]);

  const enterProps = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4 },
      };

  const hasRails = (railsData?.rails.length ?? 0) > 0;

  return (
    <main className="relative min-h-dvh bg-neutral-950 font-sans text-neutral-200 selection:bg-emerald-500/30">
      {!search.isOpen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(8rem+var(--safe-top))] bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-[calc(10rem+var(--safe-top))]"
        />
      )}
      {search.isOpen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(4.25rem+var(--safe-top))] bg-neutral-950"
        />
      )}

      <GalleryTopBar
        variant="kids"
        searchOpen={search.isOpen}
        query={search.filters.search}
        onQueryChange={search.setQuery}
        onOpenSearch={() => search.open()}
        onCloseSearch={search.close}
        onMyStories={() => setShowMyStories(true)}
      />

      <MyStoriesDrawer isOpen={showMyStories} onClose={() => setShowMyStories(false)} />

      {search.isOpen && (
        <GallerySearchPanel
          filters={filters}
          onFiltersChange={search.setFilters}
          onClearFilters={search.clearRefinements}
          results={results}
          savedIds={savedIds}
          isLoggedIn={!!user}
          onToggleSave={toggleSave}
          pageSize={PAGE_SIZE}
          variant="kids"
          infiniteScroll={false}
          hideEngagementCounts
          gridClassName={GRID_CLASS}
          sizes={CARD_SIZES}
        />
      )}

      <div className={`pb-[calc(4rem+var(--safe-bottom))] ${search.isOpen ? 'hidden' : ''}`}>
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
          ) : hasRails ? (
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
          ) : (
            <div className="px-6 py-16 text-center">
              <p className="font-serif text-lg text-neutral-300">No kids stories yet</p>
              <p className="mt-1 text-sm text-neutral-500">
                Stories appear here once they are published for ages 3 to 8.
              </p>
            </div>
          )}
        </section>

        {!railsLoading && !railsError && hasRails && (
          <div className="mt-14 px-4 lg:px-8">
            <button
              type="button"
              onClick={() => search.open()}
              className="mx-auto flex min-h-14 w-full max-w-md items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-6 text-sm font-medium text-neutral-300 transition-colors hover:border-emerald-500/30 hover:bg-white/[0.08] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <LibraryBig className="h-4 w-4" aria-hidden="true" />
              Explore all kids stories
            </button>
          </div>
        )}
      </div>

      {!search.isOpen && <ManagedFooter />}
    </main>
  );
}
