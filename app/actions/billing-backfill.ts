'use server';

import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { backfillHistoricalBillingPayments, type BackfillBillingPaymentsResult } from '@/lib/billing/backfill';

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B, plan decision 14): the admin-triggered
 * one-shot backfill. One call handles up to `limit` orders (default 500); call again with the
 * returned `lastOrderId` as `afterId` while `hasMore` is true to work through the rest. Safe to
 * re-run at any time -- backfillHistoricalBillingPayments never overwrites an existing payment row.
 */
export async function runBillingPaymentsBackfill(
  input: { limit?: number; afterId?: string | null } = {}
): Promise<BackfillBillingPaymentsResult> {
  await verifyAdmin();
  const supabase = createAdminClient();
  return backfillHistoricalBillingPayments(supabase, input);
}
