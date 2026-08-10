'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { LibraryBig } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import ManagedFooter from '@/components/layout/ManagedFooter';
import GalleryHero from '@/components/gallery/GalleryHero';
import GalleryRail from '@/components/gallery/GalleryRail';
import GalleryTopBar from '@/components/gallery/GalleryTopBar';
import GallerySearchPanel from '@/components/gallery/GallerySearchPanel';
import { GalleryErrorState } from '@/components/gallery/GalleryStates';
import { GalleryRailsSkeleton, HeroSkeleton } from '@/components/gallery/GallerySkeletons';
import { getGalleryRails } from '@/app/actions/gallery';
import { useSavedStorylines } from '@/lib/hooks/useSavedStorylines';
import { useGallerySearchMode } from '@/lib/hooks/useGallerySearchMode';
import { useGalleryResults } from '@/lib/hooks/useGalleryResults';
import type {
  GalleryFilters,
  GalleryPage,
  GalleryRailsResponse,
} from '@/lib/types/database';

export const PAGE_SIZE = 12;

interface GalleryBrowserProps {
  /** Rendered on the server so the first paint carries real content. */
  initialRails: GalleryRailsResponse | null;
  /** Resolved from the request URL, so a shared search link renders as one. */
  initialSearchOpen?: boolean;
  initialSearchFilters?: GalleryFilters | null;
  /** Only present when that search also resolved server-side. */
  initialSearchPage?: GalleryPage | null;
  /** Undefined only if the server could not resolve them; see useSavedStorylines. */
  initialSavedIds?: string[];
}

export default function GalleryBrowser({
  initialRails,
  initialSearchOpen = false,
  initialSearchFilters = null,
  initialSearchPage = null,
  initialSavedIds,
}: GalleryBrowserProps) {
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
  const results = useGalleryResults({
    filters: search.filters,
    pageSize: PAGE_SIZE,
    enabled: search.isOpen,
    initialPage: initialSearchPage,
    initialFilters: initialSearchFilters,
  });

  // Bumping a token re-runs the fetch effect; every state change then happens
  // in an async callback rather than synchronously during the effect. Starting
  // above zero when the server already delivered data keeps the effect inert
  // until a retry asks for a refetch.
  const [railsToken, setRailsToken] = useState(0);

  useEffect(() => {
    // The server already resolved the rails for this render.
    if (initialRails && railsToken === 0) return;

    let cancelled = false;

    getGalleryRails()
      .then((data) => {
        if (cancelled) return;
        setRailsData(data);
        setRailsError(false);
      })
      .catch((error) => {
        console.error('Failed to fetch gallery rails:', error);
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

  // The feed stays mounted behind search — hidden, not unmounted — so leaving
  // search costs no refetch. Only the window scroll position needs restoring.
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

  const featured = railsData?.featured ?? [];

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

  // See all hands the rail's own scope to search, which is now the only
  // full-catalogue surface.
  const railSeeAll = (railKey: string) => {
    if (railKey === 'vertical') return () => search.open({ type: 'vertical' });
    if (railKey.startsWith('genre:')) {
      const genre = railKey.slice('genre:'.length);
      return () => search.open({ genre });
    }
    return undefined;
  };

  return (
    <main className="relative min-h-dvh bg-neutral-950 font-sans text-neutral-200 selection:bg-emerald-500/30">
      {!search.isOpen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(8rem+var(--safe-top))] bg-gradient-to-b from-neutral-950/95 via-neutral-950/60 to-transparent sm:h-[calc(10rem+var(--safe-top))] md:h-[calc(12rem+var(--safe-top))]"
        />
      )}
      {search.isOpen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[calc(4.25rem+var(--safe-top))] bg-neutral-950"
        />
      )}

      <GalleryTopBar
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
          filters={search.filters}
          onFiltersChange={search.setFilters}
          onClearFilters={search.clearRefinements}
          results={results}
          savedIds={savedIds}
          isLoggedIn={!!user}
          onToggleSave={toggleSave}
          pageSize={PAGE_SIZE}
        />
      )}

      {/* Hero + rails run full-bleed. */}
      <div
        className={`pb-[calc(4rem+var(--safe-bottom))] ${search.isOpen ? 'hidden' : ''}`}
      >
        {railsLoading ? (
          <HeroSkeleton />
        ) : featured.length > 0 ? (
          <GalleryHero
            items={featured}
            savedIds={savedIds}
            isLoggedIn={!!user}
            onToggleSave={toggleSave}
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

        {/* Rails overlap the billboard's lower scrim, the way an OTT shelf
            tucks under the hero instead of starting a new blank page. */}
        <section className="relative z-10 -mt-6 space-y-9 md:-mt-12 md:space-y-11">
          {railsLoading ? (
            <GalleryRailsSkeleton />
          ) : railsError ? (
            <div className="px-4 lg:px-8">
              <GalleryErrorState
                title="Couldn't load the highlights"
                message="The featured rows are unavailable right now. Search still works."
                onRetry={retryRails}
              />
            </div>
          ) : (
            railsData?.rails.map((rail) => (
              <motion.div key={rail.key} {...enterProps(0)}>
                <GalleryRail
                  rail={rail}
                  savedIds={savedIds}
                  isLoggedIn={!!user}
                  onToggleSave={toggleSave}
                  onSeeAll={railSeeAll(rail.key)}
                />
              </motion.div>
            ))
          )}
        </section>

        {/* The catalogue is one surface now, and it is search. This is the way
            in for a viewer with nothing particular in mind. */}
        {!railsLoading && !railsError && (
          <div className="mt-14 px-4 lg:px-8">
            <button
              type="button"
              onClick={() => search.open()}
              className="mx-auto flex min-h-14 w-full max-w-md items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-6 text-sm font-medium text-neutral-300 transition-colors hover:border-emerald-500/30 hover:bg-white/[0.08] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <LibraryBig className="h-4 w-4" aria-hidden="true" />
              Explore all stories
            </button>
          </div>
        )}
      </div>

      {!search.isOpen && <ManagedFooter />}
    </main>
  );
}
