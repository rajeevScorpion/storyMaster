import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { redactRazorpayPayload } from '@/lib/billing/razorpay-redact.shared';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { getFeatureFlag } from '@/lib/ai/model-config';
import type { TaxBreakdown } from '@/lib/billing/tax.shared';
import type {
  BillingDocumentType,
  BillingMethodCategory,
  BillingPaymentKind,
  BillingPaymentStatus,
  BillingProvider,
  BillingRefundInitiator,
  BillingRefundStatus,
} from '@/lib/types/pricing';

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit A): the ledger writer for migration
 * 125's billing_payments/billing_refunds/billing_documents tables. Nothing calls this yet -- Unit B
 * wires checkout/sync/webhook to it. Every write here is idempotent on the provider id and fails
 * closed (returns 'unavailable' rather than throwing) when 125 is absent, mirroring
 * lib/billing/razorpay-sync.ts's 23505 handling and lib/ai/text-models.ts's missing-schema latch.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const DOCUMENT_ISSUING_FLAG_KEY = 'billing_document_issuing_enabled';

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/** One latch for the whole migration-125 group (billing_payments, billing_refunds,
 * billing_documents, billing_document_sequences, billing_next_document_number): every query in
 * this module touches only those, so any of the shared classifier's codes from here unambiguously
 * means 125 is not (fully) applied. Delegates to schema-availability.shared.ts, which carries the
 * code list itself -- see that file for why it was extracted out of here. */
function isMissingLedgerSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  return isMissingBillingSchemaError(error);
}

let ledgerSchemaUnavailable = false;

/** Test-only escape hatch -- the latch above is otherwise permanent for the process, matching
 * every other missing-schema latch in this codebase (a hand-applied migration needs a restart). */
export function resetLedgerSchemaLatchForTests(): void {
  ledgerSchemaUnavailable = false;
}

const METHOD_CATEGORY_MAP: Record<string, BillingMethodCategory> = {
  card: 'card',
  upi: 'upi',
  netbanking: 'netbanking',
  wallet: 'wallet',
  emi: 'emi',
  paylater: 'paylater',
};

/** Razorpay's raw `payment.method` collapsed to the coarse category the CHECK constraint allows.
 * The raw value, and everything under `card`/`bank_account`/`vpa`, is never stored (plan §4). */
export function deriveMethodCategory(rawMethod: string | null | undefined): BillingMethodCategory {
  if (!rawMethod) return 'unknown';
  return METHOD_CATEGORY_MAP[rawMethod.toLowerCase()] ?? 'other';
}

export type LedgerWriteResult =
  | { state: 'inserted'; id: string }
  | { state: 'already_recorded'; id: string | null }
  | { state: 'unavailable' };

export interface RecordPaymentInput {
  supabase: AdminClient;
  subjectRef: string;
  userId: string | null;
  provider: BillingProvider;
  providerMode: 'test' | 'live';
  providerPaymentId: string;
  providerOrderId?: string | null;
  providerSubscriptionId?: string | null;
  providerInvoiceId?: string | null;
  billingOrderId?: string | null;
  billingSubscriptionId?: string | null;
  planVersionId?: string | null;
  topupPackId?: string | null;
  kind: BillingPaymentKind;
  status: BillingPaymentStatus;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxBreakdown?: TaxBreakdown | null;
  /** Razorpay's raw `payment.method` -- converted with deriveMethodCategory, never stored as-is. */
  rawMethod?: string | null;
  providerFeeMinor?: number | null;
  providerTaxMinor?: number | null;
  cycleStart?: string | null;
  cycleEnd?: string | null;
  /** Kissago's own frozen purchase/customer snapshots (what was sold, who it was sold to) -- not a
   * raw provider payload, so unlike rawPayload below this is never passed through redaction here;
   * the caller decides what belongs in a document-worthy snapshot. */
  purchaseSnapshot?: Record<string, unknown> | null;
  customerSnapshot?: Record<string, unknown> | null;
  webhookEventId?: string | null;
  capturedAt?: string | null;
}

