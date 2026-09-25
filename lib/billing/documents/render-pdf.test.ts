import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import crypto from 'node:crypto';

vi.mock('server-only', () => ({}));

import { renderDocumentPdf, wrapLine } from '@/lib/billing/documents/render-pdf';
import type { BillingDocumentRow, DocumentBusinessSnapshot } from '@/lib/billing/documents/types.shared';
import type { TaxBreakdown } from '@/lib/billing/tax.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B3): the plan's own acceptance test --
 * rendering the SAME row twice must produce byte-identical PDFs, since storage.ts re-renders on a
 * cache miss and the result must match whatever was already emailed/downloaded. See render-pdf.ts's
 * header comment for the two pdf-lib determinism traps this guards against (a random embedded-font
 * resource name, and updateInfoDict() stamping the real clock).
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

function sampleRow(overrides: Partial<BillingDocumentRow> = {}): BillingDocumentRow {
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
      stateCode: '27',
      stateName: 'Maharashtra',
      countryCode: 'IN',
      addressLine1: '1 MG Road',
      city: 'Mumbai',
      postalCode: '400001',
    },
    business_snapshot_json: BUSINESS_SNAPSHOT,
    status: 'issued',
    storage_ref: null,
    ...overrides,
  };
}

describe('renderDocumentPdf -- determinism', () => {
  it('renders the same row to byte-identical PDFs across two separate calls', async () => {
    const row = sampleRow();
    const first = await renderDocumentPdf(row);
    const second = await renderDocumentPdf(row);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('is byte-identical for a credit note with an original-invoice reference too', async () => {
    const row = sampleRow({
      document_type: 'credit_note',
      document_number: 'KGC/26-27/000001',
      payment_id: null,
      refund_id: 'refund-1',
      original_document_id: 'doc-original',
    });
    const originalDoc = { documentNumber: 'KG/26-27/000001', issuedAt: '2026-09-20T08:00:00.000Z' };

    const first = await renderDocumentPdf(row, originalDoc);
    const second = await renderDocumentPdf(row, originalDoc);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('stamps the PDF Info dict dates from issued_at, not the real clock', async () => {
    const row = sampleRow({ issued_at: '2025-01-02T03:04:05.000Z' });
    const bytes = await renderDocumentPdf(row);

    // Info dict objects land inside a compressed object stream, so parse back with pdf-lib rather
    // than substring-searching the raw bytes -- updateMetadata: false so loading doesn't itself
    // re-stamp ModDate with the real clock.
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(loaded.getCreationDate()?.toISOString()).toBe('2025-01-02T03:04:05.000Z');
    expect(loaded.getModificationDate()?.toISOString()).toBe('2025-01-02T03:04:05.000Z');
    expect(loaded.getProducer()).toBe('Kissago');
    expect(loaded.getCreator()).toBeUndefined();
    expect(loaded.getTitle()).toBeUndefined();
  });

  it('produces a well-formed PDF starting with the standard header', async () => {
    const bytes = await renderDocumentPdf(sampleRow());
    expect(Buffer.from(bytes).toString('latin1', 0, 5)).toBe('%PDF-');
  });

  it('renders different bytes for a materially different document', async () => {
    const invoiceBytes = await renderDocumentPdf(sampleRow());
    const creditNoteBytes = await renderDocumentPdf(
      sampleRow({ document_type: 'credit_note', payment_id: null, refund_id: 'refund-1', original_document_id: 'doc-original' }),
      { documentNumber: 'KG/26-27/000001', issuedAt: '2026-09-20T08:00:00.000Z' }
    );
    expect(Buffer.from(invoiceBytes).equals(Buffer.from(creditNoteBytes))).toBe(false);
  });
});

describe('renderDocumentPdf -- India unchanged (Payments Phase 8 §9, Unit D)', () => {
  // The plan's own acceptance step: an export/foreign document may now add lines this row never
  // triggers (the endorsement, the region-code city line, the country line), so this fixes a real
  // Indian invoice's bytes to the SHA-256 captured from the pre-Unit-D code -- a change here means an
  // India document moved, which the plan says must never happen.
  it('renders byte-identical to the pre-Unit-D hash for an unchanged Indian row', async () => {
    const bytes = await renderDocumentPdf(sampleRow());
    const hash = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    expect(bytes.length).toBe(18213);
    expect(hash).toBe('8f58fcb488ed4a93c50d46b5cc2601e083bf277d3bdacd54ae0db3af9e8a7551');
  });
});

describe('wrapLine', () => {
  // One point per character keeps the arithmetic readable.
  const measure = (s: string) => s.length;

  it('keeps a line that fits as one line', () => {
    expect(wrapLine('Gandhinagar, Gujarat', 40, measure)).toEqual(['Gandhinagar, Gujarat']);
  });

  it('breaks at word boundaries', () => {
    expect(wrapLine('104, building 15, sector 17, Kharghar', 18, measure)).toEqual([
      '104, building 15,',
      'sector 17,',
      'Kharghar',
    ]);
  });

  it('breaks a single word wider than the column by character', () => {
    expect(wrapLine('abcdefghij', 4, measure)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('returns no lines for blank input', () => {
    expect(wrapLine('   ', 10, measure)).toEqual([]);
  });
});
