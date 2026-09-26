import { describe, expect, it } from 'vitest';
import { isMissingBillingSchemaError } from './schema-availability.shared';

describe('isMissingBillingSchemaError', () => {
  it('returns false for no error', () => {
    expect(isMissingBillingSchemaError(null)).toBe(false);
    expect(isMissingBillingSchemaError(undefined)).toBe(false);
  });

  it('returns false for an error with no code', () => {
    expect(isMissingBillingSchemaError({ message: 'undefined table billing_payments' })).toBe(false);
  });

  it('recognizes every structural missing-schema code', () => {
    const codes = ['42P01', 'PGRST205', '42703', 'PGRST200', 'PGRST204', '42883', 'PGRST202'];
    for (const code of codes) {
      expect(isMissingBillingSchemaError({ code })).toBe(true);
    }
  });

  it('never classifies by message text alone', () => {
    expect(isMissingBillingSchemaError({
      code: '23505',
      message: 'relation "billing_payments" does not exist',
    })).toBe(false);
  });

  it('treats a genuine query failure as not a schema gap', () => {
    expect(isMissingBillingSchemaError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isMissingBillingSchemaError({ code: '22P02', message: 'invalid input syntax' })).toBe(false);
  });
});
