'use server';

import { updateTag } from 'next/cache';

import { MANAGED_PAGES_CACHE_TAG } from '@/lib/managed-pages/cache';
import {
  getManagedFooterLinks,
  getManagedPagesAdminState,
  resetManagedPageToSeed,
  saveManagedPage,
} from '@/lib/managed-pages/service';
import type { ManagedFooterLink, ManagedPageSaveInput, ManagedPagesAdminState } from '@/lib/managed-pages/types';
import { verifyAdmin } from '@/lib/supabase/admin';

export async function getManagedPagesAdminStateAction(): Promise<ManagedPagesAdminState> {
  await verifyAdmin();
  return getManagedPagesAdminState();
}

export async function saveManagedPageAction(input: ManagedPageSaveInput): Promise<ManagedPagesAdminState> {
  const { user } = await verifyAdmin();
  await saveManagedPage(input, user.id);
  // Cross-request Data Cache invalidation (unstable_cache tag) for other
  // viewers; saveManagedPage() already cleared the in-process footer-link
  // cache so the admin's own next fetch is immediate either way.
  updateTag(MANAGED_PAGES_CACHE_TAG);
  return getManagedPagesAdminState();
}

export async function resetManagedPageToSeedAction(pageKey: string): Promise<ManagedPagesAdminState> {
  const { user } = await verifyAdmin();
  await resetManagedPageToSeed(pageKey, user.id);
  updateTag(MANAGED_PAGES_CACHE_TAG);
  return getManagedPagesAdminState();
}

export async function getManagedFooterLinksAction(): Promise<ManagedFooterLink[]> {
  return getManagedFooterLinks();
}
