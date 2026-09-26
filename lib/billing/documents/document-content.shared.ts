/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit A3): pure content builders for a
 * billing_documents row -- the business snapshot, the printed line items, and which customer
 * snapshot wins. Pure and isomorphic (no server-only, no Supabase import): the server loader,
 * lib/billing/documents/issue.ts, is what actually reads business-config.ts's env-backed support
 * email and the database, then hands the results in here. Types come from
 * lib/billing/documents/types.shared.ts -- do not redeclare them here.
 */

import {
  LEGAL_ADDRESS_LINE_1,
  LEGAL_ADDRESS_LINE_2,
  LEGAL_CITY,
  LEGAL_COUNTRY,
  LEGAL_ENTITY_NAME,
  LEGAL_ENTITY_TYPE,
  LEGAL_GSTIN,
  LEGAL_POSTAL_CODE,
  LEGAL_STATE,
} from '@/lib/legal/business-config';
import { splitGstComponents, type TaxBreakdown } from '@/lib/billing/tax.shared';
import type {
  BillingDocumentLineItem,
  DocumentBusinessSnapshot,
  DocumentCustomerSnapshot,
} from '@/lib/billing/documents/types.shared';
import type { BillingInterval } from '@/lib/types/pricing';

/** The default SAC for Kissago's own subscription/top-up service, matching the tax breakdown shape
 * recorded on every payment (phase-6-plan.md §1: `sacCode: '998439'`). Callers pass the payment's own
 * tax_breakdown_json.sacCode when they have it; this is only the fallback for a pre-GST-tracking row
 * that never recorded one. */
export const DEFAULT_SERVICE_SAC = '998439';

/**
 * The seller block, frozen from lib/legal/business-config.ts. `supportEmail` is passed in rather than
 * read from `process.env` here, so this module stays pure -- the server caller resolves it
 * (`SUPPORT_EMAIL`) and passes it through.
 */
export function buildBusinessSnapshot(supportEmail: string | null = null): DocumentBusinessSnapshot {
  return {
    legalName: LEGAL_ENTITY_NAME,
    entityType: LEGAL_ENTITY_TYPE,
    gstin: LEGAL_GSTIN,
    addressLine1: LEGAL_ADDRESS_LINE_1,
    addressLine2: LEGAL_ADDRESS_LINE_2,
    city: LEGAL_CITY,
    state: LEGAL_STATE,
    stateCode: LEGAL_GSTIN.slice(0, 2),
    postalCode: LEGAL_POSTAL_CODE,
    country: LEGAL_COUNTRY,
    supportEmail,
  };
}

const IST_TIME_ZONE = 'Asia/Kolkata';
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `d MMM yyyy` in IST, e.g. "24 Sep 2026". Built from Intl.DateTimeFormat's numeric parts rather
 * than its own month name (`month: 'short'`) so the abbreviation never depends on which ICU data a
 * given Node build ships (en-GB's CLDR abbreviates September as "Sept" in some ICU versions). */
export function formatIstDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);

  const byType: Record<string, string> = {};
  for (const part of parts) byType[part.type] = part.value;

  const month = Number(byType.month);
  if (!month || month < 1 || month > 12) return null;

  return `${Number(byType.day)} ${MONTH_ABBREVIATIONS[month - 1]} ${byType.year}`;
}

/** "24 Sep 2026 to 24 Oct 2026". Null when either end is missing/unparseable -- a caller then omits
 * the range from its line description rather than printing a broken half of one. */
export function formatIstDateRange(start: string | null | undefined, end: string | null | undefined): string | null {
  const startText = formatIstDate(start);
  const endText = formatIstDate(end);
  if (!startText || !endText) return null;
  return `${startText} to ${endText}`;
}

export interface TopupInvoiceLineInput {
  kind: 'topup';
  packName: string;
  netMinor: number;
  sac?: string | null;
}

export interface SubscriptionInvoiceLineInput {
  kind: 'subscription';
  planName: string;
  billingInterval: BillingInterval;
  cycleStart: string | null;
  cycleEnd: string | null;
  netMinor: number;
  sac?: string | null;
}

export type InvoiceLineItemsInput = TopupInvoiceLineInput | SubscriptionInvoiceLineInput;

/**
 * One printed line for a fresh tax invoice (plan §4 A3): a top-up or a subscription payment is
 * always a single line item -- Kissago never sells more than one thing per charge.
 */
