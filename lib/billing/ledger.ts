import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { redactRazorpayPayload } from '@/lib/billing/razorpay-redact.shared';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { getFeatureFlag } from '@/lib/ai/model-config';
import type { TaxBreakdown } from '@/lib/billing/tax.shared';
import type { BillingDocumentLineItem, IssuedDocumentType } from '@/lib/billing/documents/types.shared';
import type {
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
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): the two ranks a payment status can be
 * in, for recordPayment's duplicate-update path. 'refunded', 'partially_refunded' and 'disputed' are
 * all states a charge reaches only after (never instead of) being recorded -- a later, less-settled
 * re-observe (a stale webhook redelivery, or the daily reconcile re-fetching an invoice it already
 * saw) must not walk one of them back down to 'captured'/'failed'. Exported for ledger.test.ts.
 */
export function paymentStatusRank(status: BillingPaymentStatus): number {
  return status === 'refunded' || status === 'partially_refunded' || status === 'disputed' ? 1 : 0;
}

/**
 * Records one confirmed charge. Idempotent on (provider, provider_mode, provider_payment_id): a
 * concurrent caller (verify/webhook race, same as Phase 1) hits 23505 on the insert and this
 * updates the mutable fields instead of duplicating the row. The update path fills gaps rather than
 * overwriting -- see the comment above it -- mirroring recordRefund's fix (d42622b).
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

  // Verify, the webhook and the daily reconcile all converge on the same row here, each potentially
  // carrying only a subset of what it knows -- so this fills gaps instead of blanking whatever the
  // first writer already set. Read the stored status first: unlike the other fields below, status
  // must never move backwards (an incoming 'captured' must not undo a 'refunded'/'partially_refunded'/
  // disputed' already recorded), and there is no single filtered UPDATE that both enforces that rank
  // and still unconditionally fills the unrelated method/fee/webhook_event_id fields in the same call.
  const storedResult = await input.supabase
    .from('billing_payments')
    .select('status')
    .eq('provider', input.provider)
    .eq('provider_mode', input.providerMode)
    .eq('provider_payment_id', input.providerPaymentId)
    .maybeSingle();

  if (storedResult.error) {
    throw new Error(`Failed to read an already-recorded payment's status: ${storedResult.error.message}`);
  }

  const storedStatus = (storedResult.data as { status: BillingPaymentStatus } | null)?.status ?? null;
  const statusRegresses = storedStatus !== null && paymentStatusRank(input.status) < paymentStatusRank(storedStatus);

  const updatePatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (!statusRegresses) {
    updatePatch.status = input.status;
  }
  // method_category: fill only -- an incoming 'unknown' (no rawMethod on this observation) must never
  // blank a method a previous, more informative observation already recorded.
  if (methodCategory !== 'unknown') {
    updatePatch.method_category = methodCategory;
  }
  if (input.providerFeeMinor != null) {
    updatePatch.provider_fee_minor = input.providerFeeMinor;
  }
  if (input.providerTaxMinor != null) {
    updatePatch.provider_tax_minor = input.providerTaxMinor;
  }
  if (input.webhookEventId != null) {
    updatePatch.webhook_event_id = input.webhookEventId;
  }

  const updateResult = await input.supabase
    .from('billing_payments')
    .update(updatePatch)
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

  // tax_breakdown_json is never in the patch above, and never updated once non-empty: a renewal's
  // split is re-derived from the LIVE billing profile on every sync
  // (razorpay-sync.ts's resolveSubscriptionPaymentMoney), so folding it into the ordinary fill-only
  // patch would let a customer's later address edit rewrite a past charge's recorded CGST/SGST vs
  // IGST split. It is filled exactly once, only where the stored value is still the untouched
  // default -- the '{}' literal is cast to jsonb by PostgREST.
  if (input.taxBreakdown != null && Object.keys(input.taxBreakdown).length > 0) {
    const backfillTaxBreakdown = await input.supabase
      .from('billing_payments')
      .update({ tax_breakdown_json: input.taxBreakdown })
      .eq('provider', input.provider)
      .eq('provider_mode', input.providerMode)
      .eq('provider_payment_id', input.providerPaymentId)
      .eq('tax_breakdown_json', '{}');

    if (backfillTaxBreakdown.error) {
      throw new Error(`Failed to backfill an already-recorded payment's tax breakdown: ${backfillTaxBreakdown.error.message}`);
    }
  }

  // customer_snapshot_json: same write-once reasoning as tax_breakdown_json above -- who was billed
  // at the time of a past charge must never be rewritten by a later profile edit. Filled only where
  // it is still null.
  if (input.customerSnapshot != null) {
    const backfillCustomerSnapshot = await input.supabase
      .from('billing_payments')
      .update({ customer_snapshot_json: input.customerSnapshot })
      .eq('provider', input.provider)
      .eq('provider_mode', input.providerMode)
      .eq('provider_payment_id', input.providerPaymentId)
      .is('customer_snapshot_json', null);

    if (backfillCustomerSnapshot.error) {
      throw new Error(`Failed to backfill an already-recorded payment's customer snapshot: ${backfillCustomerSnapshot.error.message}`);
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
 * insert-then-update-on-23505 shape as recordPayment. The update path fills gaps rather than
 * overwriting -- see the comment above it.
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

  // Admin's in-app refund, Razorpay's refund webhook, and the dispute webhook all converge on the
  // same row here, each carrying only the fields it knows about -- so this fills in whatever the
  // caller supplies instead of blanking the rest with its nulls. status only ever moves forward
  // (an incoming 'pending' never regresses an already-processed/failed row), and processed_at gets
  // its own guarded update below: written once, never moved by a redelivery or an admin re-run.
  const fill: Record<string, unknown> = {
    raw_payload_json: rawPayload,
    updated_at: new Date().toISOString(),
  };
  if (input.paymentId != null) fill.payment_id = input.paymentId;
  if (input.providerPaymentId != null) fill.provider_payment_id = input.providerPaymentId;
  if (input.subjectRef != null) fill.subject_ref = input.subjectRef;
  if (input.netMinor != null) fill.net_minor = input.netMinor;
  if (input.taxMinor != null) fill.tax_minor = input.taxMinor;
  if (input.reason != null) fill.reason = input.reason;
  if (input.coinAdjustment != null) fill.coin_adjustment_json = input.coinAdjustment;
  if (input.actorUserRef != null) fill.actor_user_ref = input.actorUserRef;
  if (input.status !== 'pending') fill.status = input.status;

  const updateResult = await input.supabase
    .from('billing_refunds')
    .update(fill)
    .eq('provider', provider)
    .eq('provider_mode', input.providerMode)
    .eq('provider_refund_id', input.providerRefundId)
    .select('id')
    .maybeSingle();

  if (updateResult.error) {
    throw new Error(`Failed to update already-recorded refund: ${updateResult.error.message}`);
  }

  if (input.processedAt != null) {
    const backfillProcessedAt = await input.supabase
      .from('billing_refunds')
      .update({ processed_at: input.processedAt })
      .eq('provider', provider)
      .eq('provider_mode', input.providerMode)
      .eq('provider_refund_id', input.providerRefundId)
      .is('processed_at', null);

    if (backfillProcessedAt.error) {
      throw new Error(`Failed to update refund processed_at: ${backfillProcessedAt.error.message}`);
    }
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
  documentType: IssuedDocumentType;
  providerMode: 'test' | 'live';
  /** Required for a credit_note (Rule 53: it must reference the invoice it reverses); the RPC itself
   * rejects a credit_note with none. Ignored for a tax_invoice. */
  originalDocumentId?: string | null;
  /** Exactly one of paymentId/refundId, matching billing_documents_one_subject. */
  paymentId?: string | null;
  refundId?: string | null;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxBreakdown?: TaxBreakdown | null;
  lineItems: BillingDocumentLineItem[];
  customerSnapshot: Record<string, unknown>;
  businessSnapshot: Record<string, unknown>;
}

