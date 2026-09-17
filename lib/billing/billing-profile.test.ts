import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  loadBillingProfile,
  resetBillingProfileSchemaLatchForTests,
  saveBillingProfile,
  validateBillingProfileInput,
} from './billing-profile';
import type { BillingProfileInput } from '@/lib/types/pricing';

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  upsert() { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  single(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function fakeSupabase(result: QueryResult) {
  return { from: () => new FakeQueryBuilder(result) } as any;
}

function validInput(overrides: Partial<BillingProfileInput> = {}): BillingProfileInput {
  return {
    legalName: 'Jane Doe',
    stateCode: '24',
    gstin: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetBillingProfileSchemaLatchForTests();
});

describe('validateBillingProfileInput', () => {
  it('accepts a minimal valid profile', () => {
    expect(validateBillingProfileInput(validInput())).toBeNull();
  });

  it('accepts a valid GSTIN', () => {
    expect(validateBillingProfileInput(validInput({ gstin: '24ACLFA8196N1ZN' }))).toBeNull();
  });

  it('rejects a missing or blank legal name', () => {
    expect(validateBillingProfileInput(validInput({ legalName: '' }))).toMatch(/legal name/i);
    expect(validateBillingProfileInput(validInput({ legalName: '   ' }))).toMatch(/legal name/i);
  });

  it('rejects an invalid or retired state code', () => {
    expect(validateBillingProfileInput(validInput({ stateCode: '99' }))).toMatch(/state/i);
    expect(validateBillingProfileInput(validInput({ stateCode: '25' }))).toMatch(/state/i);
  });

  it('rejects a malformed GSTIN', () => {
    expect(validateBillingProfileInput(validInput({ gstin: 'not-a-gstin' }))).toMatch(/gstin/i);
  });
});

describe('loadBillingProfile', () => {
  it('returns the profile when one exists', async () => {
    const supabase = fakeSupabase({ data: { id: 'profile-1', user_id: 'user-1', state_code: '24' }, error: null });

    const result = await loadBillingProfile(supabase, 'user-1');

    expect(result).toEqual({ status: 'ok', profile: { id: 'profile-1', user_id: 'user-1', state_code: '24' } });
  });

  it('returns ok with a null profile when the user has never filled one in', async () => {
    const supabase = fakeSupabase({ data: null, error: null });

    const result = await loadBillingProfile(supabase, 'user-1');

    expect(result).toEqual({ status: 'ok', profile: null });
  });

  it('reports unavailable, not a throw, when migration 125 is absent', async () => {
    const supabase = fakeSupabase({ data: null, error: { code: '42P01', message: 'relation "billing_profiles" does not exist' } });

    const result = await loadBillingProfile(supabase, 'user-1');

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('latches unavailable for later calls in the same process', async () => {
    const supabase = fakeSupabase({ data: null, error: { code: '42P01', message: 'missing' } });
    await loadBillingProfile(supabase, 'user-1');

    const secondSupabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });
    const result = await loadBillingProfile(secondSupabase, 'user-1');

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('throws on an unrelated database error', async () => {
    const supabase = fakeSupabase({ data: null, error: { code: '23505', message: 'duplicate key' } });

    await expect(loadBillingProfile(supabase, 'user-1')).rejects.toThrow('Failed to load billing profile');
  });
});

describe('saveBillingProfile', () => {
  it('rejects invalid input before ever touching the database', async () => {
    const supabase = { from: vi.fn() } as any;

    const result = await saveBillingProfile(supabase, 'user-1', validInput({ stateCode: '99' }));

    expect(result.status).toBe('invalid');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('upserts and returns the saved row', async () => {
    const savedRow = { id: 'profile-1', user_id: 'user-1', state_code: '24', legal_name: 'Jane Doe' };
    const supabase = fakeSupabase({ data: savedRow, error: null });

    const result = await saveBillingProfile(supabase, 'user-1', validInput());

    expect(result).toEqual({ status: 'ok', profile: savedRow });
  });

  it('reports unavailable when migration 125 is absent', async () => {
    const supabase = fakeSupabase({ data: null, error: { code: 'PGRST205', message: 'missing' } });

    const result = await saveBillingProfile(supabase, 'user-1', validInput());

    expect(result).toEqual({ status: 'unavailable' });
  });
});
