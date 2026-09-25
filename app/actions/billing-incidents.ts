'use server';

import type { PostgrestError } from '@supabase/supabase-js';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { RazorpayConfigError, getRazorpayMode, type RazorpayMode } from '@/lib/billing/razorpay';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { loadQueueSwitchedOnSince } from '@/lib/billing/notifications/sweeps';
import {
  MIN_AGE_MS,
  CHECKOUT_MAX_AGE_MS,
  TOPUP_MAX_AGE_MS,
  PENDING_BILLING_JOB_STALE_MS,
  PENDING_REFUND_STALE_MS,
  STUCK_SUBSCRIPTION_CHECKOUT_STATUSES,
  STUCK_TOPUP_STATUSES,
  RECONCILABLE_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_CHECKOUT_ORDER_TYPE,
  TOPUP_CHECKOUT_ORDER_TYPE,
  webhookIncidentOrFilter,
  subscriptionBoundaryOrFilter,
  paymentIdsMissingInvoice,
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

/**
 * Why a section could not be read. The two causes need different words on the page: a support
 * person told "the migration has not run here" when the real problem is an unset Razorpay key
 * would go looking in the wrong place entirely.
 */
export type BillingIncidentUnavailableReason =
  | 'schema'
  | 'provider_config'
  /** Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2): billing_document_issuing_enabled
   * is off, so "no issued invoice" would be every captured payment -- a wall of false positives, not
   * a signal. The card reads as unavailable-for-a-reason rather than a scary count. */
  | 'issuing_disabled'
  /** loadQueueSwitchedOnSince (lib/billing/notifications/sweeps.ts) couldn't determine when the
   * switches went on, even though billing_document_issuing_enabled itself read as on -- a
   * feature_flags read glitch, not a missing migration. Scoping the invoice check with no reliable
   * start time would either replay every pre-switch payment as a defect or silently use no floor at
   * all; neither is safe to show as a number. */
  | 'switch_unreadable';

export interface BillingIncidentSection<TRow> {
  status: 'ok' | 'unavailable';
  /** Set only when `status` is 'unavailable'. */
  unavailableReason: BillingIncidentUnavailableReason | null;
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

// ── Phase 6 health (Payments Phase 7, docs/payments/phase-7-plan.md §8, Unit B2) ───────────────────

export interface FailedBillingJobRow {
  id: string;
  kind: string;
  dedupeKey: string;
  subjectRef: string;
  userId: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StalePendingBillingJobRow {
  id: string;
  kind: string;
  subjectRef: string;
  userId: string | null;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
}

export interface StalePendingRefundRow {
  id: string;
  paymentId: string | null;
  subjectRef: string | null;
  amountMinor: number;
  currencyCode: string;
  initiatedBy: string | null;
  createdAt: string;
}

export interface PaymentMissingInvoiceRow {
  id: string;
  subjectRef: string;
  userId: string | null;
  amountMinor: number;
  currencyCode: string;
  capturedAt: string;
}

export interface BillingIncidentsDashboardData {
  /** The clock every section's age/threshold math was computed against. */
  generatedAtMs: number;
  failedWebhooks: BillingIncidentSection<FailedWebhookIncidentRow>;
  stuckSubscriptionCheckouts: BillingIncidentSection<StuckSubscriptionCheckoutRow>;
  subscriptionsPastBoundary: BillingIncidentSection<SubscriptionPastBoundaryRow>;
  stuckTopups: BillingIncidentSection<StuckTopupRow>;
  failedBillingJobs: BillingIncidentSection<FailedBillingJobRow>;
  stalePendingBillingJobs: BillingIncidentSection<StalePendingBillingJobRow>;
  stalePendingRefunds: BillingIncidentSection<StalePendingRefundRow>;
  paymentsMissingInvoice: BillingIncidentSection<PaymentMissingInvoiceRow>;
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

  const [
    failedWebhooks,
    stuckSubscriptionCheckouts,
    subscriptionsPastBoundary,
    stuckTopups,
    failedBillingJobs,
    stalePendingBillingJobs,
    stalePendingRefunds,
    paymentsMissingInvoice,
  ] = await Promise.all([
    loadFailedWebhooks(supabase, generatedAtMs),
    mode
      ? loadStuckSubscriptionCheckouts(supabase, mode, generatedAtMs)
      : Promise.resolve(unavailableSection<StuckSubscriptionCheckoutRow>('provider_config')),
    mode
      ? loadSubscriptionsPastBoundary(supabase, mode, generatedAtMs)
      : Promise.resolve(unavailableSection<SubscriptionPastBoundaryRow>('provider_config')),
    mode ? loadStuckTopups(supabase, mode, generatedAtMs) : Promise.resolve(unavailableSection<StuckTopupRow>('provider_config')),
    loadFailedBillingJobs(supabase),
    loadStalePendingBillingJobs(supabase, generatedAtMs),
    loadStalePendingRefunds(supabase, generatedAtMs),
    loadPaymentsMissingInvoice(supabase),
  ]);

  return {
    generatedAtMs,
    failedWebhooks,
    stuckSubscriptionCheckouts,
    subscriptionsPastBoundary,
    stuckTopups,
    failedBillingJobs,
    stalePendingBillingJobs,
    stalePendingRefunds,
    paymentsMissingInvoice,
  };
}

function unavailableSection<TRow>(
  reason: BillingIncidentUnavailableReason
): BillingIncidentSection<TRow> {
  return { status: 'unavailable', unavailableReason: reason, totalCount: 0, rows: [] };
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

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
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

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
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

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
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

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
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

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
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

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
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

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
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

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
}

// ── Phase 6 health (Payments Phase 7, docs/payments/phase-7-plan.md §8, Unit B2) ───────────────────
// Reads the notification-jobs and document tables migration 135 added. Not scoped to a Razorpay
// mode: billing_notification_jobs has no provider_mode column at all (it can point at a test- or
// live-mode payment alike), and the other two read every mode too -- a stuck job or a payment with
// no invoice matters the same way regardless of which Razorpay mode produced it.

async function loadFailedBillingJobs(
  supabase: AdminClient
): Promise<BillingIncidentSection<FailedBillingJobRow>> {
  const result = await supabase
    .from('billing_notification_jobs')
    .select(
      'id, kind, dedupe_key, subject_ref, user_id, attempt_count, max_attempts, last_error, created_at, updated_at',
      { count: 'exact' }
    )
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
  throwIfQueryFailed(result.error, 'Failed to load failed billing jobs');

  const rows: FailedBillingJobRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    kind: row.kind as string,
    dedupeKey: row.dedupe_key as string,
    subjectRef: row.subject_ref as string,
    userId: (row.user_id as string | null) ?? null,
    attemptCount: row.attempt_count as number,
    maxAttempts: row.max_attempts as number,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
}

async function loadStalePendingBillingJobs(
  supabase: AdminClient,
  nowMs: number
): Promise<BillingIncidentSection<StalePendingBillingJobRow>> {
  const cutoffIso = new Date(nowMs - PENDING_BILLING_JOB_STALE_MS).toISOString();
  const result = await supabase
    .from('billing_notification_jobs')
    .select('id, kind, subject_ref, user_id, attempt_count, next_attempt_at, created_at', { count: 'exact' })
    .eq('status', 'pending')
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
  throwIfQueryFailed(result.error, 'Failed to load stale pending billing jobs');

  const rows: StalePendingBillingJobRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    kind: row.kind as string,
    subjectRef: row.subject_ref as string,
    userId: (row.user_id as string | null) ?? null,
    attemptCount: row.attempt_count as number,
    nextAttemptAt: row.next_attempt_at as string,
    createdAt: row.created_at as string,
  }));

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
}