/**
 * Records one confirmed charge. Idempotent on (provider, provider_mode, provider_payment_id): a
 * concurrent caller (verify/webhook race, same as Phase 1) hits 23505 on the insert and this
 * updates the mutable fields instead of duplicating the row.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<LedgerWriteResult> {
  if (ledgerSchemaUnavailable) return { state: 'unavailable' };

  const methodCategory = deriveMethodCategory(input.rawMethod);

  const row = {
    subject_ref: input.subjectRef,
    user_id: input.userId,
    provider: input.provider,
    provider_mode: input.providerMode,
    provider_payment_id: input.providerPaymentId,
    provider_order_id: input.providerOrderId ?? null,
    provider_subscription_id: input.providerSubscriptionId ?? null,
    provider_invoice_id: input.providerInvoiceId ?? null,
    billing_order_id: input.billingOrderId ?? null,
    billing_subscription_id: input.billingSubscriptionId ?? null,
    plan_version_id: input.planVersionId ?? null,
    topup_pack_id: input.topupPackId ?? null,
    kind: input.kind,
    status: input.status,
    currency_code: input.currencyCode,
    net_minor: input.netMinor,
    tax_minor: input.taxMinor,
    gross_minor: input.grossMinor,
    tax_breakdown_json: input.taxBreakdown ?? {},
    method_category: methodCategory,
    provider_fee_minor: input.providerFeeMinor ?? null,
    provider_tax_minor: input.providerTaxMinor ?? null,
    cycle_start: input.cycleStart ?? null,
    cycle_end: input.cycleEnd ?? null,
    purchase_snapshot_json: input.purchaseSnapshot ?? null,
    customer_snapshot_json: input.customerSnapshot ?? null,
    webhook_event_id: input.webhookEventId ?? null,
    captured_at: input.capturedAt ?? null,
  };

  const insertResult = await input.supabase.from('billing_payments').insert(row).select('id').single();

  if (!insertResult.error) {
    return { state: 'inserted', id: (insertResult.data as { id: string }).id };
  }

  if (isMissingLedgerSchemaError(insertResult.error)) {
    ledgerSchemaUnavailable = true;
    return { state: 'unavailable' };
  }

  if (!isUniqueViolation(insertResult.error)) {
    throw new Error(`Failed to record payment: ${insertResult.error.message}`);
  }

  const updateResult = await input.supabase
    .from('billing_payments')
    .update({
      status: input.status,
      tax_breakdown_json: input.taxBreakdown ?? {},
      method_category: methodCategory,
      provider_fee_minor: input.providerFeeMinor ?? null,
      provider_tax_minor: input.providerTaxMinor ?? null,
      webhook_event_id: input.webhookEventId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', input.provider)
    .eq('provider_mode', input.providerMode)
    .eq('provider_payment_id', input.providerPaymentId)
    .select('id')
    .maybeSingle();

  if (updateResult.error) {
    throw new Error(`Failed to update already-recorded payment: ${updateResult.error.message}`);
  }

  // captured_at is deliberately absent from the patch above: it is the tax point, so it is written
  // once and never moved. Verify, the webhook and the daily reconcile all re-observe the same
  // payment, and re-stamping would walk an immutable financial record's date forward every time.
  // Only fill it in when the first write couldn't (an authorized-not-captured row, say).
  if (input.capturedAt) {
    const backfillCapturedAt = await input.supabase
      .from('billing_payments')
      .update({ captured_at: input.capturedAt })
      .eq('provider', input.provider)
      .eq('provider_mode', input.providerMode)
      .eq('provider_payment_id', input.providerPaymentId)
      .is('captured_at', null);

    if (backfillCapturedAt.error) {
      throw new Error(`Failed to stamp the capture time on an already-recorded payment: ${backfillCapturedAt.error.message}`);
    }
  }

  return { state: 'already_recorded', id: (updateResult.data as { id: string } | null)?.id ?? null };
}

export interface RecordRefundInput {
  supabase: AdminClient;
  subjectRef?: string | null;
  /** Kissago's own billing_payments.id, when resolved. Refunds/disputes for a renewal payment we
   * haven't matched locally yet still record with providerPaymentId alone (plan §4 Unit B). */
  paymentId?: string | null;
  providerPaymentId?: string | null;
  provider?: BillingProvider;
  providerMode: 'test' | 'live';
  providerRefundId: string;
  amountMinor: number;
  netMinor?: number | null;
  taxMinor?: number | null;
  currencyCode: string;
  status: BillingRefundStatus;
  reason?: string | null;
  initiatedBy?: BillingRefundInitiator | null;
  actorUserRef?: string | null;
  coinAdjustment?: Record<string, unknown> | null;
  /** The raw provider webhook payload -- redacted here, same as billing_orders/billing_subscriptions
   * in lib/billing/razorpay-sync.ts. */
  rawPayload?: Record<string, unknown>;
  processedAt?: string | null;
}

