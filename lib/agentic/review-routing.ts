import 'server-only';

// ── Agentic Creator System: Phase 9b reviewer assignment, server half (Unit 9i) ──
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
// Unit 9j (out of scope here) will add tryAutoAssignReview() to this same file and
// wire it into orchestrator.ts's persistStageAdvance -- see the Phase 9b plan section
// 6.3 for the import-direction hazard that decision creates. Nothing in THIS unit
// imports from orchestrator.ts except the already-exported `AdminClient` type, which
// TypeScript erases, so no cycle exists yet.

import type { AdminClient } from '@/lib/agentic/orchestrator';
import {
  isMissingAssignmentSchemaError,
  type AssignmentSource,
  type AssignmentStatus,
  type ReviewAssignment,
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
