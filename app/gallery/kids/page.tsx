import KidsGalleryBrowser, { PAGE_SIZE } from '@/components/gallery/KidsGalleryBrowser';
import { getGalleryItems, getGalleryRails, getSavedStorylineIds } from '@/app/actions/gallery';
import { filtersFromParams, isSearchOpen } from '@/lib/gallery/search-params';
import type { GalleryFilters, GalleryPage, GalleryRailsResponse } from '@/lib/types/database';

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
 * Server shell for the kids surface. Every fetch passes `mode: 'kids'`, which is
 * enforced in the query layer — the audience scope is never a client decision,
 * including for a search arriving with hand-written parameters.
 */
export default async function KidsGalleryRoute({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = toURLSearchParams(await searchParams);
  const searchFilters: GalleryFilters | null = isSearchOpen(params)
    ? { ...filtersFromParams(params), type: 'storylines', ageGroup: 'all' }
    : null;

  const [railsResult, searchResult, savedResult] = await Promise.allSettled([
    getGalleryRails('kids'),
    searchFilters
      ? getGalleryItems(searchFilters, PAGE_SIZE, 0, 'kids')
      : Promise.resolve(null),
    getSavedStorylineIds(),
  ]);

  let initialRails: GalleryRailsResponse | null = null;
  if (railsResult.status === 'fulfilled') {
    initialRails = railsResult.value;
  } else {
    console.error('Failed to prerender kids rails:', railsResult.reason);
  }

  let initialSearchPage: GalleryPage | null = null;
  if (searchResult.status === 'fulfilled') {
    initialSearchPage = searchResult.value;
  } else {
    console.error('Failed to prerender kids search results:', searchResult.reason);
  }

  return (
    <KidsGalleryBrowser
      initialRails={initialRails}
      initialSearchOpen={searchFilters !== null}
      initialSearchFilters={searchFilters}
      initialSearchPage={initialSearchPage}
      initialSavedIds={savedResult.status === 'fulfilled' ? savedResult.value : undefined}
    />
  );
}
