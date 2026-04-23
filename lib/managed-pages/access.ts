import type { ManagedPageRecord } from './types';

export interface ManagedPageAccessContext {
  userId: string | null;
  isAdmin: boolean;
  billingEnabled: boolean;
}

export function canViewManagedPage(
  page: Pick<ManagedPageRecord, 'enabled' | 'accessLevel'>,
  context: ManagedPageAccessContext
): boolean {
  if (!page.enabled) return false;

  if (page.accessLevel === 'public') return true;
  if (page.accessLevel === 'authenticated') return Boolean(context.userId);
  if (page.accessLevel === 'admin') return context.isAdmin;
  if (page.accessLevel === 'billing_enabled_only') return context.billingEnabled;

  return false;
}

export function canShowManagedPageInFooter(
  page: Pick<ManagedPageRecord, 'enabled' | 'showInFooter' | 'accessLevel'>,
  context: ManagedPageAccessContext
): boolean {
  return page.showInFooter && canViewManagedPage(page, context);
}
