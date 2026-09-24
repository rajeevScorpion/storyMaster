import { describe, expect, it } from 'vitest';

import {
  amountInWordsIndian,
  buildDocumentView,
  formatIstDate,
  numberToIndianWords,
} from '@/lib/billing/documents/document-view.shared';
import type { BillingDocumentRow, DocumentBusinessSnapshot } from '@/lib/billing/documents/types.shared';
import type { TaxBreakdown } from '@/lib/billing/tax.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B2): asserts every Rule 46 particular the
 * plan lists is present on the built view, the Rule 53 original-invoice reference for a credit note,
 * the amount-in-words conversion (0, 531, 1,00,300, a paise remainder), and the intra-/inter-state tax
 * row split. Fixture amounts mirror the sample-PDF fixture (Unit B's owner-facing sample): a 120-Coins
 * top-up, net 450.00, IGST 18% = 81.00, gross 531.00, Gujarat supplier vs. Maharashtra buyer.
 */

const BUSINESS_SNAPSHOT: DocumentBusinessSnapshot = {
  legalName: 'Aavriti Design Studio',
  entityType: 'Partnership Firm',
  gstin: '24ACLFA8196N1ZN',
  addressLine1: 'B601, Kunj Heights',
  addressLine2: 'Vavol',
  city: 'Gandhinagar',
  state: 'Gujarat',
  stateCode: '24',
  postalCode: '382016',
  country: 'India',
  supportEmail: 'support@kissago.cc',
};

const INTER_STATE_TAX: TaxBreakdown = {
  ruleId: 'rule-1',
  marketKey: 'in',
  appliesTo: 'topup',
  taxRegime: 'in_gst',
  ratePercent: 18,
  sacCode: '998439',
  supplierStateCode: '24',
  placeOfSupplyStateCode: '27',
  supplyType: 'inter_state',
  cgstMinor: 0,
  sgstMinor: 0,
  igstMinor: 8100,
};

const INTRA_STATE_TAX: TaxBreakdown = {
  ...INTER_STATE_TAX,
  placeOfSupplyStateCode: '24',
  supplyType: 'intra_state',
  igstMinor: 0,
  cgstMinor: 4050,
  sgstMinor: 4050,
};

function baseRow(overrides: Partial<BillingDocumentRow> = {}): BillingDocumentRow {
  return {
    id: 'doc-1',
    subject_ref: 'user-1',
    document_type: 'tax_invoice',
    document_number: 'KG/26-27/000001',
    financial_year: '2026-27',
    provider_mode: 'live',
    issued_at: '2026-09-24T10:15:00.000Z',
    payment_id: 'payment-1',
    refund_id: null,
    original_document_id: null,
    currency_code: 'INR',
    net_minor: 45000,
    tax_minor: 8100,
    gross_minor: 53100,
    tax_breakdown_json: INTER_STATE_TAX,
    line_items_json: [
      { description: '120 Coins — Kissago coins top-up', sac: '998439', quantity: 1, unit: 'NOS', netMinor: 45000 },
    ],
    customer_snapshot_json: {
      profileType: 'personal',
      legalName: 'Jane Doe',
      companyName: null,
      gstin: null,
      billingEmail: 'jane@example.com',
      phone: null,
      stateCode: '27',
      stateName: 'Maharashtra',
      countryCode: 'IN',
      addressLine1: '1 MG Road',
      addressLine2: null,
      city: 'Mumbai',
      postalCode: '400001',
      capturedAt: null,
      profileUpdatedAt: null,
    },
    business_snapshot_json: BUSINESS_SNAPSHOT,
    status: 'issued',
    storage_ref: null,
    ...overrides,
  };
}

describe('buildDocumentView -- Rule 46 particulars', () => {
  it('carries every field CGST Rule 46 requires on the built view', () => {
    const view = buildDocumentView(baseRow());

    // Supplier name, address, GSTIN.
    expect(view.seller.legalName).toBe('Aavriti Design Studio');
    expect(view.seller.gstin).toBe('24ACLFA8196N1ZN');
    expect(view.seller.addressLines.length).toBeGreaterThan(0);

    // Number and date.
    expect(view.documentNumber).toBe('KG/26-27/000001');
    expect(view.documentDate).toBe('24 Sep 2026');

    // Place of supply, state and code.
    expect(view.placeOfSupply).toBe('Maharashtra (27)');

    // SAC, description, quantity, taxable value.
    expect(view.lineItems).toHaveLength(1);
    expect(view.lineItems[0]).toMatchObject({
      description: '120 Coins — Kissago coins top-up',
      sac: '998439',
      quantity: 1,
      taxableValueMinor: 45000,
    });

    // Rate and IGST (inter-state fixture).
    expect(view.taxRows).toEqual([{ label: 'IGST', ratePercent: 18, amountMinor: 8100 }]);

    // Reverse charge line.
    expect(view.reverseCharge).toBe('No');

    // Signature / authorised signatory.
    expect(view.footerNote).toContain('Authorised signatory');
    expect(view.footerNote).toContain('Aavriti Design Studio');
  });

  it('shows the recipient GSTIN when the buyer is registered, regardless of value', () => {
    const view = buildDocumentView(
      baseRow({
        gross_minor: 100,
        customer_snapshot_json: {
          profileType: 'business',
          legalName: 'Acme Pvt Ltd',
          companyName: 'Acme Pvt Ltd',
          gstin: '27AAACA1234A1Z5',
          stateCode: '27',
          stateName: 'Maharashtra',
        },
      })
    );

    expect(view.buyer.gstin).toBe('27AAACA1234A1Z5');
    expect(view.buyerIdentityShown).toBe(true);
    expect(view.buyer.legalName).toBe('Acme Pvt Ltd');
  });

  it('omits an unregistered buyer\'s name/address below the Rule 46(f) threshold', () => {
    const view = buildDocumentView(
      baseRow({
        gross_minor: 4999_00, // INR 4,999.00 -- below the 50,000 threshold
        customer_snapshot_json: {
          profileType: 'personal',
          legalName: 'Jane Doe',
          gstin: null,
          stateCode: '27',
          stateName: 'Maharashtra',
          addressLine1: '1 MG Road',
        },
      })
    );

    expect(view.buyerIdentityShown).toBe(false);
    expect(view.buyer.legalName).toBeNull();
    expect(view.buyer.addressLines).toEqual([]);
    // Place of supply is unconditional, independent of the identity threshold.
    expect(view.placeOfSupply).toBe('Maharashtra (27)');
  });

  it('shows an unregistered buyer\'s name/address at or above the Rule 46(f) threshold', () => {
    const view = buildDocumentView(
      baseRow({
        gross_minor: 50_000_00, // exactly INR 50,000.00
        customer_snapshot_json: {
          profileType: 'personal',
          legalName: 'Jane Doe',
          gstin: null,
          stateCode: '27',
          stateName: 'Maharashtra',
          addressLine1: '1 MG Road',
          city: 'Mumbai',
        },
      })
    );

    expect(view.buyerIdentityShown).toBe(true);
    expect(view.buyer.legalName).toBe('Jane Doe');
    expect(view.buyer.addressLines).toEqual(['1 MG Road']);
  });
});

describe('buildDocumentView -- Rule 53 (credit note)', () => {
  it('prints the original invoice\'s number and date when supplied', () => {
    const view = buildDocumentView(
      baseRow({
        document_type: 'credit_note',
        payment_id: null,
        refund_id: 'refund-1',
        original_document_id: 'doc-original',
        line_items_json: [
          { description: 'Refund against invoice KG/26-27/000001', sac: '998439', quantity: 1, unit: 'NOS', netMinor: 45000 },
        ],
      }),
      { documentNumber: 'KG/26-27/000001', issuedAt: '2026-09-20T08:00:00.000Z' }
    );

    expect(view.title).toBe('Credit Note');
    expect(view.originalReference).toEqual({ documentNumber: 'KG/26-27/000001', issuedAt: '20 Sep 2026' });
    expect(view.reference).toEqual({ kind: 'refund', id: 'refund-1' });
  });

  it('never fabricates an original reference when the caller does not supply one', () => {
    const view = buildDocumentView(baseRow({ document_type: 'credit_note', payment_id: null, refund_id: 'refund-1' }));
    expect(view.originalReference).toBeNull();
  });
});

describe('buildDocumentView -- intra- vs inter-state tax rows', () => {
  it('splits into CGST + SGST for an intra-state supply', () => {
    const view = buildDocumentView(baseRow({ tax_breakdown_json: INTRA_STATE_TAX }));
    expect(view.taxRows).toEqual([
      { label: 'CGST', ratePercent: 9, amountMinor: 4050 },
      { label: 'SGST', ratePercent: 9, amountMinor: 4050 },
    ]);
  });

  it('uses a single IGST row for an inter-state supply', () => {
    const view = buildDocumentView(baseRow({ tax_breakdown_json: INTER_STATE_TAX }));
    expect(view.taxRows).toEqual([{ label: 'IGST', ratePercent: 18, amountMinor: 8100 }]);
  });
});

describe('buildDocumentView -- test-mode band', () => {
  it('adds the TEST band when provider_mode is test', () => {
    const view = buildDocumentView(baseRow({ provider_mode: 'test', document_number: 'TEST-KG/26-27/000001' }));
    expect(view.testBanner).toBe('TEST — not a tax document');
  });

  it('has no band for a live document', () => {
    const view = buildDocumentView(baseRow());
    expect(view.testBanner).toBeNull();
  });
});

describe('formatIstDate', () => {
  it('formats a UTC timestamp as d MMM yyyy in IST', () => {
    // 2026-03-31T19:00:00Z + 5:30 = 2026-04-01T00:30 IST -- crosses midnight, and the financial year.
    expect(formatIstDate('2026-03-31T19:00:00.000Z')).toBe('1 Apr 2026');
  });

  it('falls back gracefully on an invalid timestamp', () => {
    expect(formatIstDate('not-a-date')).toBe('Unknown date');
  });
});

describe('numberToIndianWords', () => {
  it('converts zero', () => {
    expect(numberToIndianWords(0)).toBe('Zero');
  });

  it('converts a plain three-digit number', () => {
    expect(numberToIndianWords(531)).toBe('Five Hundred Thirty-One');
  });

  it('converts a lakh-scale number using Indian grouping', () => {
    expect(numberToIndianWords(100_300)).toBe('One Lakh Three Hundred');
  });

  it('converts a crore-scale number', () => {
    expect(numberToIndianWords(1_23_45_678)).toBe('One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight');
  });

  it('rejects a negative or non-integer input', () => {
    expect(() => numberToIndianWords(-1)).toThrow();
    expect(() => numberToIndianWords(1.5)).toThrow();
  });
});

describe('amountInWordsIndian', () => {
  it('renders a whole-rupee amount with no paise clause', () => {
    expect(amountInWordsIndian(53100)).toBe('Indian Rupees Five Hundred Thirty-One Only');
  });

  it('renders zero', () => {
    expect(amountInWordsIndian(0)).toBe('Indian Rupees Zero Only');
  });

  it('renders a lakh-scale amount', () => {
    expect(amountInWordsIndian(100_300_00)).toBe('Indian Rupees One Lakh Three Hundred Only');
  });

  it('renders a paise remainder', () => {
    expect(amountInWordsIndian(45081)).toBe('Indian Rupees Four Hundred Fifty and Eighty-One Paise Only');
  });
});
