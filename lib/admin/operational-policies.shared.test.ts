import { describe, expect, it } from 'vitest';
import {
  normalizeFreeWelcomeGrantPolicyUpdate,
  readFreeWelcomeGrantConfig,
} from '@/lib/admin/operational-policies.shared';

describe('operational policy helpers', () => {
  it('normalizes the one-time free welcome policy', () => {
    expect(normalizeFreeWelcomeGrantPolicyUpdate({
      enabled: true,
      coinAmount: 50,
      expiresAfterDays: null,
      reason: 'Reduce free-tier exposure',
    })).toEqual({
      enabled: true,
      config: {
        coinAmount: 50,
        grantMode: 'once_per_account',
        expiresAfterDays: null,
      },
      reason: 'Reduce free-tier exposure',
    });
  });

  it('rejects invalid amounts, expiry windows, and missing reasons', () => {
    expect(() => normalizeFreeWelcomeGrantPolicyUpdate({
      enabled: true,
      coinAmount: 0,
      expiresAfterDays: null,
      reason: 'Invalid amount',
    })).toThrow('Welcome coins');

    expect(() => normalizeFreeWelcomeGrantPolicyUpdate({
      enabled: true,
      coinAmount: 50,
      expiresAfterDays: 0,
      reason: 'Invalid expiry',
    })).toThrow('Expiry');

    expect(() => normalizeFreeWelcomeGrantPolicyUpdate({
      enabled: true,
      coinAmount: 50,
      expiresAfterDays: null,
      reason: 'no',
    })).toThrow('reason');
  });

  it('reads the persisted welcome grant configuration', () => {
    expect(readFreeWelcomeGrantConfig({
      coinAmount: 50,
      grantMode: 'once_per_account',
      expiresAfterDays: 90,
    })).toEqual({
      coinAmount: 50,
      grantMode: 'once_per_account',
      expiresAfterDays: 90,
    });
  });
});
