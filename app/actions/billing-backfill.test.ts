import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  verifyAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/billing/backfill', () => ({
  backfillHistoricalBillingPayments: vi.fn(),
}));

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { backfillHistoricalBillingPayments } from '@/lib/billing/backfill';
import { runBillingPaymentsBackfill } from './billing-backfill';

const verifyAdminMock = vi.mocked(verifyAdmin);
const createAdminClientMock = vi.mocked(createAdminClient);
const backfillHistoricalBillingPaymentsMock = vi.mocked(backfillHistoricalBillingPayments);

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({} as any);
});

describe('runBillingPaymentsBackfill', () => {
  it('requires an admin before touching the database', async () => {
    verifyAdminMock.mockRejectedValueOnce(new Error('Forbidden'));

    await expect(runBillingPaymentsBackfill()).rejects.toThrow('Forbidden');
    expect(backfillHistoricalBillingPaymentsMock).not.toHaveBeenCalled();
  });

  it('delegates to backfillHistoricalBillingPayments and returns its result', async () => {
    verifyAdminMock.mockResolvedValueOnce({ user: { id: 'admin-1' } } as any);
    backfillHistoricalBillingPaymentsMock.mockResolvedValueOnce({
      scanned: 2,
      inserted: 2,
      skippedAlreadyRecorded: 0,
      skippedIneligible: 0,
      hasMore: false,
      lastOrderId: 'order-2',
    });

    const result = await runBillingPaymentsBackfill({ limit: 100, afterId: 'order-0' });

    expect(backfillHistoricalBillingPaymentsMock).toHaveBeenCalledWith(expect.anything(), { limit: 100, afterId: 'order-0' });
    expect(result.inserted).toBe(2);
  });
});
