'use server';

import type { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { RazorpayConfigError, getRazorpayMode, type RazorpayMode } from '@/lib/billing/razorpay';
import {
  MIN_AGE_MS,
  CHECKOUT_MAX_AGE_MS,
  TOPUP_MAX_AGE_MS,
  STUCK_SUBSCRIPTION_CHECKOUT_STATUSES,
  STUCK_TOPUP_STATUSES,
  RECONCILABLE_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_CHECKOUT_ORDER_TYPE,
  TOPUP_CHECKOUT_ORDER_TYPE,
  webhookIncidentOrFilter,
  subscriptionBoundaryOrFilter,
} from '@/lib/billing/billing-incidents.shared';

/**
 * Payments Phase 4, Unit F (docs/payments/phase-4-plan.md §9 "Unit F"): read-only admin surface for
 * the incident dashboard at /admin/pricing/billing-incidents. Every query here reuses the exact
 * thresholds and filters lib/billing/razorpay-reconcile.ts's daily cron enforces (from
 * lib/billing/billing-incidents.shared.ts) so the dashboard's counts can never drift from what the
 * cron actually attempts to fix.
 *
 * No mutation, no provider call, no new schema. Migration 124's columns on billing_webhook_events
 * (attempt_count, last_attempt_at, outcome) are applied on dev but not production -- every section
 * degrades to `status: 'unavailable'` on a missing-schema error rather than throwing, via the same
 * structural error-code classifier lib/billing/ledger.ts uses (schema-availability.shared.ts).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BillingIncidentSection<TRow> {
  status: 'ok' | 'unavailable';
  totalCount: number;
  rows: TRow[];
}

export interface FailedWebhookIncidentRow {
  id: string;
  eventType: string;
  providerEventId: string;
  status: string;
  attemptCount: number;
  receivedAt: string;
  lastAttemptAt: string | null;
  outcome: string | null;
  errorMessage: string | null;
  relatedUserId: string | null;
  relatedSubscriptionId: string | null;
}

export interface StuckSubscriptionCheckoutRow {
  id: string;
  userId: string | null;
  status: string;
  providerCheckoutSessionId: string | null;
  planVersionId: string | null;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
}

export interface SubscriptionPastBoundaryRow {
  id: string;
  userId: string | null;
  status: string;
  providerSubscriptionId: string;
  currentPeriodEnd: string | null;
  firstChargeConfirmedAt: string | null;
  lastWebhookAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface StuckTopupRow {
  id: string;
  userId: string | null;
  status: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
}

export interface BillingIncidentsDashboardData {
  /** The clock every section's age/threshold math was computed against. */
  generatedAtMs: number;
  failedWebhooks: BillingIncidentSection<FailedWebhookIncidentRow>;
  stuckSubscriptionCheckouts: BillingIncidentSection<StuckSubscriptionCheckoutRow>;
  subscriptionsPastBoundary: BillingIncidentSection<SubscriptionPastBoundaryRow>;
  stuckTopups: BillingIncidentSection<StuckTopupRow>;
}

const DASHBOARD_ROW_LIMIT = 100;

export async function getBillingIncidentsDashboard(): Promise<BillingIncidentsDashboardData> {
  await verifyAdmin();
  const supabase = createAdminClient();
  const generatedAtMs = Date.now();

  // The three order/subscription sections are scoped to a Razorpay mode (test/live), exactly like
  // reconcileSubscriptionCheckouts / reconcileSubscriptions / reconcileTopups. If the provider isn't
  // configured on this environment, those sections degrade the same way a schema gap would --
  // failed webhooks don't depend on mode and still render.
  let mode: RazorpayMode | null = null;
  try {
    mode = getRazorpayMode();
  } catch (err) {
    if (!(err instanceof RazorpayConfigError)) throw err;
  }

  const [failedWebhooks, stuckSubscriptionCheckouts, subscriptionsPastBoundary, stuckTopups] = await Promise.all([
    loadFailedWebhooks(supabase, generatedAtMs),
    mode
      ? loadStuckSubscriptionCheckouts(supabase, mode, generatedAtMs)
      : Promise.resolve(unavailableSection<StuckSubscriptionCheckoutRow>()),
    mode
      ? loadSubscriptionsPastBoundary(supabase, mode, generatedAtMs)
      : Promise.resolve(unavailableSection<SubscriptionPastBoundaryRow>()),
    mode ? loadStuckTopups(supabase, mode, generatedAtMs) : Promise.resolve(unavailableSection<StuckTopupRow>()),
  ]);

  return {
    generatedAtMs,
    failedWebhooks,
    stuckSubscriptionCheckouts,
    subscriptionsPastBoundary,
    stuckTopups,
  };
}

function unavailableSection<TRow>(): BillingIncidentSection<TRow> {
  return { status: 'unavailable', totalCount: 0, rows: [] };
}

