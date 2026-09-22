'use server';

import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import {
  ADMIN_PAYMENTS_PAGE_SIZE,
  ADMIN_PAYMENTS_TOTALS_ROW_LIMIT,
  classifyPaymentSearchTerm,
  computePaymentModeTotals,
  mapAdminPaymentListRow,
  normalizeAdminPaymentsListInput,
  paymentKindDbValues,
  type AdminPaymentsListData,
  type AdminPaymentsListInput,
  type NormalizedAdminPaymentsListInput,
  type RawAdminPaymentListRow,
} from '@/lib/admin/admin-payments-list.shared';

/**
 * Payments admin-wide list -- app/admin/pricing/payments/page.tsx's data source. See
 * lib/admin/admin-payments-list.shared.ts for why the owner asked for this: a real test payment
 * couldn't be found anywhere in admin except one user's Billing panel.
 *
 * billing_payments and billing_refunds both come from migration 125, applied on dev but NOT on
 * production as of this writing -- every query here degrades to `status: 'unavailable'` on a
 * missing-schema error via isMissingBillingSchemaError, the same classifier
 * app/actions/admin-users.ts's Billing panel and app/actions/billing-incidents.ts use. This module
 * is read-only: nothing here mutates a payment, refund, or user row.
 */

const PAYMENT_ROW_COLUMNS =
  'id, provider, provider_mode, provider_payment_id, provider_order_id, provider_subscription_id, ' +
  'provider_invoice_id, billing_order_id, billing_subscription_id, plan_version_id, topup_pack_id, kind, ' +
  'status, currency_code, net_minor, tax_minor, gross_minor, method_category, provider_fee_minor, ' +
  'provider_tax_minor, cycle_start, cycle_end, captured_at, created_at, user_id, subject_ref';

const REFUND_LOOKUP_BATCH_SIZE = 100;

interface DirectoryRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
}

interface RefundTotalsRow {
  payment_id: string;
  provider_mode: string | null;
  amount_minor: number | string;
  status: string;
}

interface TotalsScopeRow {
  id: string;
  provider_mode: string | null;
  status: string;
  gross_minor: number | string;
  currency_code: string;
}

function emptyResult(normalized: NormalizedAdminPaymentsListInput): AdminPaymentsListData {
  return {
    status: 'ok',
    rows: [],
    page: normalized.page,
    pageSize: ADMIN_PAYMENTS_PAGE_SIZE,
    totalCount: 0,
    totalPages: 1,
    totals: [],
    totalsCapped: false,
  };
}

function unavailableResult(normalized: NormalizedAdminPaymentsListInput): AdminPaymentsListData {
  return {
    status: 'unavailable',
    rows: [],
    page: normalized.page,
    pageSize: ADMIN_PAYMENTS_PAGE_SIZE,
    totalCount: 0,
    totalPages: 1,
    totals: [],
    totalsCapped: false,
  };
}

