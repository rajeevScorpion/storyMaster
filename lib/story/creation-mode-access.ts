import 'server-only';

import { createClient } from '@/lib/supabase/server';

// ── Agentic Creator: Phase 10 Round 1 (D24) ─────────────────────────────
//
// Shared by app/story/[id]/layout.tsx and app/explore/[id]/layout.tsx. Both
// creation-mode routes are owner-or-reviewer only now (assertCanEditStory is
// the actual gate, called from each layout); this only answers the separate
// question of WHERE to send someone who fails that gate.
//
// docs/agentic-creator-phase10-plan.md section 3.3 item 2: "redirecting a
// non-owner to /storyline/[id] where one exists and / otherwise." A
// published storyline is the reader-facing surface for work that isn't
// theirs; falling back to '/' keeps a non-owner from ever seeing a 404-style
// dead end for a story that has no published storyline yet.
//
// Uses the ordinary session client, not the admin client: `storylines` already
// carries "Public storylines are viewable by everyone" (migration
// 001_initial_schema.sql), so a signed-out visitor and a signed-in stranger
// both read a published row the same way a gallery card would. This function
// is never the access boundary itself -- assertCanEditStory already ran (and
// threw) before either layout calls this -- so failing to find a storyline
// here can only ever send someone to '/', never grant anything.
export async function resolveNonOwnerRedirectTarget(storyId: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('storylines')
      .select('id')
      .eq('story_id', storyId)
      .eq('is_public', true)
      .limit(1)
      .maybeSingle();

    if (data?.id) {
      return `/storyline/${data.id}`;
    }
  } catch {
    // Fail closed to the front door, never let a lookup error strand a
    // redirect() call -- the caller is already inside a catch block.
  }

  return '/';
}
