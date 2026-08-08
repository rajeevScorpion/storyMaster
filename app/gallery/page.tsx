import GalleryBrowser, { DEFAULT_FILTERS, PAGE_SIZE } from '@/components/gallery/GalleryBrowser';
import { getGalleryItems, getGalleryRails, getSavedStorylineIds } from '@/app/actions/gallery';
import type { GalleryPage, GalleryRailsResponse } from '@/lib/types/database';

// The feed depends on the viewer's session (My List) and on freshly published
// storylines, so it is resolved per request rather than at build time.
export const dynamic = 'force-dynamic';

/**
 * Server shell for the discovery gallery.
 *
 * The browser used to be a client component that fetched everything after
 * hydration, so the first paint was skeletons and the real content waited on
 * bundle download → hydrate → server action → database. Resolving the
 * above-the-fold payload here collapses that into the initial HTML; the client
 * component still owns filters, paging, and saves, and refetches on its own
 * when either half fails.
 *
 * Saved ids are resolved here too. They are cheap, but fetching them from the
 * client costs a server action, and a server action re-renders this whole route
 * — so that one mount-time call would re-run the entire feed.
 */
export default async function GalleryRoute() {
  const [railsResult, gridResult, savedResult] = await Promise.allSettled([
    getGalleryRails(),
    getGalleryItems(DEFAULT_FILTERS, PAGE_SIZE, 0),
    getSavedStorylineIds(),
  ]);

  let initialRails: GalleryRailsResponse | null = null;
  if (railsResult.status === 'fulfilled') {
    initialRails = railsResult.value;
  } else {
    console.error('Failed to prerender gallery rails:', railsResult.reason);
  }

  let initialGrid: GalleryPage | null = null;
  if (gridResult.status === 'fulfilled') {
    initialGrid = gridResult.value;
  } else {
    console.error('Failed to prerender gallery grid:', gridResult.reason);
  }

  // Undefined (not []) on failure, so the client falls back to fetching them
  // rather than rendering an empty My List as though nothing were saved.
  const initialSavedIds = savedResult.status === 'fulfilled' ? savedResult.value : undefined;

  return (
    <GalleryBrowser
      initialRails={initialRails}
      initialGrid={initialGrid}
      initialSavedIds={initialSavedIds}
    />
  );
}
