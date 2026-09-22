import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveSubscriptionIncludedBeats } from './subscription-included-beats';

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

/** At most one call per table for this module (never a repeat), so one configured result each is enough. */
function createFakeSupabase(config: { billingOrders?: QueryResult; planVersions?: QueryResult }) {
  const calls: string[] = [];
  const supabase = {
    from(table: string) {
      calls.push(table);
      const result = table === 'billing_orders' ? config.billingOrders : config.planVersions;
      if (!result) throw new Error(`subscription-included-beats.test: no configured result for table "${table}"`);
      return new FakeQueryBuilder(result);
    },
  };
  return { supabase: supabase as any, calls };
}

describe('resolveSubscriptionIncludedBeats', () => {
  it('prefers the checkout order snapshot when it carries includedBeats', async () => {
    const { supabase, calls } = createFakeSupabase({
      billingOrders: { data: { purchase_snapshot_json: { includedBeats: 0 } }, error: null },
      planVersions: { data: { monthly_included_beats: 999 }, error: null }, // must NOT be read
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: 'plan-version-1',
    });
    expect(result).toBe(0);
    expect(calls).toEqual(['billing_orders']); // the plan version table was never queried
  });

  it('resolves a genuinely non-zero snapshot the same way', async () => {
    const { supabase } = createFakeSupabase({
      billingOrders: { data: { purchase_snapshot_json: { includedBeats: 120 } }, error: null },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: 'plan-version-1',
    });
    expect(result).toBe(120);
  });

  it('falls back to the plan version when the order has no snapshot', async () => {
    const { supabase } = createFakeSupabase({
      billingOrders: { data: null, error: null },
      planVersions: { data: { monthly_included_beats: 0 }, error: null },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: 'plan-version-1',
    });
    expect(result).toBe(0);
  });

  it('falls back to the plan version when the snapshot exists but has no includedBeats field', async () => {
    const { supabase } = createFakeSupabase({
      billingOrders: { data: { purchase_snapshot_json: { somethingElse: true } }, error: null },
      planVersions: { data: { monthly_included_beats: 300 }, error: null },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: 'plan-version-1',
    });
    expect(result).toBe(300);
  });

  it('skips the order lookup entirely with no provider subscription id', async () => {
    const { supabase, calls } = createFakeSupabase({
      planVersions: { data: { monthly_included_beats: 0 }, error: null },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: null,
      planVersionId: 'plan-version-1',
    });
    expect(result).toBe(0);
    expect(calls).toEqual(['pricing_plan_versions']);
  });

  it('returns null when nothing can be resolved -- no snapshot and no plan version id', async () => {
    const { supabase } = createFakeSupabase({
      billingOrders: { data: null, error: null },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: null,
    });
    expect(result).toBeNull();
  });

  it('returns null (fails closed) when the plan version query errors', async () => {
    const { supabase } = createFakeSupabase({
      billingOrders: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
      planVersions: { data: null, error: { message: 'boom' } },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: 'plan-version-1',
    });
    expect(result).toBeNull();
  });

  it('falls back to the plan version when the order query itself errors (e.g. schema absent)', async () => {
    const { supabase } = createFakeSupabase({
      billingOrders: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
      planVersions: { data: { monthly_included_beats: 120 }, error: null },
    });

    const result = await resolveSubscriptionIncludedBeats({
      supabase,
      providerSubscriptionId: 'sub_1',
      planVersionId: 'plan-version-1',
    });
    expect(result).toBe(120);
  });
});
