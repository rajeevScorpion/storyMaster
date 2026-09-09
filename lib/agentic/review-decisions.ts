import 'server-only';

// ── Agentic Creator System: Phase 9 reviewer decisions, server half (Unit 9e-i) ─────
//
// Reads/writes agent_review_decisions (migration 112). Records a reviewer's verdict on a
// run at 'awaiting_review' -- approve, reject, or request a rewrite -- and applies the
// run/agent_tasks state transition decideReviewTransition (review-decisions.shared.ts)
// says that verdict produces. All the logic that decides WHAT each decision does to run/
// task state lives in that pure sibling; this file only fetches the run, applies the
// transition, and persists the decision row.
//
// PUBLISH IS NOT HERE. Unit 9e-ii is a separate commit (D15, docs/agentic-creator-
// decisions.md) and this file exports nothing for it -- no publish function, no storyline
// write. The 'published' value migration 112 permits in its CHECK constraint is read-only
// from this file's point of view: rowToDecision can represent one if it ever appears, but
// recordReviewDecision below can never write one (its `decision` parameter is typed
// ReviewDecisionKind, which excludes it).
//
// FAILS CLOSED for its own migration group (112): while agent_review_decisions is
// unapplied, listReviewDecisionsForRun degrades to [] and recordReviewDecision throws a
// clear "not applied yet" message rather than a raw Postgres error, via its own dedicated
// latch (reviewDecisionSchemaUnavailable / isMissingReviewDecisionSchemaError) -- never
// the 107 latch (isMissingRunSchemaError, orchestrator.ts) or the 111 one
// (isMissingReviewerSchemaError, reviewers.ts), per GOTCHAS.md: latches are one per
// migration group, never reused across groups, even though all three classifiers accept an
// identical set of Postgres/PostgREST codes.
//
// THE RUN/TASK WRITE IS NOT ITS OWN LATCHED GROUP HERE. Fetching the run goes through
// orchestrator.ts's getRun (107's own latch), and the agent_tasks.status write goes
// through orchestrator.ts's exported setTaskStatus (106's own latch, best-effort --
// swallows and logs rather than throwing, exactly like every other agent_tasks write in
// that module). This file does not duplicate either latch; it only adds its OWN latch for
// the one table it alone owns, agent_review_decisions.

import { createAdminClient } from '@/lib/supabase/admin';
import { getRun, appendRunEvent, setTaskStatus, type AdminClient } from '@/lib/agentic/orchestrator';
import {
  decideReviewTransition,
  isMissingReviewDecisionSchemaError,
  type ReviewDecisionKind,
  type StoredReviewDecisionValue,
} from '@/lib/agentic/review-decisions.shared';

const REVIEW_DECISION_SCHEMA_UNAVAILABLE_MESSAGE =
  'Review decision storage is not available yet — migration 112 has not been applied to this environment.';

// One latch for migration 112 alone (GOTCHAS: latches are one per migration group).
// Logged once, then quiet: an unapplied migration is a steady state, not an incident.
let reviewDecisionSchemaUnavailable = false;
function latchReviewDecisionSchemaUnavailable(context: string): void {
  if (!reviewDecisionSchemaUnavailable) {
    reviewDecisionSchemaUnavailable = true;
    console.warn(
      `[agentic-review-decisions] agent_review_decisions unavailable (${context}); migration 112 is not applied on this database. ` +
        'Reads will report empty and writes will throw until it is.'
    );
  }
}

function isReviewDecisionSchemaMissing(error: unknown): boolean {
  return isMissingReviewDecisionSchemaError(error as { code?: string; message?: string } | null | undefined);
}

// ── Row shape ──────────────────────────────────────────────────────────

/** Mirrors public.agent_review_decisions (migration 112), camelCased. */
export interface AgentReviewDecision {
  id: string;
  runId: string;
  storyId: string | null;
  reviewerId: string | null;
  reviewerLabel: string | null;
  decision: StoredReviewDecisionValue;
  storylineId: string | null;
  notes: string | null;
  createdAt: string;
}

interface AgentReviewDecisionRow {
  id: string;
  run_id: string;
  story_id: string | null;
  reviewer_id: string | null;
  reviewer_label: string | null;
  decision: StoredReviewDecisionValue;
  storyline_id: string | null;
  notes: string | null;
  created_at: string;
}

function rowToDecision(row: AgentReviewDecisionRow): AgentReviewDecision {
  return {
    id: row.id,
    runId: row.run_id,
    storyId: row.story_id,
    reviewerId: row.reviewer_id,
    reviewerLabel: row.reviewer_label,
    decision: row.decision,
    storylineId: row.storyline_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────

/**
 * Every decision recorded against one run, most recent first (same order as the
 * idx_agent_review_decisions_run index). Degrades to [] whenever migration 112 is
 * unapplied -- a read must never 500 a review queue that otherwise has real rows to show.
 */
export async function listReviewDecisionsForRun(runId: string): Promise<AgentReviewDecision[]> {
  if (reviewDecisionSchemaUnavailable) return [];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('agent_review_decisions')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false });

    if (error) {
      if (isReviewDecisionSchemaMissing(error)) {
        latchReviewDecisionSchemaUnavailable('listReviewDecisionsForRun');
        return [];
      }
      throw new Error(`Failed to list agent_review_decisions for run ${runId}: ${error.message}`);
    }

    return ((data ?? []) as AgentReviewDecisionRow[]).map(rowToDecision);
  } catch (error) {
    if (isReviewDecisionSchemaMissing(error)) {
      latchReviewDecisionSchemaUnavailable('listReviewDecisionsForRun');
      return [];
    }
    throw error;
  }
}

