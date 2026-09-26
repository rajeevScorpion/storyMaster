'use server';

/**
 * Payments Phase 6, Unit D (docs/payments/phase-6-plan.md §10 "D -- admin support"): the two admin
 * actions over billing_notification_jobs an admin can take from the user detail page -- retrying a
 * job that failed all its attempts, and resending an issued document's email on demand. Neither
 * moves money (contrast app/actions/admin-billing-actions.ts's refund/cancel), so neither is gated
 * behind billing_admin_actions_enabled -- the plan says so explicitly. Both re-verify admin, write a
 * best-effort admin_user_audit_events row (see writeAuditBestEffort -- an audit-row failure must
 * never turn a successful retry/resend into a reported failure, the same reasoning
 * admin-billing-actions.ts's auditResyncBestEffort already uses), and kick the worker so the effect
 * is visible without waiting for the next daily reconcile.
 *
 * The two audit action types need migration 136. Where it has not run, the audit insert fails with
 * 23514 and is logged, and the retry/resend itself still succeeds.
 */

import { revalidatePath } from 'next/cache';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { enqueueBillingJob, kickBillingJobs } from '@/lib/billing/notifications/queue';
import type { AdminBillingActionResult } from '@/lib/admin/billing-admin-ui.shared';

type AdminClient = ReturnType<typeof createAdminClient>;

function assertUuid(value: string, label = 'id'): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`A valid ${label} is required.`);
  }
  return normalized;
}

function throwOnBillingJobsQueryError(error: { code?: string; message: string } | null, action: string): void {
  if (!error) return;
  if (isMissingBillingSchemaError(error)) {
    throw new Error(`${action} is not available on this environment yet -- the billing migration has not been applied here.`);
  }
  throw new Error(`${action}: ${error.message}`);
}

/**
 * Same non-blocking shape as admin-billing-actions.ts's auditResyncBestEffort: the retry/resend
 * above this call already happened (or already failed on its own terms), so losing the audit row
 * must never be reported as the action itself failing.
 */
