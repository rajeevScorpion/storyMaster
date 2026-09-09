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
 * The four decisions the review queue can record. Through Unit 9e-i this was three values
 * ('approved' | 'rejected' | 'rewrite_requested'); Unit 9e-ii (D15,
 * docs/agentic-creator-decisions.md) widens it to include 'published' -- migration 112's
 * CHECK constraint has permitted the value since it shipped (see the migration's header),
 * so this widening needs no migration of its own. The three pre-existing decisions' behavior
 * is unchanged: decideReviewTransition's three original branches are untouched below, and
 * canRecordDecisionForStage still gates all four identically.
 */
export type ReviewDecisionKind = 'approved' | 'rejected' | 'rewrite_requested' | 'published';

/**
 * Every value migration 112's CHECK constraint allows. Before Unit 9e-ii this was strictly
 * wider than ReviewDecisionKind (it also covered 'published', which nothing could yet
 * write); now that ReviewDecisionKind includes 'published' too, the two types are
 * identical. Kept as a separate name rather than deleted -- both agentic-review.ts and
 * ReviewQueue.tsx already reference stored rows by this name, and the distinction it drew
 * ("a value a stored row can carry" vs. "a value this action can produce") is worth keeping
 * nameable even though nothing separates the two sets today.
 */
export type StoredReviewDecisionValue = ReviewDecisionKind;

/**
 * What a decision does to the run row. `null` means "leave agent_runs entirely untouched".
 * 'published' -> { stage: 'complete', status: 'succeeded' } per the Phase 9 plan's Unit 9e
 * table: publishing is the run's real terminal success state, distinct from 'rejected''s
 * { stage: 'cancelled', status: 'cancelled' } for the same reason 'rejected'/'cancelled'
 * task statuses are kept distinct below -- "a reviewer looked at this and it succeeded" is
 * not the same fact as "an operator abandoned it" or "a reviewer turned it down".
 */
export type ReviewRunTransition =
  | { stage: 'cancelled'; status: 'cancelled' }
  | { stage: 'complete'; status: 'succeeded' }
  | null;

/**
 * The agent_tasks.status write a decision produces. `null` means "leave agent_tasks
 * entirely untouched" -- distinct from writing a status, and load-bearing for
 * 'rewrite_requested' below, which must change no state at all.
 */
export type ReviewTaskStatusTransition = 'approved' | 'rejected' | 'published' | null;

export interface ReviewDecisionTransition {
  run: ReviewRunTransition;
  taskStatus: ReviewTaskStatusTransition;
}

/**
 * The single function mapping a reviewer decision to its run/task state transition. This
 * was the WHOLE state machine Unit 9e-i implemented, and Unit 9e-ii (D15) adds exactly one
 * more branch to it -- see docs/agentic-creator-phase9-plan.md's Unit 9e table, reproduced
 * in the migration 112 header. Every branch is deliberate and none is a placeholder:
 *
 * - 'approved' does NOT advance the run's stage. It stays at 'awaiting_review' because
 *   publishing (9e-ii) is what actually completes it -- an approval alone has produced no
 *   storyline yet, so moving the run past 'awaiting_review' here would be premature and
 *   would also require landing on some stage with a real consumer, which 'media_pending'
 *   (verified to have none, see the migration header) is not.
 * - 'rewrite_requested' changes NO state at all -- not the run, not the task. It is a
 *   recorded opinion that the draft needs redoing. It must NOT be wired to retryRun:
 *   retryRun resumes the same run from its own checkpoint and cannot re-brief (a documented
 *   deferral, see PROJECT_STATE.md), so replaying it would silently regenerate the same
 *   draft rather than producing a genuinely different one. The redo is a separate
 *   commission a supervisor or admin issues later, entirely outside this function's
 *   concern.
 * - 'rejected' is a terminal outcome: the run is cancelled (mirroring what cancelRun's own
 *   patch shape does to agent_runs -- stage/status both 'cancelled', plus finished_at, set
 *   by the caller), and the task is marked 'rejected' rather than 'cancelled'. Those are
 *   deliberately different words for a deliberately different reason: 'cancelled' (via
 *   cancelAgentTask / cancelRun) means an operator abandoned the run outright: 'rejected'
 *   means a reviewer looked at a finished draft and turned it down on its merits. Collapsing
 *   the two would make agent_tasks.status unable to tell "nobody reviewed this" apart from
 *   "a reviewer said no".
 * - 'published' (9e-ii) is the OTHER terminal outcome, and the only one meaning success: the
 *   run's stage/status become 'complete'/'succeeded', and the task is marked 'published' --
 *   a fifth agent_tasks.status word, distinct from 'approved' for the same reason 'rejected'
 *   is distinct from 'cancelled': "a reviewer approved this" and "this is now a public
 *   storyline" are different facts, and collapsing them would make agent_tasks.status unable
 *   to tell "approved but not yet published" apart from "published". Publishing does NOT
 *   require a prior 'approved' decision row to exist -- pressing Publish is itself the
 *   approval. There is no code anywhere that checks for a prior 'approved' row before
 *   allowing 'published', and none should be added: requiring one would be a silent gate
 *   this state machine was never designed to have, since 'approved' already leaves the run
 *   exactly where 'published' finds it (still 'awaiting_review'), with nothing in between
 *   that a missing approval could have protected.
 */
export function decideReviewTransition(decision: ReviewDecisionKind): ReviewDecisionTransition {
  switch (decision) {
    case 'approved':
      return { run: null, taskStatus: 'approved' };
    case 'published':
      return { run: { stage: 'complete', status: 'succeeded' }, taskStatus: 'published' };
    case 'rewrite_requested':
      return { run: null, taskStatus: null };
    case 'rejected':
      return { run: { stage: 'cancelled', status: 'cancelled' }, taskStatus: 'rejected' };
  }
}

/**
 * The stage a run must still be sitting at for a reviewer decision to be recordable
 * against it. A decision is an opinion about a draft that is WAITING for one; once a run
 * has left 'awaiting_review' there is nothing left to decide.
 *
 * This does NOT conflict with decisions being re-recordable. Both re-recordable decisions
 * -- 'rewrite_requested' and 'approved' -- leave the run exactly where it was (see
 * decideReviewTransition: their `run` transition is null), so a run can be
 * rewrite-requested and later approved with this guard in place, which is the sequence the
 * unit is required to support. 'rejected' and 'published' (9e-ii) are the two decisions
 * that move the stage away from 'awaiting_review', and after either there is genuinely
 * nothing further to decide -- this guard is what stops a run from being published twice
 * under a race exactly like the two-reviewer one described below, not just from being
 * rejected twice.
 *
 * The defect this closes is a real two-reviewer race, not a hypothetical: A and B both
 * have the queue open, A rejects the run (run stage/status -> 'cancelled',
 * agent_tasks.status -> 'rejected'), B's page is now stale but still lists the row, and B
 * clicks Approve. Without this guard that write lands, and agent_tasks.status reads
 * 'approved' for a draft that was rejected and whose run is dead. The queue's optimistic
 * client-side removal of a rejected row does not prevent it -- a server action is directly
 * invocable, and B's page never learned about A's write.
 */
export function canRecordDecisionForStage(stage: string): boolean {
  return stage === 'awaiting_review';
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
