'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  DEFAULT_GALLERY_FILTERS,
  filtersFromParams,
  isSearchOpen,
  searchUrl,
} from '@/lib/gallery/search-params';
import type { GalleryFilters } from '@/lib/types/database';

interface UseGallerySearchModeOptions {
  /** Resolved on the server from the request URL, so hydration matches. */
  initialOpen: boolean;
  initialFilters: GalleryFilters | null;
}

interface SearchModeState {
  open: boolean;
  filters: GalleryFilters;
}

interface GallerySearchMode {
  isOpen: boolean;
  filters: GalleryFilters;
  /** Opens search, optionally pre-refined — a rail's See all lands here. */
  open: (overrides?: Partial<GalleryFilters>) => void;
  close: () => void;
  setQuery: (query: string) => void;
  setFilters: (filters: GalleryFilters) => void;
  clearRefinements: () => void;
}

function readWindowState(): SearchModeState {
  const params = new URLSearchParams(window.location.search);
  return { open: isSearchOpen(params), filters: filtersFromParams(params) };
}

/**
 * Search mode lives in the URL, so a result set is shareable and Back is what
 * leaves search — the gesture people already reach for.
 *
 * Updates go through the History API rather than the router: `router.push` on
 * this route re-runs a `force-dynamic` server render, which would refetch the
 * entire feed on every keystroke.
 *
 * The starting state is handed down from the server rather than read with
 * `useSearchParams`, so the first client render provably matches the HTML and
 * the route keeps no opinion about Suspense boundaries. `popstate` covers
 * everything after that.
 *
 * Every mutator reads the current state from a ref and calls history *before*
 * `setState`, never from inside an updater. React runs updaters during render
 * and re-runs them when a render is retried, so a `pushState` in there fires
 * during render, updates the Next router mid-render, and re-renders — a loop
 * that also stacks duplicate history entries, which then take two Backs to
 * escape.
 */
export function useGallerySearchMode({
  initialOpen,
  initialFilters,
}: UseGallerySearchModeOptions): GallerySearchMode {
  const pathname = usePathname();

  const [state, setState] = useState<SearchModeState>(() => ({
    open: initialOpen,
    filters: initialFilters ?? DEFAULT_GALLERY_FILTERS,
  }));
  const stateRef = useRef(state);
  // Whether the entry currently on screen is one we pushed, and can therefore
  // be left with a plain Back instead of stacking another entry.
  const pushedRef = useRef(false);

  const commit = useCallback((next: SearchModeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
      commit(readWindowState());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [commit]);

  /** Writes the URL for an open panel: push on entry, replace once inside. */
  const writeUrl = useCallback(
    (filters: GalleryFilters) => {
      const url = searchUrl(pathname, filters);
      if (stateRef.current.open) {
        // Replace, or every keystroke becomes a history entry.
        window.history.replaceState(null, '', url);
      } else {
        window.history.pushState(null, '', url);
        pushedRef.current = true;
      }
    },
    [pathname]
  );

  const open = useCallback(
    (overrides?: Partial<GalleryFilters>) => {
      const filters = { ...DEFAULT_GALLERY_FILTERS, ...overrides };
      writeUrl(filters);
      commit({ open: true, filters });
    },
    [commit, writeUrl]
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      // Leaves no search entry behind, so Back does not walk back into it.
      // `popstate` applies the resulting state.
      window.history.back();
      return;
    }
    window.history.pushState(null, '', pathname);
    commit({ open: false, filters: DEFAULT_GALLERY_FILTERS });
  }, [commit, pathname]);

  const setQuery = useCallback(
    (query: string) => {
      const filters = { ...stateRef.current.filters, search: query };
      writeUrl(filters);
      commit({ open: true, filters });
    },
    [commit, writeUrl]
  );

  const setFilters = useCallback(
    (filters: GalleryFilters) => {
      writeUrl(filters);
      commit({ open: true, filters });
    },
    [commit, writeUrl]
  );

  const clearRefinements = useCallback(() => {
    const filters = { ...DEFAULT_GALLERY_FILTERS };
    writeUrl(filters);
    commit({ open: true, filters });
  }, [commit, writeUrl]);

  return {
    isOpen: state.open,
    filters: state.filters,
    open,
    close,
    setQuery,
    setFilters,
    clearRefinements,
  };
}
