import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getPublishedTaxRule,
  invalidateTaxRuleCache,
  isMissingBillingTaxSchemaError,
  resetTaxRuleSchemaLatchForTests,
} from './tax-rules';
import type { DbBillingTaxRule } from '@/lib/types/database';

const createAdminClientMock = vi.mocked(createAdminClient);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

// Minimal awaitable stand-in for the supabase-js query builder, mirroring razorpay-sync.test.ts's
// FakeQueryBuilder: every chain method is a no-op passthrough and the builder itself is directly
// awaitable.
class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  is() { return this; }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function mockSupabaseResult(result: QueryResult) {
  createAdminClientMock.mockReturnValue({
    from: () => new FakeQueryBuilder(result),
  } as any);
}

function fakeRuleRow(overrides: Partial<DbBillingTaxRule> = {}): DbBillingTaxRule {
  return {
    id: 'rule-1',
    market_key: 'IN',
    applies_to: 'all',
    tax_regime: 'in_gst',
    rate_percent: 18,
    sac_code: '998439',
    supplier_state_code: '24',
    status: 'published',
    effective_from: '2026-09-17T00:00:00.000Z',
    effective_to: null,
    notes: null,
    created_at: '2026-09-17T00:00:00.000Z',
    updated_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  } as DbBillingTaxRule;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateTaxRuleCache();
  resetTaxRuleSchemaLatchForTests();
});

describe('isMissingBillingTaxSchemaError', () => {
  it('recognizes undefined_table (42P01) and the PostgREST schema-cache variants', () => {
    expect(isMissingBillingTaxSchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingBillingTaxSchemaError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingBillingTaxSchemaError({ code: '42703' })).toBe(true);
    expect(isMissingBillingTaxSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingBillingTaxSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('is false for an unrelated error, or none at all', () => {
    expect(isMissingBillingTaxSchemaError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingBillingTaxSchemaError(null)).toBe(false);
    expect(isMissingBillingTaxSchemaError(undefined)).toBe(false);
  });
});

describe('getPublishedTaxRule', () => {
  it('returns the published rule when one exists', async () => {
    mockSupabaseResult({ data: [fakeRuleRow()], error: null });

    const result = await getPublishedTaxRule('IN', 'topup');

    expect(result).toEqual({
      status: 'ok',
      rule: {
        id: 'rule-1',
        marketKey: 'IN',
        appliesTo: 'all',
        taxRegime: 'in_gst',
        ratePercent: 18,
        sacCode: '998439',
      },
    });
  });

  it('prefers an exact applies_to match over the "all" fallback row', async () => {
    mockSupabaseResult({
      data: [fakeRuleRow({ id: 'rule-all', applies_to: 'all' }), fakeRuleRow({ id: 'rule-topup', applies_to: 'topup', rate_percent: 5 })],
      error: null,
    });

    const result = await getPublishedTaxRule('IN', 'topup');

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.rule.id).toBe('rule-topup');
  });

  it('reports not_found when the table exists but nothing is published for this market/kind', async () => {
    mockSupabaseResult({ data: [], error: null });

    const result = await getPublishedTaxRule('IN', 'subscription');

    expect(result).toEqual({ status: 'not_found' });
  });

  it('reports unavailable, not a throw, when migration 125 is absent (undefined_table)', async () => {
    mockSupabaseResult({ data: null, error: { code: '42P01', message: 'relation "billing_tax_rules" does not exist' } });

    const result = await getPublishedTaxRule('IN', 'topup');

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('latches unavailable for the rest of the process after one missing-table error', async () => {
    mockSupabaseResult({ data: null, error: { code: '42P01', message: 'missing' } });
    await getPublishedTaxRule('IN', 'topup');

    // Even if the underlying client were to start returning real data (e.g. the migration is
    // applied mid-process), the latch should not re-query until the process restarts.
    mockSupabaseResult({ data: [fakeRuleRow()], error: null });
    const result = await getPublishedTaxRule('IN', 'topup');

    expect(result).toEqual({ status: 'unavailable' });
    expect(createAdminClientMock).toHaveBeenCalledTimes(1); // only the first call actually queried
  });

  it('caches a positive lookup for 60 seconds without re-querying', async () => {
    mockSupabaseResult({ data: [fakeRuleRow()], error: null });

    await getPublishedTaxRule('IN', 'topup');
    await getPublishedTaxRule('IN', 'topup');

    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a not_found result, so a freshly published rule is picked up on the next call', async () => {
    mockSupabaseResult({ data: [], error: null });
    await getPublishedTaxRule('IN', 'topup');

    mockSupabaseResult({ data: [fakeRuleRow()], error: null });
    const result = await getPublishedTaxRule('IN', 'topup');

    expect(result.status).toBe('ok');
    expect(createAdminClientMock).toHaveBeenCalledTimes(2);
  });
});
