import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getR2ObjectBuffer, putR2Object } from '@/lib/media/r2-server';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { renderDocumentPdf } from '@/lib/billing/documents/render-pdf';
import type { BillingDocumentRow, OriginalDocumentReference } from '@/lib/billing/documents/types.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B4): `ensureDocumentPdf` is the one place
 * that turns a `billing_documents` id into PDF bytes, for both the download route and (once C2 lands)
 * the email processor. The stored PDF in private R2 is a CACHE of render-pdf.ts's deterministic
 * output, never the source of truth -- the row is -- so every failure mode here falls back to
 * rendering fresh rather than surfacing an error: a customer's download or a billing email must never
 * fail because R2 hiccuped.
 */

const DOCUMENT_ROW_COLUMNS =
  'id, subject_ref, document_type, document_number, financial_year, provider_mode, issued_at, ' +
  'payment_id, refund_id, original_document_id, currency_code, net_minor, tax_minor, gross_minor, ' +
  'tax_breakdown_json, line_items_json, customer_snapshot_json, business_snapshot_json, status, storage_ref';

export interface EnsureDocumentPdfResult {
  bytes: Uint8Array;
  row: BillingDocumentRow;
}

/** Loads a `billing_documents` row by id. Exported so the download route can do its own lightweight
 * ownership check without duplicating the column list. Returns null for a missing row or a database
 * that hasn't got migration 135 yet (fail closed, like every other billing schema read). */
export async function loadBillingDocumentRow(documentId: string): Promise<BillingDocumentRow | null> {
  const supabase = createAdminClient();
  const result = await supabase
    .from('billing_documents')
    .select(DOCUMENT_ROW_COLUMNS)
    .eq('id', documentId)
    .maybeSingle();

  if (result.error || !result.data) return null;
  return result.data as unknown as BillingDocumentRow;
}

async function loadOriginalReference(row: BillingDocumentRow): Promise<OriginalDocumentReference | null> {
  if (row.document_type !== 'credit_note' || !row.original_document_id) return null;

  const supabase = createAdminClient();
  const result = await supabase
    .from('billing_documents')
    .select('document_number, issued_at')
    .eq('id', row.original_document_id)
    .maybeSingle();

  if (result.error || !result.data) return null;
  const original = result.data as { document_number: string; issued_at: string };
  return { documentNumber: original.document_number, issuedAt: original.issued_at };
}

/**
 * Returns the PDF bytes for a document, plus the row they were built from (so the caller can name the
 * download without a second query). Order of operations:
 * 1. `storage_ref` set -> try reading it from R2. A hit returns immediately.
 * 2. Otherwise (or on a cache-read failure) render fresh from the row -- and the original invoice's
 *    reference too, for a credit note.
 * 3. Best-effort: if R2 is usable, write the render and set `storage_ref` (only `WHERE storage_ref IS
 *    NULL`, so a concurrent render can't clobber another's write) -- never awaited into the response.
 */
export async function ensureDocumentPdf(documentId: string): Promise<EnsureDocumentPdfResult | null> {
  const row = await loadBillingDocumentRow(documentId);
  if (!row) return null;

  if (row.storage_ref) {
    try {
      const cached = await getR2ObjectBuffer(row.storage_ref);
      if (cached) {
        return { bytes: new Uint8Array(cached.buffer.buffer, cached.buffer.byteOffset, cached.buffer.byteLength), row };
      }
    } catch (err) {
      console.warn('[billing.documents.storage] cached PDF read failed, re-rendering', {
        documentId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  const originalDoc = await loadOriginalReference(row);
  const bytes = await renderDocumentPdf(row, originalDoc);

  // Fire-and-forget: a failed cache write must never fail the download/email that's waiting on bytes.
  void cacheRenderedPdf(row, bytes).catch((err) => {
    console.warn('[billing.documents.storage] failed to cache rendered PDF', {
      documentId,
      error: err instanceof Error ? err.message : err,
    });
  });

  return { bytes, row };
}

async function cacheRenderedPdf(row: BillingDocumentRow, bytes: Uint8Array): Promise<void> {
  const config = await getEffectiveMediaStorageConfig();
  if (!config.r2.enabled || !config.r2.privateBucketName) return;

  const objectKey = `billing-documents/${row.provider_mode}/${row.financial_year}/${row.id}.pdf`;
  const result = await putR2Object({
    access: 'private',
    objectKey,
    body: Buffer.from(bytes),
    contentType: 'application/pdf',
    cacheControl: config.r2.cacheControlPrivate,
  });

  const supabase = createAdminClient();
  const update = await supabase
    .from('billing_documents')
    .update({ storage_ref: result.urlOrReference })
    .eq('id', row.id)
    .is('storage_ref', null);

  if (update.error) {
    console.warn('[billing.documents.storage] failed to record storage_ref', { documentId: row.id, error: update.error });
  }
}
