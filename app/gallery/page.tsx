import GalleryBrowser from '@/components/gallery/GalleryBrowser';
import { getGalleryItems, getGalleryRails, getSavedStorylineIds } from '@/app/actions/gallery';
import { GALLERY_PAGE_SIZE } from '@/lib/gallery/paging';
import {
  DEFAULT_GALLERY_FILTERS,
  filtersFromParams,
  isSearchOpen,
} from '@/lib/gallery/search-params';
import type { GalleryFilters, GalleryPage, GalleryRailsResponse } from '@/lib/types/database';

// The feed depends on the viewer's session (My List) and on freshly published
// storylines, so it is resolved per request rather than at build time.
export const dynamic = 'force-dynamic';

type RawSearchParams = Record<string, string | string[] | undefined>;

function toURLSearchParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  return params;
}

/**
 * Server shell for the discovery gallery.
 *
 * The browser used to be a client component that fetched everything after
 * hydration, so the first paint was skeletons and the real content waited on
 * bundle download → hydrate → server action → database. Resolving the
 * above-the-fold payload here collapses that into the initial HTML; the client
 * component still owns search, paging, and saves, and refetches on its own
 * when either half fails.
 *
 * The catalogue's first page is resolved here whether or not search is open. On
 * a shared search link it is the results; on a plain feed visit it is the seed
 * that makes opening search instant instead of a spinner over a server-action
 * round trip. It runs in parallel with the rails, so it costs no wall time.
 *
 * Saved ids are resolved here too. They are cheap, but fetching them from the
 * client costs a server action, and a server action re-renders this whole route
 * — so that one mount-time call would re-run the entire feed.
 */
export default async function GalleryRoute({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = toURLSearchParams(await searchParams);
  const searchOpen = isSearchOpen(params);
  const searchFilters: GalleryFilters = searchOpen
    ? filtersFromParams(params)
    : DEFAULT_GALLERY_FILTERS;

  const [railsResult, searchResult, savedResult] = await Promise.allSettled([
    getGalleryRails(),
    getGalleryItems(searchFilters, GALLERY_PAGE_SIZE, 0),
    getSavedStorylineIds(),
  ]);

  let initialRails: GalleryRailsResponse | null = null;
  if (railsResult.status === 'fulfilled') {
    initialRails = railsResult.value;
  } else {
    console.error('Failed to prerender gallery rails:', railsResult.reason);
  }

  let initialSearchPage: GalleryPage | null = null;
  if (searchResult.status === 'fulfilled') {
    initialSearchPage = searchResult.value;
  } else {
    console.error('Failed to prerender gallery search results:', searchResult.reason);
  }

  // Undefined (not []) on failure, so the client falls back to fetching them
  // rather than rendering an empty My List as though nothing were saved.
  const initialSavedIds = savedResult.status === 'fulfilled' ? savedResult.value : undefined;

  return (
    <GalleryBrowser
      initialRails={initialRails}
      initialSearchOpen={searchOpen}
      initialSearchFilters={searchFilters}
      initialSearchPage={initialSearchPage}
      initialSavedIds={initialSavedIds}
    />
  );
}
