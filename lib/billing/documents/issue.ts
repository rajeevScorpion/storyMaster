import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { issueDocumentIfEnabled } from '@/lib/billing/ledger';
import { buildCustomerSnapshot, loadBillingProfile } from '@/lib/billing/billing-profile';
import {
  buildBusinessSnapshot,
  buildCreditNoteLineItems,
  buildInvoiceLineItems,
  refundTaxBreakdown,
  resolveCustomerSnapshot,
} from '@/lib/billing/documents/document-content.shared';
import type { BillingDocumentLineItem, DocumentCustomerSnapshot } from '@/lib/billing/documents/types.shared';
import { splitRefundProportionally, type TaxBreakdown } from '@/lib/billing/tax.shared';
import type { DbBillingPayment, DbBillingRefund } from '@/lib/types/database';
import type { BillingInterval, BillingPaymentStatus } from '@/lib/types/pricing';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit A3): the server-side issuers. Each loads
 * what A1's issueDocumentIfEnabled needs off a payment/refund row, builds the content with the pure
 * builders in document-content.shared.ts, and returns a typed outcome for the caller (Unit C2's
 * processors) to record as billing_notification_jobs.document_outcome. Neither function throws for an
 * ordinary "nothing to do here" case (not found, not captured, no original invoice) -- only a real
 * database failure does.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type DocumentIssueOutcome =
  | 'issued'
  | 'already_issued'
  | 'issuing_disabled'
  | 'unavailable'
  | 'skipped_no_original'
  | 'skipped_not_captured'
  | 'skipped_not_processed'
  | 'not_found';

export interface DocumentIssueResult {
  outcome: DocumentIssueOutcome;
  documentId: string | null;
  documentNumber: string | null;
}

/** A payment is invoice-worthy once it has actually been captured. refunded/partially_refunded/
 * disputed are all states a captured charge can move to afterwards (ledger.ts's paymentStatusRank
 * ranks them the same way) -- never states a charge starts in -- so a full or partial refund must
 * still get (or already have) an invoice for the original sale. */
const INVOICEABLE_PAYMENT_STATUSES = new Set<BillingPaymentStatus>(['captured', 'refunded', 'partially_refunded', 'disputed']);

function isMissingSchemaError(error: { code?: string } | null | undefined): boolean {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.code === '42703' ||
    error?.code === 'PGRST200' ||
    error?.code === 'PGRST204'
  );
}

function resolveSupportEmail(): string | null {
  return process.env.SUPPORT_EMAIL?.trim() || null;
}

/** Best-effort plan-name/interval lookup, mirroring admin-users.ts's loadBillingSubscriptionPlanKeys
 * embed pattern. Enrichment only: a failure here falls back to a generic name rather than blocking
 * the invoice, since the amount/tax/GST fields (the parts that actually matter for a tax document)
 * don't depend on it.
 *
 * Exported for Unit C2's processors.ts, which needs the same plan-name lookup for the receipt/renewal/
 * cancel/ended/reminder email copy -- reused rather than re-implemented so a subscription's plan name
 * is resolved identically for its invoice and for its emails. */
export async function resolvePlanLineItemFields(
  supabase: AdminClient,
  planVersionId: string | null
): Promise<{ planName: string; billingInterval: BillingInterval }> {
  const fallback = { planName: 'Kissago', billingInterval: 'monthly' as BillingInterval };
  if (!planVersionId) return fallback;

  const result = await supabase
    .from('pricing_plan_versions')
    .select('billing_interval, pricing_plans(name)')
    .eq('id', planVersionId)
    .maybeSingle();

  if (result.error) {
    console.error('[billing.documents] failed to resolve plan name for invoicing', {
      planVersionId,
      message: result.error.message,
    });
    return fallback;
  }

  const row = result.data as { billing_interval: BillingInterval; pricing_plans: { name: string } | { name: string }[] | null } | null;
  if (!row) return fallback;

  const related = Array.isArray(row.pricing_plans) ? row.pricing_plans[0] : row.pricing_plans;
  return {
    planName: related?.name ?? fallback.planName,
    billingInterval: row.billing_interval ?? fallback.billingInterval,
  };
}

function extractSac(taxBreakdown: Record<string, unknown>): string | null {
  const sac = (taxBreakdown as { sacCode?: unknown }).sacCode;
  return typeof sac === 'string' && sac.length > 0 ? sac : null;
}

