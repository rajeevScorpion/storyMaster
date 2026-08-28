import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUserAcceptanceState } from '@/lib/legal/consent';
import { sanitizeInternalRedirectPath } from '@/lib/auth/safe-redirect.shared';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Previously concatenated onto `origin` with no validation at all -- an
  // open redirect. See lib/auth/safe-redirect.shared.ts.
  const next = sanitizeInternalRedirectPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // The on_auth_user_created trigger has already run by this point for a
      // first-time OAuth user -- the account is fully live before this
      // redirect fires, with zero interception surface otherwise. Route
      // through the acceptance gate rather than straight into the product.
      const acceptance = await getUserAcceptanceState(data.user.id);
      if (!acceptance.hasAllRequiredAcceptances) {
        const gateUrl = new URL('/auth/accept-terms', origin);
        gateUrl.searchParams.set('next', next);
        return NextResponse.redirect(gateUrl);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to home
  return NextResponse.redirect(`${origin}/`);
}
