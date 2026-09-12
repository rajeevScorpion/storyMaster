import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import { resolveNonOwnerRedirectTarget } from '@/lib/story/creation-mode-access';

// ── Agentic Creator: Phase 10 Round 1 (D24) ─────────────────────────────
//
// Server-component gate for creation mode. /story/[id]/page.tsx is 'use
// client' by necessity -- it drives the Zustand store -- so per D24 a
// sibling server layout gates access instead, the same shape /admin and
// /review already use: try/catch/redirect, never a rendered "forbidden"
// state.
//
// docs/agentic-creator-phase10-plan.md section 3.1: loadStory
// (app/actions/persistence.ts) has never checked ownership -- it uses the
// session client and only confirms *someone* is signed in. A non-owner got
// a fully functional creation-mode editor on someone else's story. This
// closes that: assertCanEditStory grants owner or an authorized reviewer on
// an agent draft (the exact predicate saveBeat/beat-control.ts/image-batch.ts
// already use) and throws for anyone else, including the previously-real
// "continue someone else's story on your own branch" case -- shared
// branching goes dormant per D23, and this route gate is the other half of
// that alongside migration 115.
//
// Redirects to /storyline/[id] when a published storyline exists for this
// story, '/' otherwise (resolveNonOwnerRedirectTarget) -- never back to this
// same owner-only route, which would loop.
//
// A signed-out visitor is NOT a non-owner for this gate's purposes (D24,
// corrected 2026-09-12). The page already handles anonymity itself by
// opening the sign-in dialog with a return URL back to this story
// (app/story/[id]/page.tsx lines 56-61). Redirecting on `!user` here would
// make that dialog unreachable and bounce someone away from their own story
// before they ever get the chance to sign in. This is safe to skip because
// loadStory (app/actions/persistence.ts) requires a session and throws for
// an anonymous caller, so no story data loads and nothing leaks -- only a
// *signed-in* non-owner is refused.
export default async function StoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: storyId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <>{children}</>;
  }

  try {
    // ['id']: only the access decision matters here, same minimal select
    // app/actions/persistence.ts's autosave path already uses for the same
    // "just checking access" purpose.
    await assertCanEditStory(storyId, user.id, ['id']);
  } catch {
    redirect(await resolveNonOwnerRedirectTarget(storyId));
  }

  return <>{children}</>;
}
