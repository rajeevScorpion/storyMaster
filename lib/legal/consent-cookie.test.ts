import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAcceptanceFingerprint, encodeConsentCookie, verifyConsentCookie } from './consent-cookie';

const ORIGINAL_SECRET = process.env.LEGAL_CONSENT_COOKIE_SECRET;

beforeEach(() => {
  process.env.LEGAL_CONSENT_COOKIE_SECRET = 'test-secret-do-not-use-in-prod';
});

afterEach(() => {
  process.env.LEGAL_CONSENT_COOKIE_SECRET = ORIGINAL_SECRET;
});

describe('buildAcceptanceFingerprint', () => {
  it('is order-independent', () => {
    const a = buildAcceptanceFingerprint([
      { documentKey: 'terms', documentVersion: '1.0.0' },
      { documentKey: 'privacy_policy', documentVersion: '1.0.0' },
    ]);
    const b = buildAcceptanceFingerprint([
      { documentKey: 'privacy_policy', documentVersion: '1.0.0' },
      { documentKey: 'terms', documentVersion: '1.0.0' },
    ]);
    expect(a).toBe(b);
  });

  it('changes when any version changes', () => {
    const before = buildAcceptanceFingerprint([{ documentKey: 'terms', documentVersion: '1.0.0' }]);
    const after = buildAcceptanceFingerprint([{ documentKey: 'terms', documentVersion: '1.1.0' }]);
    expect(before).not.toBe(after);
  });
});

describe('encodeConsentCookie / verifyConsentCookie', () => {
  const userId = 'user-123';
  const fingerprint = buildAcceptanceFingerprint([{ documentKey: 'terms', documentVersion: '1.0.0' }]);

  it('round-trips a validly signed cookie', () => {
    const cookie = encodeConsentCookie(userId, fingerprint);
    expect(cookie).not.toBeNull();
    expect(verifyConsentCookie(cookie, userId, fingerprint)).toBe(true);
  });

  it('rejects a cookie issued for a different user', () => {
    const cookie = encodeConsentCookie(userId, fingerprint);
    expect(verifyConsentCookie(cookie, 'someone-else', fingerprint)).toBe(false);
  });

  it('rejects a cookie whose fingerprint no longer matches the required set (e.g. a new version was published)', () => {
    const cookie = encodeConsentCookie(userId, fingerprint);
    const newerFingerprint = buildAcceptanceFingerprint([{ documentKey: 'terms', documentVersion: '2.0.0' }]);
    expect(verifyConsentCookie(cookie, userId, newerFingerprint)).toBe(false);
  });

  it('rejects a forged cookie (tampered signature)', () => {
    const cookie = encodeConsentCookie(userId, fingerprint)!;
    const encodedPayload = cookie.slice(0, cookie.lastIndexOf('.'));
    const forged = `${encodedPayload}.not-a-real-signature`;
    expect(verifyConsentCookie(forged, userId, fingerprint)).toBe(false);
  });

  it('handles a fingerprint containing dots (semantic versions) correctly', () => {
    const semverFingerprint = buildAcceptanceFingerprint([
      { documentKey: 'terms', documentVersion: '1.0.0' },
      { documentKey: 'privacy_policy', documentVersion: '2.3.1' },
    ]);
    const cookie = encodeConsentCookie(userId, semverFingerprint);
    expect(verifyConsentCookie(cookie, userId, semverFingerprint)).toBe(true);
  });

  it('rejects a cookie signed with a different secret', () => {
    const cookie = encodeConsentCookie(userId, fingerprint);
    process.env.LEGAL_CONSENT_COOKIE_SECRET = 'a-different-secret';
    expect(verifyConsentCookie(cookie, userId, fingerprint)).toBe(false);
  });

  it('rejects malformed cookie values without throwing', () => {
    expect(verifyConsentCookie('not-even-close-to-valid', userId, fingerprint)).toBe(false);
    expect(verifyConsentCookie('', userId, fingerprint)).toBe(false);
    expect(verifyConsentCookie(undefined, userId, fingerprint)).toBe(false);
  });

  it('never signs or verifies when the secret is unconfigured -- callers fall through to a live DB check', () => {
    delete process.env.LEGAL_CONSENT_COOKIE_SECRET;
    expect(encodeConsentCookie(userId, fingerprint)).toBeNull();

    const cookie = 'anything.at.all';
    expect(verifyConsentCookie(cookie, userId, fingerprint)).toBe(false);
  });
});
