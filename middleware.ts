import { updateSession } from '@/lib/supabase/middleware';
import { loadModerationForMiddleware } from '@/lib/supabase/user-moderation-middleware';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  try {
    const { response, user } = await updateSession(request);
    const adminUserId = process.env.ADMIN_USER_ID;
    const pathname = request.nextUrl.pathname;
    const restrictionRoute = '/account-restricted';
    const allowedWhileRestricted = (
      pathname === restrictionRoute
      || pathname.startsWith('/auth/')
      || pathname === '/signed-out'
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
    }

    return response;
  } catch (error) {
    console.error('Middleware error:', error);
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
