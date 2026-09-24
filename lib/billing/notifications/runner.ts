import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { BILLING_JOB_PROCESSORS, type BillingJobProcessorContext } from '@/lib/billing/notifications/processors';
import {
  PermanentBillingJobError,
  type BillingNotificationJobRow,
  type ProcessorResult,
} from '@/lib/billing/notifications/types.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §2 "Retries", §4 Unit C1): the billing job runner.
 * Modelled closely on lib/media/image-job-runner.ts -- bearer-authed route calls this, a stale-claim
 * reclaim runs first, then up to 20 ready rows are claimed one at a time with a conditional update so
 * two overlapping worker runs can never process the same row twice.
 *
 * Unlike the image job runner's time-budgeted while-loop (image generation calls are individually
 * slow), a billing job is a database read plus at most one Resend call, so this claims one bounded
 * batch and processes all of it in a single pass -- comfortably inside the route's 60s budget -- then
 * re-kicks itself only if more rows were already due by the time this pass finished.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const STALE_CLAIM_MINUTES = 10;
const CLAIM_BATCH_SIZE = 20;

function baseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/** Re-kick the worker route for remaining jobs. MUST be awaited -- see image-job-runner.ts's
 *  rekickWorker for the Vercel-freeze rationale this mirrors exactly. */
async function rekickBillingWorker(): Promise<void> {
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
  }).catch((error) => console.error('Failed to re-kick billing job worker:', error));
}

/** Permanent for the process, like every other missing-schema latch in this codebase (a hand-applied
 * migration needs a restart to be noticed). */
let billingJobsSchemaUnavailable = false;

export function resetBillingJobsSchemaLatchForTests(): void {
  billingJobsSchemaUnavailable = false;
}

/** Reclaims jobs whose worker died mid-run (crashed instance, killed function) so they become
 * claimable again instead of sitting in `processing` forever. A job that has already used all its
 * attempts is failed instead: every claim counts an attempt, so a job that kills its worker each time
 * would otherwise be reclaimed and re-run forever without ever reaching the retry-or-fail path. */
export async function reclaimStaleBillingJobs(admin: AdminClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('billing_notification_jobs')
    .select('id, attempt_count, max_attempts')
    .eq('status', 'processing')
    .lt('claimed_at', cutoff);

  if (error) {
    if (isMissingBillingSchemaError(error)) {
      billingJobsSchemaUnavailable = true;
      return 0;
    }
    throw new Error(`Failed to reclaim stale billing jobs: ${error.message}`);
  }

  const stale = (data ?? []) as Array<{ id: string; attempt_count: number; max_attempts: number }>;
  let reclaimed = 0;
  for (const row of stale) {
    const exhausted = row.attempt_count >= row.max_attempts;
    const update = exhausted
      ? { status: 'failed', completed_at: new Date().toISOString(), last_error: 'The worker stopped mid-run on every attempt.' }
      : { status: 'pending' };
    const result = await admin
      .from('billing_notification_jobs')
      .update(update)
      .eq('id', row.id)
      .eq('status', 'processing');
    if (!result.error && !exhausted) reclaimed += 1;
  }
  return reclaimed;
}

interface ClaimCandidateRow {
  id: string;
  attempt_count: number;
}

/** Lists up to `limit` ready rows, then wins each one with its own conditional
 * `pending -> processing` update (mirrors image-job-runner.ts's claimJob) so a second, overlapping
 * worker invocation can never claim the same row -- it just gets fewer rows back. */
async function claimReadyBillingJobs(admin: AdminClient, limit: number): Promise<BillingNotificationJobRow[]> {
  const nowIso = new Date().toISOString();
  const listResult = await admin
    .from('billing_notification_jobs')
    .select('id, attempt_count')
    .eq('status', 'pending')
    .lte('next_attempt_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (listResult.error) {
    if (isMissingBillingSchemaError(listResult.error)) {
      billingJobsSchemaUnavailable = true;
      return [];
    }
    throw new Error(`Failed to list ready billing jobs: ${listResult.error.message}`);
  }

  const candidates = (listResult.data ?? []) as ClaimCandidateRow[];
  const claimed: BillingNotificationJobRow[] = [];

  for (const candidate of candidates) {
    const claimResult = await admin
      .from('billing_notification_jobs')
      .update({ status: 'processing', claimed_at: nowIso, attempt_count: candidate.attempt_count + 1 })
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .select('*');

    if (claimResult.error) {
      throw new Error(`Failed to claim billing job ${candidate.id}: ${claimResult.error.message}`);
    }
    const row = (claimResult.data as BillingNotificationJobRow[] | null)?.[0];
    if (row) claimed.push(row);
  }

  return claimed;
}

function truncateError(message: string): string {
  // Never store a raw provider payload -- last_error is read by admins (plan §4 Unit D), not meant to
  // carry whatever a failed HTTP body happened to contain.
  return message.length > 500 ? message.slice(0, 500) : message;
}

