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
import { canAssignWork, canPublish } from '@/lib/agentic/reviewers.shared';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { invalidatePricingRuntimeCacheForUser } from '@/lib/pricing/runtime-context-cache';
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
import {
  assignTask,
  listAssignmentsForTasks,
  releaseAssignment,
} from '@/lib/agentic/review-routing';
import type { ReviewAssignment } from '@/lib/agentic/review-routing.shared';

export type { AgentRun, StoredEvaluation, AgentReviewDecision };
export type { ReviewDecisionKind };
export type { StoredReviewDecisionValue } from '@/lib/agentic/review-decisions.shared';
export type { ReviewAssignment } from '@/lib/agentic/review-routing.shared';

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
  /**
   * The task's current ACTIVE assignment (Unit 9i, migration 114, D18), or `null`
   * when none exists. Joined via `run.taskId`, not `run.id` -- assignment is
   * task-level so it survives a retry producing a new run for the same task (see
   * the migration header). A non-null value may still carry `reviewerId: null`
   * (the FK's ON DELETE SET NULL) -- callers MUST treat that the same as `null`
   * here: "unassigned", never "assigned to nobody in particular".
   */
  assignment: ReviewAssignment | null;
  /**
   * Display name for `assignment.reviewerId`, resolved server-side against
   * agent_reviewers so the queue can show a name without a client-side lookup
   * that only an editor could make (listAssignableReviewersAction is
   * canAssignWork()-gated; a plain reviewer must still be able to SEE who a
   * draft is assigned to). `null` whenever `assignment` is null/unassigned, and
   * also `null` if the reviewer row itself has no display_name set -- callers
   * fall back to a short id in that case.
   */
  assigneeDisplayName: string | null;
}

export interface ReviewQueueListFilters {
  readiness?: ReviewQueueReadiness | 'all';
  /**
   * "Just my assigned drafts" / "the unassigned pool" / everything (Unit 9i,
   * migration 114, D18). 'mine' matches rows whose assignment.reviewerId equals the
   * CALLING reviewer's own id (resolved server-side inside listReviewQueueAction,
   * never trusted from the caller). 'unassigned' matches rows with no active
   * assignment row AND rows whose active assignment has reviewerId === null (the
   * FK's ON DELETE SET NULL state) -- both read as "nobody is on this" per D18.
   * While migration 114 is unapplied, listAssignmentsForTasks degrades to an empty
   * Map, so every row's `assignment` is `null` and 'unassigned' returns everything
   * -- an honest reflection of "nothing is assigned because there is nowhere to
   * record an assignment yet", not a silent narrowing to zero rows.
   */
  assignment?: 'mine' | 'unassigned' | 'all';
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
  const { userId } = await requireReviewer();

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

  // Unit 9i (D18): joined via run.taskId, NOT run.id -- assignment is task-level so
  // it survives a retry producing a new run for the same task (migration 114
  // header). listAssignmentsForTasks fails closed to an empty Map while migration
  // 114 is unapplied, so this join costs nothing on a database that doesn't have it
  // yet: every row's assignment is simply null.
  const taskIds = [...new Set(runs.map((run) => run.taskId))];
  const assignmentByTask = await listAssignmentsForTasks(admin, taskIds);

