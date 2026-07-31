import { describe, expect, it } from 'vitest';
import {
  beatsToCoins,
  normalizeAdminUserListInput,
  normalizeCoinGrantInput,
  normalizePromotionalCohortInput,
  resolveEffectiveModerationState,
} from './user-management.shared';

describe('admin user management helpers', () => {
  it('normalizes unsafe directory paging and filters', () => {
    expect(normalizeAdminUserListInput({
      search: '  USER@Example.com  ',
      status: 'unknown' as 'all',
      page: -3,
      pageSize: 999,
    })).toEqual({
      search: 'USER@Example.com',
      status: 'all',
      page: 1,
      pageSize: 25,
    });
  });

  it('treats an expired suspension as active', () => {
    expect(resolveEffectiveModerationState({
      status: 'suspended',
      suspended_until: '2026-01-01T00:00:00.000Z',
      reason: 'Temporary review',
    }, new Date('2026-02-01T00:00:00.000Z'))).toEqual({
      status: 'active',
      suspendedUntil: null,
      reason: 'Temporary review',
    });
  });

  it('keeps a future suspension effective', () => {
    expect(resolveEffectiveModerationState({
      status: 'suspended',
      suspended_until: '2026-03-01T00:00:00.000Z',
      reason: 'Temporary review',
    }, new Date('2026-02-01T00:00:00.000Z'))).toEqual({
      status: 'suspended',
      suspendedUntil: '2026-03-01T00:00:00.000Z',
      reason: 'Temporary review',
    });
  });

  it('converts whole coins to the fractional beat ledger unit', () => {
    expect(normalizeCoinGrantInput({
      coins: 125,
      reason: 'Support compensation',
    })).toMatchObject({
      coins: 125,
      beats: 12.5,
      reason: 'Support compensation',
      expiresAt: null,
    });
    expect(beatsToCoins('12.50')).toBe(125);
  });

  it('rejects fractional or non-positive coin grants', () => {
    expect(() => normalizeCoinGrantInput({ coins: 0, reason: 'No grant' })).toThrow();
    expect(() => normalizeCoinGrantInput({ coins: 1.5, reason: 'Fractional grant' })).toThrow();
  });

  it('normalizes transparent promotional cohort rules', () => {
    expect(normalizePromotionalCohortInput({
      name: 'Engaged creators',
      activeWithinDays: 30,
      minFinishedStories: 3,
      minPublishedStories: 1,
      minLifetimeConsumedCoins: 250,
      planKey: 'all',
      coinsPerUser: 500,
    })).toMatchObject({
      name: 'Engaged creators',
      activeWithinDays: 30,
      minFinishedStories: 3,
      minPublishedStories: 1,
      minLifetimeConsumedCoins: 250,
      minLifetimeConsumedBeats: 25,
      planKey: 'all',
      coinsPerUser: 500,
      beatsPerUser: 50,
    });
  });
});
