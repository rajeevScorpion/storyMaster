'use server';

// ── Agentic Creator System: Phase 9 review queue (Units 9c + 9e-i) ────────
//
// Reads (listReviewQueueAction, the schema-status probes, listReviewersAction) plus
// three mutations added in Unit 9e-i: approveRunAction, requestRunRewriteAction,
// rejectRunAction. PUBLISH IS STILL NOT HERE -- Unit 9e-ii is a separate commit (D15)
// and this file exports nothing for it. Every export reads/writes agent_runs (107),
// agent_tasks (106) and agent_review_decisions (112) through the same plain lib
// functions the run monitor and Unit 9c already use (lib/agentic/orchestrator.ts's
// listRuns, lib/agentic/evaluation.ts's listEvaluationsForRun,
// lib/agentic/review-decisions.ts's recordReviewDecision/listReviewDecisionsForRun)
// -- none of those functions performs its own auth check, so the gate below is
// entirely this file's to get right.
//
// AUTHORIZATION. Every export gates on requireReviewer() (lib/agentic/reviewers.ts),
// NOT verifyAdmin(). That is deliberate per D14 (docs/agentic-creator-decisions.md)
// and, TODAY, changes nothing observable: the parent app/admin/layout.tsx already runs
// verifyAdmin() and redirects before app/admin/authors/page.tsx ever renders, and
// requireReviewer() treats process.env.ADMIN_USER_ID as an implicit reviewer -- so an
// admin passes both gates, and a non-admin active reviewer STILL cannot reach
// /admin/authors at all, because the layout's verifyAdmin() bars them first, before
// this file's requireReviewer() check is ever reached. Gating on requireReviewer()
// here does not widen who can use this page today. What it buys is that this
// surface's authorization was always "you are a reviewer", not "you are staff" -- so
// if it later moves out from under /admin, only the layout shell needs to change, not
// these actions. See docs/agentic-creator-phase9-plan.md Unit 9c.
//
// FLAG GATING (D8) -- reads vs. writes are gated DIFFERENTLY, and that split is
// deliberate, not an oversight:
//   - Reads stay unconditional on agentic_reviewer_workflow_enabled, mirroring
//     listRunsAction/getRunAction in agentic-runs.ts, which read regardless of
//     agentic_creator_enabled. app/admin/authors/page.tsx checks
//     getAgenticFlags().reviewerWorkflowEnabled BEFORE calling anything in this file
//     and renders an honest "switched off" state instead of fetching, so the
//     fail-closed guarantee holds without a read needing to know about a flag whose
//     job is a page-level rendering decision.
//   - Every MUTATION additionally calls requireReviewerWorkflowEnabled() below,
//     inside the action itself, in addition to the page-level check. A server action
//     is directly invocable over its own RPC endpoint regardless of what any page
//     rendered, so a write whose only gate was "the page that normally calls this
//     already checked the flag" is not actually gated at all -- the page-level check
//     is real UX (an honest disabled state) but is not, and must not be treated as, a
//     write's security boundary.

import { requireReviewer } from '@/lib/agentic/reviewers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { listRuns, type AgentRun } from '@/lib/agentic/orchestrator';
import { isMissingRunSchemaError } from '@/lib/agentic/orchestrator.shared';
import { listEvaluationsForRun, type StoredEvaluation } from '@/lib/agentic/evaluation';
import { isMissingReviewerSchemaError, type AgentReviewerStatus } from '@/lib/agentic/reviewers.shared';
import {
  recordReviewDecision,
  listReviewDecisionsForRun,
  type AgentReviewDecision,
} from '@/lib/agentic/review-decisions';
import type { ReviewDecisionKind } from '@/lib/agentic/review-decisions.shared';
import type { ReviewReadiness } from '@/lib/agentic/evaluation.shared';

export type { AgentRun, StoredEvaluation, AgentReviewDecision };
export type { ReviewDecisionKind };
export type { StoredReviewDecisionValue } from '@/lib/agentic/review-decisions.shared';

/**
 * One story column this queue needs -- title plus the two audience fields shown
 * beside it. Deliberately narrow: assertCanEditStory's EditableStoryRow (Units
 * 9a/9b, lib/agentic/reviewers.ts) is the shape for an EDIT gate; this is a
 * read-only display projection and has no business fetching story_map or
 * anything else that row selects wide.
 */
