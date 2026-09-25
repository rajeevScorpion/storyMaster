import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { sendBillingEmail, type EmailAttachment } from '@/lib/billing/email/resend';
import type { EmailContent } from '@/lib/billing/email/templates.shared';
import type { BillingNotificationJobRow, EmailStatus } from '@/lib/billing/notifications/types.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §2 "Where to send", §4 Unit C1/C2):
 * `deliverJobEmail` is the one place every processor (Unit C2) sends a billing email through, so the
 * flag check, the 72h staleness rule, the deleted-account guard and the address fallback chain are
 * each written exactly once rather than re-derived per kind.
 *
 * `job.payload_json.billingEmail` is the address a caller (a C2 processor) already resolved off the
 * payment/refund's own `customer_snapshot_json` at enqueue time (plan §2's first preference) -- this
 * module doesn't reach back into billing_payments itself, since a job may outlive the payment row's
 * relevance (a `document_resend` job, say) and the frozen snapshot is the more correct source anyway.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const BILLING_EMAILS_FLAG_KEY = 'billing_emails_enabled';
const STALE_JOB_MS = 72 * 60 * 60 * 1000;

export interface DeliverJobEmailResult {
  emailStatus: EmailStatus;
  providerMessageId: string | null;
}

function extractSnapshotEmail(job: BillingNotificationJobRow): string | null {
  const raw = (job.payload_json as { billingEmail?: unknown } | null)?.billingEmail;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §10 "D -- admin support"): the staleness clock
 * starts at the LATER of `created_at` and `payload_json.adminRetryAt` -- app/actions/admin-
 * billing-jobs.ts's retryBillingJob stamps `adminRetryAt` when an admin explicitly resets a failed
 * job to pending, precisely so that retry can still send even though the job's original
 * `created_at` is already well past 72h old. A malformed or missing `adminRetryAt` falls back to
 * `created_at` alone, unchanged from before this admin path existed.
 */
function resolveStaleClockStartMs(job: BillingNotificationJobRow): number {
  const createdMs = new Date(job.created_at).getTime();
  const rawRetryAt = (job.payload_json as { adminRetryAt?: unknown } | null)?.adminRetryAt;
  if (typeof rawRetryAt === 'string') {
    const retryMs = new Date(rawRetryAt).getTime();
    if (Number.isFinite(retryMs)) {
      return Number.isFinite(createdMs) ? Math.max(createdMs, retryMs) : retryMs;
    }
  }
  return createdMs;
}

async function lookupBillingProfileEmail(admin: AdminClient, userId: string): Promise<string | null> {
  const result = await admin.from('billing_profiles').select('billing_email').eq('user_id', userId).maybeSingle();
  if (result.error || !result.data) return null;
  const email = (result.data as { billing_email: string | null }).billing_email;
  return email && email.trim().length > 0 ? email.trim() : null;
}

async function lookupAuthEmail(admin: AdminClient, userId: string): Promise<string | null> {
  const result = await admin.auth.admin.getUserById(userId);
  const email = result.data?.user?.email;
  return typeof email === 'string' && email.trim().length > 0 ? email.trim() : null;
}

/** payload snapshot -> live billing_profiles row -> the auth user's own email -> null (plan §2). Each
 * DB-backed step is best-effort: a lookup failure falls through to the next source rather than
 * aborting the whole resolution. */
async function resolveRecipientEmail(admin: AdminClient, job: BillingNotificationJobRow): Promise<string | null> {
  const snapshotEmail = extractSnapshotEmail(job);
  if (snapshotEmail) return snapshotEmail;
  if (!job.user_id) return null;

  const profileEmail = await lookupBillingProfileEmail(admin, job.user_id).catch(() => null);
  if (profileEmail) return profileEmail;

  return lookupAuthEmail(admin, job.user_id).catch(() => null);
}

/**
 * Sends one job's email through Resend, or resolves to a `skipped_*` status without sending -- never
 * throws for an ordinary skip (disabled, deleted account, stale job, no address). Only a genuine send
 * attempt that fails throws (resend.ts's `EmailNotConfiguredError` / `EmailSendError`), so the
 * runner's retry/backoff machinery can act on the retryable/permanent split.
 */
export async function deliverJobEmail(
  job: BillingNotificationJobRow,
  content: EmailContent,
  attachment?: EmailAttachment
): Promise<DeliverJobEmailResult> {
  const emailsEnabled = await getFeatureFlag(BILLING_EMAILS_FLAG_KEY, false);
  if (!emailsEnabled) {
    return { emailStatus: 'skipped_disabled', providerMessageId: null };
  }

  if (!job.user_id) {
    return { emailStatus: 'skipped_deleted', providerMessageId: null };
  }

  const ageMs = Date.now() - resolveStaleClockStartMs(job);
  if (Number.isFinite(ageMs) && ageMs > STALE_JOB_MS) {
    return { emailStatus: 'skipped_stale', providerMessageId: null };
  }

  const admin = createAdminClient();
  const recipient = await resolveRecipientEmail(admin, job);
  if (!recipient) {
    return { emailStatus: 'skipped_no_address', providerMessageId: null };
  }

  const result = await sendBillingEmail({
    to: recipient,
    subject: content.subject,
    html: content.html,
    text: content.text,
    attachments: attachment ? [attachment] : undefined,
    idempotencyKey: job.dedupe_key,
    tags: [{ name: 'kind', value: job.kind }],
  });

  return { emailStatus: 'sent', providerMessageId: result.id };
}