  // Resolve assignee display names against agent_reviewers directly, rather than
  // routing the client through listAssignableReviewersAction -- that action is
  // canAssignWork()-gated (Unit 9i's reviewer-picker gap), but a PLAIN reviewer
  // must still be able to see who a draft is assigned to. Deliberately not
  // filtered to status = 'active': an assignment can point at a reviewer who was
  // since suspended, and the name should still resolve for display.
  const assignedReviewerIds = [
    ...new Set(
      [...assignmentByTask.values()]
        .map((assignment) => assignment.reviewerId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const displayNameByReviewerId = new Map<string, string | null>();
  if (assignedReviewerIds.length > 0) {
    const { data: reviewerRows, error: reviewerError } = await admin
      .from('agent_reviewers')
      .select('user_id, display_name')
      .in('user_id', assignedReviewerIds);
    if (reviewerError) {
      if (!isMissingReviewerSchemaError(reviewerError)) {
        throw new Error(`Failed to resolve assignee names for the review queue: ${reviewerError.message}`);
      }
      // Migration 111/113 unapplied: fall through with an empty name map -- the UI
      // falls back to a short id, it does not lose the assignment itself.
    } else {
      for (const row of (reviewerRows ?? []) as { user_id: string; display_name: string | null }[]) {
        displayNameByReviewerId.set(row.user_id, row.display_name);
      }
    }
  }

  const rows: ReviewQueueRow[] = runs.map((run, index) => {
    const latestEvaluation = evaluationsByRun[index][0] ?? null;
    const assignment = assignmentByTask.get(run.taskId) ?? null;
    return {
      run,
      story: run.storyId ? storyById.get(run.storyId) ?? null : null,
      latestEvaluation,
      readiness: readinessOf(latestEvaluation),
      latestDecision: decisionsByRun[index][0] ?? null,
      assignment,
      assigneeDisplayName: assignment?.reviewerId ? displayNameByReviewerId.get(assignment.reviewerId) ?? null : null,
    };
  });

  let filtered = rows;

  if (filters.readiness && filters.readiness !== 'all') {
    filtered = filtered.filter((row) => row.readiness === filters.readiness);
  }

  // D18: a row reads as "unassigned" both when no active assignment row exists AT
  // ALL and when one exists with reviewerId === null (the FK's ON DELETE SET
  // NULL) -- never as "assigned to nobody in particular". 'mine' is resolved
  // against THIS call's own authenticated userId, never a value the caller could
  // pass in.
  if (filters.assignment === 'unassigned') {
    filtered = filtered.filter((row) => !row.assignment?.reviewerId);
  } else if (filters.assignment === 'mine') {
    filtered = filtered.filter((row) => row.assignment?.reviewerId === userId);
  }

  return filtered;
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
  // verifyAdmin() for the same reason as listReviewersAction below, which is
  // this probe's only companion caller: both exist solely to render
  // /admin/authors/reviewers. The boolean it returns is not itself sensitive --
  // the point is that the pair share one gate, so neither reads as the one
  // somebody forgot to think about.
  await verifyAdmin();

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
  // verifyAdmin(), NOT requireReviewer(): this row carries `notes`, which is
  // admin-only commentary ABOUT a reviewer (see ReviewerRosterRow.notes, whose
  // own doc says "never shown to the reviewer"). Unit 9g widened this payload to
  // include notes so the edit drawer could prefill it, but left the gate at
  // requireReviewer() -- which would have handed every active reviewer the
  // internal notes written about every other reviewer the moment the first real
  // row was granted. A server action is directly invocable, so the verifyAdmin()
  // on app/admin/authors/reviewers/page.tsx's parent layout was never protection
  // here. That admin page is this action's only caller, so the stricter gate
  // costs nothing. See listAssignableReviewersAction below for the reviewer-safe
  // projection an editor's assignment picker uses instead.
  await verifyAdmin();

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

  // Unit 9L / D20: reviewer standing rides the pricing-runtime payload, which is
  // cached per user for 30s. Without this, an account granted (or suspended, or
  // re-roled) here keeps its stale badge and "Review queue" link until that TTL
  // lapses. Cosmetic only -- requireReviewer() re-checks on every real action, so
  // a stale badge never grants access -- but a just-granted reviewer seeing no
  // badge for half a minute reads as a bug.
  invalidatePricingRuntimeCacheForUser((data as AgentReviewerRosterQueryRow).user_id);
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

  // Unit 9L / D20: reviewer standing rides the pricing-runtime payload, which is
  // cached per user for 30s. Without this, an account granted (or suspended, or
  // re-roled) here keeps its stale badge and "Review queue" link until that TTL
  // lapses. Cosmetic only -- requireReviewer() re-checks on every real action, so
  // a stale badge never grants access -- but a just-granted reviewer seeing no
  // badge for half a minute reads as a bug.
  invalidatePricingRuntimeCacheForUser((data as AgentReviewerRosterQueryRow).user_id);
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

  // Unit 9L / D20: reviewer standing rides the pricing-runtime payload, which is
  // cached per user for 30s. Without this, an account granted (or suspended, or
  // re-roled) here keeps its stale badge and "Review queue" link until that TTL
  // lapses. Cosmetic only -- requireReviewer() re-checks on every real action, so
  // a stale badge never grants access -- but a just-granted reviewer seeing no
  // badge for half a minute reads as a bug.
  invalidatePricingRuntimeCacheForUser((data as AgentReviewerRosterQueryRow).user_id);
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

// ── Review assignment (Unit 9i, migration 114, D18) ───────────────────────
//
// assignTaskAction / releaseAssignmentAction are gated on requireReviewer() AND
// canAssignWork(reviewer) -- plain review access is not enough, per D17's
// capability matrix: only an editor (or the implicit ADMIN_USER_ID) may assign
// work. Both re-check the reviewer-workflow flag exactly like the four decision
// actions above, for the same reason (this file's FLAG GATING header) -- a server
// action is directly invocable regardless of what any page rendered.
//
// THE REVIEWER-PICKER GAP. Section 5.3 of the Phase 9b plan does not say where
// the "Assign to..." picker gets its list of reviewers from. listReviewersAction
// (above) is the obvious candidate but is wrong for this: it returns every
// ReviewerRosterRow field -- including `notes`, which is admin-only commentary
// about the reviewer that must never reach a peer's assignment picker -- and is
// NOT filtered to active reviewers, so a suspended account would appear as a
// selectable target. listAssignableReviewersAction below is a separate, narrower
// action: gated the same way as the two mutations (requireReviewer() +
// canAssignWork()), filtered to status = 'active', and projected down to exactly
// what a picker needs -- id, display name, and coverage. No email, no notes, no
// other account field. Never verifyAdmin(): an editor who is not ADMIN_USER_ID
// must be able to call this at all.

export interface AssignableReviewerOption {
  userId: string;
  displayName: string | null;
  ageGroups: string[];
  languages: string[];
  genres: string[];
}

interface AssignableReviewerQueryRow {
  user_id: string;
  display_name: string | null;
  age_groups: string[] | null;
  languages: string[] | null;
  genres: string[] | null;
}

/**
 * The reviewer-safe roster for the "Assign to..." picker -- see this section's
 * header for why this is a separate action from listReviewersAction rather than
 * a reuse of it. Returns only ACTIVE reviewers: a suspended account has no
 * business being offered as a new assignment target, even though its historical
 * agent_review_assignments rows (already assigned before suspension) are left
 * alone -- this action only affects who a picker can choose GOING FORWARD.
 *
 * Fails closed to [] when migration 111/113 is unapplied, exactly like
 * listReviewersAction -- an empty picker is an honest reflection of "no coverage
 * data exists yet", not a crash.
 */
export async function listAssignableReviewersAction(): Promise<AssignableReviewerOption[]> {
  const { reviewer } = await requireReviewer();
  if (!canAssignWork(reviewer)) {
    throw new Error('Forbidden: only an editor may assign review work.');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_reviewers')
    .select('user_id, display_name, age_groups, languages, genres')
    .eq('status', 'active')
    .order('display_name', { ascending: true });

  if (error) {
    if (isMissingReviewerSchemaError(error)) return [];
    throw new Error(`Failed to list assignable reviewers: ${error.message}`);
  }

  return ((data ?? []) as AssignableReviewerQueryRow[]).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    ageGroups: row.age_groups ?? [],
    languages: row.languages ?? [],
    genres: row.genres ?? [],
  }));
}

/**
 * Assigns `taskId` to `reviewerId` (source: 'manual', assigned_by: the calling
 * editor). Delegates the actual supersede-then-insert and the concurrent-conflict
 * handling entirely to review-routing.ts's assignTask -- see that function's own
 * doc comment for why a racing second assign returns the winning row instead of
 * throwing.
 */
export async function assignTaskAction(taskId: string, reviewerId: string): Promise<ReviewAssignment> {
  const { userId, reviewer } = await requireReviewer();
  if (!canAssignWork(reviewer)) {
    throw new Error('Forbidden: only an editor may assign review work.');
  }
  await requireReviewerWorkflowEnabled();

  const admin = createAdminClient();
  return assignTask(admin, {
    taskId,
    reviewerId,
    assignedBy: userId,
    source: 'manual',
  });
}

/**
 * Releases `taskId`'s current active assignment, returning it to the unassigned
 * pool. A no-op (returns `null`) when the task has no active assignment to
 * release -- see review-routing.ts's releaseAssignment for why `actorId` is
 * logged rather than persisted (migration 114 has no "released_by" column).
 */
export async function releaseAssignmentAction(taskId: string): Promise<ReviewAssignment | null> {
  const { userId, reviewer } = await requireReviewer();
  if (!canAssignWork(reviewer)) {
    throw new Error('Forbidden: only an editor may release a review assignment.');
  }
  await requireReviewerWorkflowEnabled();

  const admin = createAdminClient();
  return releaseAssignment(admin, taskId, userId);
}
