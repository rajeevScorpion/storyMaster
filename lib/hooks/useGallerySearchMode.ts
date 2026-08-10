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

function readWindowState(): { open: boolean; filters: GalleryFilters } {
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
 */
export function useGallerySearchMode({
  initialOpen,
  initialFilters,
}: UseGallerySearchModeOptions): GallerySearchMode {
  const pathname = usePathname();

  const [state, setState] = useState(() => ({
    open: initialOpen,
    filters: initialFilters ?? DEFAULT_GALLERY_FILTERS,
  }));
  // Whether the entry currently on screen is one we pushed, and can therefore
  // be left with a plain Back instead of stacking another entry.
  const pushedRef = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
      setState(readWindowState());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const open = useCallback(
    (overrides?: Partial<GalleryFilters>) => {
      setState((current) => {
        const next = { ...DEFAULT_GALLERY_FILTERS, ...overrides };
        if (current.open) {
          // Refining an open panel replaces its entry rather than stacking a
          // second one on top of the first.
          window.history.replaceState(null, '', searchUrl(pathname, next));
        } else {
          window.history.pushState(null, '', searchUrl(pathname, next));
          pushedRef.current = true;
        }
        return { open: true, filters: next };
      });
    },
    [pathname]
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      // Leaves no search entry behind, so Back does not walk back into it.
      window.history.back();
      return;
    }
    window.history.pushState(null, '', pathname);
    setState({ open: false, filters: DEFAULT_GALLERY_FILTERS });
  }, [pathname]);

  const setQuery = useCallback(
    (query: string) => {
      setState((current) => {
        const next = { ...current.filters, search: query };
        if (current.open) {
          // Replace, or every keystroke becomes a history entry.
          window.history.replaceState(null, '', searchUrl(pathname, next));
        } else {
          window.history.pushState(null, '', searchUrl(pathname, next));
          pushedRef.current = true;
        }
        return { open: true, filters: next };
      });
    },
    [pathname]
  );

  const setFilters = useCallback(
    (filters: GalleryFilters) => {
      window.history.replaceState(null, '', searchUrl(pathname, filters));
      setState({ open: true, filters });
    },
    [pathname]
  );

  const clearRefinements = useCallback(() => {
    const next = { ...DEFAULT_GALLERY_FILTERS };
    window.history.replaceState(null, '', searchUrl(pathname, next));
    setState({ open: true, filters: next });
  }, [pathname]);

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
