import 'server-only';

// ── Agentic Creator System: Phase 9b reviewer assignment, server half (Units 9i + 9j) ──
//
// Reads/writes public.agent_review_assignments (migration 114, D18): which reviewer
// is currently looking at which TASK (not run -- a task can produce several runs via
// retry, and an assignment must survive that; see the migration header). ADVISORY
// only -- nothing here gates a review decision, it only drives the default filter on
// /review and (Unit 9k) the workload view.
//
// FAILS CLOSED for its own migration group (114), via its own latch
// (assignmentSchemaUnavailable) and its own classifier
// (isMissingAssignmentSchemaError, review-routing.shared.ts) -- never the 107/111/112
// latches, per GOTCHAS.md. Reads degrade to an empty Map; writes throw one clear
// "migration 114 is not applied yet" message rather than a raw Postgres error.
//
// Unit 9j adds tryAutoAssignReview() (bottom of this file) and orchestrator.ts calls it
// from persistStageAdvance -- see the Phase 9b plan section 6.3 for the import-direction
// hazard that pairing creates. This file's only import from orchestrator.ts is the
// already-exported `AdminClient` TYPE (`import type`, erased at compile time), while
// orchestrator.ts's import of `tryAutoAssignReview` from here is a genuine value import
// -- that asymmetry is what keeps this a one-directional edge rather than a runtime
// cycle. See the comment beside that import in orchestrator.ts before changing either
// side.

import type { AdminClient } from '@/lib/agentic/orchestrator';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { isMissingReviewerSchemaError } from '@/lib/agentic/reviewers.shared';
import { isMissingTaskSchemaError } from '@/lib/agentic/supervisor.shared';
import {
  isMissingAssignmentSchemaError,
  routeTaskToReviewer,
  type AssignmentSource,
  type AssignmentStatus,
  type ReviewAssignment,
  type RoutableReviewer,
  type RoutableTask,
} from '@/lib/agentic/review-routing.shared';

const ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE =
  'Review assignment storage is not available yet — migration 114 has not been applied to this environment.';

// One latch for migration 114 alone (GOTCHAS: latches are one per migration group).
// Logged once, then quiet: an unapplied migration is a steady state, not an incident.
let assignmentSchemaUnavailable = false;
function latchAssignmentSchemaUnavailable(context: string): void {
  if (!assignmentSchemaUnavailable) {
    assignmentSchemaUnavailable = true;
    console.warn(
      `[agentic-review-routing] agent_review_assignments unavailable (${context}); migration 114 is not applied on this database. ` +
        'Reads will report empty/unassigned and writes will throw until it is.'
    );
  }
}

function isAssignmentSchemaMissing(error: unknown): boolean {
  return isMissingAssignmentSchemaError(error as { code?: string; message?: string } | null | undefined);
}

// ── Row shape ──────────────────────────────────────────────────────────