export function buildInvoiceLineItems(input: InvoiceLineItemsInput): BillingDocumentLineItem[] {
  const sac = input.sac ?? DEFAULT_SERVICE_SAC;

  if (input.kind === 'topup') {
    return [
      {
        description: `${input.packName} — Kissago coins top-up`,
        sac,
        quantity: 1,
        unit: 'NOS',
        netMinor: input.netMinor,
      },
    ];
  }

  const intervalLabel = input.billingInterval === 'annual' ? 'annual' : 'monthly';
  const range = formatIstDateRange(input.cycleStart, input.cycleEnd);
  const description = `Kissago ${input.planName} plan — ${intervalLabel} subscription${range ? `, ${range}` : ''}`;

  return [
    {
      description,
      sac,
      quantity: 1,
      unit: 'NOS',
      netMinor: input.netMinor,
    },
  ];
}

export interface CreditNoteOriginalInput {
  documentNumber: string;
  lineItems: BillingDocumentLineItem[];
}

export interface CreditNoteRefundInput {
  netMinor: number;
}

/**
 * Mirrors the original invoice's lines onto a credit note, prefixed with "Refund against invoice
 * <number>" (Rule 53). Each line's share of the refund is proportional to its share of the original
 * net total, with the last line taking the rounding remainder so the lines always sum to exactly
 * `refund.netMinor` -- for the common case (decision 11: refunds are full-only, and every invoice
 * here is a single line) this is just that one line, unchanged but for the description and the
 * refund's own net standing in for the original's.
 */
export function buildCreditNoteLineItems(
  original: CreditNoteOriginalInput,
  refund: CreditNoteRefundInput
): BillingDocumentLineItem[] {
  const prefix = `Refund against invoice ${original.documentNumber}`;
  const sourceLines: BillingDocumentLineItem[] =
    original.lineItems.length > 0
      ? original.lineItems
      : [{ description: 'Kissago charge', sac: DEFAULT_SERVICE_SAC, quantity: 1, unit: 'NOS', netMinor: refund.netMinor }];

  const originalTotalNet = sourceLines.reduce((sum, line) => sum + line.netMinor, 0);

  let allocated = 0;
  return sourceLines.map((line, index) => {
    const isLast = index === sourceLines.length - 1;
    const share = isLast
      ? refund.netMinor - allocated
      : originalTotalNet > 0
        ? Math.round((line.netMinor / originalTotalNet) * refund.netMinor)
        : 0;
    allocated += share;

    return {
      description: `${prefix}: ${line.description}`,
      sac: line.sac,
      quantity: line.quantity,
      unit: line.unit,
      netMinor: share,
    };
  });
}

/**
 * The customer block a document is issued with: the payment's own frozen snapshot first (who was
 * actually billed at the time), else the live billing profile, else the minimal fallback the plan
 * allows (§4 A3) -- a place of supply and 'personal', so a document can still issue for a payment
 * whose customer_snapshot_json predates Phase 5 and whose profile has since been deleted.
 */
export function resolveCustomerSnapshot(
  paymentSnapshot: DocumentCustomerSnapshot | Record<string, unknown> | null | undefined,
  liveProfileSnapshot: DocumentCustomerSnapshot | Record<string, unknown> | null | undefined,
  taxBreakdown: Partial<TaxBreakdown> | null | undefined
): DocumentCustomerSnapshot {
  if (paymentSnapshot && Object.keys(paymentSnapshot).length > 0) {
    return paymentSnapshot as DocumentCustomerSnapshot;
  }
  if (liveProfileSnapshot && Object.keys(liveProfileSnapshot).length > 0) {
    return liveProfileSnapshot as DocumentCustomerSnapshot;
  }
  return { stateCode: taxBreakdown?.placeOfSupplyStateCode ?? '', profileType: 'personal' };
}

/**
 * A credit note's own tax breakdown: the original payment's rule, rate and place of supply, with the
 * CGST/SGST/IGST amounts recomputed from the refund's tax. Copying the payment's breakdown as-is would
 * print the whole invoice's tax on a credit note for a partial refund made from the Razorpay dashboard.
 */
export function refundTaxBreakdown(
  paymentBreakdown: Partial<TaxBreakdown> | null | undefined,
  refundTaxMinor: number
): Partial<TaxBreakdown> | null {
  if (!paymentBreakdown || Object.keys(paymentBreakdown).length === 0) return null;
  const supplyType = paymentBreakdown.supplyType ?? 'none';
  return { ...paymentBreakdown, ...splitGstComponents(refundTaxMinor, supplyType) };
}
