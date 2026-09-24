import 'server-only';

import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import type { JobKind } from '@/lib/billing/notifications/types.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §2 "A durable job queue, not inline side effects",
 * §4 Unit C1): the one entry point every hook (razorpay-sync, the webhook, admin actions, the
 * reconcile -- all Unit C2) will call to record a billing notification. Deliberately the only place
 * that writes to `billing_notification_jobs`: a hook enqueues and moves on, and never learns whether
 * the row was new, a duplicate, or silently skipped -- this must be exactly as safe to call from the
 * money path as a `console.log`.
 */

const BILLING_EMAILS_FLAG_KEY = 'billing_emails_enabled';
const BILLING_DOCUMENT_ISSUING_FLAG_KEY = 'billing_document_issuing_enabled';

/** Permanent for the process, like every other missing-schema latch in this codebase. */
let billingJobsSchemaUnavailable = false;

export function resetBillingJobsQueueSchemaLatchForTests(): void {
  billingJobsSchemaUnavailable = false;
}

/**
 * Either switch justifies enqueuing (plan §6): with issuing on but emails off, a job still needs to
 * run so its document gets numbered, and the email side just records `skipped_disabled`. With both
 * off, nothing is enqueued at all -- turning a switch on later must never replay a backlog of old
 * events. Fails closed like every other flag read in this codebase: a `feature_flags` read error
 * means "behave as if off", not "assume on".
 */
export async function shouldEnqueue(): Promise<boolean> {
  const [emailsEnabled, issuingEnabled] = await Promise.all([
    getFeatureFlag(BILLING_EMAILS_FLAG_KEY, false),
    getFeatureFlag(BILLING_DOCUMENT_ISSUING_FLAG_KEY, false),
  ]);
  return emailsEnabled || issuingEnabled;
}

function baseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

async function fetchKick(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  await fetch(`${baseUrl()}/api/billing/jobs/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to kick billing job worker:', error));
}

/**
 * Fires the worker without making the caller wait for it. Wrapped in `after()` when this is running
 * inside a request (a route handler or a server action) so the fetch survives past the response being
 * sent -- an un-awaited fetch outside `after()` can be cut short the moment a Vercel serverless
 * instance freezes (see lib/media/image-job-runner.ts's rekickWorker comment for the same rationale).
 * `after()` throws when there is no request scope to hang the callback off (e.g. a script, or a test
 * importing this module directly); the fallback there is a bare fire-and-forget call, which is
 * best-effort only -- the daily reconcile and the next real event both already exist as backstops
 * (plan §2), so a dropped kick here is never the only way a job gets picked up.
 */
export function kickBillingJobs(): void {
  try {
    after(fetchKick);
  } catch {
    void fetchKick();
  }
}

export interface EnqueueBillingJobInput {
  kind: JobKind;
  /** Unique per plan §2's table -- e.g. `payment:<billing_payments.id>`. The insert relies entirely on
   * this for exactly-once: ON CONFLICT (dedupe_key) DO NOTHING. */
  dedupeKey: string;
  subjectRef: string;
  userId: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  billingSubscriptionId?: string | null;
  documentId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Enqueues a billing notification job, or does nothing at all. Every failure mode -- both switches
 * off, migration 135 not yet applied, a genuine insert error -- is logged and swallowed here so this
 * can never be the reason a payment, refund or webhook handler fails. Duplicate calls with the same
 * `dedupeKey` (a redelivered webhook, a re-verified payment) are silently absorbed by the database's
 * own unique constraint, not by any check-then-insert race here.
 */
export async function enqueueBillingJob(input: EnqueueBillingJobInput): Promise<void> {
  try {
    if (billingJobsSchemaUnavailable) return;
    if (!(await shouldEnqueue())) return;

    const admin = createAdminClient();
    const { error } = await admin
      .from('billing_notification_jobs')
      .upsert(
        {
          dedupe_key: input.dedupeKey,
          kind: input.kind,
          subject_ref: input.subjectRef,
          user_id: input.userId,
          payment_id: input.paymentId ?? null,
          refund_id: input.refundId ?? null,
          billing_subscription_id: input.billingSubscriptionId ?? null,
          document_id: input.documentId ?? null,
          payload_json: input.payload ?? {},
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true }
      );

    if (error) {
      if (isMissingBillingSchemaError(error)) {
        billingJobsSchemaUnavailable = true;
        return;
      }
      console.error('Failed to enqueue billing job:', {
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        message: error.message,
      });
      return;
    }

    kickBillingJobs();
  } catch (error) {
    console.error('enqueueBillingJob threw unexpectedly (swallowed):', error instanceof Error ? error.message : error);
  }
}
