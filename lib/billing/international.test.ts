import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
  getFeatureFlagValue: vi.fn(),
}));

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { getInternationalCheckoutCountries } from './international';

const flag = vi.mocked(getFeatureFlag);
const value = vi.mocked(getFeatureFlagValue);

describe('getInternationalCheckoutCountries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is empty when the flag is off or missing, without reading the value', async () => {
    flag.mockResolvedValueOnce(false);
    await expect(getInternationalCheckoutCountries()).resolves.toEqual([]);
    expect(value).not.toHaveBeenCalled();
  });

  it('returns the parsed list when the flag is on', async () => {
    flag.mockResolvedValueOnce(true);
    value.mockResolvedValueOnce('US');
    await expect(getInternationalCheckoutCountries()).resolves.toEqual(['US']);
  });

  it('is empty when the flag is on with an empty value', async () => {
    flag.mockResolvedValueOnce(true);
    value.mockResolvedValueOnce(null);
    await expect(getInternationalCheckoutCountries()).resolves.toEqual([]);
  });
});