async function loadStalePendingRefunds(
  supabase: AdminClient,
  nowMs: number
): Promise<BillingIncidentSection<StalePendingRefundRow>> {
  const cutoffIso = new Date(nowMs - PENDING_REFUND_STALE_MS).toISOString();
  const result = await supabase
    .from('billing_refunds')
    .select('id, payment_id, subject_ref, amount_minor, currency_code, initiated_by, created_at', { count: 'exact' })
    .eq('status', 'pending')
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(result.error)) return unavailableSection('schema');
  throwIfQueryFailed(result.error, 'Failed to load stale pending refunds');

  const rows: StalePendingRefundRow[] = (result.data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    paymentId: (row.payment_id as string | null) ?? null,
    subjectRef: (row.subject_ref as string | null) ?? null,
    amountMinor: row.amount_minor as number,
    currencyCode: row.currency_code as string,
    initiatedBy: (row.initiated_by as string | null) ?? null,
    createdAt: row.created_at as string,
  }));

  return { status: 'ok', unavailableReason: null, totalCount: result.count ?? rows.length, rows };
}

/**
 * "Captured payments with no issued invoice" -- PostgREST has no `NOT EXISTS`, so this is two
 * queries and a client-side set difference (paymentIdsMissingInvoice), not one filtered query like
 * every other section on this page. Reads "issuing off" rather than a reassuring 0 while
 * billing_document_issuing_enabled is off (every captured payment would otherwise show as a
 * defect), and is scoped no further back than loadQueueSwitchedOnSince's answer so a payment
 * captured before the switches ever went on is never counted at all (plan §8: "the four pre-switch
 * dev payments, and every pre-go-live payment on prod, show as defects forever" otherwise).
 *
 * Bounded by the same DASHBOARD_ROW_LIMIT as every other section, so on a database with more than
 * 100 captured payments since switch-on, this undercounts rather than scanning the whole table --
 * acceptable at this app's current volume, and still strictly on the side of under-alarming rather
 * than over-alarming.
 */