async function loadFailedWebhooks(
  supabase: AdminClient,
  nowMs: number
): Promise<BillingIncidentSection<FailedWebhookIncidentRow>> {
  const result = await supabase
    .from('billing_webhook_events')
    .select(
      'id, event_type, provider_event_id, status, attempt_count, received_at, last_attempt_at, outcome, error_message, related_user_id, related_subscription_id',
      { count: 'exact' }
    )
    .eq('provider', 'razorpay')
    .or(webhookIncidentOrFilter(nowMs))
    .order('received_at', { ascending: false })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection();
  throwIfQueryFailed(result.error, 'Failed to load failed-webhook incidents');

  const rows: FailedWebhookIncidentRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    eventType: row.event_type as string,
    providerEventId: row.provider_event_id as string,
    status: row.status as string,
    attemptCount: row.attempt_count as number,
    receivedAt: row.received_at as string,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    outcome: (row.outcome as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    relatedUserId: (row.related_user_id as string | null) ?? null,
    relatedSubscriptionId: (row.related_subscription_id as string | null) ?? null,
  }));

  return { status: 'ok', totalCount: result.count ?? rows.length, rows };
}

async function loadStuckSubscriptionCheckouts(
  supabase: AdminClient,
  mode: RazorpayMode,
  nowMs: number
): Promise<BillingIncidentSection<StuckSubscriptionCheckoutRow>> {
  const result = await supabase
    .from('billing_orders')
    .select(
      'id, user_id, status, provider_checkout_session_id, plan_version_id, amount_minor, currency_code, created_at',
      { count: 'exact' }
    )
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('order_type', SUBSCRIPTION_CHECKOUT_ORDER_TYPE)
    .in('status', STUCK_SUBSCRIPTION_CHECKOUT_STATUSES)
    .not('provider_checkout_session_id', 'is', null)
    .lte('created_at', new Date(nowMs - MIN_AGE_MS).toISOString())
    .gte('created_at', new Date(nowMs - CHECKOUT_MAX_AGE_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection();
  throwIfQueryFailed(result.error, 'Failed to load stuck subscription checkout incidents');

  const rows: StuckSubscriptionCheckoutRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    status: row.status as string,
    providerCheckoutSessionId: (row.provider_checkout_session_id as string | null) ?? null,
    planVersionId: (row.plan_version_id as string | null) ?? null,
    amountMinor: row.amount_minor as number,
    currencyCode: row.currency_code as string,
    createdAt: row.created_at as string,
  }));

  return { status: 'ok', totalCount: result.count ?? rows.length, rows };
}

async function loadSubscriptionsPastBoundary(
  supabase: AdminClient,
  mode: RazorpayMode,
  nowMs: number
): Promise<BillingIncidentSection<SubscriptionPastBoundaryRow>> {
  const result = await supabase
    .from('billing_subscriptions')
    .select(
      'id, user_id, status, provider_subscription_id, current_period_end, first_charge_confirmed_at, last_webhook_at, cancel_at_period_end',
      { count: 'exact' }
    )
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .in('status', RECONCILABLE_SUBSCRIPTION_STATUSES)
    .or(subscriptionBoundaryOrFilter(nowMs))
    .order('updated_at', { ascending: false })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection();
  throwIfQueryFailed(result.error, 'Failed to load subscriptions past their boundary');

  const rows: SubscriptionPastBoundaryRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    status: row.status as string,
    providerSubscriptionId: row.provider_subscription_id as string,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    firstChargeConfirmedAt: (row.first_charge_confirmed_at as string | null) ?? null,
    lastWebhookAt: (row.last_webhook_at as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  }));

  return { status: 'ok', totalCount: result.count ?? rows.length, rows };
}

async function loadStuckTopups(
  supabase: AdminClient,
  mode: RazorpayMode,
  nowMs: number
): Promise<BillingIncidentSection<StuckTopupRow>> {
  const result = await supabase
    .from('billing_orders')
    .select('id, user_id, status, provider_order_id, provider_payment_id, amount_minor, currency_code, created_at', {
      count: 'exact',
    })
    .eq('provider', 'razorpay')
    .eq('provider_mode', mode)
    .eq('order_type', TOPUP_CHECKOUT_ORDER_TYPE)
    .in('status', STUCK_TOPUP_STATUSES)
    .gte('created_at', new Date(nowMs - TOPUP_MAX_AGE_MS).toISOString())
    .lte('created_at', new Date(nowMs - MIN_AGE_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection();
  throwIfQueryFailed(result.error, 'Failed to load stuck top-up incidents');

  const rows: StuckTopupRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    status: row.status as string,
    providerOrderId: (row.provider_order_id as string | null) ?? null,
    providerPaymentId: (row.provider_payment_id as string | null) ?? null,
    amountMinor: row.amount_minor as number,
    currencyCode: row.currency_code as string,
    createdAt: row.created_at as string,
  }));

  return { status: 'ok', totalCount: result.count ?? rows.length, rows };
}

function throwIfQueryFailed(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
