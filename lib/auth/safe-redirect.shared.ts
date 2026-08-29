/**
 * Restricts a client-supplied `next` query param to a same-origin path.
 * app/auth/callback/route.ts previously concatenated `next` onto `origin`
 * with no validation at all -- an open redirect. Also used by
 * app/auth/accept-terms/page.tsx, which receives the same kind of param.
 *
 * Resolves `candidate` against a fixed dummy origin and checks the result's
 * origin didn't change, rather than hand-rolling checks for `//`, `/\`,
 * embedded schemes, etc. individually -- the WHATWG URL parser already
 * normalizes all of those the same way a browser would, so comparing
 * `resolved.origin` against the dummy catches every trick uniformly instead
 * of chasing cases one at a time.
 */
const SAFE_REDIRECT_BASE = 'https://internal.invalid';

export function sanitizeInternalRedirectPath(candidate: string | null | undefined, fallback = '/'): string {
  if (!candidate || !candidate.startsWith('/')) return fallback;

  try {
    const resolved = new URL(candidate, SAFE_REDIRECT_BASE);
    if (resolved.origin !== SAFE_REDIRECT_BASE) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