async function loadPaymentsMissingInvoice(
  supabase: AdminClient
): Promise<BillingIncidentSection<PaymentMissingInvoiceRow>> {
  const issuingEnabled = await getFeatureFlag('billing_document_issuing_enabled', false);
  if (!issuingEnabled) {
    return unavailableSection('issuing_disabled');
  }

  const switchedOnSinceMs = await loadQueueSwitchedOnSince(supabase);
  if (switchedOnSinceMs === null) {
    return unavailableSection('switch_unreadable');
  }

  const cutoffIso = new Date(switchedOnSinceMs).toISOString();
  const paymentsResult = await supabase
    .from('billing_payments')
    .select('id, subject_ref, user_id, gross_minor, currency_code, captured_at')
    .eq('status', 'captured')
    .gte('captured_at', cutoffIso)
    .order('captured_at', { ascending: false })
    .limit(DASHBOARD_ROW_LIMIT);

  if (isMissingBillingSchemaError(paymentsResult.error)) return unavailableSection('schema');
  throwIfQueryFailed(paymentsResult.error, 'Failed to load captured payments for the invoice-coverage check');

  const payments = (paymentsResult.data ?? []) as {
    id: string;
    subject_ref: string;
    user_id: string | null;
    gross_minor: number;
    currency_code: string;
    captured_at: string;
  }[];

  if (payments.length === 0) {
    return { status: 'ok', unavailableReason: null, totalCount: 0, rows: [] };
  }

  const paymentIds = payments.map((payment) => payment.id);
  const documentsResult = await supabase
    .from('billing_documents')
    .select('payment_id')
    .eq('document_type', 'tax_invoice')
    .eq('status', 'issued')
    .in('payment_id', paymentIds);

  if (isMissingBillingSchemaError(documentsResult.error)) return unavailableSection('schema');
  throwIfQueryFailed(documentsResult.error, 'Failed to load issued invoices for the invoice-coverage check');

  const issuedPaymentIds = ((documentsResult.data ?? []) as { payment_id: string | null }[])
    .map((row) => row.payment_id)
    .filter((id): id is string => Boolean(id));

  const missingIds = new Set(paymentIdsMissingInvoice(paymentIds, issuedPaymentIds));
  const rows: PaymentMissingInvoiceRow[] = payments
    .filter((payment) => missingIds.has(payment.id))
    .map((payment) => ({
      id: payment.id,
      subjectRef: payment.subject_ref,
      userId: payment.user_id,
      amountMinor: payment.gross_minor,
      currencyCode: payment.currency_code,
      capturedAt: payment.captured_at,
    }));

  return { status: 'ok', unavailableReason: null, totalCount: rows.length, rows };
}

function throwIfQueryFailed(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}
