// ── Agentic Creator System: Phase 9 reviewer decisions, pure half ───────
//
// No `server-only`, no `'use client'`, no Supabase, no network -- everything here is
// deterministic and operates on plain data a caller already has.
// `lib/agentic/review-decisions.ts` (which IS `server-only`) is where a decision row is
// actually written (migration 112, `public.agent_review_decisions`) and where the run/task
// state transition below is actually applied.
//
// Model: this file mirrors reviewers.ts / reviewers.shared.ts's split exactly -- the
// migration-112 schema classifier lives here (own latch, per GOTCHAS.md: one latch per
// migration group, never reused -- see isMissingReviewDecisionSchemaError below, which is
// this migration's own and is never the 107 latch (isMissingRunSchemaError) or the 106 one
// (isMissingTaskSchemaError), even though all three accept an identical set of Postgres/
// PostgREST codes and are told apart only by which table the failing query touched).

/**
 * The three decisions Unit 9e-i's queue can record. 'published' is a fourth value migration
 * 112's CHECK constraint permits (so Unit 9e-ii needs no migration of its own), but it is
 * NOT part of this unit's decision surface -- decideReviewTransition below never accepts or
 * produces it. See the migration's header for why the column allows it early.
 */
export type ReviewDecisionKind = 'approved' | 'rejected' | 'rewrite_requested';

/**
 * Every value migration 112's CHECK constraint allows, including 'published'. Only useful
 * for typing a raw stored row read back from the table -- a caller reading history must be
 * able to represent a 'published' row if 9e-ii ever writes one, even though nothing in this
 * unit ever produces that value itself.
 */
export type StoredReviewDecisionValue = ReviewDecisionKind | 'published';

/** What a decision does to the run row. `null` means "leave agent_runs entirely untouched". */
export type ReviewRunTransition = { stage: 'cancelled'; status: 'cancelled' } | null;

/**
 * The agent_tasks.status write a decision produces. `null` means "leave agent_tasks
 * entirely untouched" -- distinct from writing a status, and load-bearing for
 * 'rewrite_requested' below, which must change no state at all.
 */
export type ReviewTaskStatusTransition = 'approved' | 'rejected' | null;

export interface ReviewDecisionTransition {
  run: ReviewRunTransition;
  taskStatus: ReviewTaskStatusTransition;
}

/**
 * The single function mapping a reviewer decision to its run/task state transition. This
 * is the WHOLE state machine Unit 9e-i implements -- see
 * docs/agentic-creator-phase9-plan.md's Unit 9e table, reproduced in the migration 112
 * header. Every branch is deliberate and none is a placeholder:
 *
 * - 'approved' does NOT advance the run's stage. It stays at 'awaiting_review' because
 *   publishing (Unit 9e-ii) is what actually completes it -- an approval alone has produced
 *   no storyline yet, so moving the run past 'awaiting_review' here would be premature and
 *   would also require landing on some stage with a real consumer, which 'media_pending'
 *   (verified to have none, see the migration header) is not.
 * - 'rewrite_requested' changes NO state at all -- not the run, not the task. It is a
 *   recorded opinion that the draft needs redoing. It must NOT be wired to retryRun:
 *   retryRun resumes the same run from its own checkpoint and cannot re-brief (a documented
 *   deferral, see PROJECT_STATE.md), so replaying it would silently regenerate the same
 *   draft rather than producing a genuinely different one. The redo is a separate
 *   commission a supervisor or admin issues later, entirely outside this function's
 *   concern.
 * - 'rejected' is the only terminal outcome: the run is cancelled (mirroring what
 *   cancelRun's own patch shape does to agent_runs -- stage/status both 'cancelled', plus
 *   finished_at, set by the caller), and the task is marked 'rejected' rather than
 *   'cancelled'. Those are deliberately different words for a deliberately different
 *   reason: 'cancelled' (via cancelAgentTask / cancelRun) means an operator abandoned the
 *   run outright: 'rejected' means a reviewer looked at a finished draft and turned it down
 *   on its merits. Collapsing the two would make agent_tasks.status unable to tell "nobody
 *   reviewed this" apart from "a reviewer said no".
 */
export function decideReviewTransition(decision: ReviewDecisionKind): ReviewDecisionTransition {
  switch (decision) {
    case 'approved':
      return { run: null, taskStatus: 'approved' };
    case 'rewrite_requested':
      return { run: null, taskStatus: null };
    case 'rejected':
      return { run: { stage: 'cancelled', status: 'cancelled' }, taskStatus: 'rejected' };
  }
}

/**
 * True when a Postgres/PostgREST error means "migration 112 hasn't run on this database
 * yet", as opposed to any other failure that should surface as a real error. Codes only,
 * deliberately -- see isMissingReviewerSchemaError (reviewers.shared.ts) for the defect
 * this guards against: a bare message match on the table name would also catch an unrelated
 * error that happens to mention it, and misreport it as an unapplied migration.
 *
 * This is its OWN classifier and its OWN latch (in review-decisions.ts) for migration 112
 * alone -- never isMissingRunSchemaError (107) or isMissingReviewerSchemaError (111), even
 * though all three accept an identical code set. Per GOTCHAS.md: "classify by the query,
 * not by the error" -- the four codes below are indistinguishable on their own; what tells
 * them apart is that only queries against agent_review_decisions are ever passed through
 * this function.
 */
export function isMissingReviewDecisionSchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_review_decisions absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
