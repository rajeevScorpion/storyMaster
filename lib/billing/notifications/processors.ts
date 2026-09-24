import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { issueInvoiceForPayment, issueCreditNoteForRefund, resolvePlanLineItemFields } from '@/lib/billing/documents/issue';
import { ensureDocumentPdf } from '@/lib/billing/documents/storage';
import { deliverJobEmail } from '@/lib/billing/notifications/deliver';
import type { EmailAttachment } from '@/lib/billing/email/resend';
import {
  buildCancelScheduledEmail,
  buildDocumentResendEmail,
  buildPaymentReceiptEmail,
  buildRefundProcessedEmail,
  buildRenewalReminderEmail,
  buildSubscriptionEndedEmail,
  buildSubscriptionPaymentFailedEmail,
} from '@/lib/billing/email/templates.shared';
import { PermanentBillingJobError, type BillingNotificationJobRow, type JobKind, type ProcessorResult } from './types.shared';
import type { DbBillingPayment, DbBillingRefund, DbBillingSubscription } from '@/lib/types/database';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §10, Unit C2): the real processor for each
 * `billing_notification_jobs.kind`, replacing Unit C1's no-op registry. The registry shape itself
 * (`BILLING_JOB_PROCESSORS`, `BillingJobProcessor`, `BillingJobProcessorContext`) is unchanged -- C1's
 * whole point in splitting this file out was that C2's diff would be contained to the function bodies
 * below plus the imports they need, and that held.
 *
 * Every processor either returns a `ProcessorResult` (the runner marks the job `done`, whatever the
 * email outcome was -- `deliverJobEmail` itself never throws for an ordinary skip) or throws:
 * - an ordinary `Error` for anything that might succeed on a later attempt (a Resend 5xx, a transient
 *   database error) -- the runner retries it with backoff;
 * - `PermanentBillingJobError` when the row the job points at is simply gone (a `not_found` from the
 *   document issuer, a deleted payment/refund/subscription row) -- retrying an absent row can never
 *   succeed, so the runner fails it immediately instead of burning all 5 attempts finding that out.
 *
 * A document issuer's OTHER non-issued outcomes (`issuing_disabled`, `unavailable`,
 * `skipped_not_captured`, `skipped_no_original`, `skipped_not_processed`) are NOT permanent failures
 * here: the plan is explicit that a receipt/refund email still sends without an attachment when there
 * is no document (§6 "Kill switches", §2 "a credit note needs an issued original invoice") -- so those
 * outcomes just mean "no attachment", never "stop".
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BillingJobProcessorContext {
  admin: AdminClient;
  appUrl: string;
}

export type BillingJobProcessor = (
  job: BillingNotificationJobRow,
  ctx: BillingJobProcessorContext
) => Promise<ProcessorResult>;

/** Outcomes from issueInvoiceForPayment/issueCreditNoteForRefund that still leave a document to
 * attach. Anything else (including the two below plus `unavailable`, `issuing_disabled`,
 * `skipped_no_original`, `skipped_not_processed`, `skipped_not_captured`) means "no document" -- an
 * email still goes out, just without an attachment. */
const ISSUED_OUTCOMES = new Set(['issued', 'already_issued']);

/** `Kissago-<number with / replaced by ->.pdf` (plan §10: "Attachments"). Slashes are the only
 * character a document number can carry that a filename can't (Rule 46's format is `KG/26-27/000001`). */
function buildDocumentAttachment(documentNumber: string, bytes: Uint8Array): EmailAttachment {
  return {
    filename: `Kissago-${documentNumber.replace(/\//g, '-')}.pdf`,
    content: Buffer.from(bytes).toString('base64'),
  };
}

async function loadPaymentRow(admin: AdminClient, paymentId: string): Promise<DbBillingPayment | null> {
  const result = await admin.from('billing_payments').select('*').eq('id', paymentId).maybeSingle();
  if (result.error) throw new Error(`Failed to load billing_payments ${paymentId}: ${result.error.message}`);
  return (result.data as DbBillingPayment | null) ?? null;
}

async function loadRefundRow(admin: AdminClient, refundId: string): Promise<DbBillingRefund | null> {
  const result = await admin.from('billing_refunds').select('*').eq('id', refundId).maybeSingle();
  if (result.error) throw new Error(`Failed to load billing_refunds ${refundId}: ${result.error.message}`);
  return (result.data as DbBillingRefund | null) ?? null;
}

async function loadSubscriptionRow(admin: AdminClient, subscriptionId: string): Promise<DbBillingSubscription | null> {
  const result = await admin.from('billing_subscriptions').select('*').eq('id', subscriptionId).maybeSingle();
  if (result.error) throw new Error(`Failed to load billing_subscriptions ${subscriptionId}: ${result.error.message}`);
  return (result.data as DbBillingSubscription | null) ?? null;
}