export interface ReviewQueueStory {
  id: string;
  title: string | null;
  targetAge: string | null;
  genre: string | null;
}

/**
 * A row's review readiness, extended with 'unscored' for the one state
 * deriveReviewReadiness (lib/agentic/evaluation.shared.ts:368) has no opinion
 * about: no agent_evaluations row exists for this run at all. Verified on dev
 * (docs/agentic-creator-phase9-plan.md 1.7): 5 runs sit at awaiting_review and
 * only 3 agent_evaluations rows exist, so this is not a hypothetical -- 2 of 5
 * queue rows on dev hit this branch today. It must never be silently folded into
 * 'ready_for_review': an unscored draft is not a graded-and-passed one.
 */
export type ReviewQueueReadiness = ReviewReadiness | 'unscored';

export interface ReviewQueueRow {
  run: AgentRun;
  story: ReviewQueueStory | null;
  latestEvaluation: StoredEvaluation | null;
  readiness: ReviewQueueReadiness;
  /**
   * Most recent row from agent_review_decisions for this run (Unit 9e-i), or `null` when
   * nobody has decided on it yet. 'approved' and 'rewrite_requested' both leave the run at
   * 'awaiting_review' (see review-decisions.shared.ts's decideReviewTransition), so an
   * already-decided run keeps appearing in this queue -- this field is what lets the UI
   * show "Approved" or "Rewrite requested" on a row instead of implying nobody has looked
   * at it. A 'rejected' row, by contrast, moves its run to stage 'cancelled' and so drops
   * out of this queue on the next reload (listRuns is filtered to 'awaiting_review'
   * below) -- there is no reject badge to show here because a rejected row is never
   * fetched into this list again.
   */
  latestDecision: AgentReviewDecision | null;
}

export interface ReviewQueueListFilters {
  readiness?: ReviewQueueReadiness | 'all';
}

/**
 * readiness is read straight off the stored evaluation, never recomputed --
 * deriveReviewReadiness already ran once, at evaluation time, and its own
 * header says it is "the ONLY place that mapping may live." 'unscored' is this
 * file's own addition for "no evaluation exists", a case deriveReviewReadiness
 * was never asked to classify (it takes a verdict, and there is none here).
 */
function readinessOf(latestEvaluation: StoredEvaluation | null): ReviewQueueReadiness {
  return latestEvaluation?.reviewReadiness ?? 'unscored';
}

/**
 * Distinguishes "migration 107 not applied" from "applied, nothing waiting" --
 * both read as an empty list from listReviewQueueAction alone. Mirrors
 * getRunSchemaStatusAction (agentic-runs.ts) exactly, gated on requireReviewer()
 * instead of verifyAdmin() per this file's header. Deliberately keeps no latch
 * of its own: like getRunSchemaStatusAction, this is a cheap one-shot probe, and
 * orchestrator.ts's own internal latch (set only by orchestrator.ts's own
 * queries) is what actually protects listRuns() below from repeat failures.
 */
export async function getReviewQueueSchemaStatusAction(): Promise<{ schemaApplied: boolean }> {
  await requireReviewer();

  const admin = createAdminClient();
  const { error } = await admin.from('agent_runs').select('id').limit(1);

  if (error) {
    if (isMissingRunSchemaError(error)) return { schemaApplied: false };
    throw new Error(`Failed to check run schema status: ${error.message}`);
  }
  return { schemaApplied: true };
}

/**
 * The queue itself: every run at stage 'awaiting_review', joined to its story
 * (title + audience fields) and its latest evaluation (StoredEvaluation, most
 * recent first per listEvaluationsForRun -- so [0] is "latest"). Optionally
 * filtered by readiness. Ordered oldest-run-id-first is NOT applied here --
 * this keeps listRuns' own order (created_at desc, newest first), the same
 * order the run monitor shows, rather than inventing a second convention with
 * no instruction to back it.
 *
 * N+1 by construction: one listEvaluationsForRun call per run, and (Unit 9e-i) one
 * listReviewDecisionsForRun call per run alongside it. Deliberately not batched into a
 * single query with a "distinct on run_id, newest first" projection, because that
 * projection's row-picking logic (rowToStoredEvaluation / rowToDecision) is private to
 * evaluation.ts / review-decisions.ts -- duplicating it here would be exactly the "two
 * copies that drift" trap D2 rejected for a different pair of functions. Dev has 5 runs at
 * awaiting_review (verified, Phase 9 plan 1.7); this scales to dozens fine and would only
 * need revisiting at a queue size this surface is not expected to reach.
 */
