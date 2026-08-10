'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGalleryItems, type GalleryAudienceMode } from '@/app/actions/gallery';
import { filterKey } from '@/lib/gallery/search-params';
import type { GalleryFilters, GalleryItem, GalleryPage } from '@/lib/types/database';

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * One result set. Items and total live in the same object on purpose: the old
 * browser kept them in separate state, which is how the grid ended up rendering
 * "26 stories" above an empty-state panel. They can no longer disagree.
 */
interface ResultSet {
  key: string;
  items: GalleryItem[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

interface CacheEntry extends ResultSet {
  cachedAt: number;
}

export type GalleryResultsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseGalleryResultsOptions {
  filters: GalleryFilters;
  pageSize: number;
  /** Nothing is fetched until the surface asking for results is actually open. */
  enabled: boolean;
  mode?: GalleryAudienceMode;
  /** Server-rendered first page for a deep-linked search, keyed by its filters. */
  initialPage?: GalleryPage | null;
  initialFilters?: GalleryFilters | null;
}

export interface UseGalleryResultsValue {
  items: GalleryItem[];
  total: number;
  hasMore: boolean;
  status: GalleryResultsStatus;
  isLoadingMore: boolean;
  /** A newer page is in flight while stale results are still on screen. */
  isRefreshing: boolean;
  loadMore: () => void;
  retry: () => void;
}

const emptySet = (key: string): ResultSet => ({
  key,
  items: [],
  total: 0,
  hasMore: false,
  nextOffset: 0,
});

export function useGalleryResults({
  filters,
  pageSize,
  enabled,
  mode = 'all',
  initialPage = null,
  initialFilters = null,
}: UseGalleryResultsOptions): UseGalleryResultsValue {
  const key = filterKey(filters);

  const cacheRef = useRef<Map<string, CacheEntry>>(
    new Map(
      initialPage && initialFilters
        ? [[
            filterKey(initialFilters),
            {
              key: filterKey(initialFilters),
              items: initialPage.items,
              total: initialPage.total,
              hasMore: initialPage.hasMore,
              nextOffset: initialPage.items.length,
              cachedAt: Date.now(),
            },
          ]]
        : []
    )
  );

  // Shared so a duplicate request joins the existing one instead of being
  // dropped. Dropping it is what could leave a caller with nothing to apply
  // and the list stuck on whatever happened to be there.
  const inFlightRef = useRef<Map<string, Promise<GalleryPage>>>(new Map());
  const activeKeyRef = useRef(key);
  const mountedRef = useRef(true);
  const [reloadToken, setReloadToken] = useState(0);

  const [resultSet, setResultSet] = useState<ResultSet>(() => {
    const seeded = cacheRef.current.get(key);
    return seeded ? { ...seeded } : emptySet(key);
  });
  const [status, setStatus] = useState<GalleryResultsStatus>(() =>
    cacheRef.current.has(key) ? 'ready' : 'idle'
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const request = useCallback(
    (targetFilters: GalleryFilters, offset: number): Promise<GalleryPage> => {
      const requestKey = `${filterKey(targetFilters)}:${offset}`;
      const existing = inFlightRef.current.get(requestKey);
      if (existing) return existing;

      const promise = getGalleryItems(targetFilters, pageSize, offset, mode).finally(() => {
        inFlightRef.current.delete(requestKey);
      });
      inFlightRef.current.set(requestKey, promise);
      return promise;
    },
    [mode, pageSize]
  );

  useEffect(() => {
    activeKeyRef.current = key;

    if (!enabled) return;

    const cached = cacheRef.current.get(key);
    const isFresh = cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS;

    if (cached) {
      setResultSet({ ...cached });
      setStatus('ready');
      if (isFresh) return;
    } else {
      // No stale copy to show, so the surface renders skeletons rather than the
      // previous query's results, which would read as "these match".
      setResultSet(emptySet(key));
      setStatus('loading');
    }

    if (cached) setIsRefreshing(true);
    let cancelled = false;

    request(filters, 0)
      .then((page) => {
        const entry: CacheEntry = {
          key,
          items: page.items,
          total: page.total,
          hasMore: page.hasMore,
          nextOffset: page.items.length,
          cachedAt: Date.now(),
        };
        cacheRef.current.set(key, entry);

        // Late responses for a query the viewer has moved on from are cached
        // but never rendered.
        if (cancelled || !mountedRef.current || activeKeyRef.current !== key) return;
        setResultSet({ ...entry });
        setStatus('ready');
      })
      .catch((error) => {
        console.error('Failed to fetch gallery results:', error);
        if (cancelled || !mountedRef.current || activeKeyRef.current !== key) return;
        setStatus('error');
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        setIsRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
    // `filters` is fully described by `key`; depending on the object identity
    // would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, reloadToken, request]);

  const loadMore = useCallback(() => {
    if (!enabled || isLoadingMore || isRefreshing) return;

    const current = cacheRef.current.get(key);
    if (!current || !current.hasMore) return;

    const offset = current.nextOffset;
    setIsLoadingMore(true);

    request(filters, offset)
      .then((page) => {
        const base = cacheRef.current.get(key) ?? current;
        // Server order (created_at desc) is stable, so appended pages line up
        // with what is already on screen.
        const entry: CacheEntry = {
          key,
          items: [...base.items, ...page.items],
          // Only the first page carries a count; keep the one we already have.
          total: base.total,
          hasMore: page.hasMore,
          nextOffset: offset + page.items.length,
          cachedAt: base.cachedAt,
        };
        cacheRef.current.set(key, entry);

        if (!mountedRef.current || activeKeyRef.current !== key) return;
        setResultSet({ ...entry });
        setStatus('ready');
      })
      .catch((error) => {
        console.error('Failed to fetch more gallery results:', error);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setIsLoadingMore(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isLoadingMore, isRefreshing, key, request]);

  const retry = useCallback(() => {
    cacheRef.current.delete(key);
    setReloadToken((token) => token + 1);
  }, [key]);

  return {
    // Guard against a render between the key changing and the effect running.
    items: resultSet.key === key ? resultSet.items : [],
    total: resultSet.key === key ? resultSet.total : 0,
    hasMore: resultSet.key === key ? resultSet.hasMore : false,
    status,
    isLoadingMore,
    isRefreshing,
    loadMore,
    retry,
  };
}
