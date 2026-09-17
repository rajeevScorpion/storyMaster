import { describe, it, expect } from 'vitest';
import {
  GSTIN_REGEX,
  INDIA_GST_STATE_CODES,
  indiaStateName,
  isValidGstin,
  isValidIndiaStateCode,
} from './india-states.shared';

describe('isValidIndiaStateCode', () => {
  it('accepts every code in the list', () => {
    for (const entry of INDIA_GST_STATE_CODES) {
      expect(isValidIndiaStateCode(entry.code)).toBe(true);
    }
  });

  it('rejects retired codes, unknown codes, and non-strings', () => {
    expect(isValidIndiaStateCode('25')).toBe(false); // retired: Daman and Diu
    expect(isValidIndiaStateCode('28')).toBe(false); // retired: undivided Andhra Pradesh
    expect(isValidIndiaStateCode('99')).toBe(false);
    expect(isValidIndiaStateCode('')).toBe(false);
    expect(isValidIndiaStateCode(null)).toBe(false);
    expect(isValidIndiaStateCode(undefined)).toBe(false);
  });

  it('has no duplicate codes', () => {
    const codes = INDIA_GST_STATE_CODES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('indiaStateName', () => {
  it('resolves a known code and returns null for an unknown one', () => {
    expect(indiaStateName('24')).toBe('Gujarat');
    expect(indiaStateName('99')).toBeNull();
  });
});

describe('GSTIN_REGEX / isValidGstin', () => {
  it('accepts the business GSTIN used elsewhere in the app', () => {
    expect(GSTIN_REGEX.test('24ACLFA8196N1ZN')).toBe(true);
    expect(isValidGstin('24ACLFA8196N1ZN')).toBe(true);
  });

  it('rejects malformed shapes', () => {
    expect(isValidGstin('24aclfa8196n1zn')).toBe(false); // lowercase
    expect(isValidGstin('24ACLFA8196N1Z')).toBe(false); // too short
    expect(isValidGstin('24ACLFA8196N1ZNX')).toBe(false); // too long
    expect(isValidGstin('AAACLFA8196N1ZN')).toBe(false); // state code not numeric
    expect(isValidGstin(null)).toBe(false);
    expect(isValidGstin(undefined)).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });
});
