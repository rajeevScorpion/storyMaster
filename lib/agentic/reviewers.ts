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
  decideStoryEditAccess,
  isActiveReviewer,
  isMissingReviewerSchemaError,
  type AgentReviewer,
  type AgentReviewerRole,
  type AgentReviewerStatus,
} from '@/lib/agentic/reviewers.shared';
import { listRuns } from '@/lib/agentic/orchestrator';
import { isMissingAssignmentSchemaError } from '@/lib/agentic/review-routing.shared';

interface AgentReviewerRow {
  user_id: string;
  status: AgentReviewerStatus;
  role: AgentReviewerRole;
  age_groups: string[] | null;
  languages: string[] | null;
  genres: string[] | null;
  display_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

function rowToReviewer(row: AgentReviewerRow): AgentReviewer {
  return {
    userId: row.user_id,
    status: row.status,
    role: row.role,
    ageGroups: row.age_groups ?? [],
    languages: row.languages ?? [],
    genres: row.genres ?? [],
    displayName: row.display_name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/**
 * Synthetic row for process.env.ADMIN_USER_ID -- never persisted, never read back.
 * All three coverage arrays are empty ON PURPOSE: the implicit admin is not in the
 * routing pool and must never be auto-assigned work by Unit 9j's matcher (which
 * only considers a reviewer's declared coverage) -- they already reach every draft
 * through /admin/authors regardless of routing.
 */
function buildImplicitAdminReviewer(userId: string): AgentReviewer {
  const now = new Date().toISOString();
  return {
    userId,
    status: 'active',
    role: 'editor',
    ageGroups: [],
    languages: [],
    genres: [],
    displayName: 'Admin (implicit reviewer)',
    notes: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
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
      .select('user_id, status, role, age_groups, languages, genres, display_name, notes, created_at, updated_at, created_by, updated_by')
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

// One latch for migration 114 alone, SCOPED TO THIS FILE. Per GOTCHAS.md ("Column
// availability latches are per migration group"), and per review-routing.ts's own
// header for this exact table ("never shared across files even when they read the
// same table"): this is a second, independent latch from review-routing.ts's own
// `assignmentSchemaUnavailable`, sharing only the classifier
// (isMissingAssignmentSchemaError), never the flag.
let assignmentSchemaUnavailableForStanding = false;
function latchAssignmentSchemaUnavailableForStanding(context: string): void {
  if (!assignmentSchemaUnavailableForStanding) {
    assignmentSchemaUnavailableForStanding = true;
    console.warn(
      `[agentic-reviewers] agent_review_assignments unavailable (${context}); migration 114 is not applied on this database. ` +
        'The assigned-count bubble will stay hidden (count 0) until it is.'
    );
  }
}

/**
 * Phase 10 Round 3, 5.4: the count behind the profile-menu bubble beside "Review
 * queue" -- ACTIVE assignments pointing at `userId` whose task's CURRENT run is
 * still at stage 'awaiting_review'. Deliberately NOT all-time assignments: an
 * assignment can stay 'active' (nobody has released it) after its run has already
 * been decided (approved/rejected/published all move the run off
 * 'awaiting_review'), and a decided run is not outstanding work any more.
 *
 * Reuses listRuns (lib/agentic/orchestrator.ts) exactly as listReviewQueueAction's
 * own 'mine' filter does, rather than re-deriving "which runs are awaiting review"
 * a second way. Two queries, not a joined one: agent_review_assignments and
 * agent_runs are read from separate files with separate migration-availability
 * latches (114 and 107 respectively), and there is no FK-embed relationship set up
 * between them to lean on.
 *
 * NEVER THROWS -- always degrades to 0 (missing migration 114, a transient query
 * error, or genuinely zero). This is what lets resolveMyReviewerStanding below keep
 * its "fails closed to no bubble, never a thrown provider" property: a count
 * failure must not cost a reviewer their role badge, only the bubble.
 */
async function countMyAwaitingReviewAssignments(userId: string): Promise<number> {
  if (assignmentSchemaUnavailableForStanding) return 0;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('agent_review_assignments')
      .select('task_id')
      .eq('reviewer_id', userId)
      .eq('status', 'active');

    if (error) {
      if (isMissingAssignmentSchemaError(error)) {
        latchAssignmentSchemaUnavailableForStanding('countMyAwaitingReviewAssignments');
        return 0;
      }
      throw new Error(`Failed to count review assignments: ${error.message}`);
    }

    const assignedTaskIds = new Set((data ?? []).map((row) => (row as { task_id: string }).task_id));
    if (assignedTaskIds.size === 0) return 0;

    const awaitingRuns = await listRuns({ stage: 'awaiting_review' });
    let count = 0;
    for (const run of awaitingRuns) {
      if (assignedTaskIds.has(run.taskId)) count += 1;
    }
    return count;
  } catch (error) {
    if (isMissingAssignmentSchemaError(error as { code?: string; message?: string } | null | undefined)) {
      latchAssignmentSchemaUnavailableForStanding('countMyAwaitingReviewAssignments');
      return 0;
    }
    // Fails closed to 0, not a throw -- see this function's own doc comment.
    console.error('[agentic-reviewers] countMyAwaitingReviewAssignments failed; showing no bubble instead.', error);
    return 0;
  }
}

/**
 * Resolves the CURRENT user's reviewer standing for the pricing-runtime payload
 * (D20, docs/agentic-creator-phase9c-plan.md section 4.1): `{ role, assignedCount }
 * | null`, never more. requireReviewer() below throws by design -- a hard
 * authorization gate -- which is exactly wrong for this caller:
 * getPricingRuntimeContext() is fetched once per session by an app-wide provider
 * on every signed-in page, so a reviewer lookup here must degrade to `null` for
 * ANY reason (migration 111 unapplied, a transient query error, or simply "not a
 * reviewer") rather than take the whole pricing payload down with it. Reuses
 * resolveReviewerForUser() above -- same fetch, same 111-latch, same
 * ADMIN_USER_ID short-circuit as requireReviewer() -- so this is not a second way
 * of answering "is this user a reviewer".
 *
 * Deliberately returns ONLY `{ role, assignedCount }` for the CALLER's own id.
 * Never `notes`, never `status`, never any other account's standing -- see
 * `245588e`, which fixed exactly this shape (admin-only `notes`) leaking from a
 * different reviewer action to every active reviewer. There is no parameter here
 * to pass another user's id.
 *
 * Only an ACTIVE reviewer/editor gets a standing back (isActiveReviewer), matching
 * requireReviewer()'s own gate -- a suspended reviewer must not see a badge or a
 * queue link that requireReviewer() would then refuse to honor.
 *
 * `assignedCount` (Phase 10 Round 3, 5.4) is resolved by
 * countMyAwaitingReviewAssignments above, which NEVER throws -- so a count failure
 * degrades to 0 (no bubble rendered) without disturbing this function's own
 * "fails closed to null on any error" property for `role`/the reviewer badge
 * itself. The query only runs here, inside this branch -- once `isActiveReviewer`
 * is already known true -- so it costs nothing for the overwhelming majority of
 * signed-in users who are not reviewers at all.
 */
export async function resolveMyReviewerStanding(
  userId: string
): Promise<{ role: AgentReviewerRole; assignedCount: number } | null> {
  try {
    const reviewer = await resolveReviewerForUser(userId);
    if (!isActiveReviewer(reviewer)) {
      return null;
    }
    const assignedCount = await countMyAwaitingReviewAssignments(userId);
    return { role: reviewer.role, assignedCount };
  } catch {
    return null;
  }
}

/**
 * Verify the current session belongs to an active reviewer. Throws if not -- mirrors
 * verifyAdmin() (lib/supabase/admin.ts) exactly: 'Not authenticated' when there is no
 * session, 'Forbidden' when the signed-in user is neither ADMIN_USER_ID nor an active
 * row in agent_reviewers. On success `reviewer` is a non-null, active AgentReviewer --
 * either the fetched row or the synthetic admin one -- so a caller can read
 * canPublish()/canTriggerMedia() off it without re-checking for null.
 */
export async function requireReviewer(): Promise<{ userId: string; reviewer: AgentReviewer }> {
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
 * The shared ownership/review gate every write-path guard delegates to (D14): resolves
 * access when `userId` is EITHER the story's own `user_id` OR an active reviewer AND
 * the story is agent-owned (`stories.agent_persona_id IS NOT NULL`) -- delegating the
 * actual owner/reviewer/stranger decision to the pure `decideStoryEditAccess()` in
 * reviewers.shared.ts. Throws 'Story not found.' when the story does not exist,
 * 'Forbidden.' otherwise. Runs on the service-role client, so this function itself is
 * the entire access-control boundary for a reviewer write -- callers must not
 * additionally trust RLS.
 *
 * Deliberately does NOT itself enforce any specific capability (can_publish /
 * can_trigger_media) -- it only proves "may edit this story at all". What it DOES do
 * (Unit 9b) is hand the caller `reviewer` -- `null` when access came from ownership,
 * the resolved active `AgentReviewer` when it came from the reviewer branch -- so a
 * caller that also needs a specific capability (narration/image submits, gated on
 * can_trigger_media per the plan) can check `canTriggerMediaForEditAccess(reviewer)` /
 * `canPublish(reviewer)` from reviewers.shared.ts against THIS reviewer, with no second
 * database round-trip and, just as importantly, no risk of running the capability check
 * on an owner at all (an owner's `reviewer` is always `null`, never a freshly re-fetched
 * row that might not exist).
 *
 * Column selection: pass `columns` to fetch exactly what the call site needs, and `id`,
 * `user_id` and `agent_persona_id` are unioned in regardless -- this function's own
 * authorization logic reads them, and a caller omitting `user_id` would otherwise
 * silently authorize everyone. Omit `columns` and it selects `*`. Prefer passing them:
 * `stories.story_map` is the whole branching tree, and the guards this replaces
 * deliberately fetched narrow lists rather than dragging it through every ownership
 * check. `EditableStoryRow` types only the three columns this function itself depends on.
 */
export interface EditableStoryRow {
  id: string;
  user_id: string;
  agent_persona_id: string | null;
  [key: string]: unknown;
}

/**
 * What a successful `assertCanEditStory()` call hands back. `reviewer` says HOW access
 * was granted, per decideStoryEditAccess(): `null` for the owner branch, the active
 * `AgentReviewer` for the reviewer branch. Never both, never neither.
 */
export interface EditableStoryAccess {
  story: EditableStoryRow;
  reviewer: AgentReviewer | null;
}

export async function assertCanEditStory(
  storyId: string,
  userId: string,
  columns?: readonly string[]
): Promise<EditableStoryAccess> {
  // The three columns this function's own logic reads are always fetched, whatever the
  // caller asked for -- a guard that omitted user_id would silently authorize everyone.
  const select = columns?.length
    ? Array.from(new Set(['id', 'user_id', 'agent_persona_id', ...columns])).join(', ')
    : '*';

  const admin = createAdminClient();
  const { data: story, error } = await admin
    .from('stories')
    .select(select)
    .eq('id', storyId)
    .single();

  if (error || !story) {
    throw new Error('Story not found.');
  }

  // Double cast: `select()` takes a runtime-built string, so supabase-js cannot infer a
  // row shape and widens to GenericStringError. The column union above guarantees the
  // three fields EditableStoryRow declares are present.
  const row = story as unknown as EditableStoryRow;

  // Only fetch a reviewer row when ownership alone doesn't already grant access, and
  // only when the story could possibly have one to check -- an ordinary user's own
  // story has no reviewer standing regardless of agent_reviewers, so this never
  // touches the table (or the ADMIN_USER_ID short-circuit) on that path.
  const reviewer = row.user_id !== userId && row.agent_persona_id
    ? await resolveReviewerForUser(userId)
    : null;

  const decision = decideStoryEditAccess({
    userId,
    storyUserId: row.user_id,
    agentPersonaId: row.agent_persona_id,
    reviewer,
  });
  if (!decision.granted) {
    throw new Error('Forbidden.');
  }

  return { story: row, reviewer: decision.via === 'reviewer' ? decision.reviewer : null };
}