async function resolveInvoiceLineItems(supabase: AdminClient, payment: DbBillingPayment): Promise<BillingDocumentLineItem[]> {
  const sac = extractSac(payment.tax_breakdown_json);

  if (payment.kind === 'topup') {
    const packName = (payment.purchase_snapshot_json as { packName?: string } | null)?.packName ?? 'Coins';
    return buildInvoiceLineItems({ kind: 'topup', packName, netMinor: payment.net_minor, sac });
  }

  const { planName, billingInterval } = await resolvePlanLineItemFields(supabase, payment.plan_version_id);
  return buildInvoiceLineItems({
    kind: 'subscription',
    planName,
    billingInterval,
    cycleStart: payment.cycle_start,
    cycleEnd: payment.cycle_end,
    netMinor: payment.net_minor,
    sac,
  });
}

/** The payment snapshot, else a freshly-loaded live profile, else the minimal fallback -- see
 * document-content.shared.ts's resolveCustomerSnapshot for the actual precedence. */
async function resolveInvoiceCustomerSnapshot(
  supabase: AdminClient,
  payment: DbBillingPayment
): Promise<DocumentCustomerSnapshot> {
  const paymentSnapshot = payment.customer_snapshot_json as Record<string, unknown> | null;
  let liveSnapshot: DocumentCustomerSnapshot | null = null;

  // Skip the profile round trip entirely when the payment already froze one -- resolveCustomerSnapshot
  // prefers it anyway, and a live-profile lookup here would be a wasted query on the common path.
  if ((!paymentSnapshot || Object.keys(paymentSnapshot).length === 0) && payment.user_id) {
    const profileLookup = await loadBillingProfile(supabase, payment.user_id);
    if (profileLookup.status === 'ok' && profileLookup.profile) {
      liveSnapshot = buildCustomerSnapshot(profileLookup.profile) as unknown as DocumentCustomerSnapshot;
    }
  }

  return resolveCustomerSnapshot(paymentSnapshot, liveSnapshot, payment.tax_breakdown_json as Partial<TaxBreakdown>);
}

/**
 * Issues (or reports the already-issued state of) the tax invoice for one captured payment.
 */
export async function issueInvoiceForPayment(paymentId: string): Promise<DocumentIssueResult> {
  const supabase = createAdminClient();

  const paymentResult = await supabase.from('billing_payments').select('*').eq('id', paymentId).maybeSingle();
  if (paymentResult.error) {
    if (isMissingSchemaError(paymentResult.error)) return { outcome: 'unavailable', documentId: null, documentNumber: null };
    throw new Error(`Failed to load payment for invoicing: ${paymentResult.error.message}`);
  }

  const payment = paymentResult.data as DbBillingPayment | null;
  if (!payment) return { outcome: 'not_found', documentId: null, documentNumber: null };

  if (!INVOICEABLE_PAYMENT_STATUSES.has(payment.status)) {
    return { outcome: 'skipped_not_captured', documentId: null, documentNumber: null };
  }

  const [lineItems, customerSnapshot] = await Promise.all([
    resolveInvoiceLineItems(supabase, payment),
    resolveInvoiceCustomerSnapshot(supabase, payment),
  ]);

  const result = await issueDocumentIfEnabled({
    supabase,
    subjectRef: payment.subject_ref,
    documentType: 'tax_invoice',
    providerMode: payment.provider_mode,
    paymentId: payment.id,
    refundId: null,
    originalDocumentId: null,
    currencyCode: payment.currency_code,
    netMinor: payment.net_minor,
    taxMinor: payment.tax_minor,
    grossMinor: payment.gross_minor,
    taxBreakdown: payment.tax_breakdown_json as unknown as TaxBreakdown,
    lineItems,
    customerSnapshot: customerSnapshot as unknown as Record<string, unknown>,
    businessSnapshot: buildBusinessSnapshot(resolveSupportEmail()) as unknown as Record<string, unknown>,
  });

  if (!result.issued) {
    return { outcome: result.reason, documentId: null, documentNumber: null };
  }

  return {
    outcome: result.alreadyIssued ? 'already_issued' : 'issued',
    documentId: result.documentId,
    documentNumber: result.documentNumber,
  };
}

/**
 * Issues (or reports the already-issued state of) the credit note for one refund. A credit note only
 * ever issues against an already-issued tax_invoice for the SAME payment (plan §2: "a credit note
 * needs an issued original invoice") -- if invoicing was off when the payment was captured, the
 * refund still emails (Unit C2), just with no credit note attached.
 */
