import { describe, expect, it } from 'vitest';

import { DEFAULT_MEDIA_PIPELINE_SETTINGS } from './media-pipeline-settings';
import { isHqEntitled, resolveOriginalExpiresAt, resolveOriginalRetentionMs } from './retention';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('resolveOriginalRetentionMs', () => {
  it('maps each tier to its configured window', () => {
    expect(resolveOriginalRetentionMs('free', DEFAULT_MEDIA_PIPELINE_SETTINGS)).toBe(24 * HOUR_MS);
    expect(resolveOriginalRetentionMs('plus', DEFAULT_MEDIA_PIPELINE_SETTINGS)).toBe(10 * DAY_MS);
    expect(resolveOriginalRetentionMs('studio', DEFAULT_MEDIA_PIPELINE_SETTINGS)).toBe(30 * DAY_MS);
  });

  it('respects admin-configured overrides', () => {
    const settings = { ...DEFAULT_MEDIA_PIPELINE_SETTINGS, freeRetentionHours: 0, plusRetentionDays: 14 };
    expect(resolveOriginalRetentionMs('free', settings)).toBe(0);
    expect(resolveOriginalRetentionMs('plus', settings)).toBe(14 * DAY_MS);
  });
});

describe('isHqEntitled', () => {
  it('never entitles free users', () => {
    expect(isHqEntitled('free', DEFAULT_MEDIA_PIPELINE_SETTINGS)).toBe(false);
  });

  it('entitles plus and studio by default', () => {
    expect(isHqEntitled('plus', DEFAULT_MEDIA_PIPELINE_SETTINGS)).toBe(true);
    expect(isHqEntitled('studio', DEFAULT_MEDIA_PIPELINE_SETTINGS)).toBe(true);
  });

  it('respects the admin per-tier gates', () => {
    const settings = {
      ...DEFAULT_MEDIA_PIPELINE_SETTINGS,
      allowPlusHighQuality: false,
      allowStudioHighQuality: false,
    };
    expect(isHqEntitled('plus', settings)).toBe(false);
    expect(isHqEntitled('studio', settings)).toBe(false);
  });
});

describe('resolveOriginalExpiresAt', () => {
  it('stamps the expiry relative to the provided clock', () => {
    const now = new Date('2026-07-07T00:00:00.000Z');
    expect(resolveOriginalExpiresAt('plus', DEFAULT_MEDIA_PIPELINE_SETTINGS, now))
      .toBe('2026-07-17T00:00:00.000Z');
    expect(resolveOriginalExpiresAt('free', DEFAULT_MEDIA_PIPELINE_SETTINGS, now))
      .toBe('2026-07-08T00:00:00.000Z');
  });
});
