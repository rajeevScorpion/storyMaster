import KidsGalleryBrowser, { KIDS_FILTERS, PAGE_SIZE } from '@/components/gallery/KidsGalleryBrowser';
import { getGalleryItems, getGalleryRails, getSavedStorylineIds } from '@/app/actions/gallery';
import type { GalleryPage, GalleryRailsResponse } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

/**
 * Server shell for the kids surface. Both fetches pass `mode: 'kids'`, which is
 * enforced in the query layer — the audience scope is never a client decision.
 */
export default async function KidsGalleryRoute() {
  const [railsResult, gridResult, savedResult] = await Promise.allSettled([
    getGalleryRails('kids'),
    getGalleryItems(KIDS_FILTERS, PAGE_SIZE, 0, 'kids'),
    getSavedStorylineIds(),
  ]);

  let initialRails: GalleryRailsResponse | null = null;
  if (railsResult.status === 'fulfilled') {
    initialRails = railsResult.value;
  } else {
    console.error('Failed to prerender kids rails:', railsResult.reason);
  }

  let initialGrid: GalleryPage | null = null;
  if (gridResult.status === 'fulfilled') {
    initialGrid = gridResult.value;
  } else {
    console.error('Failed to prerender kids grid:', gridResult.reason);
  }

  return (
    <KidsGalleryBrowser
      initialRails={initialRails}
      initialGrid={initialGrid}
      initialSavedIds={savedResult.status === 'fulfilled' ? savedResult.value : undefined}
    />
  );
}
