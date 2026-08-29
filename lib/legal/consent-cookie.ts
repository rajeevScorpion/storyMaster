import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * No `import 'server-only'` here on purpose: this module is imported by
 * proxy.ts (middleware), whose bundle classification under Next's own
 * server/client split is less certain than an ordinary Server Component or
 * Server Action. The `node:crypto` import already fails loudly if this ever
 * ends up in a client bundle, which is the property `server-only` exists to
 * provide anyway.
 *
 * proxy.ts's fast path for the consent gate: a signed cookie that lets a
 * compliant user skip the legal_acceptances DB read on every request. The
 * cookie is a CACHE of "the user was compliant with this exact required-set
 * fingerprint" — never the record. The row in legal_acceptances is the
 * evidence; this only saves a query when it's still valid.
 *
 * Encodes no per-document state — just userId + a fingerprint of the
 * currently-required document versions (see buildAcceptanceFingerprint). If
 * an admin publishes a new required version, every fingerprint changes at
 * once and every existing cookie stops matching, without touching a single
 * user row.
 */

export const CONSENT_COOKIE_NAME = 'kissago_legal_ok';
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days; re-derived from the DB whenever it lapses or the required set changes

export interface RequiredDocumentVersion {
  documentKey: string;
  documentVersion: string;
}

/** Stable, order-independent fingerprint of a set of (document, version) pairs. */
export function buildAcceptanceFingerprint(documents: RequiredDocumentVersion[]): string {
  return documents
    .map((doc) => `${doc.documentKey}@${doc.documentVersion}`)
    .sort()
    .join('|');
}

function getCookieSecret(): string | null {
  const secret = process.env.LEGAL_CONSENT_COOKIE_SECRET?.trim();
  return secret ? secret : null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

interface ConsentCookiePayload {
  u: string; // userId
  f: string; // fingerprint
}

/**
 * Builds the cookie value, or null if LEGAL_CONSENT_COOKIE_SECRET isn't
 * configured — callers should simply not set the cookie in that case. The
 * gate itself never depends on the cookie existing: proxy.ts always falls
 * back to a live DB check on a miss.
 *
 * The payload is JSON, base64url-encoded, with the signature appended after
 * the *last* dot — not a naive `userId.fingerprint.signature` join. A
 * fingerprint is built from semantic versions like "1.0.0", which contain
 * dots themselves, so splitting a 3-field cookie on every dot silently reads
 * the wrong fields back and every verification fails.
 */
export function encodeConsentCookie(userId: string, fingerprint: string): string | null {
  const secret = getCookieSecret();
  if (!secret) return null;

  const payload: ConsentCookiePayload = { u: userId, f: fingerprint };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

/**
 * Returns true only if `cookieValue` is validly signed for `userId` AND
 * matches the current required-set fingerprint. Any mismatch, missing
 * secret, or malformed value returns false — never throws, so a bad or
 * stale cookie just falls through to a live DB check rather than blocking
 * or (worse) wrongly admitting the request.
 */
export function verifyConsentCookie(
  cookieValue: string | undefined | null,
  userId: string,
  expectedFingerprint: string
): boolean {
  const secret = getCookieSecret();
  if (!secret || !cookieValue) return false;

  const lastDot = cookieValue.lastIndexOf('.');
  if (lastDot === -1) return false;

  const encodedPayload = cookieValue.slice(0, lastDot);
  const signature = cookieValue.slice(lastDot + 1);

  const expectedSignature = sign(encodedPayload, secret);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  let payload: ConsentCookiePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as ConsentCookiePayload;
  } catch {
    return false;
  }

  return payload.u === userId && payload.f === expectedFingerprint;
}
