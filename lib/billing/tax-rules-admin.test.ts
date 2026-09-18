import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  archiveTaxRule,
  listBillingTaxRules,
  publishTaxRule,
  resetTaxRuleAdminSchemaLatchForTests,
  saveTaxRuleDraft,
  validateTaxRuleDraftInput,
} from './tax-rules-admin';
import { resetTaxRuleSchemaLatchForTests } from './tax-rules';
import type { DbBillingTaxRule } from '@/lib/types/database';
import type { TaxRuleDraftInput } from '@/lib/types/pricing';

// --- A minimal, generic stand-in for the supabase-js query builder, mirroring
// lib/billing/razorpay-sync.test.ts's FakeQueryBuilder: every chain method is a no-op passthrough,
// and the builder is directly awaitable so callers that stop chaining early still resolve.
interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  order() { return this; }
  limit() { return this; }
  single(): Promise<QueryResult> { return Promise.resolve(this.result); }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: unknown;
}

function createFakeSupabase() {
  const queues: Record<string, QueryResult[]> = {};
  const calls: RecordedCall[] = [];

  function enqueue(table: string, op: RecordedCall['op'], result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: RecordedCall['op']): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`tax-rules-admin.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const supabase = {
    from(table: string) {
      return {
        select: (..._args: unknown[]) => {
          calls.push({ table, op: 'select' });
          return new FakeQueryBuilder(dequeue(table, 'select'));
        },
        insert: (row: unknown) => {
          calls.push({ table, op: 'insert', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'insert'));
        },
        update: (row: unknown) => {
          calls.push({ table, op: 'update', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'update'));
        },
      };
    },
  };

  return { supabase: supabase as any, enqueue, calls };
}

function fakeTaxRule(overrides: Partial<DbBillingTaxRule> = {}): DbBillingTaxRule {
  return {
    id: 'rule-1',
    market_key: 'IN',
    applies_to: 'all',
    tax_regime: 'in_gst',
    rate_percent: 18,
    sac_code: '998439',
    supplier_state_code: '24',
    status: 'draft',
    effective_from: '2026-09-17T00:00:00.000Z',
    effective_to: null,
    notes: null,
    created_at: '2026-09-17T00:00:00.000Z',
    updated_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  } as DbBillingTaxRule;
}

function fakeDraftInput(overrides: Partial<TaxRuleDraftInput> = {}): TaxRuleDraftInput {
  return {
    marketKey: 'IN',
    appliesTo: 'all',
    taxRegime: 'in_gst',
    ratePercent: 18,
    sacCode: '998439',
    supplierStateCode: '24',
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetTaxRuleAdminSchemaLatchForTests();
  // tax-rules-admin.ts reuses tax-rules.ts's own missing-schema predicate; its module-level cache
  // and latch are unrelated to the admin module's latch, but reset it too in case another test file
  // left it set within this same worker.
  resetTaxRuleSchemaLatchForTests();
});

describe('validateTaxRuleDraftInput', () => {
  it('accepts a valid draft', () => {
    expect(validateTaxRuleDraftInput(fakeDraftInput())).toBeNull();
  });

  it('rejects an out-of-range rate', () => {
    expect(validateTaxRuleDraftInput(fakeDraftInput({ ratePercent: 101 }))).toMatch(/between 0 and 100/);
    expect(validateTaxRuleDraftInput(fakeDraftInput({ ratePercent: -1 }))).toMatch(/between 0 and 100/);
    expect(validateTaxRuleDraftInput(fakeDraftInput({ ratePercent: Number.NaN }))).toMatch(/between 0 and 100/);
  });

  it('rejects an unknown supplier state code', () => {
    expect(validateTaxRuleDraftInput(fakeDraftInput({ supplierStateCode: '99' }))).toMatch(/valid indian state/i);
    expect(validateTaxRuleDraftInput(fakeDraftInput({ supplierStateCode: '25' }))).toMatch(/valid indian state/i);
  });

  it('rejects an invalid applies-to or tax regime', () => {
    expect(validateTaxRuleDraftInput(fakeDraftInput({ appliesTo: 'bogus' as any }))).toMatch(/applies-to/i);
    expect(validateTaxRuleDraftInput(fakeDraftInput({ taxRegime: 'bogus' as any }))).toMatch(/tax regime/i);
  });
});

describe('listBillingTaxRules', () => {
  it('returns the mapped rules for a market', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_tax_rules', 'select', { data: [fakeTaxRule()], error: null });

    const result = await listBillingTaxRules(supabase, 'IN');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.rules).toEqual([
        {
          id: 'rule-1',
          marketKey: 'IN',
          appliesTo: 'all',
          taxRegime: 'in_gst',
          ratePercent: 18,
          sacCode: '998439',
          supplierStateCode: '24',
          status: 'draft',
          effectiveFrom: '2026-09-17T00:00:00.000Z',
          effectiveTo: null,
          notes: null,
          createdAt: '2026-09-17T00:00:00.000Z',
          updatedAt: '2026-09-17T00:00:00.000Z',
        },
      ]);
    }
  });

  it('reports unavailable instead of throwing when the table is missing (migration 125 absent)', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_tax_rules', 'select', {
      data: null,
      error: { code: '42P01', message: 'relation "public.billing_tax_rules" does not exist' },
    });

    const result = await listBillingTaxRules(supabase, 'IN');
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('latches unavailable so a second call never re-queries the missing table', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    enqueue('billing_tax_rules', 'select', { data: null, error: { code: '42P01', message: 'missing' } });

    await listBillingTaxRules(supabase, 'IN');
    await listBillingTaxRules(supabase, 'IN');

    expect(calls.filter((call) => call.op === 'select')).toHaveLength(1);
  });
});

describe('saveTaxRuleDraft', () => {
  it('refuses invalid input without touching the database', async () => {
    const supabase = {
      from: () => {
        throw new Error('should not query the database for invalid input');
      },
    } as any;

    const result = await saveTaxRuleDraft(supabase, fakeDraftInput({ ratePercent: 200 }));
    expect(result.status).toBe('invalid');
  });

  it('refuses to edit a rule that is not a draft', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_tax_rules', 'select', { data: [fakeTaxRule({ id: 'rule-1', status: 'published' })], error: null });

    const result = await saveTaxRuleDraft(supabase, fakeDraftInput({ id: 'rule-1' }));

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toMatch(/only a draft/i);
    }
  });

  it('creates a new draft row', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const inserted = fakeTaxRule({ id: 'new-1' });
    enqueue('billing_tax_rules', 'insert', { data: inserted, error: null });
    enqueue('billing_tax_rules', 'select', { data: [inserted], error: null });

    const result = await saveTaxRuleDraft(supabase, fakeDraftInput());

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.rule.id).toBe('new-1');
    }
    const insertCall = calls.find((call) => call.op === 'insert');
    expect((insertCall?.payload as any).status).toBe('draft');
  });
});

const ADMIN_ID = 'admin-1';

describe('publishTaxRule', () => {
  it('archives the incumbent published rule before publishing the draft, in that order', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const draft = fakeTaxRule({ id: 'draft-1', status: 'draft', market_key: 'IN', applies_to: 'all' });
    const incumbent = fakeTaxRule({ id: 'pub-1', status: 'published', market_key: 'IN', applies_to: 'all', effective_to: null });
    const published = { ...draft, status: 'published' as const };

    enqueue('billing_tax_rules', 'select', { data: [draft], error: null }); // getTaxRuleById(draft)
    enqueue('billing_tax_rules', 'select', { data: [incumbent], error: null }); // incumbent lookup
    enqueue('billing_tax_rules', 'update', { data: null, error: null }); // archive incumbent
    enqueue('pricing_publish_audit', 'insert', { data: null, error: null }); // audit: archive + publish
    enqueue('billing_tax_rules', 'update', { data: published, error: null }); // publish draft
    enqueue('billing_tax_rules', 'select', { data: [published], error: null }); // refreshed list

    const result = await publishTaxRule(supabase, 'draft-1', ADMIN_ID);

    expect(result.status).toBe('ok');
    const updateCalls = calls.filter((call) => call.table === 'billing_tax_rules' && call.op === 'update');
    expect(updateCalls).toHaveLength(2);
    expect((updateCalls[0].payload as any).status).toBe('archived');
    expect((updateCalls[1].payload as any).status).toBe('published');

    const auditCalls = calls.filter((call) => call.table === 'pricing_publish_audit' && call.op === 'insert');
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls.map((call) => (call.payload as any).action_type)).toEqual(['archive', 'publish']);
    expect(auditCalls.every((call) => (call.payload as any).entity_type === 'tax_rule')).toBe(true);
    expect(auditCalls.every((call) => (call.payload as any).performed_by === ADMIN_ID)).toBe(true);
  });

  it('does not archive anything when there is no incumbent published rule', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const draft = fakeTaxRule({ id: 'draft-1', status: 'draft' });
    const published = { ...draft, status: 'published' as const };

    enqueue('billing_tax_rules', 'select', { data: [draft], error: null });
    enqueue('billing_tax_rules', 'select', { data: [], error: null }); // no incumbent
    enqueue('billing_tax_rules', 'update', { data: published, error: null }); // publish draft
    enqueue('pricing_publish_audit', 'insert', { data: null, error: null }); // audit: publish only
    enqueue('billing_tax_rules', 'select', { data: [published], error: null });

    const result = await publishTaxRule(supabase, 'draft-1', ADMIN_ID);

    expect(result.status).toBe('ok');
    const updateCalls = calls.filter((call) => call.table === 'billing_tax_rules' && call.op === 'update');
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0].payload as any).status).toBe('published');

    const auditCalls = calls.filter((call) => call.table === 'pricing_publish_audit' && call.op === 'insert');
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0].payload as any).action_type).toBe('publish');
  });

  it('refuses to publish a rule that is not a draft', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_tax_rules', 'select', { data: [fakeTaxRule({ id: 'rule-1', status: 'published' })], error: null });

    const result = await publishTaxRule(supabase, 'rule-1', ADMIN_ID);

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toMatch(/only a draft/i);
    }
  });

  it('surfaces a 23505 unique-violation on publish as a plain conflict message, not the raw Postgres error', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    const draft = fakeTaxRule({ id: 'draft-1', status: 'draft' });

    enqueue('billing_tax_rules', 'select', { data: [draft], error: null }); // getTaxRuleById
    enqueue('billing_tax_rules', 'select', { data: [], error: null }); // incumbent lookup: none seen
    enqueue('billing_tax_rules', 'update', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_billing_tax_rules_live"' },
    });

    const result = await publishTaxRule(supabase, 'draft-1', ADMIN_ID);

    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.message).not.toMatch(/uq_billing_tax_rules_live/);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('reports unavailable instead of throwing when the table is missing', async () => {
    const { supabase, enqueue } = createFakeSupabase();
    enqueue('billing_tax_rules', 'select', {
      data: null,
      error: { code: '42P01', message: 'relation "public.billing_tax_rules" does not exist' },
    });

    const result = await publishTaxRule(supabase, 'draft-1', ADMIN_ID);
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('still publishes successfully when the audit write raises 23514 (migration 128 not applied)', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const draft = fakeTaxRule({ id: 'draft-1', status: 'draft' });
    const published = { ...draft, status: 'published' as const };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    enqueue('billing_tax_rules', 'select', { data: [draft], error: null }); // getTaxRuleById
    enqueue('billing_tax_rules', 'select', { data: [], error: null }); // no incumbent
    enqueue('billing_tax_rules', 'update', { data: published, error: null }); // publish draft
    enqueue('pricing_publish_audit', 'insert', {
      data: null,
      error: { code: '23514', message: 'new row for relation "pricing_publish_audit" violates check constraint' },
    });
    enqueue('billing_tax_rules', 'select', { data: [published], error: null }); // refreshed list

    const result = await publishTaxRule(supabase, 'draft-1', ADMIN_ID);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.rule.status).toBe('published');
    }
    expect(calls.filter((call) => call.table === 'pricing_publish_audit')).toHaveLength(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe('archiveTaxRule', () => {
  it('archives a published rule', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const rule = fakeTaxRule({ id: 'rule-1', status: 'published' });
    const archived = { ...rule, status: 'archived' as const };

    enqueue('billing_tax_rules', 'select', { data: [rule], error: null });
    enqueue('billing_tax_rules', 'update', { data: archived, error: null });
    enqueue('pricing_publish_audit', 'insert', { data: null, error: null });
    enqueue('billing_tax_rules', 'select', { data: [archived], error: null });

    const result = await archiveTaxRule(supabase, 'rule-1', ADMIN_ID);

    expect(result.status).toBe('ok');
    const updateCall = calls.find((call) => call.table === 'billing_tax_rules' && call.op === 'update');
    expect((updateCall?.payload as any).status).toBe('archived');

    const auditCall = calls.find((call) => call.table === 'pricing_publish_audit' && call.op === 'insert');
    expect((auditCall?.payload as any)).toMatchObject({ entity_type: 'tax_rule', action_type: 'archive', performed_by: ADMIN_ID });
  });

  it('is a no-op success for a rule that is already archived', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const rule = fakeTaxRule({ id: 'rule-1', status: 'archived' });

    enqueue('billing_tax_rules', 'select', { data: [rule], error: null });
    enqueue('billing_tax_rules', 'select', { data: [rule], error: null }); // refreshed list

    const result = await archiveTaxRule(supabase, 'rule-1', ADMIN_ID);

    expect(result.status).toBe('ok');
    expect(calls.some((call) => call.op === 'update')).toBe(false);
    expect(calls.some((call) => call.table === 'pricing_publish_audit')).toBe(false);
  });

  it('still archives successfully when the audit write raises 23514 (migration 128 not applied)', async () => {
    const { supabase, enqueue, calls } = createFakeSupabase();
    const rule = fakeTaxRule({ id: 'rule-1', status: 'published' });
    const archived = { ...rule, status: 'archived' as const };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    enqueue('billing_tax_rules', 'select', { data: [rule], error: null });
    enqueue('billing_tax_rules', 'update', { data: archived, error: null });
    enqueue('pricing_publish_audit', 'insert', {
      data: null,
      error: { code: '23514', message: 'new row for relation "pricing_publish_audit" violates check constraint' },
    });
    enqueue('billing_tax_rules', 'select', { data: [archived], error: null });

    const result = await archiveTaxRule(supabase, 'rule-1', ADMIN_ID);

    expect(result.status).toBe('ok');
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
