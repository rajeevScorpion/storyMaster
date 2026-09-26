import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { getRazorpayMode, type RazorpayMode } from '@/lib/billing/razorpay';
import {
  buildWalletActivityItems,
  cursorUpperBoundIso,
  pageWalletActivity,
  sourceFetchLimit,
  type ActivityGrantRow,
  type ActivityPaymentRow,
  type ActivityRefundRow,
  type ActivitySpendRow,
  type ActivitySubscriptionRow,
} from '@/lib/pricing/wallet-activity.shared';
import type { WalletActivityCursor, WalletActivityPage } from '@/lib/types/pricing';

type AdminClient = ReturnType<typeof createAdminClient>;

/** A customer has a handful of payments and subscriptions, so those are read whole and filtered in
 * memory; only grants and spends grow without bound and are paged in the query. */
const SMALL_SOURCE_LIMIT = 200;

/**
 * One page of the wallet's activity, newest first. Grants and spends failing is an error, as before;
 * the billing tables are best-effort, so an un-migrated database still shows coin activity.
 */
export async function loadWalletActivityPage(
  supabase: AdminClient,
  userId: string,
  cursor: WalletActivityCursor | null
): Promise<WalletActivityPage> {
  const limit = sourceFetchLimit(cursor);
  const upperBound = cursorUpperBoundIso(cursor);
  const nowIso = new Date().toISOString();
  const mode = safeRazorpayMode();

  let grantsQuery = supabase
    .from('beat_grants')
    .select('id, source_type, beats_total, beats_remaining, granted_at, expires_at')
    .eq('user_id', userId);
  if (upperBound) grantsQuery = grantsQuery.lt('granted_at', upperBound);

  let expiredQuery = supabase
    .from('beat_grants')
    .select('id, source_type, beats_total, beats_remaining, granted_at, expires_at')
    .eq('user_id', userId)
    .gt('beats_remaining', 0)
    .lte('expires_at', nowIso);
  if (upperBound) expiredQuery = expiredQuery.lt('expires_at', upperBound);

  let spendsQuery = supabase
    .from('beat_usage_events')
    .select('id, action_key, beat_cost, created_at')
    .eq('user_id', userId);
  if (upperBound) spendsQuery = spendsQuery.lt('created_at', upperBound);

  const [grantsResult, expiredResult, spendsResult, payments, subscriptions] = await Promise.all([
    grantsQuery.order('granted_at', { ascending: false }).limit(limit),
    expiredQuery.order('expires_at', { ascending: false }).limit(limit),
    spendsQuery.order('created_at', { ascending: false }).limit(limit),
    loadPayments(supabase, userId, mode),
    loadSubscriptions(supabase, userId, mode),
  ]);

  if (grantsResult.error) throw new Error(`Failed to load wallet grant activity: ${grantsResult.error.message}`);
  if (expiredResult.error) throw new Error(`Failed to load wallet expiry activity: ${expiredResult.error.message}`);
  if (spendsResult.error) throw new Error(`Failed to load wallet spend activity: ${spendsResult.error.message}`);

  const refunds = await loadRefunds(supabase, payments.map((payment) => payment.id), mode);
  const planNamesByVersionId = await resolvePlanNames(supabase, [
    ...payments.map((payment) => payment.plan_version_id),
    ...subscriptions.map((subscription) => subscription.plan_version_id),
  ]);

  const items = buildWalletActivityItems({
    grants: (grantsResult.data ?? []) as ActivityGrantRow[],
    expiredGrants: (expiredResult.data ?? []) as ActivityGrantRow[],
    spends: (spendsResult.data ?? []) as ActivitySpendRow[],
    payments,
    refunds,
    subscriptions,
    planNamesByVersionId,
  });

  return pageWalletActivity(items, cursor);
}

/** No Razorpay keys (local dev without billing): coin activity only, never an error. */
function safeRazorpayMode(): RazorpayMode | null {
  try {
    return getRazorpayMode();
  } catch {
    return null;
  }
}

async function loadPayments(
  supabase: AdminClient,
  userId: string,
  mode: RazorpayMode | null
): Promise<ActivityPaymentRow[]> {
  if (mode === null) return [];
  const result = await supabase
    .from('billing_payments')
    .select('id, kind, status, gross_minor, currency_code, plan_version_id, purchase_snapshot_json, captured_at, created_at')
    .eq('user_id', userId)
    .eq('provider_mode', mode)
    .order('created_at', { ascending: false })
    .limit(SMALL_SOURCE_LIMIT);
  if (result.error) {
    console.error('loadWalletActivityPage: payments unavailable:', result.error.message);
    return [];
  }
  return (result.data ?? []) as ActivityPaymentRow[];
}

async function loadSubscriptions(
  supabase: AdminClient,
  userId: string,
  mode: RazorpayMode | null
): Promise<ActivitySubscriptionRow[]> {
  if (mode === null) return [];
  const result = await supabase
    .from('billing_subscriptions')
    .select('id, plan_version_id, status, cancel_requested_at, current_period_end, first_charge_confirmed_at, updated_at')
    .eq('user_id', userId)
    .eq('provider_mode', mode)
    .order('created_at', { ascending: false })
    .limit(SMALL_SOURCE_LIMIT);
  if (result.error) {
    console.error('loadWalletActivityPage: subscriptions unavailable:', result.error.message);
    return [];
  }
  return (result.data ?? []) as ActivitySubscriptionRow[];
}

async function loadRefunds(supabase: AdminClient, paymentIds: string[], mode: RazorpayMode | null): Promise<ActivityRefundRow[]> {
  if (mode === null || paymentIds.length === 0) return [];
  const result = await supabase
    .from('billing_refunds')
    .select('id, payment_id, amount_minor, currency_code, status, coin_adjustment_json, processed_at, created_at')
    .in('payment_id', paymentIds)
    .eq('provider_mode', mode);
  if (result.error) {
    console.error('loadWalletActivityPage: refunds unavailable:', result.error.message);
    return [];
  }
  return (result.data ?? []) as ActivityRefundRow[];
}

async function resolvePlanNames(supabase: AdminClient, versionIds: (string | null)[]): Promise<Record<string, string>> {
  const ids = [...new Set(versionIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return {};

  const versions = await supabase.from('pricing_plan_versions').select('id, plan_id').in('id', ids);
  if (versions.error) return {};
  const versionRows = (versions.data ?? []) as { id: string; plan_id: string }[];
  const planIds = [...new Set(versionRows.map((row) => row.plan_id))];
  if (planIds.length === 0) return {};

  const plans = await supabase.from('pricing_plans').select('id, name').in('id', planIds);
  if (plans.error) return {};
  const nameByPlanId = new Map(((plans.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));

  const out: Record<string, string> = {};
  for (const row of versionRows) {
    const name = nameByPlanId.get(row.plan_id);
    if (name) out[row.id] = name;
  }
  return out;
}
