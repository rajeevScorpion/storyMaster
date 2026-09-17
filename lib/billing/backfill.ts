import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { DbBillingOrder } from '@/lib/types/database';
import type { BillingPaymentKind, BillingPaymentStatus } from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;

const ORDER_STATUS_TO_PAYMENT_STATUS: Record<string, BillingPaymentStatus | undefined> = {
  paid: 'captured',
  refunded: 'refunded',
  partially_refunded: 'partially_refunded',
  disputed: 'disputed',
};

export interface BackfillBillingPaymentsResult {
  scanned: number;
  inserted: number;
  skippedAlreadyRecorded: number;
  skippedIneligible: number;
  /** True when this page was cut short by `limit` -- call again with `afterId` set to the last
   * scanned order's id to continue. */
  hasMore: boolean;
  lastOrderId: string | null;
}

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B, plan decision 14): turns historical
 * paid billing_orders into billing_payments rows marked `backfilled` with `taxStatus:
 * 'unknown_legacy'` in tax_breakdown_json -- these orders predate Phase 2 tax, so recording
 * net = gross = what was actually charged is the honest number, not a guess (no rate was ever
 * applied, so there is nothing to reconstruct). Idempotent: an existing billing_payments row for the
 * same (provider, provider_mode, provider_payment_id) is left completely untouched, never
 * overwritten -- so re-running this after Phase 2 has been live for a while can only ever add rows
 * for orders that still have none, never downgrade a properly tax-aware payment record.
 *
 * A structural limitation, not a bug: billing_orders never had a row for a subscription renewal
 * (only ever the first charge), so pre-Phase-2 renewals cannot be backfilled -- there is no local
 * record of them to backfill from. Only what the provider told us is recorded, never invented.
 */
export async function backfillHistoricalBillingPayments(
  supabase: AdminClient,
  options: { limit?: number; afterId?: string | null } = {}
): Promise<BackfillBillingPaymentsResult> {
  const limit = options.limit ?? 500;

  let query = supabase
    .from('billing_orders')
    .select('*')
    .not('provider_payment_id', 'is', null)
    .in('status', ['paid', 'refunded', 'partially_refunded', 'disputed'])
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (options.afterId) {
    query = query.gt('id', options.afterId);
  }

  const result = await query;
  if (result.error) {
    throw new Error(`Failed to load billing orders to backfill: ${result.error.message}`);
  }

  const rows = (result.data ?? []) as DbBillingOrder[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let inserted = 0;
  let skippedAlreadyRecorded = 0;
  let skippedIneligible = 0;

  for (const order of page) {
    const paymentStatus = order.provider_payment_id ? ORDER_STATUS_TO_PAYMENT_STATUS[order.status] : undefined;
    const subjectRef = order.subject_ref ?? order.user_id ?? null;

    if (!order.provider_payment_id || !paymentStatus || !subjectRef) {
      skippedIneligible += 1;
      continue;
    }

    const existingResult = await supabase
      .from('billing_payments')
      .select('id')
      .eq('provider', 'razorpay')
      .eq('provider_mode', order.provider_mode)
      .eq('provider_payment_id', order.provider_payment_id)
      .maybeSingle();

    if (existingResult.error) {
      throw new Error(`Failed to check for an existing billing payment: ${existingResult.error.message}`);
    }

    if (existingResult.data) {
      skippedAlreadyRecorded += 1;
      continue;
    }

    const kind: BillingPaymentKind = order.order_type === 'subscription_checkout' ? 'subscription_first' : 'topup';

    const insertResult = await supabase.from('billing_payments').insert({
      subject_ref: subjectRef,
      user_id: order.user_id,
      provider: 'razorpay',
      provider_mode: order.provider_mode,
      provider_payment_id: order.provider_payment_id,
      provider_order_id: order.provider_order_id,
      billing_order_id: order.id,
      plan_version_id: order.plan_version_id,
      topup_pack_id: order.topup_pack_id,
      kind,
      status: paymentStatus,
      currency_code: order.currency_code,
      net_minor: order.amount_minor,
      tax_minor: 0,
      gross_minor: order.amount_minor,
      tax_breakdown_json: { taxStatus: 'unknown_legacy', backfilled: true },
      purchase_snapshot_json: order.purchase_snapshot_json,
      captured_at: order.created_at,
    });

    if (insertResult.error) {
      if (insertResult.error.code === '23505') {
        // Lost a race with another concurrent backfill run or a live payment write -- already recorded.
        skippedAlreadyRecorded += 1;
        continue;
      }
      throw new Error(`Failed to backfill billing payment for order ${order.id}: ${insertResult.error.message}`);
    }

    inserted += 1;
  }

  return {
    scanned: page.length,
    inserted,
    skippedAlreadyRecorded,
    skippedIneligible,
    hasMore,
    lastOrderId: page.length > 0 ? page[page.length - 1].id : options.afterId ?? null,
  };
}