/**
 * Records one refund. Idempotent on (provider, provider_mode, provider_refund_id), same
 * insert-then-update-on-23505 shape as recordPayment.
 */
export async function recordRefund(input: RecordRefundInput): Promise<LedgerWriteResult> {
  if (ledgerSchemaUnavailable) return { state: 'unavailable' };

  const provider = input.provider ?? 'razorpay';
  const rawPayload = redactRazorpayPayload(input.rawPayload ?? {});

  const row = {
    subject_ref: input.subjectRef ?? null,
    payment_id: input.paymentId ?? null,
    provider,
    provider_mode: input.providerMode,
    provider_refund_id: input.providerRefundId,
    provider_payment_id: input.providerPaymentId ?? null,
    amount_minor: input.amountMinor,
    net_minor: input.netMinor ?? null,
    tax_minor: input.taxMinor ?? null,
    currency_code: input.currencyCode,
    status: input.status,
    reason: input.reason ?? null,
    initiated_by: input.initiatedBy ?? null,
    actor_user_ref: input.actorUserRef ?? null,
    coin_adjustment_json: input.coinAdjustment ?? null,
    raw_payload_json: rawPayload,
    processed_at: input.processedAt ?? null,
  };

  const insertResult = await input.supabase.from('billing_refunds').insert(row).select('id').single();

  if (!insertResult.error) {
    return { state: 'inserted', id: (insertResult.data as { id: string }).id };
  }

  if (isMissingLedgerSchemaError(insertResult.error)) {
    ledgerSchemaUnavailable = true;
    return { state: 'unavailable' };
  }

  if (!isUniqueViolation(insertResult.error)) {
    throw new Error(`Failed to record refund: ${insertResult.error.message}`);
  }

  const updateResult = await input.supabase
    .from('billing_refunds')
    .update({
      status: input.status,
      payment_id: input.paymentId ?? null,
      reason: input.reason ?? null,
      coin_adjustment_json: input.coinAdjustment ?? null,
      raw_payload_json: rawPayload,
      processed_at: input.processedAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', provider)
    .eq('provider_mode', input.providerMode)
    .eq('provider_refund_id', input.providerRefundId)
    .select('id')
    .maybeSingle();

  if (updateResult.error) {
    throw new Error(`Failed to update already-recorded refund: ${updateResult.error.message}`);
  }

  return { state: 'already_recorded', id: (updateResult.data as { id: string } | null)?.id ?? null };
}

/**
 * Records a dispute. There is no separate disputes table (plan §3): a dispute is a
 * billing_refunds row with `initiated_by = 'dispute'`, keyed on the provider's dispute id passed
 * as `providerRefundId` -- the same "provider id" uniqueness recordRefund uses.
 */
export async function recordDispute(input: Omit<RecordRefundInput, 'initiatedBy'>): Promise<LedgerWriteResult> {
  return recordRefund({ ...input, initiatedBy: 'dispute' });
}

export interface IssueDocumentInput {
  supabase: AdminClient;
  subjectRef: string;
  documentType: BillingDocumentType;
  /** e.g. '2026-27' -- the caller computes this; the ledger only stores and numbers within it. */
  financialYear: string;
  /** Exactly one of paymentId/refundId, matching billing_documents_one_subject. */
  paymentId?: string | null;
  refundId?: string | null;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxBreakdown?: TaxBreakdown | null;
  customerSnapshot: Record<string, unknown>;
  businessSnapshot: Record<string, unknown>;
}

export type IssueDocumentResult =
  | { issued: false; reason: 'issuing_disabled' | 'unavailable' | 'already_issued' }
  | { issued: true; documentId: string; documentNumber: string };

/**
 * Issues a receipt/tax invoice/credit note, gated entirely behind the `billing_document_issuing_enabled`
 * feature flag (default off, per plan decision 8 -- Phase 6 turns it on). Numbering comes from
 * `billing_next_document_number`, which takes its own advisory lock in Postgres, so this function
 * never invents a number itself.
 */
export async function issueDocumentIfEnabled(input: IssueDocumentInput): Promise<IssueDocumentResult> {
  const enabled = await getFeatureFlag(DOCUMENT_ISSUING_FLAG_KEY, false);
  if (!enabled) return { issued: false, reason: 'issuing_disabled' };

  if ((input.paymentId != null) === (input.refundId != null)) {
    throw new Error('issueDocumentIfEnabled: exactly one of paymentId or refundId is required');
  }

  if (ledgerSchemaUnavailable) return { issued: false, reason: 'unavailable' };

  const existing = await input.supabase
    .from('billing_documents')
    .select('id, document_number')
    .eq('document_type', input.documentType)
    .eq('status', 'issued')
    .eq(input.paymentId ? 'payment_id' : 'refund_id', input.paymentId ?? input.refundId)
    .maybeSingle();

  if (existing.error) {
    if (isMissingLedgerSchemaError(existing.error)) {
      ledgerSchemaUnavailable = true;
      return { issued: false, reason: 'unavailable' };
    }
    throw new Error(`Failed to check for an already-issued document: ${existing.error.message}`);
  }

  if (existing.data) {
    return { issued: false, reason: 'already_issued' };
  }

  const numberResult = await input.supabase.rpc('billing_next_document_number', {
    p_financial_year: input.financialYear,
    p_document_type: input.documentType,
  });

  if (numberResult.error) {
    if (isMissingLedgerSchemaError(numberResult.error)) {
      ledgerSchemaUnavailable = true;
      return { issued: false, reason: 'unavailable' };
    }
    throw new Error(`Failed to allocate a document number: ${numberResult.error.message}`);
  }

  const documentNumber = numberResult.data as string;

  const insertResult = await input.supabase
    .from('billing_documents')
    .insert({
      subject_ref: input.subjectRef,
      document_type: input.documentType,
      document_number: documentNumber,
      financial_year: input.financialYear,
      payment_id: input.paymentId ?? null,
      refund_id: input.refundId ?? null,
      currency_code: input.currencyCode,
      net_minor: input.netMinor,
      tax_minor: input.taxMinor,
      gross_minor: input.grossMinor,
      tax_breakdown_json: input.taxBreakdown ?? {},
      customer_snapshot_json: input.customerSnapshot,
      business_snapshot_json: input.businessSnapshot,
    })
    .select('id')
    .single();

  if (insertResult.error) {
    throw new Error(`Failed to issue document ${documentNumber}: ${insertResult.error.message}`);
  }

  return { issued: true, documentId: (insertResult.data as { id: string }).id, documentNumber };
}
