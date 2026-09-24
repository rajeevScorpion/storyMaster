/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §3/§4 Unit C1): the shapes shared between the
 * queue, the runner, the processor registry and the (Unit C2) hooks. Pure and isomorphic -- no
 * Supabase import, no server-only -- these are plain type/const declarations, safe to import from a
 * test or from client code that only needs to read a job's shape (e.g. Unit D's admin panel).
 *
 * `JobKind`, `JobStatus` and `EmailStatus` mirror migration 135's CHECK constraints on
 * `billing_notification_jobs` character for character. If a kind or status is ever added, this file
 * and the migration must change together -- there is deliberately no third place that lists them.
 *
 * `document_outcome` is typed as a plain `string | null`, not a union: it stores whichever
 * `DocumentIssueOutcome` value `lib/billing/documents/issue.ts` (Unit A3) returned (`'issued'`,
 * `'already_issued'`, `'skipped_no_original'`, ...), and that type lives on the documents side, not
 * here -- duplicating its union here would just be a second place to keep in sync for a column that is
 * display-only (admin read, plan §4 Unit D).
 */

export const BILLING_JOB_KINDS = [
  'payment_receipt',
  'refund_processed',
  'subscription_payment_failed',
  'cancel_scheduled',
  'subscription_ended',
  'renewal_reminder',
  'document_resend',
] as const;
export type JobKind = (typeof BILLING_JOB_KINDS)[number];

export const BILLING_JOB_STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
export type JobStatus = (typeof BILLING_JOB_STATUSES)[number];

export const BILLING_EMAIL_STATUSES = [
  'sent',
  'skipped_disabled',
  'skipped_no_address',
  'skipped_stale',
  'skipped_deleted',
] as const;
export type EmailStatus = (typeof BILLING_EMAIL_STATUSES)[number];

/** A `billing_notification_jobs` row exactly as migration 135 defines it (snake_case, straight off the
 * wire) -- the shape the runner claims, dispatches and updates. */
export interface BillingNotificationJobRow {
  id: string;
  dedupe_key: string;
  kind: JobKind;
  subject_ref: string;
  user_id: string | null;
  payment_id: string | null;
  refund_id: string | null;
  billing_subscription_id: string | null;
  document_id: string | null;
  payload_json: Record<string, unknown>;
  status: JobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  claimed_at: string | null;
  document_outcome: string | null;
  email_status: EmailStatus | null;
  provider_message_id: string | null;
  last_error: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What a processor hands back to the runner to persist alongside the `done` transition. Every field
 * is optional: a no-op (Unit C1's placeholder registry) returns `{}` and touches none of them, while a
 * real processor (Unit C2) fills in whichever the job actually produced -- an email-only job (e.g.
 * `cancel_scheduled`) has no `documentId`, and a `subscription_ended` job may have no email at all if
 * the account was already deleted. */
export interface ProcessorResult {
  documentId?: string | null;
  documentOutcome?: string | null;
  emailStatus?: EmailStatus | null;
  providerMessageId?: string | null;
}

/**
 * Thrown by a processor (or by `deliverJobEmail`) to tell the runner "do not retry this, ever" --
 * distinct from an ordinary thrown Error, which the runner retries with backoff until
 * `max_attempts`. Reserved for outcomes a retry structurally cannot fix (Unit C2 will use this for
 * `EmailNotConfiguredError` and Resend's permanent-4xx case; C1 ships the class so the runner's
 * dispatch logic and its test can exist before any processor actually throws it).
 */
export class PermanentBillingJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentBillingJobError';
  }
}