/** The last price actually charged for this subscription, GST included -- what a renewal reminder
 * should quote (plan §10: "the latest billing_payments.gross_minor for this subscription"). Ordered by
 * `created_at` (every recorded payment has one; `captured_at` does not on every historical row) so
 * "latest" means "most recently recorded", matching what the sync itself just wrote. */
async function loadLatestChargedGrossMinor(admin: AdminClient, billingSubscriptionId: string): Promise<number | null> {
  const result = await admin
    .from('billing_payments')
    .select('gross_minor')
    .eq('billing_subscription_id', billingSubscriptionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw new Error(`Failed to load the latest charge for subscription ${billingSubscriptionId}: ${result.error.message}`);
  }
  return (result.data as { gross_minor: number } | null)?.gross_minor ?? null;
}

function readStringPayload(payload: Record<string, unknown>, key: string): string | null {
  const raw = payload[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

// --- payment_receipt ---------------------------------------------------------------------------------

async function processPaymentReceipt(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.payment_id) {
    throw new PermanentBillingJobError('payment_receipt job has no payment_id');
  }

  const issueResult = await issueInvoiceForPayment(job.payment_id);
  if (issueResult.outcome === 'not_found') {
    throw new PermanentBillingJobError(`Payment ${job.payment_id} no longer exists`);
  }

  const payment = await loadPaymentRow(ctx.admin, job.payment_id);
  if (!payment) {
    throw new PermanentBillingJobError(`Payment ${job.payment_id} no longer exists`);
  }

  const documentId = ISSUED_OUTCOMES.has(issueResult.outcome) ? issueResult.documentId : null;
  const hasInvoice = documentId != null;

  let attachment: EmailAttachment | undefined;
  if (documentId) {
    const pdf = await ensureDocumentPdf(documentId);
    if (pdf) attachment = buildDocumentAttachment(pdf.row.document_number, pdf.bytes);
  }

  let itemLabel: string;
  let planName: string | null = null;
  if (payment.kind === 'topup') {
    itemLabel = (payment.purchase_snapshot_json as { packName?: string } | null)?.packName ?? 'Coins';
  } else {
    const resolved = await resolvePlanLineItemFields(ctx.admin, payment.plan_version_id);
    planName = resolved.planName;
    itemLabel = `Kissago ${resolved.planName} plan`;
  }

  const content = buildPaymentReceiptEmail({
    appUrl: ctx.appUrl,
    variant: payment.kind === 'subscription_renewal' ? 'renewal' : 'receipt',
    itemLabel,
    planName,
    grossMinor: payment.gross_minor,
    hasInvoice,
  });

  const delivery = await deliverJobEmail(job, content, attachment);

  return {
    documentId,
    documentOutcome: issueResult.outcome,
    emailStatus: delivery.emailStatus,
    providerMessageId: delivery.providerMessageId,
  };
}

// --- refund_processed --------------------------------------------------------------------------------

async function processRefundProcessed(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.refund_id) {
    throw new PermanentBillingJobError('refund_processed job has no refund_id');
  }

  const issueResult = await issueCreditNoteForRefund(job.refund_id);
  if (issueResult.outcome === 'not_found') {
    throw new PermanentBillingJobError(`Refund ${job.refund_id} no longer exists`);
  }

  const refund = await loadRefundRow(ctx.admin, job.refund_id);
  if (!refund) {
    throw new PermanentBillingJobError(`Refund ${job.refund_id} no longer exists`);
  }

  const documentId = ISSUED_OUTCOMES.has(issueResult.outcome) ? issueResult.documentId : null;
  const hasCreditNote = documentId != null;

  let attachment: EmailAttachment | undefined;
  if (documentId) {
    const pdf = await ensureDocumentPdf(documentId);
    if (pdf) attachment = buildDocumentAttachment(pdf.row.document_number, pdf.bytes);
  }

  const content = buildRefundProcessedEmail({
    appUrl: ctx.appUrl,
    grossMinor: refund.amount_minor,
    hasCreditNote,
  });

  const delivery = await deliverJobEmail(job, content, attachment);

  return {
    documentId,
    documentOutcome: issueResult.outcome,
    emailStatus: delivery.emailStatus,
    providerMessageId: delivery.providerMessageId,
  };
}

// --- subscription_payment_failed ----------------------------------------------------------------------

