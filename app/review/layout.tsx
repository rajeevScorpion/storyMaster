import { redirect } from 'next/navigation';
import { requireReviewer } from '@/lib/agentic/reviewers';

// ── Agentic Creator System: Phase 9b, Unit 9h ───────────────────────────
//
// Reviewer-facing route gate, living OUTSIDE /admin on purpose. Mirrors
// app/admin/layout.tsx's shape -- verify, redirect('/') on throw, render
// children -- but gates on requireReviewer() (lib/agentic/reviewers.ts), NOT
// verifyAdmin() (lib/supabase/admin.ts). Do not import verifyAdmin() here:
// the entire point of this route is that a non-admin active reviewer
// (agent_reviewers.status = 'active') can reach it, which verifyAdmin()'s
// single-person ADMIN_USER_ID check would refuse outright.
//
// Deliberately a MINIMAL shell -- a bare header and the page, nothing else.
// No AdminSidebar, no AdminMobileNav, no admin nav of any kind
// (docs/agentic-creator-phase9b-plan.md section 4.1): a reviewer is not
// staff and must not be shown the ~40-page admin information architecture,
// most of which requireReviewer() would refuse them anyway.
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
      <header className="border-b border-white/10 px-4 py-4 sm:px-6">
        <span className="font-serif text-lg text-neutral-100">Kissago Review</span>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-10">{children}</main>
    </div>
  );
}