export async function issueCreditNoteForRefund(refundId: string): Promise<DocumentIssueResult> {
  const supabase = createAdminClient();

  const refundResult = await supabase.from('billing_refunds').select('*').eq('id', refundId).maybeSingle();
  if (refundResult.error) {
    if (isMissingSchemaError(refundResult.error)) return { outcome: 'unavailable', documentId: null, documentNumber: null };
    throw new Error(`Failed to load refund for crediting: ${refundResult.error.message}`);
  }

  const refund = refundResult.data as DbBillingRefund | null;
  if (!refund) return { outcome: 'not_found', documentId: null, documentNumber: null };

  // Only money that has actually gone back gets a credit note. The job is enqueued on 'processed', but
  // an admin retry or a later caller must not be able to issue one for a pending or failed refund.
  if (refund.status !== 'processed') {
    return { outcome: 'skipped_not_processed', documentId: null, documentNumber: null };
  }

  if (!refund.payment_id) {
    return { outcome: 'skipped_no_original', documentId: null, documentNumber: null };
  }

  const originalResult = await supabase
    .from('billing_documents')
    .select('id, subject_ref, document_number, line_items_json, customer_snapshot_json')
    .eq('document_type', 'tax_invoice')
    .eq('status', 'issued')
    .eq('payment_id', refund.payment_id)
    .maybeSingle();

  if (originalResult.error) {
    if (isMissingSchemaError(originalResult.error)) return { outcome: 'unavailable', documentId: null, documentNumber: null };
    throw new Error(`Failed to look up the original invoice for a credit note: ${originalResult.error.message}`);
  }

  const original = originalResult.data as {
    id: string;
    subject_ref: string;
    document_number: string;
    line_items_json: BillingDocumentLineItem[] | null;
    customer_snapshot_json: DocumentCustomerSnapshot | null;
  } | null;
  if (!original) {
    return { outcome: 'skipped_no_original', documentId: null, documentNumber: null };
  }

  const paymentResult = await supabase.from('billing_payments').select('*').eq('id', refund.payment_id).maybeSingle();
  if (paymentResult.error) {
    if (isMissingSchemaError(paymentResult.error)) return { outcome: 'unavailable', documentId: null, documentNumber: null };
    throw new Error(`Failed to load the original payment for a credit note: ${paymentResult.error.message}`);
  }
  const payment = paymentResult.data as DbBillingPayment | null;
  if (!payment) return { outcome: 'not_found', documentId: null, documentNumber: null };

  // The refund's own net/tax split when it recorded one, else the same proportional split every refund
  // path uses (tax.shared.ts), so net + tax always equals the amount refunded.
  const split =
    refund.net_minor != null && refund.tax_minor != null
      ? { netMinor: refund.net_minor, taxMinor: refund.tax_minor }
      : splitRefundProportionally(refund.amount_minor, payment.net_minor, payment.gross_minor);

  const lineItems = buildCreditNoteLineItems(
    { documentNumber: original.document_number, lineItems: original.line_items_json ?? [] },
    { netMinor: split.netMinor }
  );

  // The buyer printed on the invoice, not a re-derived one: a credit note must name the same party
  // as the invoice it reverses.
  const customerSnapshot = original.customer_snapshot_json
    ?? resolveCustomerSnapshot(null, null, payment.tax_breakdown_json as Partial<TaxBreakdown>);

  const result = await issueDocumentIfEnabled({
    supabase,
    subjectRef: original.subject_ref,
    documentType: 'credit_note',
    providerMode: refund.provider_mode,
    paymentId: null,
    refundId: refund.id,
    originalDocumentId: original.id,
    currencyCode: refund.currency_code,
    netMinor: split.netMinor,
    taxMinor: split.taxMinor,
    grossMinor: refund.amount_minor,
    taxBreakdown: refundTaxBreakdown(payment.tax_breakdown_json as Partial<TaxBreakdown>, split.taxMinor) as TaxBreakdown | null,
    lineItems,
    customerSnapshot: customerSnapshot as unknown as Record<string, unknown>,
    businessSnapshot: buildBusinessSnapshot(resolveSupportEmail()) as unknown as Record<string, unknown>,
  });

  if (!result.issued) {
    return { outcome: result.reason, documentId: null, documentNumber: null };
  }

  return {
    outcome: result.alreadyIssued ? 'already_issued' : 'issued',
    documentId: result.documentId,
    documentNumber: result.documentNumber,
  };
}
