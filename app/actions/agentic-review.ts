'use server';

// ── Agentic Creator System: Phase 9 review queue (Units 9c, 9e-i, 9e-ii) ────────
//
// Reads (listReviewQueueAction, the schema-status probes, listReviewersAction) plus four
// mutations: approveRunAction, requestRunRewriteAction, rejectRunAction (Unit 9e-i), and
// publishRunAction (Unit 9e-ii, D15). Every export reads/writes agent_runs (107),
// agent_tasks (106) and agent_review_decisions (112) through the same plain lib
// functions the run monitor and Unit 9c already use (lib/agentic/orchestrator.ts's
// listRuns/getRun, lib/agentic/evaluation.ts's listEvaluationsForRun,
// lib/agentic/review-decisions.ts's recordReviewDecision/listReviewDecisionsForRun) --
// none of those functions performs its own auth check, so the gate below is entirely
// this file's to get right. publishRunAction additionally calls
// lib/agentic/review-publish.ts's publishReviewedStoryline, which creates the
// `storylines` row itself and likewise performs no auth check of its own.
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
import { canPublish } from '@/lib/agentic/reviewers.shared';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { listRuns, getRun, type AgentRun } from '@/lib/agentic/orchestrator';
import { isMissingRunSchemaError } from '@/lib/agentic/orchestrator.shared';
import { listEvaluationsForRun, type StoredEvaluation } from '@/lib/agentic/evaluation';
import {
  isMissingReviewerSchemaError,
  validateReviewerCoverage,
  type AgentReviewerRole,
  type AgentReviewerStatus,
} from '@/lib/agentic/reviewers.shared';
import {
  recordReviewDecision,
  listReviewDecisionsForRun,
  type AgentReviewDecision,
} from '@/lib/agentic/review-decisions';
import { canRecordDecisionForStage, type ReviewDecisionKind } from '@/lib/agentic/review-decisions.shared';
import { publishReviewedStoryline } from '@/lib/agentic/review-publish';
import type { ReviewReadiness } from '@/lib/agentic/evaluation.shared';
import { getAdminUsersPage } from '@/app/actions/admin-users';

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
  role: AgentReviewerRole;
  ageGroups: string[];
  languages: string[];
  genres: string[];
  displayName: string | null;
  /** Internal note for other admins -- never shown to the reviewer. Carried here (Unit 9g) so the edit drawer can prefill it. */
  notes: string | null;
  createdAt: string;
}

interface AgentReviewerRosterQueryRow {
  user_id: string;
  status: AgentReviewerStatus;
  role: AgentReviewerRole;
  age_groups: string[] | null;
  languages: string[] | null;
  genres: string[] | null;
  display_name: string | null;
  notes: string | null;
  created_at: string;
}

const REVIEWER_ROSTER_SELECT =
  'user_id, status, role, age_groups, languages, genres, display_name, notes, created_at';

/**
 * Single row->camelCase mapping for the roster shape, shared by the read
 * (listReviewersAction) and all three Unit 9g write actions below -- every one
 * of them does a Postgres UPDATE/INSERT ... RETURNING and needs to hand the UI
 * back a fresh ReviewerRosterRow. Keeping one mapper avoids the "two copies
 * that drift" trap GOTCHAS warns about for exactly this kind of row-shaping code.
 */
function rosterRowFromQuery(row: AgentReviewerRosterQueryRow): ReviewerRosterRow {
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
  };
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
 * Every row in agent_reviewers, most recently created first. Migration 111
 * seeds no rows, and it was verified empty on dev before Unit 9g (Phase 9 plan
 * 1.7), so this returning [] on a schema-applied database can still be the
 * honest "nobody has been granted yet" state -- not necessarily a bug -- until
 * an admin uses grantReviewerAction (below) to add the first real row. Reviewer
 * standing before that point is carried entirely by the process.env.ADMIN_USER_ID
 * short-circuit in requireReviewer().
 */
export async function listReviewersAction(): Promise<ReviewerRosterRow[]> {
  await requireReviewer();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_reviewers')
    .select(REVIEWER_ROSTER_SELECT)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingReviewerSchemaError(error)) return [];
    throw new Error(`Failed to list agent_reviewers: ${error.message}`);
  }

  return ((data ?? []) as AgentReviewerRosterQueryRow[]).map(rosterRowFromQuery);
}