export async function listReviewQueueAction(filters: ReviewQueueListFilters = {}): Promise<ReviewQueueRow[]> {
  await requireReviewer();

  const runs = await listRuns({ stage: 'awaiting_review' });
  if (runs.length === 0) return [];

  const admin = createAdminClient();
  const storyIds = [...new Set(runs.map((run) => run.storyId).filter((id): id is string => Boolean(id)))];

  const storyById = new Map<string, ReviewQueueStory>();
  if (storyIds.length > 0) {
    const { data: storyRows, error: storyError } = await admin
      .from('stories')
      .select('id, title, target_age, genre')
      .in('id', storyIds);
    if (storyError) throw new Error(`Failed to load stories for the review queue: ${storyError.message}`);
    for (const row of (storyRows ?? []) as { id: string; title: string | null; target_age: string | null; genre: string | null }[]) {
      storyById.set(row.id, { id: row.id, title: row.title, targetAge: row.target_age, genre: row.genre });
    }
  }

  const evaluationsByRun = await Promise.all(runs.map((run) => listEvaluationsForRun(run.id)));
  const decisionsByRun = await Promise.all(runs.map((run) => listReviewDecisionsForRun(run.id)));

  const rows: ReviewQueueRow[] = runs.map((run, index) => {
    const latestEvaluation = evaluationsByRun[index][0] ?? null;
    return {
      run,
      story: run.storyId ? storyById.get(run.storyId) ?? null : null,
      latestEvaluation,
      readiness: readinessOf(latestEvaluation),
      latestDecision: decisionsByRun[index][0] ?? null,
    };
  });

  if (!filters.readiness || filters.readiness === 'all') return rows;
  return rows.filter((row) => row.readiness === filters.readiness);
}

// ── Reviewer roster (read-only) ───────────────────────────────────────────

export interface ReviewerRosterRow {
  userId: string;
  status: AgentReviewerStatus;
  canPublish: boolean;
  canTriggerMedia: boolean;
  displayName: string | null;
  createdAt: string;
}

interface AgentReviewerRosterQueryRow {
  user_id: string;
  status: AgentReviewerStatus;
  can_publish: boolean;
  can_trigger_media: boolean;
  display_name: string | null;
  created_at: string;
}

/**
 * Same status-probe shape as getReviewQueueSchemaStatusAction, for migration 111
 * (agent_reviewers) instead of 107. A separate probe against a different table,
 * classified with reviewers.shared.ts's own isMissingReviewerSchemaError --
 * never isMissingRunSchemaError above, per GOTCHAS's "classify by the query,
 * not by the error" rule: the two classifiers accept an identical set of
 * Postgres/PostgREST codes and are told apart only by which table the failing
 * query actually touched.
 */
export async function getReviewerRosterSchemaStatusAction(): Promise<{ schemaApplied: boolean }> {
  await requireReviewer();

  const admin = createAdminClient();
  const { error } = await admin.from('agent_reviewers').select('user_id').limit(1);

  if (error) {
    if (isMissingReviewerSchemaError(error)) return { schemaApplied: false };
    throw new Error(`Failed to check reviewer schema status: ${error.message}`);
  }
  return { schemaApplied: true };
}

/**
 * Every row in agent_reviewers, most recently created first. Read-only -- there
 * is no create/suspend/edit action here yet. Migration 111 seeds no rows, and
 * it is verified empty on dev (Phase 9 plan 1.7), so this returning [] on a
 * schema-applied database is the honest common case today, not a bug: reviewer
 * standing so far is carried entirely by the process.env.ADMIN_USER_ID
 * short-circuit in requireReviewer(), which never writes a row here.
 */
