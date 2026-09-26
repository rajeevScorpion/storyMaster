/**
 * Client-side pagination for admin tables that already have the full row set in memory (the
 * per-user Billing panel's Subscription / Orders / Payments / Refunds & disputes / Documents /
 * Webhook events tables -- see components/admin/users/AdminUserDetail.tsx's BillingListSection).
 * No server round trip: the rows are already loaded, so this just slices what's on screen.
 * Kept pure and isomorphic per CLAUDE.md's *.shared.ts split -- no DOM, no React.
 */

export const ADMIN_TABLE_PAGE_SIZE = 10;

export interface PaginatedAdminTableRows<T> {
  /** Clamped into [1, pageCount] -- never the raw, possibly-stale value a caller passed in. */
  page: number;
  pageCount: number;
  rows: T[];
  totalCount: number;
  /** 1-based display range, e.g. "11–20 of 23". Both 0 when totalCount is 0. */
  rangeStart: number;
  rangeEnd: number;
}

/**
 * Slices `rows` to one page, clamping a requested page number into range first -- so a page
 * number left over from a longer previous result set (or a stale click) never produces an empty
 * slice instead of falling back to the last real page.
 */
export function paginateAdminTableRows<T>(
  rows: readonly T[],
  requestedPage: number,
  pageSize: number = ADMIN_TABLE_PAGE_SIZE
): PaginatedAdminTableRows<T> {
  const totalCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(1, Math.floor(requestedPage)), pageCount)
    : 1;
  const startIndex = (page - 1) * pageSize;

  return {
    page,
    pageCount,
    rows: rows.slice(startIndex, startIndex + pageSize),
    totalCount,
    rangeStart: totalCount === 0 ? 0 : startIndex + 1,
    rangeEnd: Math.min(startIndex + pageSize, totalCount),
  };
}