// ── Reviewer roster management: grant / edit / suspend (Unit 9g) — ADMIN ONLY ──
//
// Every export below gates on verifyAdmin() (lib/supabase/admin.ts), NOT
// requireReviewer() -- a deliberate departure from this file's own header rule
// (see AUTHORIZATION at the top of this file). Granting or editing reviewer
// STANDING is an admin act, not a reviewer one: even an editor-role reviewer
// (canAssignWork(reviewer) === true) has no business creating other reviewers or
// changing their coverage -- that would let a reviewer promote themselves or a
// friend to editor with no admin in the loop. Only process.env.ADMIN_USER_ID
// (verifyAdmin's single-person env check) may call any of the four functions
// below. This is also why granting stays under /admin/authors/reviewers instead
// of moving to /review with the rest of this file's reviewer-facing surface in
// Unit 9h -- see docs/agentic-creator-phase9b-plan.md section 3.
//
// FAIL CLOSED, same latch as every read above: a write against a column 113
// hasn't created yet surfaces as isMissingReviewerSchemaError (42703), and each
// action below turns that into one clear, actionable message instead of a raw
// Postgres error. No second latch is added -- these columns live on the same
// agent_reviewers table 111 already created, per GOTCHAS's "one latch per
// migration group" rule, so the existing classifier already covers them.

/** What searchGrantableUsersAction hands the picker -- just enough to identify an account and grant it. */
export interface GrantableUserOption {
  userId: string;
  email: string | null;
  displayName: string;
}

/**
 * Backs the "search for a user to grant" box in ReviewerRosterEditor. Delegates
 * entirely to getAdminUsersPage (app/actions/admin-users.ts), which already
 * wraps the admin_list_users RPC (lower(email) OR display name, migration 083)
 * -- re-implementing that query here would be a second copy of a search that
 * already exists and is already admin-gated. Note: getAdminUsersPage's own
 * normalizeAdminUserListInput clamps pageSize to one of [25, 50, 100]
 * (lib/admin/user-management.shared.ts), so the `10` passed here is rounded up
 * to 25 results, not truncated to 10 -- harmless for a search-as-you-type list,
 * but worth knowing if a caller ever expects an exact count.
 *
 * Returns [] for a blank query rather than the newest 25 accounts -- there is
 * no "browse everyone" use case here, only "find the person I mean to grant".
 */
export async function searchGrantableUsersAction(query: string): Promise<GrantableUserOption[]> {
  await verifyAdmin();

  const search = query.trim();
  if (!search) return [];

  const page = await getAdminUsersPage({ search, pageSize: 10 });
  return page.users.map((user) => ({
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
  }));
}

/** Shared input shape for grant/update -- everything validateReviewerCoverage needs, plus the identity/free-text fields it doesn't check. */
interface ReviewerWriteInput {
  role: AgentReviewerRole;
  ageGroups: string[];
  languages: string[];
  genres: string[];
  displayName?: string | null;
  notes?: string | null;
}

/** Throws a validation error whose message is the joined list from validateReviewerCoverage -- shared by grant and update so the two can't drift on how they report a bad taxonomy value. */
function assertValidCoverage(input: ReviewerWriteInput, action: string): void {
  const validation = validateReviewerCoverage(input);
  if (!validation.ok) {
    throw new Error(`Cannot ${action}: ${validation.errors.join(' ')}`);
  }
}

/** True for the Postgres unique_violation code -- what agent_reviewers' primary key (user_id) throws when grantReviewerAction targets someone already in the roster. */
function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export interface GrantReviewerInput extends ReviewerWriteInput {
  userId: string;
}

/**
 * Creates a brand-new agent_reviewers row for `userId`, always starting
 * `status: 'active'` -- reinstating a suspended reviewer is setReviewerStatusAction's
 * job, not this one's. Deliberately a plain INSERT (never upsert): a conflict on
 * the primary key means this user already has a row, and the right fix for that
 * is Edit (updateReviewerAction), not a silent overwrite that would also clobber
 * their original created_by. `created_by` and `updated_by` are both stamped with
 * the granting admin's id -- the same id for both, since this is the row's first
 * write.
 */
