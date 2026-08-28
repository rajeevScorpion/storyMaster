import { redirect } from 'next/navigation';

import AcceptTermsGate from '@/components/legal/AcceptTermsGate';
import KissagoLogo from '@/components/ui/KissagoLogo';
import { sanitizeInternalRedirectPath } from '@/lib/auth/safe-redirect.shared';
import { getUserAcceptanceState } from '@/lib/legal/consent';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface AcceptTermsPageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * Reached two ways: app/auth/callback/route.ts routes a first-time or
 * non-compliant OAuth user here before they ever see the product, and
 * proxy.ts's consent gate routes any signed-in user here the moment a
 * required document changes underneath them. Never linked to directly.
 */
export default async function AcceptTermsPage({ searchParams }: AcceptTermsPageProps) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeInternalRedirectPath(rawNext);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signed-out');
  }

  const acceptance = await getUserAcceptanceState(user.id);
  if (acceptance.hasAllRequiredAcceptances) {
    redirect(next);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-200">
      <div className="absolute inset-0 z-0">
        <div className="absolute left-10 top-10 h-56 w-56 rounded-full bg-emerald-900/20 blur-3xl" />
        <div className="absolute bottom-10 right-10 h-56 w-56 rounded-full bg-indigo-900/20 blur-3xl" />
      </div>

      <header className="relative z-10 p-4 md:p-6">
        <KissagoLogo fixed={false} />
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-88px)] items-center justify-center px-4 py-10">
        <AcceptTermsGate
          documentKeys={acceptance.missingDocumentKeys}
          isReconsent={acceptance.reconsentDocumentKeys.length > 0}
          next={next}
        />
      </main>
    </div>
  );
}
