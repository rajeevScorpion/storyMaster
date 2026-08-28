import 'server-only';

import { getFeatureFlag } from '@/lib/ai/model-config';
import {
  MANAGED_PAGE_DEFINITIONS,
  RESERVED_ROOT_SLUGS,
  getManagedPageSeedDefinition,
  isReservedManagedPageSlug,
  normalizeManagedPageSlug,
} from '@/lib/managed-pages/registry';
import {
  MANAGED_PAGE_ACCESS_LEVELS,
  MANAGED_PAGE_TYPES,
  type ManagedFooterLink,
  type ManagedPageAccessLevel,
  type ManagedPageRecord,
  type ManagedPageSaveInput,
  type ManagedPageSummary,
  type ManagedPageType,
  type ManagedPagesAdminState,
} from '@/lib/managed-pages/types';
import { canViewManagedPage, type ManagedPageAccessContext } from '@/lib/managed-pages/access';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { DbManagedPage } from '@/lib/types/database';

type ManagedPageUpdateRow = Partial<
  Pick<
    DbManagedPage,
    | 'title'
    | 'slug'
    | 'enabled'
    | 'show_in_footer'
    | 'footer_order'
    | 'open_in_new_tab'
    | 'access_level'
    | 'page_type'
    | 'seed_version'
    | 'content'
    | 'excerpt'
    | 'metadata_json'
    | 'updated_at'
    | 'updated_by'
  >
>;

function isManagedPageAccessLevel(value: string): value is ManagedPageAccessLevel {
  return (MANAGED_PAGE_ACCESS_LEVELS as readonly string[]).includes(value);
}

function isManagedPageType(value: string): value is ManagedPageType {
  return (MANAGED_PAGE_TYPES as readonly string[]).includes(value);
}

export function getSupportEmail(): string {
  return process.env.SUPPORT_EMAIL?.trim() ?? '';
}

