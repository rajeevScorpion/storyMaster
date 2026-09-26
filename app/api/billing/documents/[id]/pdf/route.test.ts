import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/pricing/enforcement', () => ({
  isAdminUserId: vi.fn(),
}));

vi.mock('@/lib/billing/documents/storage', () => ({
  loadBillingDocumentRow: vi.fn(),
  ensureDocumentPdf: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { isAdminUserId } from '@/lib/pricing/enforcement';
import { loadBillingDocumentRow, ensureDocumentPdf } from '@/lib/billing/documents/storage';
import { GET } from './route';
import type { BillingDocumentRow } from '@/lib/billing/documents/types.shared';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4, Unit B5): modelled on
 * app/api/billing/razorpay/prepare/route.test.ts -- mocks every module the route directly imports so
 * its own wiring (the auth check, the subject_ref-or-admin ownership rule, 404-never-403, the
 * filename/headers) is exercised without a real Supabase client or a real PDF render.
 */

const createClientMock = vi.mocked(createClient);
const isAdminUserIdMock = vi.mocked(isAdminUserId);
const loadBillingDocumentRowMock = vi.mocked(loadBillingDocumentRow);
const ensureDocumentPdfMock = vi.mocked(ensureDocumentPdf);

const DOCUMENT_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = 'owner-user-id';
const OTHER_ID = 'other-user-id';
const ADMIN_ID = 'admin-user-id';

function fakeRow(overrides: Partial<BillingDocumentRow> = {}): BillingDocumentRow {
  return {
    id: DOCUMENT_ID,
    subject_ref: OWNER_ID,
    document_type: 'tax_invoice',
    document_number: 'KG/26-27/000001',
    financial_year: '2026-27',
    provider_mode: 'live',
    issued_at: '2026-09-24T00:00:00.000Z',
    payment_id: 'payment-1',
    refund_id: null,
    original_document_id: null,
    currency_code: 'INR',
    net_minor: 45000,
    tax_minor: 8100,
    gross_minor: 53100,
    tax_breakdown_json: null,
    line_items_json: [],
    customer_snapshot_json: null,
    business_snapshot_json: null,
    status: 'issued',
    storage_ref: null,
    ...overrides,
  };
}

function fakeSupabaseAuth(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: null }
      ),
    },
  };
}

function getRequest(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [new Request(`http://localhost/api/billing/documents/${id}/pdf`), { params: Promise.resolve({ id }) }];
}

beforeEach(() => {
  vi.clearAllMocks();
  isAdminUserIdMock.mockReturnValue(false);
});

describe('GET /api/billing/documents/[id]/pdf -- auth', () => {
  it('401s when signed out', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(null) as any);

    const response = await GET(...getRequest(DOCUMENT_ID));

    expect(response.status).toBe(401);
    expect(loadBillingDocumentRowMock).not.toHaveBeenCalled();
  });

  it('404s an invalid id shape before touching the database', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(OWNER_ID) as any);

    const response = await GET(...getRequest('not-a-uuid'));

    expect(response.status).toBe(404);
    expect(loadBillingDocumentRowMock).not.toHaveBeenCalled();
  });

  it('404s a genuinely missing document', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(OWNER_ID) as any);
    loadBillingDocumentRowMock.mockResolvedValue(null);

    const response = await GET(...getRequest(DOCUMENT_ID));

    expect(response.status).toBe(404);
    expect(ensureDocumentPdfMock).not.toHaveBeenCalled();
  });

  it('404s -- never 403 -- for a document owned by someone else', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(OTHER_ID) as any);
    loadBillingDocumentRowMock.mockResolvedValue(fakeRow());

    const response = await GET(...getRequest(DOCUMENT_ID));

    expect(response.status).toBe(404);
    expect(ensureDocumentPdfMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/billing/documents/[id]/pdf -- success', () => {
  it('200s for the document\'s own owner, with a PDF body and a sanitised filename', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(OWNER_ID) as any);
    const row = fakeRow();
    loadBillingDocumentRowMock.mockResolvedValue(row);
    ensureDocumentPdfMock.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), row });

    const response = await GET(...getRequest(DOCUMENT_ID));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Kissago-KG-26-27-000001.pdf"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('200s for the admin even when the document belongs to someone else', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(ADMIN_ID) as any);
    isAdminUserIdMock.mockReturnValue(true);
    const row = fakeRow({ subject_ref: OWNER_ID });
    loadBillingDocumentRowMock.mockResolvedValue(row);
    ensureDocumentPdfMock.mockResolvedValue({ bytes: new Uint8Array([9]), row });

    const response = await GET(...getRequest(DOCUMENT_ID));

    expect(response.status).toBe(200);
    expect(isAdminUserIdMock).toHaveBeenCalledWith(ADMIN_ID);
  });
});

describe('GET /api/billing/documents/[id]/pdf -- render failure', () => {
  it('502s when ensureDocumentPdf throws, without leaking the error', async () => {
    createClientMock.mockResolvedValue(fakeSupabaseAuth(OWNER_ID) as any);
    loadBillingDocumentRowMock.mockResolvedValue(fakeRow());
    ensureDocumentPdfMock.mockRejectedValue(new Error('R2 is on fire'));

    const response = await GET(...getRequest(DOCUMENT_ID));

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('R2 is on fire');
  });
});
