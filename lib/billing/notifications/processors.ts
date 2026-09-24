import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { BillingNotificationJobRow, JobKind, ProcessorResult } from './types.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit C1): the processor registry
 * lib/billing/notifications/runner.ts dispatches to, keyed by `billing_notification_jobs.kind`. Every
 * entry here is a placeholder that marks its job `done` without doing any real work -- Unit C2
 * replaces each body with the real issue -> render -> email pipeline described in the plan.
 *
 * The registry shape is the point of this file existing separately from the runner: C2's whole diff
 * is contained to the seven function bodies below (plus the imports they need). Neither the runner,
 * the route nor the queue has to change shape when a real processor lands.
 */

export type AdminClient = ReturnType<typeof createAdminClient>;

/** What every processor gets besides the job row -- resolved once per worker run so no processor
 * re-derives the admin client or re-resolves APP_URL for itself. */
export interface BillingJobProcessorContext {
  admin: AdminClient;
  appUrl: string;
}

export type BillingJobProcessor = (
  job: BillingNotificationJobRow,
  ctx: BillingJobProcessorContext
) => Promise<ProcessorResult>;

async function noop(): Promise<ProcessorResult> {
  return {};
}

export const BILLING_JOB_PROCESSORS: Record<JobKind, BillingJobProcessor> = {
  // TODO(C2): issueInvoiceForPayment (documents/issue.ts) -> ensureDocumentPdf (documents/storage.ts)
  // -> deliverJobEmail with buildPaymentReceiptEmail (variant from payload_json: 'receipt' | 'renewal').
  payment_receipt: noop,
  // TODO(C2): issueCreditNoteForRefund -> ensureDocumentPdf -> deliverJobEmail with
  // buildRefundProcessedEmail (hasCreditNote from the issue outcome).
  refund_processed: noop,
  // TODO(C2): deliverJobEmail with buildSubscriptionPaymentFailedEmail (payload_json carries
  // shortUrl/graceEndsAt, per plan §4 Unit C2's hook).
  subscription_payment_failed: noop,
  // TODO(C2): deliverJobEmail with buildCancelScheduledEmail.
  cancel_scheduled: noop,
  // TODO(C2): deliverJobEmail with buildSubscriptionEndedEmail.
  subscription_ended: noop,
  // TODO(C2): deliverJobEmail with buildRenewalReminderEmail.
  renewal_reminder: noop,
  // TODO(C2): re-render the referenced document's own email kind and resend its PDF as an attachment.
  document_resend: noop,
};