async function writeAuditBestEffort(
  admin: AdminClient,
  row: {
    targetUserId: string | null;
    actorUserId: string;
    actionType: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await admin.from('admin_user_audit_events').insert({
      target_user_id: row.targetUserId,
      actor_user_id: row.actorUserId,
      action_type: row.actionType,
      reason: row.reason,
      metadata_json: row.metadata ?? {},
    });
    if (error) {
      console.error('[admin-billing-jobs] failed to record audit row', { actionType: row.actionType, message: error.message });
    }
  } catch (err) {
    console.error('[admin-billing-jobs] audit write threw', { message: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------------------------
// Retry: failed jobs only. Resets to pending with a clean attempt count, and stamps
// payload.adminRetryAt so deliver.ts's staleness clock restarts from now (see its own comment) --
// an admin's explicit retry of an old job must still be able to send.
// ---------------------------------------------------------------------------------------------

export interface RetryBillingJobResult {
  retried: boolean;
}

export async function retryBillingJob(input: { jobId: string }): Promise<RetryBillingJobResult> {
  const { user: actor } = await verifyAdmin();
  const jobId = assertUuid(input.jobId, 'job id');
  const admin = createAdminClient();

  const jobResult = await admin
    .from('billing_notification_jobs')
    .select('id, kind, status, subject_ref, user_id, payload_json')
    .eq('id', jobId)
    .maybeSingle();
  throwOnBillingJobsQueryError(jobResult.error, 'Retry');
  const job = jobResult.data as {
    id: string;
    kind: string;
    status: string;
    subject_ref: string;
    user_id: string | null;
    payload_json: Record<string, unknown> | null;
  } | null;
  if (!job) throw new Error('Billing notification job not found.');
  if (job.status !== 'failed') {
    throw new Error(`This job is "${job.status}", not "failed", so there is nothing to retry.`);
  }

  const mergedPayload = { ...(job.payload_json ?? {}), adminRetryAt: new Date().toISOString() };

  const updateResult = await admin
    .from('billing_notification_jobs')
    .update({
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
      payload_json: mergedPayload,
    })
    .eq('id', jobId)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle();
  throwOnBillingJobsQueryError(updateResult.error, 'Retry');
  if (!updateResult.data) {
    throw new Error('This job is no longer failed -- it may already have been retried.');
  }

  await writeAuditBestEffort(admin, {
    targetUserId: job.user_id,
    actorUserId: actor.id,
    actionType: 'billing_job_retried',
    reason: `Admin retry of billing notification job ${jobId} (${job.kind})`,
    metadata: { jobId, kind: job.kind },
  });

  kickBillingJobs();

  revalidatePath('/admin/users');
  if (job.subject_ref) revalidatePath(`/admin/users/${job.subject_ref}`);

  return { retried: true };
}

// ---------------------------------------------------------------------------------------------
// Resend: any issued document, on demand. The dedupe key carries a timestamp precisely so a repeat
// click is a new send every time, rather than swallowed by the queue's own ON CONFLICT.
// ---------------------------------------------------------------------------------------------

export interface ResendBillingDocumentResult {
  enqueued: boolean;
}

export async function resendBillingDocument(input: { documentId: string }): Promise<ResendBillingDocumentResult> {
  const { user: actor } = await verifyAdmin();
  const documentId = assertUuid(input.documentId, 'document id');
  const admin = createAdminClient();

  const docResult = await admin
    .from('billing_documents')
    .select('id, subject_ref, status, document_number')
    .eq('id', documentId)
    .maybeSingle();
  throwOnBillingJobsQueryError(docResult.error, 'Resend');
  const doc = docResult.data as { id: string; subject_ref: string; status: string; document_number: string } | null;
  if (!doc) throw new Error('Billing document not found.');
  if (doc.status !== 'issued') {
    throw new Error(`This document is "${doc.status}", not "issued", so it cannot be resent.`);
  }

  // With emails off the queue drops the job (or the worker records skipped_disabled), so "queued"
  // would be untrue.
  if (!(await getFeatureFlag('billing_emails_enabled', false))) {
    throw new Error('Billing emails are switched off, so nothing would be sent.');
  }

  // "If that auth user no longer exists, refuse with 'This account was deleted.'" (plan §10 D).
  // Only a 404 means deleted; any other lookup error is reported as itself.
  const userLookup = await admin.auth.admin.getUserById(doc.subject_ref);
  if (userLookup.error && userLookup.error.status !== 404) {
    throw new Error(`Could not check the account: ${userLookup.error.message}`);
  }
  if (!userLookup.data?.user) {
    throw new Error('This account was deleted.');
  }

  await enqueueBillingJob({
    kind: 'document_resend',
    dedupeKey: `resend:${documentId}:${Date.now()}`,
    subjectRef: doc.subject_ref,
    userId: doc.subject_ref,
    documentId,
  });

  await writeAuditBestEffort(admin, {
    targetUserId: doc.subject_ref,
    actorUserId: actor.id,
    actionType: 'billing_document_resent',
    reason: `Admin resend of billing document ${doc.document_number}`,
    metadata: { documentId },
  });

  kickBillingJobs();

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${doc.subject_ref}`);

  return { enqueued: true };
}

// ---------------------------------------------------------------------------------------------
// Settled wrappers for the client -- same reasoning as app/actions/admin-billing-ui-actions.ts:
// Next omits a thrown server-action error's message in production builds, and the refusal reasons
// above (job not failed, document not issued, account deleted) are exactly what the admin needs to
// read.
// ---------------------------------------------------------------------------------------------

async function settle<T>(run: () => Promise<T>): Promise<AdminBillingActionResult<T>> {
  try {
    return { ok: true, result: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message ? error.message : 'This action failed.' };
  }
}

export async function retryBillingJobSettled(input: Parameters<typeof retryBillingJob>[0]) {
  return settle(() => retryBillingJob(input));
}

export async function resendBillingDocumentSettled(input: Parameters<typeof resendBillingDocument>[0]) {
  return settle(() => resendBillingDocument(input));
}
