import { redirect } from 'next/navigation';
import { verifyAdmin } from '@/lib/supabase/admin';

// Thin server-side shell for Phase 9's reviewer surface, copying
// app/admin/agents/layout.tsx's shape exactly: the parent app/admin/layout.tsx
// already verifies admin and redirects on failure before this ever renders; this
// repeats the same cheap check so the module stays server-side and self-guarding
// as this area grows (today: the review queue and the reviewer roster).
//
// This is a DIFFERENT gate from the one app/actions/agentic-review.ts uses
// (requireReviewer(), not verifyAdmin() -- see that file's header). The two
// currently agree for every real caller: ADMIN_USER_ID passes both, and this
// layout's verifyAdmin() bars anyone who isn't staff before a non-admin
// reviewer's standing is ever even checked -- so today, a non-admin active
// reviewer still cannot reach /admin/authors at all. See
// docs/agentic-creator-phase9-plan.md Unit 9c.
export default async function AuthorsAdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await verifyAdmin();
  } catch {
    redirect('/');
  }

  return <>{children}</>;
}
