export const MANAGED_PAGE_ACCESS_LEVELS = [
  'public',
  'authenticated',
  'admin',
  'billing_enabled_only',
] as const;

export type ManagedPageAccessLevel = (typeof MANAGED_PAGE_ACCESS_LEVELS)[number];

export const MANAGED_PAGE_TYPES = [
  'rich_text',
  'blog_index',
  'docs_index',
  'faq',
  'legal',
] as const;

export type ManagedPageType = (typeof MANAGED_PAGE_TYPES)[number];

export interface ManagedPageRecord {
  pageKey: string;
  title: string;
  slug: string;
  enabled: boolean;
  showInFooter: boolean;
  footerOrder: number;
  openInNewTab: boolean;
  accessLevel: ManagedPageAccessLevel;
  pageType: ManagedPageType;
  seedVersion: number;
  content: string;
  excerpt: string | null;
  metadata: Record<string, unknown>;
  isSystemPage: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ManagedPageSaveInput {
  pageKey: string;
  title: string;
  slug: string;
  enabled: boolean;
  showInFooter: boolean;
  footerOrder: number;
  openInNewTab: boolean;
  accessLevel: ManagedPageAccessLevel;
  pageType: ManagedPageType;
  content: string;
  excerpt: string | null;
}

/** A managed page without its `content` body — for listings (footer, Help & Legal index) that only need labels/metadata and shouldn't pay to fetch every page's full text. */
export type ManagedPageSummary = Omit<ManagedPageRecord, 'content'>;

export interface ManagedFooterLink {
  key: string;
  title: string;
  href: string;
  openInNewTab: boolean;
  footerOrder: number;
}

export interface ManagedPagesAdminState {
  pages: ManagedPageRecord[];
  supportEmailConfigured: boolean;
  reservedSlugs: string[];
}
