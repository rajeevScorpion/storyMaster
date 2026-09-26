import { describe, expect, it } from 'vitest';

import {
  billingCountryName,
  isForeignBillingCountry,
  isSupportedBillingCountry,
  parseInternationalCountries,
} from '@/lib/billing/international.shared';

describe('parseInternationalCountries', () => {
  it('parses the seeded value', () => {
    expect(parseInternationalCountries('US')).toEqual(['US']);
  });

  it('tolerates case, spaces, commas and duplicates', () => {
    expect(parseInternationalCountries(' us, US\nus ')).toEqual(['US']);
  });

  it('never treats India as international', () => {
    expect(parseInternationalCountries('IN,US')).toEqual(['US']);
  });

  it('drops codes the code cannot handle', () => {
    expect(parseInternationalCountries('GB,DE,US')).toEqual(['US']);
  });

  it('reads blank or missing as no countries', () => {
    expect(parseInternationalCountries('')).toEqual([]);
    expect(parseInternationalCountries(null)).toEqual([]);
    expect(parseInternationalCountries(' , ')).toEqual([]);
  });
});

describe('country helpers', () => {
  it('knows India and the US only', () => {
    expect(isSupportedBillingCountry('IN')).toBe(true);
    expect(isSupportedBillingCountry('US')).toBe(true);
    expect(isSupportedBillingCountry('GB')).toBe(false);
    expect(isSupportedBillingCountry(null)).toBe(false);
  });

  it('treats only supported non-India countries as foreign', () => {
    expect(isForeignBillingCountry('US')).toBe(true);
    expect(isForeignBillingCountry('IN')).toBe(false);
    expect(isForeignBillingCountry('GB')).toBe(false);
  });

  it('names countries', () => {
    expect(billingCountryName('US')).toBe('United States');
    expect(billingCountryName('XX')).toBeNull();
  });
});
