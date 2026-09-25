import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildCustomerSnapshot,
  loadBillingProfile,
  resetBillingProfileSchemaLatchForTests,
  saveBillingProfile,
  validateBillingProfileInput,
} from './billing-profile';
import type { DbBillingProfile } from '@/lib/types/database';
import type { BillingProfileInput } from '@/lib/types/pricing';

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  upsertedRow: Record<string, unknown> | undefined;
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  upsert(row: Record<string, unknown>) {
    this.upsertedRow = row;
    return this;
  }
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
  const builder = new FakeQueryBuilder(result);
  return { from: () => builder, builder } as any;
}

// Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit B): a complete PERSONAL profile under
// P1's required-field set -- legalName, billingEmail, phone, stateCode, city and postalCode are all
// required, so the fixture must supply all of them for a "minimal valid" case to actually be valid.
function validInput(overrides: Partial<BillingProfileInput> = {}): BillingProfileInput {
  return {
    legalName: 'Jane Doe',
    billingEmail: 'jane@example.com',
    phone: '9876543210',
    stateCode: '24',
    city: 'Gandhinagar',
    postalCode: '382016',
    profileType: 'personal',
    gstin: null,
    ...overrides,
  };
}

// A complete BUSINESS profile: adds the fields P1 requires only for business (addressLine1,
// companyName, a checksum-valid GSTIN) on top of validInput's personal fields.
function validBusinessInput(overrides: Partial<BillingProfileInput> = {}): BillingProfileInput {
  return validInput({
    profileType: 'business',
    addressLine1: 'B601, Kunj Heights',
    companyName: 'Aavriti Design Studio',
    gstin: '24ACLFA8196N1ZN',
    ...overrides,
  });
}

// Payments Phase 8 (docs/payments/phase-8-plan.md §8, Unit B): a complete US profile.
function validUsInput(overrides: Partial<BillingProfileInput> = {}): BillingProfileInput {
  return {
    countryCode: 'US',
    legalName: 'Jane Doe',
    billingEmail: 'jane@example.com',
    phone: '4155550100',
    stateCode: '',
    region: 'CA',
    city: 'San Francisco',
    postalCode: '94103',
    ...overrides,
  };
}

beforeEach(() => {
  resetBillingProfileSchemaLatchForTests();
});

describe('validateBillingProfileInput', () => {
  it('accepts a complete personal profile', () => {
    expect(validateBillingProfileInput(validInput())).toBeNull();
  });

  it('accepts a complete business profile with a valid GSTIN', () => {
    expect(validateBillingProfileInput(validBusinessInput())).toBeNull();
  });

  it('rejects a missing or blank legal name', () => {
    expect(validateBillingProfileInput(validInput({ legalName: '' }))).toMatch(/name/i);
    expect(validateBillingProfileInput(validInput({ legalName: '   ' }))).toMatch(/name/i);
  });

  it('rejects an invalid or retired state code for a personal profile', () => {
    expect(validateBillingProfileInput(validInput({ stateCode: '99' }))).toMatch(/state/i);
    expect(validateBillingProfileInput(validInput({ stateCode: '25' }))).toMatch(/state/i);
  });

  it('rejects a malformed GSTIN on a business profile', () => {
    expect(validateBillingProfileInput(validBusinessInput({ gstin: 'not-a-gstin' }))).toMatch(/gstin/i);
  });

  it('rejects a business GSTIN that fails its checksum', () => {
    expect(validateBillingProfileInput(validBusinessInput({ gstin: '27AAPFU0939F1ZX' }))).toMatch(/gstin/i);
  });

  it('rejects a personal profile that still carries a GSTIN', () => {
    expect(validateBillingProfileInput(validInput({ gstin: '24ACLFA8196N1ZN' }))).toMatch(/business/i);
  });

  it('rejects a phone that does not normalise', () => {
    expect(validateBillingProfileInput(validInput({ phone: '12345' }))).toMatch(/mobile/i);
  });

  it('rejects an invalid billing email', () => {
    expect(validateBillingProfileInput(validInput({ billingEmail: 'not-an-email' }))).toMatch(/email/i);
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

  it('normalises the phone and upper-cases the GSTIN before saving', async () => {
    const supabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });

    await saveBillingProfile(
      supabase,
      'user-1',
      validBusinessInput({ phone: '098765 43210', gstin: '24aclfa8196n1zn' })
    );

    expect(supabase.builder.upsertedRow?.phone).toBe('+919876543210');
    expect(supabase.builder.upsertedRow?.gstin).toBe('24ACLFA8196N1ZN');
  });

  it('derives the saved state from the GSTIN for a business profile, ignoring the client stateCode', async () => {
    const supabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });

    // 24ACLFA8196N1ZN is state 24 (Gujarat); the client sent 27 (Maharashtra) instead.
    await saveBillingProfile(supabase, 'user-1', validBusinessInput({ stateCode: '27' }));

    expect(supabase.builder.upsertedRow?.state_code).toBe('24');
  });

  it('nulls out company_name and gstin when saving a personal profile', async () => {
    const supabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });

    await saveBillingProfile(supabase, 'user-1', validInput());

    expect(supabase.builder.upsertedRow?.company_name).toBeNull();
    expect(supabase.builder.upsertedRow?.gstin).toBeNull();
  });

  it('writes country_code IN and region null for an Indian profile', async () => {
    const supabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });

    await saveBillingProfile(supabase, 'user-1', validInput());

    expect(supabase.builder.upsertedRow?.country_code).toBe('IN');
    expect(supabase.builder.upsertedRow?.region).toBeNull();
  });

  it('writes the foreign place-of-supply code, the region and a normalised US phone for a US profile', async () => {
    const supabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });

    await saveBillingProfile(supabase, 'user-1', validUsInput({ phone: '(415) 555-0100' }));

    expect(supabase.builder.upsertedRow?.country_code).toBe('US');
    expect(supabase.builder.upsertedRow?.state_code).toBe('96');
    expect(supabase.builder.upsertedRow?.region).toBe('CA');
    expect(supabase.builder.upsertedRow?.phone).toBe('+14155550100');
  });

  it('ignores profileType for a US profile -- never writes company_name/gstin regardless', async () => {
    // validateBillingProfile's US branch doesn't look at profileType at all (only IN has a
    // Personal/Business split), so this pins down saveBillingProfile's own isForeign guard rather
    // than relying on validation to have already stripped a stray 'business' value.
    const supabase = fakeSupabase({ data: { id: 'profile-1' }, error: null });

    await saveBillingProfile(supabase, 'user-1', validUsInput({ profileType: 'business' }));

    expect(supabase.builder.upsertedRow?.company_name).toBeNull();
    expect(supabase.builder.upsertedRow?.gstin).toBeNull();
  });

  it('saves an Indian profile without region when the column is missing (migration 138 absent), and does not mark the whole table unavailable', async () => {
    // A builder that fails whichever upsert includes `region` with a column-shaped error, and
    // succeeds otherwise -- modelling a database with 125 applied but not 138, regardless of which
    // call (first attempt or retry) happens to carry the column.
    const savedRow = { id: 'profile-1', user_id: 'user-1', state_code: '24' };
    const builder = {
      upsertedRows: [] as Record<string, unknown>[],
      select() { return this; },
      upsert(row: Record<string, unknown>) {
        this.upsertedRows.push(row);
        return this;
      },
      single() {
        const lastRow = this.upsertedRows[this.upsertedRows.length - 1];
        return Promise.resolve(
          lastRow && 'region' in lastRow
            ? { data: null, error: { code: '42703', message: 'column "region" of relation "billing_profiles" does not exist' } }
            : { data: savedRow, error: null }
        );
      },
    };
    const supabase = { from: () => builder } as any;

    const result = await saveBillingProfile(supabase, 'user-1', validInput());

    expect(result).toEqual({ status: 'ok', profile: savedRow });
    expect(builder.upsertedRows).toHaveLength(2);
    expect(builder.upsertedRows[0]).toHaveProperty('region');
    expect(builder.upsertedRows[1]).not.toHaveProperty('region');

    // The latch is per-process: a later save in the same run skips straight to the no-region upsert.
    const secondResult = await saveBillingProfile(supabase, 'user-1', validInput());
    expect(secondResult).toEqual({ status: 'ok', profile: savedRow });
    expect(builder.upsertedRows).toHaveLength(3);
    expect(builder.upsertedRows[2]).not.toHaveProperty('region');
  });
});

// Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): the frozen snapshot recorded against
// a payment at the moment it is charged -- see ledger.ts's recordPayment write-once guard.
function dbProfileRow(overrides: Partial<DbBillingProfile> = {}): DbBillingProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    legal_name: 'Jane Doe',
    billing_email: 'jane@example.com',
    phone: '+919876543210',
    company_name: null,
    gstin: null,
    state_code: '24',
    country_code: 'IN',
    region: null,
    address_line_1: null,
    address_line_2: null,
    city: 'Gandhinagar',
    postal_code: '382016',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildCustomerSnapshot', () => {
  it('returns null for no profile', () => {
    expect(buildCustomerSnapshot(null)).toBeNull();
  });

  it('builds a personal snapshot with the profile row\'s own updated_at and the state name', () => {
    const snapshot = buildCustomerSnapshot(dbProfileRow());

    expect(snapshot).toMatchObject({
      profileType: 'personal',
      legalName: 'Jane Doe',
      gstin: null,
      companyName: null,
      stateCode: '24',
      stateName: 'Gujarat',
      profileUpdatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(typeof snapshot?.capturedAt).toBe('string');
    expect(Number.isNaN(Date.parse(snapshot!.capturedAt))).toBe(false);
  });

  it('derives profileType business iff a GSTIN is present', () => {
    const snapshot = buildCustomerSnapshot(
      dbProfileRow({ gstin: '24ACLFA8196N1ZN', company_name: 'Aavriti Design Studio' })
    );

    expect(snapshot).toMatchObject({ profileType: 'business', gstin: '24ACLFA8196N1ZN', companyName: 'Aavriti Design Studio' });
  });

  it('resolves stateName to null for a state code the lookup does not recognize', () => {
    const snapshot = buildCustomerSnapshot(dbProfileRow({ state_code: '99' }));

    expect(snapshot?.stateName).toBeNull();
  });

  it('names the US state and country for a foreign profile, ignoring the GST place-of-supply code', () => {
    const snapshot = buildCustomerSnapshot(
      dbProfileRow({ country_code: 'US', state_code: '96', region: 'CA' })
    );

    expect(snapshot).toMatchObject({
      countryCode: 'US',
      countryName: 'United States',
      region: 'CA',
      stateCode: '96',
      stateName: 'California',
    });
  });

  it('defaults region to null on a row from before migration 138', () => {
    const { region, ...rowWithoutRegion } = dbProfileRow();
    const snapshot = buildCustomerSnapshot(rowWithoutRegion as DbBillingProfile);

    expect(snapshot?.region).toBeNull();
  });
});
