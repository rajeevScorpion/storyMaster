import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { enqueueBillingJob, shouldEnqueue } from '@/lib/billing/notifications/queue';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §10, Unit C2, "Sweeps"): the two backstops the
 * daily reconcile route (app/api/batch/reconcile/route.ts) runs after the money-moving reconciles.
 * Every live hook (razorpay-sync.ts, razorpay-webhook.ts, the two cancel actions) enqueues its own
 * job the moment the thing it's about happens -- these sweeps exist only to catch what a hook
 * missed: a payment recorded before this Unit shipped, a hook that threw before reaching its
 * enqueue call, or (for the renewal reminder, which no hook produces at all) a subscription simply
 * coming due. Both are pure best-effort: every enqueue goes through enqueueBillingJob, which never
 * throws and de-dupes on its own key, so re-running either sweep on a row it already covered costs
 * nothing.
 *
 * Fails closed like every other billing query in this codebase (see GOTCHAS.md): a missing table or
 * column -- migration 125 or 135 not yet applied on this database -- comes back as a count of 0,
 * logged, never thrown, so the daily cron keeps working regardless of migration state here.
 */

const RECEIPT_SWEEP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const RECEIPT_SWEEP_LIMIT = 200;
const RECEIPT_SWEEP_STATUSES = ['captured', 'refunded', 'partially_refunded', 'disputed'];

const RENEWAL_REMINDER_MIN_DAYS = 6;
const RENEWAL_REMINDER_MAX_DAYS = 8;

const QUEUE_SWITCH_FLAG_KEYS = ['billing_emails_enabled', 'billing_document_issuing_enabled'];

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * When the queue started accepting jobs: the earliest `updated_at` among the switches that are on.
 * A payment captured before then was never meant to get a job, and sweeping it would number an
 * invoice and email a receipt for a purchase that predates the switch (seen on the dev walk,
 * 2026-09-25). `updated_at` moves on any edit, so this can only narrow the window, never widen it.
 * Null when unreadable, and the sweep then does nothing.
 */
/**
 * Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2): exported so the billing-incidents
 * health cards (app/actions/billing-incidents.ts) can scope their "captured payments with no issued
 * invoice" count to the same switch-on time this sweep already uses -- otherwise every payment
 * captured before the switches went on (the four pre-switch dev payments; every pre-go-live payment
 * on prod) would show as a defect forever. No behaviour change here beyond the export.
 */
export async function loadQueueSwitchedOnSince(admin: AdminClient): Promise<number | null> {
  const result = await admin.from('feature_flags').select('enabled, updated_at').in('flag_key', QUEUE_SWITCH_FLAG_KEYS);
  if (result.error) {
    console.error('[billing sweeps] failed to read when the billing switches went on:', result.error.message);
    return null;
  }
  const times = ((result.data ?? []) as { enabled: boolean; updated_at: string | null }[])
    .filter((row) => row.enabled && row.updated_at)
    .map((row) => Date.parse(row.updated_at as string))
    .filter(Number.isFinite);
  return times.length > 0 ? Math.min(...times) : null;
}

interface SweepPaymentRow {
  id: string;
  subject_ref: string | null;
  user_id: string | null;
  customer_snapshot_json: Record<string, unknown> | null;
}

/**
 * Catches every `billing_payments` row captured in the last 3 days, in a settled status, and
 * enqueues `payment_receipt` for each -- the dedupe key (`payment:<id>`, identical to hooks 1/2's
 * own) makes a payment a live hook already covered a free no-op here. Gated up front on the same
 * `shouldEnqueue()` the queue itself uses, so a disabled billing setup never even runs the query.
 */
export async function sweepMissingReceiptJobs(): Promise<number> {
  if (!(await shouldEnqueue())) return 0;

  const admin = createAdminClient();
  const switchedOnSince = await loadQueueSwitchedOnSince(admin);
  if (switchedOnSince === null) return 0;
  const cutoff = new Date(Math.max(Date.now() - RECEIPT_SWEEP_WINDOW_MS, switchedOnSince)).toISOString();

  const result = await admin
    .from('billing_payments')
    .select('id, subject_ref, user_id, customer_snapshot_json')
    .gte('captured_at', cutoff)
    .in('status', RECEIPT_SWEEP_STATUSES)
    .limit(RECEIPT_SWEEP_LIMIT);

  if (result.error) {
    if (isMissingBillingSchemaError(result.error)) return 0;
    console.error('[billing sweeps] failed to load recent payments for the receipt sweep:', result.error.message);
    return 0;
  }

  const rows = (result.data ?? []) as SweepPaymentRow[];
  let swept = 0;

  for (const row of rows) {
    const subjectRef = row.subject_ref ?? row.user_id;
    if (!subjectRef) continue; // nothing left to key the job to (deleted account, pre-125 row)

    await enqueueBillingJob({
      kind: 'payment_receipt',
      dedupeKey: `payment:${row.id}`,
      subjectRef,
      userId: row.user_id,
      paymentId: row.id,
      payload: {
        billingEmail: (row.customer_snapshot_json as { billingEmail?: string | null } | null)?.billingEmail ?? null,
      },
    });
    swept += 1;
  }

  return swept;
}

interface SweepSubscriptionRow {
  id: string;
  subject_ref: string | null;
  user_id: string | null;
  current_period_end: string;
}

/**
 * Annual subscriptions renewing 6-8 days from now, not already scheduled to cancel, earn a
 * `renewal_reminder`. The wide window (rather than a single "exactly N days out" check) is what
 * makes this safe to run once a day, on Vercel Hobby's one daily cron, without a subscription ever
 * slipping through a day the cron didn't fire -- the dedupe key (`renew:<id>:<current_period_end>`)
 * absorbs the days it then matches on repeatedly.
 */
export async function sweepRenewalReminders(): Promise<number> {
  const admin = createAdminClient();
  const now = Date.now();
  const windowStart = new Date(now + RENEWAL_REMINDER_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + RENEWAL_REMINDER_MAX_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await admin
    .from('billing_subscriptions')
    .select('id, subject_ref, user_id, current_period_end')
    .eq('status', 'active')
    .eq('billing_interval', 'annual')
    .eq('cancel_at_period_end', false)
    .gte('current_period_end', windowStart)
    .lte('current_period_end', windowEnd);

  if (result.error) {
    if (isMissingBillingSchemaError(result.error)) return 0;
    console.error('[billing sweeps] failed to load renewing annual subscriptions:', result.error.message);
    return 0;
  }

  const rows = (result.data ?? []) as SweepSubscriptionRow[];
  let swept = 0;

  for (const row of rows) {
    const subjectRef = row.subject_ref ?? row.user_id;
    if (!subjectRef) continue;

    await enqueueBillingJob({
      kind: 'renewal_reminder',
      dedupeKey: `renew:${row.id}:${row.current_period_end}`,
      subjectRef,
      userId: row.user_id,
      billingSubscriptionId: row.id,
      payload: { renewsAt: row.current_period_end },
    });
    swept += 1;
  }

  return swept;
}
