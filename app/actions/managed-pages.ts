'use server';

import { updateTag } from 'next/cache';

import { getCachedAllowedManagedPageByKey, MANAGED_PAGES_CACHE_TAG } from '@/lib/managed-pages/cache';
import {
  getEssentialLegalFooterLinks,
  getManagedPagesAdminState,
  resetManagedPageToSeed,
  saveManagedPage,
} from '@/lib/managed-pages/service';
import { resolveManagedPageTokens } from '@/lib/managed-pages/render';
import type {
  ManagedFooterLink,
  ManagedPageSaveInput,
  ManagedPageType,
  ManagedPagesAdminState,
} from '@/lib/managed-pages/types';
import { publishManagedPageVersion, type ManagedPageChangeType } from '@/lib/managed-pages/versioning';
import { verifyAdmin } from '@/lib/supabase/admin';

export async function getManagedPagesAdminStateAction(): Promise<ManagedPagesAdminState> {
  await verifyAdmin();
  return getManagedPagesAdminState();
}

export async function saveManagedPageAction(input: ManagedPageSaveInput): Promise<ManagedPagesAdminState> {
  const { user } = await verifyAdmin();
  await saveManagedPage(input, user.id);
  // Cross-request Data Cache invalidation (unstable_cache tag) for read-your-
  // own-writes on the admin's own next fetch and for every other viewer.
  updateTag(MANAGED_PAGES_CACHE_TAG);
  return getManagedPagesAdminState();
}

export async function resetManagedPageToSeedAction(pageKey: string): Promise<ManagedPagesAdminState> {
  const { user } = await verifyAdmin();
  await resetManagedPageToSeed(pageKey, user.id);
  updateTag(MANAGED_PAGES_CACHE_TAG);
  return getManagedPagesAdminState();
}

export async function getEssentialLegalFooterLinksAction(): Promise<ManagedFooterLink[]> {
  return getEssentialLegalFooterLinks();
}

export interface ManagedPageModalContent {
  title: string;
  content: string;
  docVersion: string | null;
  effectiveDate: string | null;
  updatedAt: string;
  pageType: ManagedPageType;
}

/**
 * Content for components/legal/LegalDocumentModal.tsx — the {{SUPPORT_EMAIL}}
 * token is resolved here (server-side, via the server-only support-email
 * lookup) so the client component can render the body with the pure
 * lib/managed-pages/render.shared.tsx parser without needing any
 * 'server-only'-gated import.
 */
export async function getManagedPageContentForModalAction(pageKey: string): Promise<ManagedPageModalContent | null> {
  const page = await getCachedAllowedManagedPageByKey(pageKey);
  if (!page) return null;

  return {
    title: page.title,
    content: resolveManagedPageTokens(page.content),
    docVersion: page.docVersion,
    effectiveDate: page.effectiveDate,
    updatedAt: page.updatedAt,
    pageType: page.pageType,
  };
}

export async function publishManagedPageVersionAction(
  pageKey: string,
  changeType: ManagedPageChangeType
): Promise<ManagedPagesAdminState> {
  const { user } = await verifyAdmin();
  await publishManagedPageVersion(pageKey, changeType, user.id);
  // Both the required-documents cache (lib/legal/consent.ts) and the page-row
  // cache (app/[slug]) key off this same tag.
  updateTag(MANAGED_PAGES_CACHE_TAG);
  return getManagedPagesAdminState();
}
