import { describe, expect, it } from 'vitest';

import { sanitizeInternalRedirectPath } from './safe-redirect.shared';

describe('sanitizeInternalRedirectPath', () => {
  it('accepts a plain internal path', () => {
    expect(sanitizeInternalRedirectPath('/story/abc123')).toBe('/story/abc123');
  });

  it('preserves query string and hash on an internal path', () => {
    expect(sanitizeInternalRedirectPath('/gallery?q=dragon#top')).toBe('/gallery?q=dragon#top');
  });

  it('falls back for a missing or empty value', () => {
    expect(sanitizeInternalRedirectPath(null)).toBe('/');
    expect(sanitizeInternalRedirectPath(undefined)).toBe('/');
    expect(sanitizeInternalRedirectPath('')).toBe('/');
  });

  it('falls back for a value not starting with /', () => {
    expect(sanitizeInternalRedirectPath('story/abc')).toBe('/');
    expect(sanitizeInternalRedirectPath('evil.com')).toBe('/');
  });

  it('rejects a protocol-relative URL (//evil.com)', () => {
    expect(sanitizeInternalRedirectPath('//evil.com')).toBe('/');
    expect(sanitizeInternalRedirectPath('//evil.com/path')).toBe('/');
  });

  it('rejects an absolute URL with a different origin', () => {
    expect(sanitizeInternalRedirectPath('https://evil.com')).toBe('/');
    expect(sanitizeInternalRedirectPath('http://evil.com/story/abc')).toBe('/');
  });

  it('rejects a non-http(s) scheme smuggled as a path', () => {
    expect(sanitizeInternalRedirectPath('javascript:alert(1)')).toBe('/');
  });

  it('rejects backslash tricks some browsers normalize to protocol-relative', () => {
    expect(sanitizeInternalRedirectPath('/\\evil.com')).toBe('/');
    expect(sanitizeInternalRedirectPath('/\\/evil.com')).toBe('/');
  });

  it('honors a custom fallback', () => {
    expect(sanitizeInternalRedirectPath('https://evil.com', '/signed-out')).toBe('/signed-out');
  });
});