async function processSubscriptionPaymentFailed(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.billing_subscription_id) {
    throw new PermanentBillingJobError('subscription_payment_failed job has no billing_subscription_id');
  }

  const subscription = await loadSubscriptionRow(ctx.admin, job.billing_subscription_id);
  if (!subscription) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} no longer exists`);
  }

  const { planName } = await resolvePlanLineItemFields(ctx.admin, subscription.plan_version_id);
  const payload = job.payload_json ?? {};
  const graceEndsAt = readStringPayload(payload, 'graceEndsAt') ?? subscription.grace_period_ends_at ?? subscription.current_period_end;
  if (!graceEndsAt) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} has no grace/period end to quote`);
  }
  const shortUrl = readStringPayload(payload, 'shortUrl');

  const content = buildSubscriptionPaymentFailedEmail({ appUrl: ctx.appUrl, planName, graceEndsAt, shortUrl });
  const delivery = await deliverJobEmail(job, content);

  return { emailStatus: delivery.emailStatus, providerMessageId: delivery.providerMessageId };
}

// --- cancel_scheduled ----------------------------------------------------------------------------------

async function processCancelScheduled(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.billing_subscription_id) {
    throw new PermanentBillingJobError('cancel_scheduled job has no billing_subscription_id');
  }

  const subscription = await loadSubscriptionRow(ctx.admin, job.billing_subscription_id);
  if (!subscription) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} no longer exists`);
  }

  const payload = job.payload_json ?? {};
  const accessUntil = readStringPayload(payload, 'accessUntil') ?? subscription.current_period_end;
  if (!accessUntil) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} has no period end to quote`);
  }

  const content = buildCancelScheduledEmail({ appUrl: ctx.appUrl, accessUntil });
  const delivery = await deliverJobEmail(job, content);

  return { emailStatus: delivery.emailStatus, providerMessageId: delivery.providerMessageId };
}

// --- subscription_ended --------------------------------------------------------------------------------

async function processSubscriptionEnded(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.billing_subscription_id) {
    throw new PermanentBillingJobError('subscription_ended job has no billing_subscription_id');
  }

  const subscription = await loadSubscriptionRow(ctx.admin, job.billing_subscription_id);
  if (!subscription) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} no longer exists`);
  }

  const { planName } = await resolvePlanLineItemFields(ctx.admin, subscription.plan_version_id);
  const content = buildSubscriptionEndedEmail({ appUrl: ctx.appUrl, planName });
  const delivery = await deliverJobEmail(job, content);

  return { emailStatus: delivery.emailStatus, providerMessageId: delivery.providerMessageId };
}

// --- renewal_reminder ----------------------------------------------------------------------------------

async function processRenewalReminder(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.billing_subscription_id) {
    throw new PermanentBillingJobError('renewal_reminder job has no billing_subscription_id');
  }

  const subscription = await loadSubscriptionRow(ctx.admin, job.billing_subscription_id);
  if (!subscription) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} no longer exists`);
  }

  const { planName } = await resolvePlanLineItemFields(ctx.admin, subscription.plan_version_id);
  const payload = job.payload_json ?? {};
  const renewsAt = readStringPayload(payload, 'renewsAt') ?? subscription.current_period_end;
  if (!renewsAt) {
    throw new PermanentBillingJobError(`Subscription ${job.billing_subscription_id} has no period end to quote`);
  }

  const grossMinor = await loadLatestChargedGrossMinor(ctx.admin, job.billing_subscription_id);
  if (grossMinor == null) {
    // plan §10: "with no payment row, throw PermanentBillingJobError('no charged amount to quote')" --
    // a subscription with no recorded charge at all can never have a real amount to remind about.
    throw new PermanentBillingJobError('no charged amount to quote');
  }

  const content = buildRenewalReminderEmail({ appUrl: ctx.appUrl, planName, renewsAt, grossMinor });
  const delivery = await deliverJobEmail(job, content);

  return { emailStatus: delivery.emailStatus, providerMessageId: delivery.providerMessageId };
}

// --- document_resend -----------------------------------------------------------------------------------

async function processDocumentResend(job: BillingNotificationJobRow, ctx: BillingJobProcessorContext): Promise<ProcessorResult> {
  if (!job.document_id) {
    throw new PermanentBillingJobError('document_resend job has no document_id');
  }

  const pdf = await ensureDocumentPdf(job.document_id);
  if (!pdf) {
    throw new PermanentBillingJobError(`Document ${job.document_id} no longer exists`);
  }

  const content = buildDocumentResendEmail({ appUrl: ctx.appUrl, documentNumber: pdf.row.document_number });
  const attachment = buildDocumentAttachment(pdf.row.document_number, pdf.bytes);
  const delivery = await deliverJobEmail(job, content, attachment);

  return { documentId: job.document_id, emailStatus: delivery.emailStatus, providerMessageId: delivery.providerMessageId };
}

export const BILLING_JOB_PROCESSORS: Record<JobKind, BillingJobProcessor> = {
  payment_receipt: processPaymentReceipt,
  refund_processed: processRefundProcessed,
  subscription_payment_failed: processSubscriptionPaymentFailed,
  cancel_scheduled: processCancelScheduled,
  subscription_ended: processSubscriptionEnded,
  renewal_reminder: processRenewalReminder,
  document_resend: processDocumentResend,
};
