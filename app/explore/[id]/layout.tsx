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
export default async function ExploreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: storyId } = await params;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }
    // ['id']: only the access decision matters here, same minimal select
    // app/actions/persistence.ts's autosave path already uses for the same
    // "just checking access" purpose.
    await assertCanEditStory(storyId, user.id, ['id']);
  } catch {
    redirect(await resolveNonOwnerRedirectTarget(storyId));
  }

  return <>{children}</>;
}
