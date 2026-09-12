import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assertCanEditStory } from '@/lib/agentic/reviewers';
import { resolveNonOwnerRedirectTarget } from '@/lib/story/creation-mode-access';

// ── Agentic Creator: Phase 10 Round 1 (D24) ─────────────────────────────
//
// /explore/[id] is owner-or-reviewer only too, per the owner's 2026-09-12
// decision recorded in docs/agentic-creator-phase10-plan.md section 3
// (right above 3.1): "the same gate as /story/[id]. Non-owners read
// published work at /storyline/[id]. This closes the exposure of
// *unpublished* branches alongside the branching itself." Shared branching
// (exploring someone else's tree to fork it on your own branch) goes dormant
// per D23; this route was its one entry point (the "Explore full story
// tree" link removed from StorylinePlayer.tsx).
//
// Deliberately byte-for-byte the same shape as app/story/[id]/layout.tsx --
// see that file's comment for the full rationale. Kept as two files rather
// than one shared layout because the two routes are siblings under
// different top-level segments; Next's layout resolution has no shared
// ancestor to hang a single layout from without also affecting other routes.
//
// A signed-out visitor is NOT a non-owner for this gate's purposes (D24,
// corrected 2026-09-12). The page already handles anonymity itself by
// opening the sign-in dialog with a return URL back to this story
// (app/explore/[id]/page.tsx lines 50-53). Redirecting on `!user` here would
// make that dialog unreachable and bounce someone away from their own story
// before they ever get the chance to sign in. This is safe to skip because
// loadStoryTree (app/actions/exploration.ts) requires a session and throws
// for an anonymous caller, so no story data loads and nothing leaks -- only
// a *signed-in* non-owner is refused.
export default async function ExploreLayout({
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
