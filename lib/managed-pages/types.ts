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

export const MANAGED_PAGE_ACCEPTANCE_KINDS = ['accepted', 'acknowledged'] as const;
export type ManagedPageAcceptanceKind = (typeof MANAGED_PAGE_ACCEPTANCE_KINDS)[number];

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
  /** Migration 099; null on a database that hasn't applied it, or on a page with no published version yet. */
  docVersion: string | null;
  effectiveDate: string | null;
  requiresAcceptance: boolean;
  acceptanceKind: ManagedPageAcceptanceKind | null;
  reacceptanceRequired: boolean;
  publishedAt: string | null;
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
  /** Draft-editable versioning fields (migration 099). `reacceptanceRequired`/`publishedAt` are set only by publishing a version, never edited directly. */
  docVersion: string | null;
  effectiveDate: string | null;
  requiresAcceptance: boolean;
  acceptanceKind: ManagedPageAcceptanceKind | null;
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
  /** `legal_consent_gate_enabled` feature flag — enforced in proxy.ts, not by this admin screen itself. */
  legalConsentGateEnabled: boolean;
}