export async function getAdminPaymentsList(input: AdminPaymentsListInput = {}): Promise<AdminPaymentsListData> {
  await verifyAdmin();
  const normalized = normalizeAdminPaymentsListInput(input);
  const admin = createAdminClient();
  const classification = classifyPaymentSearchTerm(normalized.search);

  // A directory (email / display-name) search resolves through the exact same admin_list_users RPC
  // the user directory itself calls (app/actions/admin-users.ts's getAdminUsersPage) -- reusing it
  // rather than hand-rolling a second auth.users lookup that could drift from what "matches" means
  // there. Capped at 100, the RPC's own maximum page size.
  let directoryUserIds: string[] | null = null;
  if (classification.kind === 'directory') {
    const directoryResult = await admin.rpc('admin_list_users', {
      p_search: classification.value,
      p_status: 'all',
      p_page: 1,
      p_page_size: 100,
      p_user_id: null,
    });
    if (directoryResult.error) {
      throw new Error(`Failed to resolve user search: ${directoryResult.error.message}`);
    }
    directoryUserIds = ((directoryResult.data ?? []) as { user_id: string }[]).map((row) => row.user_id);
    if (directoryUserIds.length === 0) {
      // A real search with zero matching accounts -- honestly empty, not an error.
      return emptyResult(normalized);
    }
  }

  const kindValues = paymentKindDbValues(normalized.kind);
  const offset = (normalized.page - 1) * ADMIN_PAYMENTS_PAGE_SIZE;

  let pageQuery = admin.from('billing_payments').select(PAYMENT_ROW_COLUMNS, { count: 'exact' });
  if (normalized.status !== 'all') pageQuery = pageQuery.eq('status', normalized.status);
  if (kindValues) pageQuery = pageQuery.in('kind', kindValues);
  if (normalized.providerMode !== 'all') pageQuery = pageQuery.eq('provider_mode', normalized.providerMode);
  if (classification.kind === 'payment_id') pageQuery = pageQuery.eq('provider_payment_id', classification.value);
  else if (classification.kind === 'order_id') pageQuery = pageQuery.eq('provider_order_id', classification.value);
  else if (classification.kind === 'subscription_id') {
    pageQuery = pageQuery.eq('provider_subscription_id', classification.value);
  } else if (classification.kind === 'user_id') pageQuery = pageQuery.eq('user_id', classification.value);
  else if (classification.kind === 'directory' && directoryUserIds) pageQuery = pageQuery.in('user_id', directoryUserIds);

  const pageResult = await pageQuery
    .order('captured_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + ADMIN_PAYMENTS_PAGE_SIZE - 1);

  if (isMissingBillingSchemaError(pageResult.error)) {
    return unavailableResult(normalized);
  }
  if (pageResult.error) {
    throw new Error(`Failed to load payments: ${pageResult.error.message}`);
  }

  const pageRows = (pageResult.data ?? []) as unknown as RawAdminPaymentListRow[];
  const totalCount = pageResult.count ?? pageRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_PAYMENTS_PAGE_SIZE));

  // Totals scope: the same filters, unpaginated up to ADMIN_PAYMENTS_TOTALS_ROW_LIMIT, and only the
  // columns the totals strip needs -- deliberately separate from the page query above so the row
  // list stays exactly paginated while the totals strip covers (almost certainly) every matching row.
  let totalsQuery = admin.from('billing_payments').select('id, provider_mode, status, gross_minor, currency_code');
  if (normalized.status !== 'all') totalsQuery = totalsQuery.eq('status', normalized.status);
  if (kindValues) totalsQuery = totalsQuery.in('kind', kindValues);
  if (normalized.providerMode !== 'all') totalsQuery = totalsQuery.eq('provider_mode', normalized.providerMode);
  if (classification.kind === 'payment_id') totalsQuery = totalsQuery.eq('provider_payment_id', classification.value);
  else if (classification.kind === 'order_id') totalsQuery = totalsQuery.eq('provider_order_id', classification.value);
  else if (classification.kind === 'subscription_id') {
    totalsQuery = totalsQuery.eq('provider_subscription_id', classification.value);
  } else if (classification.kind === 'user_id') totalsQuery = totalsQuery.eq('user_id', classification.value);
  else if (classification.kind === 'directory' && directoryUserIds) totalsQuery = totalsQuery.in('user_id', directoryUserIds);

  const [totalsResult, directoryLookup] = await Promise.all([
    totalsQuery.order('created_at', { ascending: false }).limit(ADMIN_PAYMENTS_TOTALS_ROW_LIMIT),
    loadDirectoryLookup(admin, pageRows),
  ]);

  // The page query already proved the schema is present; a schema error here would be surprising,
  // but degrade the same way rather than throw and blank a page that otherwise loaded fine.
  if (isMissingBillingSchemaError(totalsResult.error)) {
    return {
      status: 'ok',
      rows: pageRows.map((row) => mapAdminPaymentListRow(row, { refundedMinor: 0, hasPendingRefund: false }, directoryLookup.get(row.user_id ?? '') ?? null)),
      page: normalized.page,
      pageSize: ADMIN_PAYMENTS_PAGE_SIZE,
      totalCount,
      totalPages,
      totals: [],
      totalsCapped: false,
    };
  }
  if (totalsResult.error) {
    throw new Error(`Failed to load payment totals: ${totalsResult.error.message}`);
  }

  const totalsRows = (totalsResult.data ?? []) as unknown as TotalsScopeRow[];
  const totalsCapped = totalsRows.length >= ADMIN_PAYMENTS_TOTALS_ROW_LIMIT;
  const totalsPaymentIds = totalsRows.map((row) => row.id);

  // Batched: an .in() filter travels in the request URL, and a few hundred uuids in one list is
  // enough to overflow it -- the page would then fail at exactly the volume it exists for.
  const refundBatches: string[][] = [];
  for (let index = 0; index < totalsPaymentIds.length; index += REFUND_LOOKUP_BATCH_SIZE) {
    refundBatches.push(totalsPaymentIds.slice(index, index + REFUND_LOOKUP_BATCH_SIZE));
  }
  const refundResults = await Promise.all(
    refundBatches.map((batch) =>
      admin.from('billing_refunds').select('payment_id, provider_mode, amount_minor, status').in('payment_id', batch)
    )
  );

  const refundRows: RefundTotalsRow[] = [];
  for (const refundsResult of refundResults) {
    if (refundsResult.error && !isMissingBillingSchemaError(refundsResult.error)) {
      throw new Error(`Failed to load refunds: ${refundsResult.error.message}`);
    }
    refundRows.push(...((refundsResult.data ?? []) as unknown as RefundTotalsRow[]));
  }

  const totals = computePaymentModeTotals(
    totalsRows.map((row) => ({
      providerMode: row.provider_mode,
      status: row.status,
      grossMinor: Number(row.gross_minor),
      currencyCode: row.currency_code,
    })),
    refundRows.map((row) => ({
      providerMode: row.provider_mode,
      status: row.status,
      amountMinor: Number(row.amount_minor),
    }))
  );

  const refundsByPaymentId = new Map<string, { refundedMinor: number; hasPendingRefund: boolean }>();
  for (const refund of refundRows) {
    const entry = refundsByPaymentId.get(refund.payment_id) ?? { refundedMinor: 0, hasPendingRefund: false };
    if (refund.status === 'processed') entry.refundedMinor += Number(refund.amount_minor);
    if (refund.status === 'pending') entry.hasPendingRefund = true;
    refundsByPaymentId.set(refund.payment_id, entry);
  }

  const rows = pageRows.map((row) =>
    mapAdminPaymentListRow(
      row,
      refundsByPaymentId.get(row.id) ?? { refundedMinor: 0, hasPendingRefund: false },
      directoryLookup.get(row.user_id ?? '') ?? null
    )
  );

  return {
    status: 'ok',
    rows,
    page: normalized.page,
    pageSize: ADMIN_PAYMENTS_PAGE_SIZE,
    totalCount,
    totalPages,
    totals,
    totalsCapped,
  };
}

/**
 * Batch-resolves the current page's user ids to email/display name via admin_user_directory --
 * the same trigger-synced mirror of auth.users the admin_list_users RPC reads (migration 083,
 * long predating billing_payments' migration 125), so a failure here is a genuine error, never a
 * missing-migration case to degrade.
 */
async function loadDirectoryLookup(
  admin: ReturnType<typeof createAdminClient>,
  pageRows: RawAdminPaymentListRow[]
): Promise<Map<string, { email: string | null; displayName: string | null }>> {
  const ids = Array.from(new Set(pageRows.map((row) => row.user_id).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();

  const result = await admin.from('admin_user_directory').select('user_id, email, display_name').in('user_id', ids);
  if (result.error) {
    throw new Error(`Failed to resolve user directory: ${result.error.message}`);
  }

  const map = new Map<string, { email: string | null; displayName: string | null }>();
  for (const row of (result.data ?? []) as unknown as DirectoryRow[]) {
    map.set(row.user_id, { email: row.email, displayName: row.display_name });
  }
  return map;
}