// ── Writes ─────────────────────────────────────────────────────────────

/**
 * Best-effort timeline note for a decision, mirroring cancelRun's own
 * `appendRunEvent(run.id, 'cancelled', 'warn', 'Run cancelled by an admin.')` call --
 * appendRunEvent already swallows its own failures (orchestrator.ts), so this needs no
 * try/catch of its own. `stage` is the run's stage AFTER the transition was applied
 * (unchanged for 'approved'/'rewrite_requested', 'cancelled' for 'rejected'), so the run
 * monitor's timeline reads the event under the stage it actually happened at.
 */
async function recordDecisionEvent(
  runId: string,
  stage: string,
  decision: ReviewDecisionKind,
  reviewerLabel: string | null
): Promise<void> {
  const who = reviewerLabel ? ` by ${reviewerLabel}` : '';
  const messages: Record<ReviewDecisionKind, string> = {
    approved: `Reviewer decision: approved${who}. The run stays at 'awaiting_review' — publishing is a separate step.`,
    rewrite_requested: `Reviewer decision: rewrite requested${who}. No state changed; the redo is a separate commission.`,
    rejected: `Reviewer decision: rejected${who}. Run cancelled.`,
  };
  const level = decision === 'approved' ? 'info' : 'warn';
  await appendRunEvent(runId, stage, level, messages[decision]);
}

/**
 * Records one reviewer decision and applies the run/agent_tasks transition
 * decideReviewTransition says it produces. This is the ONLY write path in Unit 9e-i --
 * app/actions/agentic-review.ts's mutations all funnel through this function.
 *
 * Order of operations, and why: the run-side transition (agent_runs, 'rejected' only) is
 * applied FIRST, then the best-effort agent_tasks.status write, and the
 * agent_review_decisions row is inserted LAST. This is deliberately the opposite of
 * "record the decision, then act on it" -- if the decision row were written first and the
 * run update then failed, the database would show a 'rejected' decision against a run that
 * never actually left 'awaiting_review', which is a worse lie than the reverse: applying
 * the transition first and then failing to record it at least leaves an accurate
 * agent_runs/agent_tasks state, just an under-documented one, recoverable by re-submitting
 * the same decision (this function is safe to call twice with the same arguments -- there
 * is no unique constraint stopping it, by design, see the migration 112 header).
 *
 * Does NOT itself re-validate that the run is at 'awaiting_review' -- the review queue
 * (Unit 9c, listReviewQueueAction) already filters to that stage, and a decision is
 * meaningful to record even against a run that has since moved (e.g. a duplicate click
 * racing a first one). What this function guarantees is only the STATE TRANSITION table in
 * review-decisions.shared.ts, not queue membership.
 */
export async function recordReviewDecision(params: {
  runId: string;
  decision: ReviewDecisionKind;
  reviewerId: string;
  reviewerLabel: string | null;
  notes?: string | null;
}): Promise<AgentReviewDecision> {
  if (reviewDecisionSchemaUnavailable) throw new Error(REVIEW_DECISION_SCHEMA_UNAVAILABLE_MESSAGE);

  const run = await getRun(params.runId);
  if (!run) {
    throw new Error(`Run ${params.runId} was not found (or migration 107 is not applied on this environment).`);
  }

  const transition = decideReviewTransition(params.decision);
  const admin: AdminClient = createAdminClient();
  let resultingStage: string = run.stage;

  // The only branch that touches agent_runs at all is 'rejected'. Deliberately NOT a call
  // to orchestrator.ts's own cancelRun(): cancelRun sets agent_tasks.status to 'cancelled',
  // and a reviewer's editorial rejection must write 'rejected' instead (see
  // review-decisions.shared.ts's decideReviewTransition doc comment for why those are
  // different words for a different reason). The patch shape below -- stage/status both
  // 'cancelled', plus finished_at -- is copied from cancelRun's own update for exactly that
  // reason: same run-side effect, different task-side effect.
  if (transition.run) {
    const { error: runUpdateError } = await admin
      .from('agent_runs')
      .update({ stage: transition.run.stage, status: transition.run.status, finished_at: new Date().toISOString() })
      .eq('id', run.id);
    if (runUpdateError) {
      throw new Error(`Failed to apply decision '${params.decision}' to agent_run ${run.id}: ${runUpdateError.message}`);
    }
    resultingStage = transition.run.stage;
  }

  if (transition.taskStatus) {
    // Best-effort, matching every other agent_tasks write in orchestrator.ts (setTaskStatus
    // swallows and logs its own failures) -- the agent_review_decisions row inserted below
    // is the durable record of the reviewer's action; a task-status hiccup must not make
    // the decision itself unrecordable.
    await setTaskStatus(admin, run.taskId, transition.taskStatus, 'recordReviewDecision');
  }

  await recordDecisionEvent(run.id, resultingStage, params.decision, params.reviewerLabel);

  const { data, error } = await admin
    .from('agent_review_decisions')
    .insert({
      run_id: run.id,
      story_id: run.storyId,
      reviewer_id: params.reviewerId,
      reviewer_label: params.reviewerLabel,
      decision: params.decision,
      notes: params.notes ?? null,
    })
    .select('*')
    .single();

  if (error) {
    if (isReviewDecisionSchemaMissing(error)) {
      latchReviewDecisionSchemaUnavailable('recordReviewDecision');
      throw new Error(REVIEW_DECISION_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw new Error(`Failed to record review decision for run ${run.id}: ${error.message}`);
  }

  return rowToDecision(data as AgentReviewDecisionRow);
}