export async function listReviewersAction(): Promise<ReviewerRosterRow[]> {
  await requireReviewer();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_reviewers')
    .select('user_id, status, can_publish, can_trigger_media, display_name, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingReviewerSchemaError(error)) return [];
    throw new Error(`Failed to list agent_reviewers: ${error.message}`);
  }

  return ((data ?? []) as AgentReviewerRosterQueryRow[]).map((row) => ({
    userId: row.user_id,
    status: row.status,
    canPublish: row.can_publish,
    canTriggerMedia: row.can_trigger_media,
    displayName: row.display_name,
    createdAt: row.created_at,
  }));
}

// ── Reviewer decisions (Unit 9e-i: approve / reject / request rewrite) ────
//
// PUBLISH IS NOT HERE. There is deliberately no approveAndPublishRunAction or similar --
// Unit 9e-ii is a separate commit (D15) and nothing below produces a 'published' row or
// touches storylines. 'approved' below leaves the run at 'awaiting_review'; see
// review-decisions.shared.ts's decideReviewTransition for the full state table.

/**
 * Throws with a clear, actionable message when agentic_reviewer_workflow_enabled is off.
 * Every mutation below calls this IN ADDITION TO the page-level flag check
 * app/admin/authors/page.tsx already does -- see this file's header (FLAG GATING) for why
 * a write cannot rely on a rendering decision as its own gate. Mirrors
 * requireCreatorEnabled() in agentic-runs.ts exactly, one flag over.
 */
async function requireReviewerWorkflowEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.reviewerWorkflowEnabled) {
    throw new Error(
      'The reviewer workflow is currently disabled. Turn on "Reviewer workflow" on the Agents Overview page before recording a decision.'
    );
  }
}

/**
 * Shared body for the three decision actions below: authenticate as a reviewer, check the
 * flag, then delegate to recordReviewDecision (lib/agentic/review-decisions.ts), which owns
 * the actual state transition and the migration-112 fail-closed latch. `reviewer.displayName`
 * -- not any live-editable profile field -- is what recordReviewDecision snapshots into
 * agent_review_decisions.reviewer_label, exactly as the migration 112 header specifies:
 * captured AT DECISION TIME so it survives a later rename or account deletion.
 */
async function decide(runId: string, decision: ReviewDecisionKind, notes?: string): Promise<AgentReviewDecision> {
  const { userId, reviewer } = await requireReviewer();
  await requireReviewerWorkflowEnabled();

  return recordReviewDecision({
    runId,
    decision,
    reviewerId: userId,
    reviewerLabel: reviewer.displayName,
    notes: notes ?? null,
  });
}

/**
 * Approves the draft. Does NOT publish it and does NOT advance the run past
 * 'awaiting_review' -- publishing is Unit 9e-ii, which does not exist yet. An approved run
 * stays in this queue (still at stage 'awaiting_review') until something publishes it;
 * listReviewQueueAction's latestDecision field is what lets the UI show it as already
 * decided rather than implying nobody has looked at it.
 */
export async function approveRunAction(runId: string, notes?: string): Promise<AgentReviewDecision> {
  return decide(runId, 'approved', notes);
}

/**
 * Records that the draft needs a rewrite. Changes NO run or task state -- see
 * decideReviewTransition's doc comment (review-decisions.shared.ts) for why this is
 * deliberately not wired to retryRun (retryRun resumes the same checkpoint and cannot
 * re-brief, so replaying it would silently regenerate the same draft). The redo is a
 * separate commission, issued outside this action entirely.
 */
export async function requestRunRewriteAction(runId: string, notes?: string): Promise<AgentReviewDecision> {
  return decide(runId, 'rewrite_requested', notes);
}

/**
 * Rejects the draft outright: the run's stage/status both become 'cancelled' (with
 * finished_at set) and its task's status becomes 'rejected' -- NOT 'cancelled', which is
 * reserved for an operator abandoning a run via cancelRunAction/cancelAgentTask. Terminal:
 * once rejected, the run drops out of this queue (listReviewQueueAction filters to
 * 'awaiting_review') on the next reload.
 */
export async function rejectRunAction(runId: string, notes?: string): Promise<AgentReviewDecision> {
  return decide(runId, 'rejected', notes);
}
