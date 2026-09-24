/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B2): the pure layout model for a rendered
 * tax invoice or credit note. `buildDocumentView` takes a frozen `billing_documents` row (and, for a
 * credit note, the original invoice's own number/date -- Rule 53) and returns everything the PDF
 * renderer (render-pdf.ts) prints, with no further decisions left for it to make. Isomorphic and pure
 * so the CGST/SGST-vs-IGST choice, the Rule 46 recipient-detail threshold and the amount-in-words
 * conversion are unit-testable without pdf-lib or a database.
 *
 * Rule 46 (CGST Rules, via ClearTax -- plan §1 "Law"): a registered recipient's GSTIN is always
 * printed when known; an unregistered recipient's name/address/state are only a legal requirement at
 * gross value >= INR 50,000 -- below that we simply may not have collected them, so the buyer block
 * omits name/address rather than printing blanks. Place of supply is a separate, always-mandatory
 * field, independent of that threshold.
 */

import type {
  BillingDocumentLineItem,
  BillingDocumentRow,
  DocumentBusinessSnapshot,
  DocumentCustomerSnapshot,
  OriginalDocumentReference,
} from '@/lib/billing/documents/types.shared';
import type { TaxBreakdown } from '@/lib/billing/tax.shared';
import { indiaStateName } from '@/lib/billing/india-states.shared';

/** Rule 46(f): recipient identity (name/address/state) is only mandatory for an unregistered buyer
 * at or above this gross value. GSTIN, when the buyer is registered, is shown regardless of value. */
const UNREGISTERED_BUYER_DETAIL_THRESHOLD_MINOR = 50_000 * 100;

export interface DocumentViewLineItem {
  description: string;
  sac: string | null;
  quantity: number;
  unit: string;
  taxableValueMinor: number;
}

export interface DocumentViewTaxRow {
  label: 'CGST' | 'SGST' | 'IGST';
  ratePercent: number;
  amountMinor: number;
}

export interface DocumentViewParty {
  legalName: string | null;
  gstin: string | null;
  addressLines: string[];
  city: string | null;
  postalCode: string | null;
  state: string | null;
  stateCode: string | null;
  country: string | null;
}

export interface DocumentViewOriginalReference {
  documentNumber: string;
  issuedAt: string;
}

export interface DocumentView {
  title: string;
  copyLabel: string;
  documentNumber: string;
  documentDate: string;
  financialYear: string;
  providerMode: 'test' | 'live';
  seller: DocumentViewParty;
  buyer: DocumentViewParty;
  /** Whether the buyer's name/address are printed at all -- false only for an unregistered buyer
   * below the Rule 46(f) threshold, where we omit rather than print blanks. */
  buyerIdentityShown: boolean;
  placeOfSupply: string;
  reference: { kind: 'payment' | 'refund'; id: string } | null;
  originalReference: DocumentViewOriginalReference | null;
  lineItems: DocumentViewLineItem[];
  taxRows: DocumentViewTaxRow[];
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  currencyCode: string;
  amountInWords: string;
  reverseCharge: 'No';
  footerNote: string;
  testBanner: string | null;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** `d MMM yyyy` in IST -- same offset-shift technique as lib/billing/financial-year.shared.ts, kept
 * independent of it since this only needs a display string, not a financial-year boundary. */
export function formatIstDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return `${ist.getUTCDate()} ${MONTH_NAMES[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]}-${ONES[ones]}`;
}

function threeDigitWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(twoDigitWords(rest));
  return parts.length > 0 ? parts.join(' ') : 'Zero';
}

/** Indian digit grouping (crore / lakh / thousand / hundred), not the international thousand-group
 * used everywhere else -- this is specifically for the legal "amount in words" line. Handles 0 up to
 * 999,99,99,999 (comfortably past any real invoice). */
export function numberToIndianWords(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`numberToIndianWords: expected a non-negative integer, got ${value}`);
  }
  if (value === 0) return 'Zero';

  const crore = Math.floor(value / 1e7);
  const lakh = Math.floor((value % 1e7) / 1e5);
  const thousand = Math.floor((value % 1e5) / 1e3);
  const hundred = value % 1e3;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(threeDigitWords(hundred));
  return parts.join(' ');
}

/** "Indian Rupees Five Hundred Thirty-One Only" (no paise) or "... Four Hundred Fifty and
 * Eighty-One Paise Only" (paise present). `grossMinor` is integer paise, as stored on the row. */
export function amountInWordsIndian(grossMinor: number): string {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) {
    throw new Error(`amountInWordsIndian: expected a non-negative integer minor amount, got ${grossMinor}`);
  }
  const rupees = Math.floor(grossMinor / 100);
  const paise = grossMinor % 100;
  const rupeeWords = numberToIndianWords(rupees);
  if (paise === 0) return `Indian Rupees ${rupeeWords} Only`;
  return `Indian Rupees ${rupeeWords} and ${numberToIndianWords(paise)} Paise Only`;
}

function documentTitle(documentType: BillingDocumentRow['document_type']): string {
  if (documentType === 'tax_invoice') return 'Tax Invoice';
  if (documentType === 'credit_note') return 'Credit Note';
  return 'Receipt';
}

