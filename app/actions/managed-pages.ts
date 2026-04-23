'use server';

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
  return getManagedPagesAdminState();
}

export async function resetManagedPageToSeedAction(pageKey: string): Promise<ManagedPagesAdminState> {
  const { user } = await verifyAdmin();
  await resetManagedPageToSeed(pageKey, user.id);
  return getManagedPagesAdminState();
}

export async function getManagedFooterLinksAction(): Promise<ManagedFooterLink[]> {
  return getManagedFooterLinks();
}
