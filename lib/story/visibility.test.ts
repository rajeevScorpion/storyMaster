import { describe, expect, it } from 'vitest';

import {
  buildUnlistedShareUrl,
  generateShareToken,
  normalizePublishQuality,
  normalizeStorylineVisibility,
  shareTokensEqual,
} from './visibility';

describe('normalizeStorylineVisibility', () => {
  it('accepts known values and defaults to private', () => {
    expect(normalizeStorylineVisibility('public')).toBe('public');
    expect(normalizeStorylineVisibility('unlisted')).toBe('unlisted');
    expect(normalizeStorylineVisibility('private')).toBe('private');
    expect(normalizeStorylineVisibility('secret')).toBe('private');
    expect(normalizeStorylineVisibility(null)).toBe('private');
  });
});

describe('normalizePublishQuality', () => {
  it('only allows high explicitly', () => {
    expect(normalizePublishQuality('high')).toBe('high');
    expect(normalizePublishQuality('standard')).toBe('standard');
    expect(normalizePublishQuality('ultra')).toBe('standard');
  });
});

describe('generateShareToken', () => {
  it('produces long, URL-safe, unique tokens', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('shareTokensEqual', () => {
  it('matches only exact tokens', () => {
    const token = generateShareToken();
    expect(shareTokensEqual(token, token)).toBe(true);
    expect(shareTokensEqual(token, `${token}x`)).toBe(false);
    expect(shareTokensEqual(token, token.slice(0, -1))).toBe(false);
    expect(shareTokensEqual(null, token)).toBe(false);
    expect(shareTokensEqual(token, null)).toBe(false);
  });
});

describe('buildUnlistedShareUrl', () => {
  it('builds the tokenized link', () => {
    expect(buildUnlistedShareUrl('https://kissago.cc/', 'sl-1', 'tok'))
      .toBe('https://kissago.cc/storyline/sl-1?token=tok');
  });
});