export function mapDbManagedPage(row: DbManagedPage): ManagedPageRecord {
  return {
    pageKey: row.page_key,
    title: row.title,
    slug: row.slug,
    enabled: row.enabled,
    showInFooter: row.show_in_footer,
    footerOrder: row.footer_order,
    openInNewTab: row.open_in_new_tab,
    accessLevel: row.access_level,
    pageType: row.page_type,
    seedVersion: row.seed_version,
    content: row.content,
    excerpt: row.excerpt,
    metadata: row.metadata_json ?? {},
    isSystemPage: row.is_system_page,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

type DbManagedPageSummaryRow = Omit<DbManagedPage, 'content'>;

function mapDbManagedPageSummary(row: DbManagedPageSummaryRow): ManagedPageSummary {
  return {
    pageKey: row.page_key,
    title: row.title,
    slug: row.slug,
    enabled: row.enabled,
    showInFooter: row.show_in_footer,
    footerOrder: row.footer_order,
    openInNewTab: row.open_in_new_tab,
    accessLevel: row.access_level,
    pageType: row.page_type,
    seedVersion: row.seed_version,
    excerpt: row.excerpt,
    metadata: row.metadata_json ?? {},
    isSystemPage: row.is_system_page,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const MANAGED_PAGE_SUMMARY_COLUMNS =
  'page_key, title, slug, enabled, show_in_footer, footer_order, open_in_new_tab, access_level, page_type, seed_version, excerpt, metadata_json, is_system_page, created_at, updated_at, updated_by';

async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentManagedPageAccessContext(): Promise<ManagedPageAccessContext> {
  const [userId, billingEnabled] = await Promise.all([
    getCurrentUserId(),
    getFeatureFlag('pricing_snapshot_enabled', false),
  ]);

  const adminUserId = process.env.ADMIN_USER_ID;

  return {
    userId,
    isAdmin: Boolean(userId && adminUserId && userId === adminUserId),
    billingEnabled,
  };
}

export async function listManagedPages(): Promise<ManagedPageRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .select('*')
    .order('footer_order', { ascending: true })
    .order('title', { ascending: true });

  if (error) throw new Error(`Failed to load managed pages: ${error.message}`);

  return ((data ?? []) as DbManagedPage[]).map(mapDbManagedPage);
}

/**
 * Same rows as listManagedPages() but without `content` — the footer and the
 * Help & Legal index only need labels/metadata, and listManagedPages()'s
 * `select('*')` was pulling the full body of all 11 pages just to build a
 * list of link labels.
 */
export async function listManagedPageSummaries(): Promise<ManagedPageSummary[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .select(MANAGED_PAGE_SUMMARY_COLUMNS)
    .order('footer_order', { ascending: true })
    .order('title', { ascending: true });

  if (error) throw new Error(`Failed to load managed page summaries: ${error.message}`);

  return ((data ?? []) as DbManagedPageSummaryRow[]).map(mapDbManagedPageSummary);
}

export async function getManagedPageBySlug(slug: string): Promise<ManagedPageRecord | null> {
  const normalizedSlug = normalizeManagedPageSlug(slug);
  if (!normalizedSlug || isReservedManagedPageSlug(normalizedSlug)) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .select('*')
    .eq('slug', normalizedSlug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load managed page: ${error.message}`);
  if (!data) return null;

  return mapDbManagedPage(data as DbManagedPage);
}

export async function getManagedPagesAdminState(): Promise<ManagedPagesAdminState> {
  const pages = await listManagedPages();

  return {
    pages,
    supportEmailConfigured: Boolean(getSupportEmail()),
    reservedSlugs: [...RESERVED_ROOT_SLUGS],
  };
}

const ESSENTIAL_LEGAL_FOOTER_KEYS = ['terms', 'privacy_policy'] as const;

/**
 * Terms + Privacy hrefs for the minimal site-wide footer. Deliberately
 * independent of `show_in_footer`/`footer_order` (the old generic,
 * admin-configurable footer list): these two must remain reachable from
 * every page regardless of that toggle, since the pack's stop condition is
 * that legal content stay accessible to logged-out and restricted users.
 * Filtered to `enabled && accessLevel === 'public'` — never gated on the
 * viewer, so this needs no per-request auth check at all.
 */
export async function getEssentialLegalFooterLinks(): Promise<ManagedFooterLink[]> {
  const pages = await listManagedPageSummaries();

  return ESSENTIAL_LEGAL_FOOTER_KEYS.map((key) => pages.find((page) => page.pageKey === key))
    .filter((page): page is ManagedPageSummary => Boolean(page && page.enabled && page.accessLevel === 'public'))
    .map((page) => ({
      key: page.pageKey,
      title: page.title,
      href: `/${page.slug}`,
      openInNewTab: false,
      footerOrder: 0,
    }));
}

export async function getAllowedManagedPageBySlug(slug: string): Promise<ManagedPageRecord | null> {
  const [page, context] = await Promise.all([
    getManagedPageBySlug(slug),
    getCurrentManagedPageAccessContext(),
  ]);

  if (!page || !canViewManagedPage(page, context)) return null;
  return page;
}

async function assertSlugIsUnique(pageKey: string, slug: string): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .select('page_key')
    .eq('slug', slug)
    .neq('page_key', pageKey)
    .limit(1);

  if (error) throw new Error(`Failed to validate slug: ${error.message}`);
  if (data && data.length > 0) throw new Error('Slug is already used by another managed page.');
}

function validateManagedPageInput(input: ManagedPageSaveInput): ManagedPageSaveInput {
  const pageKey = input.pageKey.trim();
  const title = input.title.trim();
  const slug = normalizeManagedPageSlug(input.slug);
  const footerOrder = Number(input.footerOrder);
  const accessLevel = input.accessLevel;
  const pageType = input.pageType;

  if (!getManagedPageSeedDefinition(pageKey)) {
    throw new Error('Unknown managed system page.');
  }

  if (!title) {
    throw new Error('Title is required.');
  }

  if (!slug) {
    throw new Error('Slug is required.');
  }

  if (isReservedManagedPageSlug(slug)) {
    throw new Error('Slug is reserved by an existing app route.');
  }

  if (!isManagedPageAccessLevel(accessLevel)) {
    throw new Error('Invalid access level.');
  }

  if (!isManagedPageType(pageType)) {
    throw new Error('Invalid page type.');
  }

  if (!Number.isFinite(footerOrder)) {
    throw new Error('Footer order must be a number.');
  }

  return {
    pageKey,
    title,
    slug,
    enabled: Boolean(input.enabled),
    showInFooter: Boolean(input.showInFooter),
    footerOrder: Math.trunc(footerOrder),
    openInNewTab: Boolean(input.openInNewTab),
    accessLevel,
    pageType,
    content: input.content,
    excerpt: input.excerpt?.trim() || null,
  };
}

export async function saveManagedPage(
  input: ManagedPageSaveInput,
  updatedBy: string
): Promise<ManagedPageRecord> {
  const normalized = validateManagedPageInput(input);
  await assertSlugIsUnique(normalized.pageKey, normalized.slug);

  const updateRow: ManagedPageUpdateRow = {
    title: normalized.title,
    slug: normalized.slug,
    enabled: normalized.enabled,
    show_in_footer: normalized.showInFooter,
    footer_order: normalized.footerOrder,
    open_in_new_tab: normalized.openInNewTab,
    access_level: normalized.accessLevel,
    page_type: normalized.pageType,
    content: normalized.content,
    excerpt: normalized.excerpt,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .update(updateRow)
    .eq('page_key', normalized.pageKey)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to save managed page: ${error.message}`);
  return mapDbManagedPage(data as DbManagedPage);
}

export async function resetManagedPageToSeed(
  pageKey: string,
  updatedBy: string
): Promise<ManagedPageRecord> {
  const definition = getManagedPageSeedDefinition(pageKey.trim());
  if (!definition) throw new Error('Unknown managed system page.');

  await assertSlugIsUnique(definition.pageKey, definition.slug);

  const updateRow: ManagedPageUpdateRow = {
    title: definition.title,
    slug: definition.slug,
    enabled: definition.enabled,
    show_in_footer: definition.showInFooter,
    footer_order: definition.footerOrder,
    open_in_new_tab: definition.openInNewTab,
    access_level: definition.accessLevel,
    page_type: definition.pageType,
    seed_version: definition.seedVersion,
    content: definition.content,
    excerpt: definition.excerpt,
    metadata_json: definition.metadata,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('managed_pages')
    .update(updateRow)
    .eq('page_key', definition.pageKey)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to reset managed page: ${error.message}`);
  return mapDbManagedPage(data as DbManagedPage);
}

export function getManagedPageSeedCount(): number {
  return MANAGED_PAGE_DEFINITIONS.length;
}
