// ── Agentic Creator System: Phase 9b reviewer assignment, pure half (Unit 9i) ────
//
// No `server-only`, no `'use client'`, no Supabase, no network -- mirrors
// reviewers.ts/.shared.ts and review-decisions.ts/.shared.ts's split exactly. This
// file holds only the row shape and migration-114 schema classifier;
// `lib/agentic/review-routing.ts` (which IS `server-only`) is where
// `agent_review_assignments` is actually read and written.
//
// THIS IS MIGRATION 114's OWN LATCH. Per GOTCHAS.md ("Column-availability latches
// are per migration group"), isMissingAssignmentSchemaError below must never be
// conflated with isMissingReviewerSchemaError (111, reviewers.shared.ts),
// isMissingReviewDecisionSchemaError (112, review-decisions.shared.ts), or
// isMissingRunSchemaError (107, orchestrator.shared.ts) -- even though all four
// accept an identical set of Postgres/PostgREST codes. What tells them apart is
// only ever which table the failing query touched: this classifier is called
// exclusively from queries against agent_review_assignments in review-routing.ts.

/** Every value migration 114's `source` CHECK constraint allows. */
export type AssignmentSource = 'manual' | 'auto';

/** Every value migration 114's `status` CHECK constraint allows. */
export type AssignmentStatus = 'active' | 'released' | 'superseded';

/**
 * Mirrors public.agent_review_assignments (migration 114), camelCased.
 *
 * `reviewerId: null` is a REAL, reachable state on an otherwise-`active` row (the
 * FK is `ON DELETE SET NULL`, exactly like `agent_reviewers`/`agent_review_decisions`
 * before it) -- not a sign of a malformed row. A caller must read
 * `status === 'active' && reviewerId == null` as "unassigned", never as "assigned
 * to nobody in particular". See listAssignmentsForTasks (review-routing.ts).
 */
export interface ReviewAssignment {
  id: string;
  taskId: string;
  reviewerId: string | null;
  assignedBy: string | null;
  source: AssignmentSource;
  status: AssignmentStatus;
  matchReason: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * True when a Postgres/PostgREST error means "migration 114 hasn't run on this
 * database yet", as opposed to any other failure that should surface as a real
 * error. Codes only, deliberately -- see isMissingReviewerSchemaError
 * (reviewers.shared.ts) for the defect this guards against: a bare message match
 * on the table name would also catch an unrelated error that happens to mention
 * it, and misreport it as an unapplied migration.
 *
 * This is migration 114's OWN classifier -- never reused from 107/111/112, per
 * this file's header.
 */
export function isMissingAssignmentSchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_review_assignments absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