export async function grantReviewerAction(input: GrantReviewerInput): Promise<ReviewerRosterRow> {
  const { user } = await verifyAdmin();
  assertValidCoverage(input, 'grant reviewer standing');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_reviewers')
    .insert({
      user_id: input.userId,
      status: 'active',
      role: input.role,
      age_groups: input.ageGroups,
      languages: input.languages,
      genres: input.genres,
      display_name: input.displayName?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(REVIEWER_ROSTER_SELECT)
    .single();

  if (error) {
    if (isMissingReviewerSchemaError(error)) {
      throw new Error(
        'Migration 113 is not applied on this environment yet -- agent_reviewers has no role/coverage columns to write. Apply 113_agent_reviewer_roles.sql before granting reviewer standing.'
      );
    }
    if (isUniqueViolation(error)) {
      throw new Error('This user is already a reviewer. Use Edit to change their role or coverage instead.');
    }
    throw new Error(`Failed to grant reviewer standing: ${error.message}`);
  }

  return rosterRowFromQuery(data as AgentReviewerRosterQueryRow);
}

export interface UpdateReviewerInput extends ReviewerWriteInput {
  userId: string;
}

/**
 * Edits role/coverage/display name/notes on an EXISTING reviewer row. Plain
 * UPDATE ... WHERE user_id = ... (never upsert, mirroring grantReviewerAction's
 * own reasoning in reverse): if no row matches, `.single()` throws PGRST116,
 * which is reported back as "grant them first" rather than silently creating a
 * row through the wrong action. Does not touch `status` -- suspend/reinstate is
 * setReviewerStatusAction's job, kept separate so a reviewer's coverage isn't
 * accidentally rewritten by a status-only click.
 */
export async function updateReviewerAction(input: UpdateReviewerInput): Promise<ReviewerRosterRow> {
  const { user } = await verifyAdmin();
  assertValidCoverage(input, 'update reviewer');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_reviewers')
    .update({
      role: input.role,
      age_groups: input.ageGroups,
      languages: input.languages,
      genres: input.genres,
      display_name: input.displayName?.trim() || null,
      notes: input.notes?.trim() || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .select(REVIEWER_ROSTER_SELECT)
    .single();

  if (error) {
    if (isMissingReviewerSchemaError(error)) {
      throw new Error(
        'Migration 113 is not applied on this environment yet -- agent_reviewers has no role/coverage columns to write. Apply 113_agent_reviewer_roles.sql before editing a reviewer.'
      );
    }
    if (error.code === 'PGRST116') {
      throw new Error('This user has no reviewer row yet. Grant reviewer standing first.');
    }
    throw new Error(`Failed to update reviewer: ${error.message}`);
  }

  return rosterRowFromQuery(data as AgentReviewerRosterQueryRow);
}

/**
 * Suspends or reinstates a reviewer. Touches only `status` (plus the
 * `updated_by`/`updated_at` audit pair) -- role and coverage are left exactly as
 * they were, so reinstating someone returns them to the same routing pool they
 * left rather than resetting them to defaults.
 */
export async function setReviewerStatusAction(
  userId: string,
  status: AgentReviewerStatus
): Promise<ReviewerRosterRow> {
  const { user } = await verifyAdmin();
  if (status !== 'active' && status !== 'suspended') {
    throw new Error(`Unsupported reviewer status '${status}'.`);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_reviewers')
    .update({ status, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select(REVIEWER_ROSTER_SELECT)
    .single();

  if (error) {
    if (isMissingReviewerSchemaError(error)) {
      throw new Error(
        'Migration 113 is not applied on this environment yet -- agent_reviewers has no updated_by column to write. Apply 113_agent_reviewer_roles.sql before changing reviewer status.'
      );
    }
    if (error.code === 'PGRST116') {
      throw new Error('This user has no reviewer row yet. Grant reviewer standing first.');
    }
    throw new Error(`Failed to update reviewer status: ${error.message}`);
  }

  return rosterRowFromQuery(data as AgentReviewerRosterQueryRow);
}

// ── Reviewer decisions (approve / reject / request rewrite / publish) ────
//
// approveRunAction / requestRunRewriteAction / rejectRunAction (Unit 9e-i) share the
// `decide` helper below and gate on nothing beyond requireReviewer() + the workflow flag --
// plain review access is enough to record an opinion. publishRunAction (Unit 9e-ii, D15)
// is deliberately NOT built on `decide`: it additionally requires canPublish(reviewer), and
// it has a real, hard-to-undo side effect (a public storyline) to perform before a decision
// row can even be written, which the other three do not. See publishRunAction's own doc
// comment for why it re-implements the auth/flag/stage checks instead of sharing `decide`.
// 'approved' below leaves the run at 'awaiting_review'; see review-decisions.shared.ts's
// decideReviewTransition for the full state table, including 'published'.

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
 * 'awaiting_review' -- publishing is a separate action (publishRunAction) that a reviewer
 * takes independently, and does not require an 'approved' row to exist first (see
 * decideReviewTransition's doc comment: pressing Publish is itself the approval). An
 * approved run stays in this queue (still at stage 'awaiting_review') until something
 * publishes it; listReviewQueueAction's latestDecision field is what lets the UI show it as
 * already decided rather than implying nobody has looked at it.
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

/**
 * Publishes an approved (or not -- see below) agent draft as a real storyline, owned by
 * the agentic system user and authored under the persona's display_name (D15,
 * docs/agentic-creator-decisions.md). Does NOT use the shared `decide` helper above, for
 * three reasons stacked in order:
 *
 * 1. Authorization is narrower than plain review access: canPublish(reviewer) must hold,
 *    not just requireReviewer() succeeding. A reviewer who can review but not publish gets
 *    a clear refusal here rather than a silent no-op.
 * 2. There is a real side effect -- lib/agentic/review-publish.ts's publishReviewedStoryline
 *    creates a `storylines` row -- that must happen BEFORE recordReviewDecision can be
 *    called with a storyline_id to record. `decide` has no such step; every one of its three
 *    decisions is nothing but the recordReviewDecision call itself.
 * 3. Because of #2, this function pre-checks the run's stage itself (via getRun +
 *    canRecordDecisionForStage) BEFORE calling publishReviewedStoryline, in addition to the
 *    check recordReviewDecision performs internally right before its own writes. Skipping
 *    the pre-check and relying solely on recordReviewDecision's internal one -- fine for
 *    approve/reject/rewrite, which have no side effect of their own to guard -- would let a
 *    run that already left 'awaiting_review' (rejected by another reviewer moments ago, say)
 *    still get published: the storyline write would already be committed by the time
 *    recordReviewDecision's own check ran and threw. This does not close the race
 *    completely -- a run rejected in the window BETWEEN this pre-check and the storyline
 *    write would still end up published, with recordReviewDecision then throwing on its own
 *    re-check rather than silently mis-recording it. Closing that fully needs an atomic
 *    claim/lock step this unit does not add; documented here rather than hidden.
 *
 * Publish does NOT require a prior 'approved' decision row -- pressing Publish is itself
 * the approval (decideReviewTransition's doc comment, review-decisions.shared.ts). This
 * function does not check listReviewDecisionsForRun at all.
 */
export async function publishRunAction(runId: string, notes?: string): Promise<AgentReviewDecision> {
  const { userId, reviewer } = await requireReviewer();
  if (!canPublish(reviewer)) {
    throw new Error('Forbidden: this reviewer is not authorized to publish drafts.');
  }
  await requireReviewerWorkflowEnabled();

  const run = await getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} was not found (or migration 107 is not applied on this environment).`);
  }
  if (!canRecordDecisionForStage(run.stage)) {
    throw new Error(
      `Run ${run.id} is no longer awaiting review (stage '${run.stage}'), so it cannot be published. Refresh the review queue to see its current state.`
    );
  }
  if (!run.storyId) {
    throw new Error(`Run ${run.id} has no story attached; there is nothing to publish.`);
  }

  const { storylineId } = await publishReviewedStoryline(run.storyId);

  return recordReviewDecision({
    runId,
    decision: 'published',
    reviewerId: userId,
    reviewerLabel: reviewer.displayName,
    notes: notes ?? null,
    storylineId,
  });
}
