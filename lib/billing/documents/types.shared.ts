/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md): the shapes frozen into a billing_documents row
 * (migration 135) and read back to render it. Pure and isomorphic. Every snapshot field is nullable
 * because a document may be issued from a minimal fallback snapshot (plan §4 A3), and a renderer must
 * never assume a field the issuer could not supply.
 */

import type { TaxBreakdown } from '@/lib/billing/tax.shared';

export type IssuedDocumentType = 'tax_invoice' | 'credit_note';
export type DocumentProviderMode = 'test' | 'live';

/** One printed line. `netMinor` is the taxable value before GST. */
export interface BillingDocumentLineItem {
  description: string;
  sac: string | null;
  quantity: number;
  unit: string;
  netMinor: number;
}

/** The seller, frozen from lib/legal/business-config.ts at issue time. */
export interface DocumentBusinessSnapshot {
  legalName: string;
  entityType: string | null;
  gstin: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  stateCode: string;
  postalCode: string;
  country: string;
  supportEmail: string | null;
}

/** The buyer, as billing_payments.customer_snapshot_json stores it -- or the minimal fallback. */
export interface DocumentCustomerSnapshot {
  profileType?: 'personal' | 'business' | null;
  legalName?: string | null;
  companyName?: string | null;
  gstin?: string | null;
  billingEmail?: string | null;
  phone?: string | null;
  stateCode?: string | null;
  stateName?: string | null;
  countryCode?: string | null;
  /** Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): a foreign customer's state/province
   * code (e.g. a US state code) -- billing-profile.ts's BillingCustomerSnapshot has carried this since
   * Unit B; added here too so an export document's buyer block can print "Austin, TX, 78701" instead
   * of the GST place-of-supply state name. Always null/absent for an Indian snapshot. */
  region?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  capturedAt?: string | null;
  profileUpdatedAt?: string | null;
}

/** A billing_documents row as the renderer reads it (snake_case, straight from the database). */
export interface BillingDocumentRow {
  id: string;
  subject_ref: string;
  document_type: IssuedDocumentType | 'receipt';
  document_number: string;
  financial_year: string;
  provider_mode: DocumentProviderMode;
  issued_at: string;
  payment_id: string | null;
  refund_id: string | null;
  original_document_id: string | null;
  currency_code: string;
  net_minor: number;
  tax_minor: number;
  gross_minor: number;
  tax_breakdown_json: Partial<TaxBreakdown> | null;
  line_items_json: BillingDocumentLineItem[] | null;
  customer_snapshot_json: DocumentCustomerSnapshot | null;
  business_snapshot_json: DocumentBusinessSnapshot | null;
  status: 'issued' | 'void';
  storage_ref: string | null;
}

/** What a credit note prints about the invoice it reverses (Rule 53: number and date). */
export interface OriginalDocumentReference {
  documentNumber: string;
  issuedAt: string;
}
