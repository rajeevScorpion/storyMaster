import 'server-only';

// ── Agentic Creator: Phase 9 reviewer authorization, server half ───────
//
// Reads public.agent_reviewers (migration 111). All the logic that decides what a
// reviewer CAN DO given their row lives in the pure sibling reviewers.shared.ts; this
// file only authenticates, fetches, and enforces (D14 in
// docs/agentic-creator-phase9-plan.md).
//
// FAILS CLOSED for its own migration group (111): while agent_reviewers is unapplied,
// fetching a reviewer row degrades to `null` (never a throw, never a 500) via the same
// single-latch pattern lib/agentic/supervisor.ts uses for agent_tasks (106) and
// lib/agentic/memory.ts uses for agent_story_memory (105) -- detected from the query
// error's code, never by probing information_schema first. A `null` reviewer reads as
// "not a reviewer" everywhere downstream (isActiveReviewer/canPublish/canTriggerMedia
// all return false for null), so a database that has never seen migration 111 denies
// every non-owner write rather than erroring or, worse, allowing one.
//
// process.env.ADMIN_USER_ID is IMPLICITLY a reviewer with every capability, exactly as
// verifyAdmin() (lib/supabase/admin.ts) treats it as implicitly THE admin. That is
// policy, not data, so it is resolved here in code rather than by seeding a row --
// the plan is explicit that ADMIN_USER_ID must work even on a database with no
// agent_reviewers table at all. resolveReviewerForUser() below short-circuits on the
// env var BEFORE touching the database, so the admin override has no dependency on
// migration 111 having run.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  isActiveReviewer,
  isMissingReviewerSchemaError,
  type AgentReviewer,
  type AgentReviewerStatus,
} from '@/lib/agentic/reviewers.shared';

interface AgentReviewerRow {
  user_id: string;
  status: AgentReviewerStatus;
  can_publish: boolean;
  can_trigger_media: boolean;
  display_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

function rowToReviewer(row: AgentReviewerRow): AgentReviewer {
  return {
    userId: row.user_id,
    status: row.status,
    canPublish: row.can_publish,
    canTriggerMedia: row.can_trigger_media,
    displayName: row.display_name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

/** Synthetic row for process.env.ADMIN_USER_ID -- never persisted, never read back. */
function buildImplicitAdminReviewer(userId: string): AgentReviewer {
  const now = new Date().toISOString();
  return {
    userId,
    status: 'active',
    canPublish: true,
    canTriggerMedia: true,
    displayName: 'Admin (implicit reviewer)',
    notes: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
  };
}

function isImplicitAdmin(userId: string): boolean {
  const adminUserId = process.env.ADMIN_USER_ID;
  return Boolean(adminUserId) && userId === adminUserId;
}

// One latch for migration 111 alone (GOTCHAS: latches are one per migration group).
// Logged once, then quiet: an unapplied migration is a steady state, not an incident.
let reviewerSchemaUnavailable = false;
function latchReviewerSchemaUnavailable(context: string): void {
  if (!reviewerSchemaUnavailable) {
    reviewerSchemaUnavailable = true;
    console.warn(
      `[agentic-reviewers] agent_reviewers unavailable (${context}); migration 111 is not applied on this database. ` +
        'Every non-admin caller will be denied reviewer access until it is.'
    );
  }
}

/** Reads one row from public.agent_reviewers on the service-role client. Fails closed to `null` -- both "no such reviewer" and "the table doesn't exist yet" read identically to every caller. */
async function fetchReviewerRow(userId: string): Promise<AgentReviewer | null> {
  if (reviewerSchemaUnavailable) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('agent_reviewers')
      .select('user_id, status, can_publish, can_trigger_media, display_name, notes, created_at, updated_at, created_by')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (isMissingReviewerSchemaError(error)) {
        latchReviewerSchemaUnavailable('fetchReviewerRow');
        return null;
      }
      throw new Error(`Failed to read agent_reviewers: ${error.message}`);
    }

    return data ? rowToReviewer(data as AgentReviewerRow) : null;
  } catch (error) {
    if (isMissingReviewerSchemaError(error as { code?: string; message?: string } | null | undefined)) {
      latchReviewerSchemaUnavailable('fetchReviewerRow');
      return null;
    }
    throw error;
  }
}

/**
 * The one place `userId -> AgentReviewer | null` is resolved, for both requireReviewer()
 * and assertCanEditStory() below. ADMIN_USER_ID short-circuits to a full-capability
 * synthetic row without a database round-trip; everyone else goes through
 * fetchReviewerRow(), which fails closed per the file header.
 */
async function resolveReviewerForUser(userId: string): Promise<AgentReviewer | null> {
  if (isImplicitAdmin(userId)) return buildImplicitAdminReviewer(userId);
  return fetchReviewerRow(userId);
}

/**
 * Verify the current session belongs to an active reviewer. Throws if not -- mirrors
 * verifyAdmin() (lib/supabase/admin.ts) exactly: 'Not authenticated' when there is no
 * session, 'Forbidden' when the signed-in user is neither ADMIN_USER_ID nor an active
 * row in agent_reviewers. On success `reviewer` is always a non-null, active
 * AgentReviewer (the fetched row, or the synthetic admin one) -- callers still get the
 * `| null` in the type because that is the honest shape of "a reviewer row for a user"
 * everywhere else this type is used, not because a successful call here can produce it.
 */
export async function requireReviewer(): Promise<{ userId: string; reviewer: AgentReviewer | null }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Not authenticated');
  }

  const reviewer = await resolveReviewerForUser(user.id);
  if (!isActiveReviewer(reviewer)) {
    throw new Error('Forbidden');
  }

  return { userId: user.id, reviewer };
}