interface AgentReviewAssignmentRow {
  id: string;
  task_id: string;
  reviewer_id: string | null;
  assigned_by: string | null;
  source: AssignmentSource;
  status: AssignmentStatus;
  match_reason: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToAssignment(row: AgentReviewAssignmentRow): ReviewAssignment {
  return {
    id: row.id,
    taskId: row.task_id,
    reviewerId: row.reviewer_id,
    assignedBy: row.assigned_by,
    source: row.source,
    status: row.status,
    matchReason: row.match_reason ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────

/**
 * Every ACTIVE assignment among `taskIds`, keyed by task_id. Degrades to an empty
 * Map whenever migration 114 is unapplied, taskIds is empty, or the query itself
 * fails closed -- a read must never 500 a review queue that otherwise has real rows
 * to show.
 *
 * A returned row may still carry `reviewerId: null` (the FK's ON DELETE SET NULL) --
 * this function does NOT filter those out, because the row's other fields
 * (assignedBy, source, matchReason) can still be meaningful. Callers reading "is this
 * task assigned to someone" MUST check `.reviewerId`, not merely whether the map has
 * an entry -- see this module's header and the migration's own comment.
 */
export async function listAssignmentsForTasks(
  admin: AdminClient,
  taskIds: readonly string[]
): Promise<Map<string, ReviewAssignment>> {
  const result = new Map<string, ReviewAssignment>();
  if (assignmentSchemaUnavailable || taskIds.length === 0) return result;

  try {
    const { data, error } = await admin
      .from('agent_review_assignments')
      .select('*')
      .in('task_id', taskIds)
      .eq('status', 'active');

    if (error) {
      if (isAssignmentSchemaMissing(error)) {
        latchAssignmentSchemaUnavailable('listAssignmentsForTasks');
        return result;
      }
      throw new Error(`Failed to list agent_review_assignments: ${error.message}`);
    }

    for (const row of (data ?? []) as AgentReviewAssignmentRow[]) {
      result.set(row.task_id, rowToAssignment(row));
    }
    return result;
  } catch (error) {
    if (isAssignmentSchemaMissing(error)) {
      latchAssignmentSchemaUnavailable('listAssignmentsForTasks');
      return result;
    }
    throw error;
  }
}

/**
 * Open (active) assignment count per reviewer_id, across the WHOLE roster -- what
 * Unit 9j's least-loaded matcher needs. Rows with `reviewer_id IS NULL` are
 * deliberately EXCLUDED from every reviewer's count -- per D18/the migration
 * header, that state means "unassigned", not "assigned to nobody", so it must never
 * be attributed to any reviewer's workload.
 */
export async function countOpenAssignmentsByReviewer(admin: AdminClient): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (assignmentSchemaUnavailable) return result;

  try {
    const { data, error } = await admin
      .from('agent_review_assignments')
      .select('reviewer_id')
      .eq('status', 'active');

    if (error) {
      if (isAssignmentSchemaMissing(error)) {
        latchAssignmentSchemaUnavailable('countOpenAssignmentsByReviewer');
        return result;
      }
      throw new Error(`Failed to count open agent_review_assignments: ${error.message}`);
    }

    for (const row of (data ?? []) as Pick<AgentReviewAssignmentRow, 'reviewer_id'>[]) {
      if (!row.reviewer_id) continue;
      result.set(row.reviewer_id, (result.get(row.reviewer_id) ?? 0) + 1);
    }
    return result;
  } catch (error) {
    if (isAssignmentSchemaMissing(error)) {
      latchAssignmentSchemaUnavailable('countOpenAssignmentsByReviewer');
      return result;
    }
    throw error;
  }
}

async function fetchActiveAssignmentForTask(admin: AdminClient, taskId: string): Promise<ReviewAssignment | null> {
  const { data, error } = await admin
    .from('agent_review_assignments')
    .select('*')
    .eq('task_id', taskId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    if (isAssignmentSchemaMissing(error)) {
      latchAssignmentSchemaUnavailable('fetchActiveAssignmentForTask');
      return null;
    }
    throw new Error(`Failed to read the active assignment for task ${taskId}: ${error.message}`);
  }

  return data ? rowToAssignment(data as AgentReviewAssignmentRow) : null;
}

// ── Writes ─────────────────────────────────────────────────────────────

/** True for the Postgres unique_violation code -- what agent_review_assignments_one_active_idx throws on a racing concurrent assign. */
function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export interface AssignTaskParams {
  taskId: string;
  /** The reviewer being assigned. Always a real user for both manual (9i) and auto (9j) assignment -- there is no "assign to nobody" call; release is a separate function. */
  reviewerId: string;
  /** The editor who chose this assignment (manual), or `null` for an auto-assignment (9j) -- the matcher acts on nobody's behalf. */
  assignedBy: string | null;
  source?: AssignmentSource;
  matchReason?: Record<string, unknown>;
}

/**
 * Assigns `reviewerId` to `taskId`: supersedes any existing ACTIVE row for that task
 * (status -> 'superseded'), then inserts a fresh active row. Two separate statements,
 * not an upsert -- an upsert would need a conflict target, and the only unique
 * constraint on this table is the PARTIAL one on `(task_id) WHERE status = 'active'`,
 * which `ON CONFLICT` cannot target directly.
 *
 * CONCURRENCY: the partial unique index is what makes this safe under a race. If two
 * assignTask calls for the same task interleave between this function's supersede and
 * insert steps, both supersede statements succeed (superseding is idempotent — there
 * is at most one active row to affect), but only one insert can win; the loser's
 * insert throws 23505 (unique_violation). Rather than surfacing that as an error to an
 * editor who did nothing wrong, this function re-reads the now-active row and returns
 * IT instead of throwing -- "already assigned" is treated as success, per the Phase 9b
 * plan section 5.2 ("catch that and return the existing assignment rather than
 * throwing").
 */
export async function assignTask(admin: AdminClient, params: AssignTaskParams): Promise<ReviewAssignment> {
  if (assignmentSchemaUnavailable) throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const { error: supersedeError } = await admin
      .from('agent_review_assignments')
      .update({ status: 'superseded', updated_at: new Date().toISOString() })
      .eq('task_id', params.taskId)
      .eq('status', 'active');

    if (supersedeError) {
      if (isAssignmentSchemaMissing(supersedeError)) {
        latchAssignmentSchemaUnavailable('assignTask (supersede)');
        throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to supersede the prior assignment for task ${params.taskId}: ${supersedeError.message}`);
    }

    const { data, error } = await admin
      .from('agent_review_assignments')
      .insert({
        task_id: params.taskId,
        reviewer_id: params.reviewerId,
        assigned_by: params.assignedBy,
        source: params.source ?? 'manual',
        status: 'active',
        match_reason: params.matchReason ?? {},
      })
      .select('*')
      .single();

    if (error) {
      if (isAssignmentSchemaMissing(error)) {
        latchAssignmentSchemaUnavailable('assignTask (insert)');
        throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      if (isUniqueViolation(error)) {
        // Lost the race described in this function's own doc comment -- another
        // assignTask call's insert landed first. Its row IS the current truth; hand
        // it back rather than throwing on an editor who did nothing wrong.
        const existing = await fetchActiveAssignmentForTask(admin, params.taskId);
        if (existing) return existing;
        throw new Error(
          `Task ${params.taskId} conflicted on assignment but no active row could be found afterward -- this should be unreachable.`
        );
      }
      throw new Error(`Failed to assign task ${params.taskId}: ${error.message}`);
    }

    return rowToAssignment(data as AgentReviewAssignmentRow);
  } catch (error) {
    if (isAssignmentSchemaMissing(error)) {
      latchAssignmentSchemaUnavailable('assignTask');
      throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

/**
 * Releases the active assignment on `taskId` (status -> 'released'), returning to the
 * unassigned pool. `actorId` is NOT persisted anywhere -- migration 114 has no
 * "released_by" column (only `assigned_by`, which describes how the row was CREATED,
 * not who ended it) -- it exists purely so a caller can log who released it; adding a
 * column for that is future scope, not this unit's.
 *
 * A no-op (returns `null`) when there is no active row to release -- releasing an
 * already-unassigned task is not an error.
 */
export async function releaseAssignment(
  admin: AdminClient,
  taskId: string,
  actorId: string
): Promise<ReviewAssignment | null> {
  if (assignmentSchemaUnavailable) throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const { data, error } = await admin
      .from('agent_review_assignments')
      .update({ status: 'released', updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .eq('status', 'active')
      .select('*')
      .maybeSingle();

    if (error) {
      if (isAssignmentSchemaMissing(error)) {
        latchAssignmentSchemaUnavailable('releaseAssignment');
        throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to release the assignment for task ${taskId}: ${error.message}`);
    }

    if (!data) return null;
    console.info(`[agentic-review-routing] task ${taskId} released by ${actorId}.`);
    return rowToAssignment(data as AgentReviewAssignmentRow);
  } catch (error) {
    if (isAssignmentSchemaMissing(error)) {
      latchAssignmentSchemaUnavailable('releaseAssignment');
      throw new Error(ASSIGNMENT_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

// ── Unit 9j: automatic assignment ────────────────────────────────────────
//
// tryAutoAssignReview() is orchestrator.ts's hook, called from persistStageAdvance
// immediately after a run's task flips to 'awaiting_review' (Phase 9b plan section
// 6.2/6.3). It is deliberately the ONLY function in this file that may never throw --
// a routing failure must never fail a run that has otherwise generated successfully.
// Every helper below exists to keep that function's own body a straight line: fetch the
// task's routing axes (106), fetch the active reviewer roster with its current load
// (111/113 + 114), call the pure routeTaskToReviewer (review-routing.shared.ts), and on
// a match, write it with assignTask() above.

// One latch for the migration-111/113 reviewer-roster read this file does for routing.
// Deliberately its OWN boolean, not a reuse of reviewers.ts's private
// `reviewerSchemaUnavailable` (module-private there, and per GOTCHAS.md latches are one
// per FILE-migration pair, not shared across files even when they read the same table) --
// it shares only the classifier (isMissingReviewerSchemaError), never the flag.
let reviewerRosterSchemaUnavailable = false;
function latchReviewerRosterSchemaUnavailable(context: string): void {
  if (!reviewerRosterSchemaUnavailable) {
    reviewerRosterSchemaUnavailable = true;
    console.warn(
      `[agentic-review-routing] agent_reviewers roster unavailable for auto-assignment (${context}); ` +
        'migration 111/113 is not applied on this database. Auto-assignment will treat every task as unroutable until it is.'
    );
  }
}

interface RoutableReviewerRow {
  user_id: string;
  languages: string[] | null;
  age_groups: string[] | null;
  genres: string[] | null;
}

/**
 * Every ACTIVE reviewer, shaped for routeTaskToReviewer, with each one's current open
 * (active) assignment count already attached -- the matcher needs the whole roster in
 * memory at once to compute least-loaded (migration 114's own header says the same).
 * Fails closed to `[]` when migration 111/113 is unapplied, exactly like every other
 * reviewer-roster read in this codebase -- an empty roster and "the table doesn't exist"
 * both correctly produce 'no_active_reviewers' from the matcher, which is the honest
 * outcome either way: there is nobody to route to.
 *
 * Does NOT include the synthetic ADMIN_USER_ID reviewer (buildImplicitAdminReviewer,
 * reviewers.ts) -- that identity is never a row in agent_reviewers, so a plain table
 * query naturally excludes it, which is exactly what Unit 9f's plan requires: the
 * implicit admin must never be auto-assigned work.
 */
async function fetchActiveReviewersForRouting(admin: AdminClient): Promise<RoutableReviewer[]> {
  if (reviewerRosterSchemaUnavailable) return [];

  try {
    const { data, error } = await admin
      .from('agent_reviewers')
      .select('user_id, languages, age_groups, genres')
      .eq('status', 'active');

    if (error) {
      if (isMissingReviewerSchemaError(error)) {
        latchReviewerRosterSchemaUnavailable('fetchActiveReviewersForRouting');
        return [];
      }
      throw new Error(`Failed to list active agent_reviewers for routing: ${error.message}`);
    }

    const openAssignments = await countOpenAssignmentsByReviewer(admin);
    return ((data ?? []) as RoutableReviewerRow[]).map((row) => ({
      userId: row.user_id,
      languages: row.languages ?? [],
      ageGroups: row.age_groups ?? [],
      genres: row.genres ?? [],
      openAssignments: openAssignments.get(row.user_id) ?? 0,
    }));
  } catch (error) {
    if (isMissingReviewerSchemaError(error as { code?: string; message?: string } | null | undefined)) {
      latchReviewerRosterSchemaUnavailable('fetchActiveReviewersForRouting');
      return [];
    }
    throw error;
  }
}

interface RoutableTaskRow {
  language: string;
  age_group: string;
  genre: string | null;
}

/**
 * The routing axes for one agent_tasks row (migration 106) -- a query that touches ONLY
 * agent_tasks, so it is classified with isMissingTaskSchemaError (106's own classifier),
 * never isMissingAssignmentSchemaError (114) or isMissingReviewerSchemaError (111/113),
 * per GOTCHAS.md ("classify by the query, not by the error"). Returns `null` on a
 * missing row OR a missing migration -- both mean "there is nothing here to route",
 * which tryAutoAssignReview treats identically: log and return.
 */
async function fetchRoutableTask(admin: AdminClient, taskId: string): Promise<RoutableTask | null> {
  try {
    const { data, error } = await admin
      .from('agent_tasks')
      .select('language, age_group, genre')
      .eq('id', taskId)
      .maybeSingle();

    if (error) {
      if (isMissingTaskSchemaError(error)) return null;
      throw new Error(`Failed to read agent_task ${taskId} for auto-assignment: ${error.message}`);
    }
    if (!data) return null;

    const row = data as RoutableTaskRow;
    return { language: row.language, ageGroup: row.age_group, genre: row.genre };
  } catch (error) {
    if (isMissingTaskSchemaError(error as { code?: string; message?: string } | null | undefined)) return null;
    throw error;
  }
}

/**
 * The Unit 9j hook: called from orchestrator.ts's persistStageAdvance immediately after
 * a task's status is set to 'awaiting_review'. Returns `void` and NEVER THROWS -- every
 * failure path below logs and returns, because a routing failure must never fail a run
 * that otherwise generated successfully. An unrouted task is a normal outcome (it is
 * visible in the unassigned pool on /review), not an incident, so the `assigned: false`
 * branch logs at info, not warn or error.
 *
 * No-ops, in order, when:
 *   - `agentic_reviewer_workflow_enabled` is off (no fetch of anything else at all).
 *   - migration 114 is unapplied -- checked via THIS FILE's own `assignmentSchemaUnavailable`
 *     latch (set by any of listAssignmentsForTasks/assignTask/etc. above), which is "the
 *     existing latch" the plan means: this hook lives in the same module as that flag and
 *     reads it directly rather than re-deriving it.
 *   - the task already carries an ACTIVE assignment with a real reviewer (`reviewerId`
 *     non-null). An active row with `reviewerId: null` (the FK's ON DELETE SET NULL) does
 *     NOT count as "already assigned" -- per this file's header and listAssignmentsForTasks's
 *     own doc comment, that state IS the unassigned pool, so routing proceeds and
 *     assignTask() supersedes the stale null-reviewer row.
 */
export async function tryAutoAssignReview(admin: AdminClient, taskId: string, context: string): Promise<void> {
  try {
    const flags = await getAgenticFlags();
    if (!flags.reviewerWorkflowEnabled) return;

    if (assignmentSchemaUnavailable) return;

    const existingByTask = await listAssignmentsForTasks(admin, [taskId]);
    const existing = existingByTask.get(taskId);
    if (existing && existing.reviewerId) {
      console.info(`[agentic-review-routing] task ${taskId} already assigned to ${existing.reviewerId}; skipping auto-assignment (${context}).`);
      return;
    }

    // listAssignmentsForTasks may itself have just discovered 114 is missing (it fails
    // closed to an empty map rather than throwing) -- re-check before doing any further
    // work, so a missing migration produces one quiet log line from its own latch above,
    // not a second one down in the catch block below.
    if (assignmentSchemaUnavailable) return;

    const task = await fetchRoutableTask(admin, taskId);
    if (!task) {
      console.warn(`[agentic-review-routing] tryAutoAssignReview: agent_task ${taskId} was not found (or migration 106 is unapplied); leaving unassigned (${context}).`);
      return;
    }

    const reviewers = await fetchActiveReviewersForRouting(admin);
    const outcome = routeTaskToReviewer(task, reviewers);

    if (!outcome.assigned) {
      console.info(`[agentic-review-routing] task ${taskId} not auto-assigned: ${outcome.reason} (${context}).`);
      return;
    }

    if (assignmentSchemaUnavailable) return;

    await assignTask(admin, {
      taskId,
      reviewerId: outcome.reviewerId,
      assignedBy: null,
      source: 'auto',
      // ReviewRoutingReason has no index signature of its own (it is a named interface,
      // not a loose bag); assignTask's matchReason column is jsonb via a generic
      // Record<string, unknown>, so the shape is spread into a fresh object literal
      // rather than cast, keeping this a real runtime copy instead of a type-only lie.
      matchReason: { ...outcome.reason },
    });
    console.info(`[agentic-review-routing] task ${taskId} auto-assigned to reviewer ${outcome.reviewerId} (${context}).`, outcome.reason);
  } catch (error) {
    console.error(`[agentic-review-routing] tryAutoAssignReview failed for task ${taskId} (${context}); leaving the task unassigned rather than failing the run.`, error);
  }
}