async function markJobDone(admin: AdminClient, job: BillingNotificationJobRow, result: ProcessorResult): Promise<void> {
  const update: Record<string, unknown> = {
    status: 'done',
    completed_at: new Date().toISOString(),
    last_error: null,
  };
  if (result.documentId !== undefined) update.document_id = result.documentId;
  if (result.documentOutcome !== undefined) update.document_outcome = result.documentOutcome;
  if (result.emailStatus !== undefined) update.email_status = result.emailStatus;
  if (result.providerMessageId !== undefined) update.provider_message_id = result.providerMessageId;

  await admin.from('billing_notification_jobs').update(update).eq('id', job.id).eq('status', 'processing');
}

export interface RetryDecisionInput {
  /** The job's attempt_count AFTER the claim's increment -- i.e. counting the attempt that just
   * failed. */
  attemptCount: number;
  maxAttempts: number;
  /** True when the failure was a PermanentBillingJobError -- skips straight to `fail` regardless of
   * how many attempts remain. */
  permanent: boolean;
  now: Date;
}

export type RetryDecision =
  | { outcome: 'retry'; nextAttemptAt: Date }
  | { outcome: 'fail' };

/**
 * The pure retry/backoff/fail decision (plan §2: "Backoff is 2, 4, 8 and 16 minutes, 5 attempts in
 * all"). `attemptCount` already includes the attempt that just failed, so backoff minutes are
 * `2^attemptCount`: 2, 4, 8, 16 for attempts 1-4, and attempt 5 (== maxAttempts) fails outright rather
 * than scheduling a fifth retry. Extracted from runBillingJobsOnce so the backoff schedule and the
 * permanent-error short-circuit are each exercised directly, without a database in the loop.
 */
export function decideRetryOutcome(input: RetryDecisionInput): RetryDecision {
  if (input.permanent || input.attemptCount >= input.maxAttempts) {
    return { outcome: 'fail' };
  }
  const backoffMinutes = 2 ** input.attemptCount;
  return { outcome: 'retry', nextAttemptAt: new Date(input.now.getTime() + backoffMinutes * 60_000) };
}

async function retryOrFailJob(
  admin: AdminClient,
  job: BillingNotificationJobRow,
  message: string,
  permanent: boolean
): Promise<'retried' | 'failed'> {
  const decision = decideRetryOutcome({
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    permanent,
    now: new Date(),
  });

  if (decision.outcome === 'retry') {
    await admin
      .from('billing_notification_jobs')
      .update({
        status: 'pending',
        next_attempt_at: decision.nextAttemptAt.toISOString(),
        last_error: truncateError(message),
      })
      .eq('id', job.id)
      .eq('status', 'processing');
    return 'retried';
  }

  await admin
    .from('billing_notification_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      last_error: truncateError(message),
    })
    .eq('id', job.id)
    .eq('status', 'processing');
  return 'failed';
}

export interface RunBillingJobsResult {
  processed: number;
  failed: number;
  remaining: number;
}

/**
 * Claims and processes one bounded batch of ready billing_notification_jobs rows. Called from
 * app/api/billing/jobs/run/route.ts's after() block, and from the daily reconcile route as a backstop
 * (plan §2). Safe to run concurrently with itself -- every claim is atomic.
 */
export async function runBillingJobsOnce(): Promise<RunBillingJobsResult> {
  const admin = createAdminClient();
  if (billingJobsSchemaUnavailable) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  await reclaimStaleBillingJobs(admin).catch(() => 0);
  if (billingJobsSchemaUnavailable) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  const jobs = await claimReadyBillingJobs(admin, CLAIM_BATCH_SIZE).catch((error) => {
    console.error('Failed to claim billing jobs:', error instanceof Error ? error.message : error);
    return [] as BillingNotificationJobRow[];
  });

  if (billingJobsSchemaUnavailable || jobs.length === 0) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  const ctx: BillingJobProcessorContext = { admin, appUrl: baseUrl() };
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const processor = BILLING_JOB_PROCESSORS[job.kind];
    try {
      const result = await processor(job, ctx);
      await markJobDone(admin, job, result);
      processed += 1;
    } catch (error) {
      const permanent = error instanceof PermanentBillingJobError;
      const message = error instanceof Error ? error.message : 'Billing job failed.';
      console.error(
        `Billing job ${job.id} (${job.kind}) failed:`,
        error instanceof Error ? error.stack ?? message : error
      );
      const outcome = await retryOrFailJob(admin, job, message, permanent);
      if (outcome === 'failed') failed += 1;
    }
  }

  const { count } = await admin
    .from('billing_notification_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString());
  const remaining = count ?? 0;

  if (remaining > 0) {
    await rekickBillingWorker();
  }

  return { processed, failed, remaining };
}