export type IssueDocumentResult =
  | { issued: false; reason: 'issuing_disabled' | 'unavailable' }
  | { issued: true; documentId: string; documentNumber: string; alreadyIssued: boolean };

interface BillingIssueDocumentRow {
  o_document_id: string;
  o_document_number: string;
  o_already_issued: boolean;
}

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §3/§4 Unit A1): issues a tax invoice/credit note
 * through the single `billing_issue_document` RPC (migration 135), which allocates the number and
 * inserts the row in one Postgres transaction under its own advisory locks -- replacing the Phase 2
 * check-then-insert (`billing_next_document_number` then a separate insert), where a failed insert
 * burned a number and two concurrent callers could double-issue. Still gated entirely behind the
 * `billing_document_issuing_enabled` feature flag (default off), and still fails closed with the same
 * latch when 135 hasn't been applied.
 */
export async function issueDocumentIfEnabled(input: IssueDocumentInput): Promise<IssueDocumentResult> {
  const enabled = await getFeatureFlag(DOCUMENT_ISSUING_FLAG_KEY, false);
  if (!enabled) return { issued: false, reason: 'issuing_disabled' };

  if ((input.paymentId != null) === (input.refundId != null)) {
    throw new Error('issueDocumentIfEnabled: exactly one of paymentId or refundId is required');
  }
  if (input.documentType === 'credit_note' && !input.originalDocumentId) {
    throw new Error('issueDocumentIfEnabled: a credit note needs its original invoice id');
  }

  if (ledgerSchemaUnavailable) return { issued: false, reason: 'unavailable' };

  const rpcResult = await input.supabase.rpc('billing_issue_document', {
    p_document_type: input.documentType,
    p_provider_mode: input.providerMode,
    p_subject_ref: input.subjectRef,
    p_payment_id: input.paymentId ?? null,
    p_refund_id: input.refundId ?? null,
    p_original_document_id: input.originalDocumentId ?? null,
    p_currency_code: input.currencyCode,
    p_net_minor: input.netMinor,
    p_tax_minor: input.taxMinor,
    p_gross_minor: input.grossMinor,
    p_tax_breakdown: input.taxBreakdown ?? {},
    p_line_items: input.lineItems ?? [],
    p_customer_snapshot: input.customerSnapshot,
    p_business_snapshot: input.businessSnapshot,
  });

  if (rpcResult.error) {
    if (isMissingLedgerSchemaError(rpcResult.error)) {
      ledgerSchemaUnavailable = true;
      return { issued: false, reason: 'unavailable' };
    }
    throw new Error(`Failed to issue document: ${rpcResult.error.message}`);
  }

  // A RETURNS TABLE function comes back as an array of rows from supabase-js; tolerate a bare object
  // too so a hand-rolled test stub doesn't need to know that.
  const row = (Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data) as
    | BillingIssueDocumentRow
    | undefined;

  if (!row) {
    throw new Error('billing_issue_document returned no row');
  }

  return {
    issued: true,
    documentId: row.o_document_id,
    documentNumber: row.o_document_number,
    alreadyIssued: row.o_already_issued,
  };
}