function buildSellerParty(business: DocumentBusinessSnapshot | null): DocumentViewParty {
  if (!business) {
    return {
      legalName: null, gstin: null, addressLines: [], city: null, postalCode: null,
      state: null, stateCode: null, country: null,
    };
  }
  return {
    legalName: business.legalName,
    gstin: business.gstin,
    addressLines: [business.addressLine1, business.addressLine2].filter((v): v is string => Boolean(v)),
    city: business.city,
    postalCode: business.postalCode,
    state: business.state,
    stateCode: business.stateCode,
    country: business.country,
  };
}

function buildBuyerParty(
  customer: DocumentCustomerSnapshot | null,
  tax: Partial<TaxBreakdown> | null,
  grossMinor: number
): { party: DocumentViewParty; identityShown: boolean } {
  const stateCode = customer?.stateCode ?? tax?.placeOfSupplyStateCode ?? null;
  const state = customer?.stateName ?? (stateCode ? indiaStateName(stateCode) : null);
  const gstin = customer?.gstin ?? null;

  // Rule 46(f): identity is shown whenever the buyer is registered (GSTIN present), and otherwise
  // only once the value crosses the unregistered-recipient threshold.
  const identityShown = Boolean(gstin) || grossMinor >= UNREGISTERED_BUYER_DETAIL_THRESHOLD_MINOR;

  return {
    identityShown,
    party: {
      legalName: identityShown ? (customer?.companyName ?? customer?.legalName ?? null) : null,
      gstin,
      addressLines: identityShown
        ? [customer?.addressLine1, customer?.addressLine2].filter((v): v is string => Boolean(v))
        : [],
      city: identityShown ? (customer?.city ?? null) : null,
      postalCode: identityShown ? (customer?.postalCode ?? null) : null,
      state,
      stateCode,
      country: identityShown ? (customer?.countryCode ?? null) : null,
    },
  };
}

function buildTaxRows(tax: Partial<TaxBreakdown> | null): DocumentViewTaxRow[] {
  if (!tax || !tax.ratePercent || tax.supplyType === 'none' || !tax.supplyType) return [];
  if (tax.supplyType === 'inter_state') {
    return [{ label: 'IGST', ratePercent: tax.ratePercent, amountMinor: tax.igstMinor ?? 0 }];
  }
  const half = tax.ratePercent / 2;
  return [
    { label: 'CGST', ratePercent: half, amountMinor: tax.cgstMinor ?? 0 },
    { label: 'SGST', ratePercent: half, amountMinor: tax.sgstMinor ?? 0 },
  ];
}

function buildReference(row: BillingDocumentRow): { kind: 'payment' | 'refund'; id: string } | null {
  if (row.payment_id) return { kind: 'payment', id: row.payment_id };
  if (row.refund_id) return { kind: 'refund', id: row.refund_id };
  return null;
}

function mapLineItems(items: BillingDocumentLineItem[] | null): DocumentViewLineItem[] {
  return (items ?? []).map((item) => ({
    description: item.description,
    sac: item.sac,
    quantity: item.quantity,
    unit: item.unit,
    taxableValueMinor: item.netMinor,
  }));
}

/**
 * Builds everything the PDF renderer prints from one frozen `billing_documents` row. `originalDoc` is
 * the Rule 53 reference for a credit note (its original invoice's own number and issue date) --
 * optional so this stays a pure function of data the caller already has in hand (the download route
 * loads it; A3's issuer has it at issue time too), and simply omitted (not fabricated) when a credit
 * note's caller didn't supply one.
 */
export function buildDocumentView(
  row: BillingDocumentRow,
  originalDoc?: OriginalDocumentReference | null
): DocumentView {
  const tax = row.tax_breakdown_json;
  const buyer = buildBuyerParty(row.customer_snapshot_json, tax, row.gross_minor);
  const placeOfSupplyCode = tax?.placeOfSupplyStateCode ?? buyer.party.stateCode ?? null;
  const placeOfSupplyName = placeOfSupplyCode ? (indiaStateName(placeOfSupplyCode) ?? placeOfSupplyCode) : 'Unknown';

  const sellerLegalName = row.business_snapshot_json?.legalName ?? 'Kissago';

  return {
    title: documentTitle(row.document_type),
    copyLabel: 'Original for recipient',
    documentNumber: row.document_number,
    documentDate: formatIstDate(row.issued_at),
    financialYear: row.financial_year,
    providerMode: row.provider_mode,
    seller: buildSellerParty(row.business_snapshot_json),
    buyer: buyer.party,
    buyerIdentityShown: buyer.identityShown,
    placeOfSupply: placeOfSupplyCode ? `${placeOfSupplyName} (${placeOfSupplyCode})` : placeOfSupplyName,
    reference: buildReference(row),
    originalReference:
      row.document_type === 'credit_note' && originalDoc
        ? { documentNumber: originalDoc.documentNumber, issuedAt: formatIstDate(originalDoc.issuedAt) }
        : null,
    lineItems: mapLineItems(row.line_items_json),
    taxRows: buildTaxRows(tax),
    netMinor: row.net_minor,
    taxMinor: row.tax_minor,
    grossMinor: row.gross_minor,
    currencyCode: row.currency_code,
    amountInWords: amountInWordsIndian(row.gross_minor),
    reverseCharge: 'No',
    footerNote: `Computer-generated document. Authorised signatory: ${sellerLegalName}`,
    testBanner: row.provider_mode === 'test' ? 'TEST — not a tax document' : null,
  };
}
