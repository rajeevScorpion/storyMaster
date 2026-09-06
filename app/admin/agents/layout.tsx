import { redirect } from 'next/navigation';
import { verifyAdmin } from '@/lib/supabase/admin';

// Thin server-side shell for the Agentic Creator System's admin area. The
// parent app/admin/layout.tsx already verifies admin and redirects on
// failure before this ever renders; this repeats the same cheap check so the
// module stays server-side and self-guarding as later phases add sibling
// routes (personas, test lab, tasks, runs, routing) under this layout.
export default async function AgenticAdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await verifyAdmin();
  } catch {
    redirect('/');
  }

  return <>{children}</>;
}
