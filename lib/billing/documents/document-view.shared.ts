/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B2): the pure layout model for a rendered
 * tax invoice or credit note. `buildDocumentView` takes a frozen `billing_documents` row (and, for a
 * credit note, the original invoice's own number/date -- Rule 53) and returns everything the PDF
 * renderer (render-pdf.ts) prints, with no further decisions left for it to make. Isomorphic and pure
 * so the CGST/SGST-vs-IGST choice, the buyer block and the amount-in-words
 * conversion are unit-testable without pdf-lib or a database.
 *
 * Rule 46 (CGST Rules, via ClearTax -- plan §1 "Law"): a registered recipient's GSTIN is always
 * printed when known. An unregistered recipient's name and address are only *mandatory* from INR
 * 50,000, but the rule is a floor, not a ceiling: whatever the buyer gave us is printed at any value,
 * since a customer expects their own name on their invoice. Place of supply is printed regardless.
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
import { billingCountryName } from '@/lib/billing/international.shared';
import { LEGAL_LUT_ARN } from '@/lib/legal/business-config';

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
  /** Whether any buyer identity (name, GSTIN or address) is known -- false only for a document issued
   * from the minimal fallback snapshot, which the renderer prints as "Unregistered recipient". */
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
  /** Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): Rule 46's export-under-LUT wording,
   * only for a document whose tax_breakdown_json.supplyType is 'export' -- null for every India
   * document, unchanged. See buildExportEndorsement. */
  exportEndorsement: string | null;
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

/** Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): Western thousand/million grouping
 * (thousand, million, billion), not the Indian crore/lakh grouping above -- for a USD export invoice's
 * "amount in words" line. Reuses threeDigitWords/twoDigitWords, which are grouping-agnostic. Handles 0
 * up to 999,999,999,999 (comfortably past any real invoice). */
export function numberToWesternWords(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`numberToWesternWords: expected a non-negative integer, got ${value}`);
  }
  if (value === 0) return 'Zero';

  const billion = Math.floor(value / 1e9);
  const million = Math.floor((value % 1e9) / 1e6);
  const thousand = Math.floor((value % 1e6) / 1e3);
  const hundred = value % 1e3;

  const parts: string[] = [];
  if (billion > 0) parts.push(`${threeDigitWords(billion)} Billion`);
  if (million > 0) parts.push(`${threeDigitWords(million)} Million`);
  if (thousand > 0) parts.push(`${threeDigitWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(threeDigitWords(hundred));
  return parts.join(' ');
}

/** "US Dollars Twenty-Nine and Fifty Cents Only" (cents present) or "... Only" (a whole dollar
 * amount) -- the USD twin of amountInWordsIndian, for an export invoice. `grossMinor` is integer
 * cents, as stored on the row. */
export function amountInWordsUsd(grossMinor: number): string {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) {
    throw new Error(`amountInWordsUsd: expected a non-negative integer minor amount, got ${grossMinor}`);
  }
  const dollars = Math.floor(grossMinor / 100);
  const cents = grossMinor % 100;
  const dollarWords = numberToWesternWords(dollars);
  if (cents === 0) return `US Dollars ${dollarWords} Only`;
  return `US Dollars ${dollarWords} and ${numberToWesternWords(cents)} Cents Only`;
}

/** Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): Rule 46's export-under-LUT
 * endorsement, with the LUT ARN appended only once the owner has filed one (business-config.ts's
 * LEGAL_LUT_ARN, empty by default). A separate function from buildDocumentView so a test can exercise
 * both the with- and without-ARN wording directly, without needing to mock business-config's constant
 * import. */
export function buildExportEndorsement(lutArn: string): string {
  const base = 'Supply meant for export under LUT without payment of IGST';
  return lutArn ? `${base}. LUT ARN: ${lutArn}` : `${base}.`;
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

/** Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): billingCountryName maps a supported
 * code (IN, US) to its full name; billingCountryName('IN') is already 'India', so this keeps the
 * India output byte-identical while a US buyer now prints "United States" instead of the raw code. An
 * unrecognised code (should not happen -- checkout only accepts a supported country) falls back to the
 * upper-cased code itself rather than fabricating a name. */
function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return billingCountryName(code) ?? code.toUpperCase();
}

function buildBuyerParty(
  customer: DocumentCustomerSnapshot | null,
  tax: Partial<TaxBreakdown> | null
): { party: DocumentViewParty; identityShown: boolean } {
  const isExport = tax?.supplyType === 'export';
  const stateCode = customer?.stateCode ?? tax?.placeOfSupplyStateCode ?? null;
  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): an export buyer's city line prints
  // the US state's own code ("Austin, TX, 78701"), not its GST place-of-supply state name -- India's
  // non-export path is unchanged (the state name, as before).
  const state = isExport
    ? (customer?.region ?? null)
    : (customer?.stateName ?? (stateCode ? indiaStateName(stateCode) : null));
  const gstin = customer?.gstin ?? null;

  const legalName = customer?.companyName ?? customer?.legalName ?? null;
  const addressLines = [customer?.addressLine1, customer?.addressLine2].filter((v): v is string => Boolean(v));

  return {
    identityShown: Boolean(legalName || gstin || addressLines.length > 0),
    party: {
      legalName,
      gstin,
      addressLines,
      city: customer?.city ?? null,
      postalCode: customer?.postalCode ?? null,
      state,
      stateCode,
      country: countryName(customer?.countryCode),
    },
  };
}

function buildTaxRows(tax: Partial<TaxBreakdown> | null): DocumentViewTaxRow[] {
  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): an export supply prints an explicit
  // "IGST @ 0%" row rather than no tax row at all, so the zero-rating is visible on the invoice face --
  // checked first since ratePercent is itself 0 for the seeded ROW rule, which the falsy check below
  // would otherwise read as "no breakdown at all".
  if (tax?.supplyType === 'export') {
    return [{ label: 'IGST', ratePercent: 0, amountMinor: 0 }];
  }
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
  const isExport = tax?.supplyType === 'export';
  const buyer = buildBuyerParty(row.customer_snapshot_json, tax);
  const placeOfSupplyCode = tax?.placeOfSupplyStateCode ?? buyer.party.stateCode ?? null;
  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): '96' (FOREIGN_PLACE_OF_SUPPLY_CODE)
  // is never an Indian state code, so indiaStateName would otherwise print the raw digits -- an
  // export's place of supply reads "Other Countries (96)" instead.
  const placeOfSupplyName = isExport
    ? 'Other Countries'
    : placeOfSupplyCode
      ? (indiaStateName(placeOfSupplyCode) ?? placeOfSupplyCode)
      : 'Unknown';

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
    // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): chosen by the row's own
    // currency_code, not by isExport -- a future non-USD ROW currency would still want Western words.
    // INR keeps amountInWordsIndian, unchanged.
    amountInWords: row.currency_code === 'INR' ? amountInWordsIndian(row.gross_minor) : amountInWordsUsd(row.gross_minor),
    reverseCharge: 'No',
    footerNote: `Computer-generated document. Authorised signatory: ${sellerLegalName}`,
    testBanner: row.provider_mode === 'test' ? 'TEST — not a tax document' : null,
    exportEndorsement: isExport ? buildExportEndorsement(LEGAL_LUT_ARN) : null,
  };
}
