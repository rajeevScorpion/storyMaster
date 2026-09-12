import { redirect } from 'next/navigation';
import { requireReviewer } from '@/lib/agentic/reviewers';
import ReviewSidebar from '@/components/review/ReviewSidebar';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';

// ── Agentic Creator System: Phase 9b/9c, Units 9h/9L; Phase 10 Round 3, 5.1 ──
//
// Reviewer-facing route gate, living OUTSIDE /admin on purpose. Mirrors
// app/admin/layout.tsx's shape -- verify, redirect('/') on throw, render
// children -- but gates on requireReviewer() (lib/agentic/reviewers.ts), NOT
// verifyAdmin() (lib/supabase/admin.ts). Do not import verifyAdmin() here:
// the entire point of this route is that a non-admin active reviewer
// (agent_reviewers.status = 'active') can reach it, which verifyAdmin()'s
// single-person ADMIN_USER_ID check would refuse outright.
//
// The header carries the normal app identity -- KissagoLogo (linking home) and
// UserMenu, the same pair app/story/[id]/page.tsx renders -- rather than the
// bare "Kissago Review" span this used to be (owner decision 4, plan section
// 0): a reviewer had no way back to `/` or to the rest of the profile menu.
// Both are 'use client' components rendered from this server layout with no
// extra wiring -- PricingRuntimeProvider is already mounted app-wide in
// components/Providers.tsx, so UserMenu's reviewer badge/count and wallet
// summary work here exactly as they do everywhere else. Below the header this
// stays the MINIMAL shell it always was -- ReviewSidebar and the page. No
// AdminSidebar, no AdminMobileNav, no admin nav of any kind
// (docs/agentic-creator-phase9b-plan.md section 4.1 / phase9c-plan.md section
// 4.2): a reviewer is not staff and must not be shown the ~40-page admin
// information architecture, most of which requireReviewer() would refuse them
// anyway. ReviewSidebar lives in components/review/, not components/admin/,
// for the same reason -- there is nothing admin-shaped for it to drift toward.
//
// Known limit (plan section 4.4, recorded in PROJECT_STATE): a signed-out
// visitor lands on redirect('/'), same as /admin -- not a sign-in redirect
// carrying a return URL. Deferred, not forgotten.
export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireReviewer();
  } catch {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
        <KissagoLogo fixed={false} />
        <UserMenu />
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <ReviewSidebar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  );
}