/**
 * The shared ownership/review gate every write-path guard delegates to (D14): returns
 * the story row when `userId` is EITHER the story's own `user_id` OR an active reviewer
 * AND the story is agent-owned (`stories.agent_persona_id IS NOT NULL`). Throws
 * 'Story not found.' when the story does not exist, 'Forbidden.' otherwise. Runs on the
 * service-role client, so this function itself is the entire access-control boundary
 * for a reviewer write -- callers must not additionally trust RLS.
 *
 * Deliberately does NOT check any specific capability (can_publish / can_trigger_media)
 * -- this only proves "may edit this story at all". A caller that also needs a specific
 * capability (Unit 9b's narration/image submits, gated on can_trigger_media per the
 * plan) resolves its own reviewer separately -- e.g. via requireReviewer() when it has
 * the session cookie available -- and checks canTriggerMedia()/canPublish() from
 * reviewers.shared.ts against it. Unit 9a's job is this one shared ownership boundary,
 * not every capability-specific call site.
 *
 * Selects `*`: different call sites need different columns (story_map, story_config,
 * genre, tone, target_age, ...) and this helper has no way to know which columns a
 * future 9b guard will need, so it returns the whole row rather than guessing a subset
 * and forcing every caller into a second query. `EditableStoryRow` types only the three
 * columns this function's own logic depends on.
 */
export interface EditableStoryRow {
  id: string;
  user_id: string;
  agent_persona_id: string | null;
  [key: string]: unknown;
}

export async function assertCanEditStory(storyId: string, userId: string): Promise<EditableStoryRow> {
  const admin = createAdminClient();
  const { data: story, error } = await admin
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();

  if (error || !story) {
    throw new Error('Story not found.');
  }

  const row = story as EditableStoryRow;
  if (row.user_id === userId) {
    return row;
  }

  // Not the owner: only an active reviewer may proceed, and only onto a story an agent
  // actually authored -- a reviewer has no standing over an ordinary user's own story.
  if (!row.agent_persona_id) {
    throw new Error('Forbidden.');
  }

  const reviewer = await resolveReviewerForUser(userId);
  if (!isActiveReviewer(reviewer)) {
    throw new Error('Forbidden.');
  }

  return row;
}
