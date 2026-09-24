import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { isAdminUserId } from '@/lib/pricing/enforcement';
import { ensureDocumentPdf, loadBillingDocumentRow } from '@/lib/billing/documents/storage';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B5): the signed-in download for a tax
 * invoice or credit note. Modelled on app/api/media/r2/object/route.ts (auth via the session cookie,
 * `runtime='nodejs'` since ensureDocumentPdf reads font files with `fs`) but with its own ownership
 * rule: the caller must be the document's own `subject_ref`, or the admin.
 *
 * A wrong id, another user's document, and a genuinely missing row all answer 404 -- never 403, which
 * would confirm the id exists. The ownership check runs against a lightweight row load BEFORE
 * ensureDocumentPdf does any rendering, so a probe for someone else's id never pays for a PDF render.
 */

export const runtime = 'nodejs';

function isValidDocumentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function downloadFilename(documentNumber: string): string {
  const safe = documentNumber.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `Kissago-${safe}.pdf`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidDocumentId(id)) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const row = await loadBillingDocumentRow(id);
  if (!row) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const isOwner = row.subject_ref === user.id;
  if (!isOwner && !isAdminUserId(user.id)) {
    // Never 403 here -- that would confirm the id belongs to someone.
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  try {
    const result = await ensureDocumentPdf(id);
    if (!result) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
    }

    const bytes = result.bytes;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="${downloadFilename(result.row.document_number)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[billing.documents.pdf] failed to render/serve document', {
      documentId: id,
      error: err instanceof Error ? err.message : err,
    });
    return NextResponse.json({ error: "We couldn't load this document. Please try again." }, { status: 502 });
  }
}
