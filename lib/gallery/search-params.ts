import type { GalleryFilters, GalleryLane } from '@/lib/types/database';

/**
 * Search is a *mode* of the gallery, not a section of it, and the URL is what
 * says which mode you are in. `?q` present — even empty — means search is open;
 * absent means the discovery feed.
 *
 * An empty `q` is therefore meaningful and must survive a round trip: it is the
 * "browse the whole catalogue" state you land in when you tap the search icon
 * or a rail's See all, before typing anything.
 */
export const SEARCH_QUERY_PARAM = 'q';

const PARAM_KEYS = {
  type: 'type',
  genre: 'genre',
  ageGroup: 'age',
  country: 'from',
  language: 'lang',
} as const;

export const DEFAULT_GALLERY_FILTERS: GalleryFilters = {
  search: '',
  type: 'storylines',
  genre: 'all',
  ageGroup: 'all',
  country: 'all',
  language: 'all',
};

function readLane(value: string | null): GalleryLane {
  return value === 'vertical' ? 'vertical' : 'storylines';
}

/** A filter is "set" when it is anything other than the catch-all default. */
function readFilter(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'all';
}

type ReadableParams = Pick<URLSearchParams, 'get' | 'has'>;

export function isSearchOpen(params: ReadableParams): boolean {
  return params.has(SEARCH_QUERY_PARAM);
}

export function filtersFromParams(params: ReadableParams): GalleryFilters {
  return {
    search: params.get(SEARCH_QUERY_PARAM)?.trim() ?? '',
    type: readLane(params.get(PARAM_KEYS.type)),
    genre: readFilter(params.get(PARAM_KEYS.genre)),
    ageGroup: readFilter(params.get(PARAM_KEYS.ageGroup)),
    country: readFilter(params.get(PARAM_KEYS.country)),
    language: readFilter(params.get(PARAM_KEYS.language)),
  };
}

/**
 * Serialize back to a query string, dropping every default so a plain browse
 * URL stays `?q=` rather than carrying five `all`s nobody typed.
 */
export function paramsFromFilters(filters: GalleryFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set(SEARCH_QUERY_PARAM, filters.search.trim());

  if (filters.type !== DEFAULT_GALLERY_FILTERS.type) params.set(PARAM_KEYS.type, filters.type);
  if (filters.genre !== 'all') params.set(PARAM_KEYS.genre, filters.genre);
  if (filters.ageGroup !== 'all') params.set(PARAM_KEYS.ageGroup, filters.ageGroup);
  if (filters.country !== 'all') params.set(PARAM_KEYS.country, filters.country);
  if (filters.language !== 'all') params.set(PARAM_KEYS.language, filters.language);

  return params;
}

export function searchUrl(pathname: string, filters: GalleryFilters): string {
  return `${pathname}?${paramsFromFilters(filters).toString()}`;
}

/** Identity of a result set, for caching and for discarding stale responses. */
export function filterKey(filters: GalleryFilters): string {
  return [
    filters.type,
    filters.search.trim().toLowerCase(),
    filters.genre,
    filters.ageGroup,
    filters.country,
    filters.language,
  ].join('|');
}

export function hasActiveRefinement(filters: GalleryFilters): boolean {
  return (
    filters.type !== DEFAULT_GALLERY_FILTERS.type ||
    filters.genre !== 'all' ||
    filters.ageGroup !== 'all' ||
    filters.country !== 'all' ||
    filters.language !== 'all'
  );
}

/** True when nothing has been asked for yet — the browse-everything state. */
export function isBrowseAll(filters: GalleryFilters): boolean {
  return filters.search.trim() === '' && !hasActiveRefinement(filters);
}
