import { updateSession } from '@/lib/supabase/middleware';
import { loadModerationForMiddleware } from '@/lib/supabase/user-moderation-middleware';
import { checkLegalConsentForRequest } from '@/lib/legal/consent-middleware';
import { CONSENT_COOKIE_MAX_AGE_SECONDS, CONSENT_COOKIE_NAME } from '@/lib/legal/consent-cookie';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  try {
    const { response, user } = await updateSession(request);
    const adminUserId = process.env.ADMIN_USER_ID;
    const pathname = request.nextUrl.pathname;
    const restrictionRoute = '/account-restricted';
    // A restricted user must still be able to read the legal documents they're
    // being held to and find the Help & Legal centre — this hardcodes the
    // current default managed-page slugs (see lib/managed-pages/registry.ts)
    // rather than adding a DB round trip to this already-narrow code path; if
    // an admin renames one of these slugs, update this list to match.
    const legalSlugPattern = /^\/(terms|privacy|content-usage-policy|ai-disclosure|refund-policy|account-deletion|contact|help-legal)$/;
    const allowedWhileRestricted = (
      pathname === restrictionRoute
      || pathname.startsWith('/auth/')
      || pathname === '/signed-out'
      || legalSlugPattern.test(pathname)
    );

    if (user && user.id !== adminUserId) {
      const moderation = await loadModerationForMiddleware(user.id);
      const restricted = moderation.status === 'blocked' || moderation.status === 'suspended';

      if (restricted && !allowedWhileRestricted) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = restrictionRoute;
        redirectUrl.search = '';
        const redirectResponse = NextResponse.redirect(redirectUrl);
        for (const cookie of response.cookies.getAll()) {
          redirectResponse.cookies.set(cookie);
        }
        return redirectResponse;
      }

      if (!restricted && pathname === restrictionRoute) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/';
        redirectUrl.search = '';
        const redirectResponse = NextResponse.redirect(redirectUrl);
        for (const cookie of response.cookies.getAll()) {
          redirectResponse.cookies.set(cookie);
        }
        return redirectResponse;
      }

      // Legal consent gate. Behind legal_consent_gate_enabled (seeded off by
      // migration 099) -- checkLegalConsentForRequest returns inert until an
      // admin turns it on, so this is a no-op today. Skipped for the same
      // always-reachable surfaces as the restriction allowlist, plus /api/*
      // (worker routes authenticate with CRON_SECRET, not a browser session).
      const consentExemptRoute = (
        pathname.startsWith('/auth/')
        || pathname === '/signed-out'
        || pathname === restrictionRoute
        || pathname.startsWith('/api/')
        || legalSlugPattern.test(pathname)
      );

      if (!restricted && !consentExemptRoute) {
        const existingCookie = request.cookies.get(CONSENT_COOKIE_NAME)?.value;
        const { requiresGate, refreshedCookieValue } = await checkLegalConsentForRequest(user.id, existingCookie);

        if (requiresGate) {
          const redirectUrl = request.nextUrl.clone();
          redirectUrl.pathname = '/auth/accept-terms';
          redirectUrl.search = `?next=${encodeURIComponent(pathname)}`;
          const redirectResponse = NextResponse.redirect(redirectUrl);
          for (const cookie of response.cookies.getAll()) {
            redirectResponse.cookies.set(cookie);
          }
          return redirectResponse;
        }

        if (refreshedCookieValue) {
          response.cookies.set(CONSENT_COOKIE_NAME, refreshedCookieValue, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
            path: '/',
          });
        }
      }
    }

    return response;
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|sounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
