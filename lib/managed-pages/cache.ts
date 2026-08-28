import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';

import { canViewManagedPage } from '@/lib/managed-pages/access';
import { getCurrentManagedPageAccessContext, getManagedPageBySlug } from '@/lib/managed-pages/service';
import type { ManagedPageRecord } from '@/lib/managed-pages/types';

/** Bump-invalidated by app/actions/managed-pages.ts via updateTag() after any admin save/reset. */
export const MANAGED_PAGES_CACHE_TAG = 'managed-pages';
const MANAGED_PAGE_ROW_REVALIDATE_SECONDS = 300;

// Caches only the raw DB row — never the access decision. A non-public page's
// allowed/denied result depends on the requesting user (auth.getUser() +
// pricing_snapshot_enabled), and caching that would leak one visitor's result
// to a different visitor for the rest of the revalidate window.
const cachedManagedPageRowBySlug = unstable_cache(
  (slug: string) => getManagedPageBySlug(slug),
  ['managed-page-row-by-slug'],
  { revalidate: MANAGED_PAGE_ROW_REVALIDATE_SECONDS, tags: [MANAGED_PAGES_CACHE_TAG] }
);

/**
 * The route-level loader for app/[slug]/page.tsx. React cache() dedupes this
 * within a single request, so generateMetadata and the page body — which both
 * need the same page — issue one row fetch instead of two. For the 9 of 11
 * pages that are `accessLevel: 'public'`, the access check short-circuits
 * before touching Supabase Auth or the feature-flag table at all.
 */
export const getCachedAllowedManagedPageBySlug = cache(
  async (slug: string): Promise<ManagedPageRecord | null> => {
    const page = await cachedManagedPageRowBySlug(slug);
    if (!page || !page.enabled) return null;
    if (page.accessLevel === 'public') return page;

    // Only non-public pages pay for the per-user check, and it always runs
    // live — never cached — because its result depends on who is asking.
    const context = await getCurrentManagedPageAccessContext();
    return canViewManagedPage(page, context) ? page : null;
  }
);
