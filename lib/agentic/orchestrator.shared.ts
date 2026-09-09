// ── Agentic Creator: execution orchestrator, pure half ──────────────────
//
// DELIBERATE DEVIATION FROM THE PLAN: the plan file put the whole orchestrator in a
// single `server-only` module. That would leave the retry and checkpoint logic below --
// the exact logic that stops a retried run from paying twice for a model call -- with
// zero test coverage, since a `server-only` module cannot be imported from a vitest test
// without a live Supabase connection. Everything here can be decided without a database
// or a network call, so it lives in this pure, isomorphic sibling instead, mirroring the
// supervisor.shared.ts / supervisor.ts split from Phase 4: the server half
// (lib/agentic/orchestrator.ts) claims rows, calls stage executors, and persists; this
// file owns the state machine itself.
//
// THE LOAD-BEARING CONTRACT: `agent_runs.checkpoint` (migration 107) is a JSONB object
// keyed by stage name. Before a run advances past a stage that did anything expensive
// (a paid model call, a write that must not repeat), the orchestrator writes that stage's
// result into checkpoint via recordCheckpoint(). On any retry, isCheckpointed() is checked
// FIRST -- a stage already present in checkpoint is never re-executed, full stop. Get this
// wrong and a flaky retry silently double-bills a model call. This is why the very first
// test in orchestrator.shared.test.ts asserts it directly.
//
// AgentRunStage and AgentRunStatus mirror the CHECK constraints on public.agent_runs
// (107_agent_runs.sql) exactly -- keep them in lockstep with that file, not with any
// intuition about what stages "should" exist.

// ── Stage machine ──────────────────────────────────────────────────────

/** Mirrors the CHECK constraint on agent_runs.stage (107_agent_runs.sql). */
export type AgentRunStage =
  | 'queued'
  | 'brief_ready'
  | 'novelty_checked'
  | 'story_generated'
  | 'draft_created'
  | 'narration_pending'
  | 'narration_complete'
  | 'evaluated'
  | 'awaiting_review'
  | 'media_pending'
  | 'complete'
  | 'failed'
  | 'cancelled';

/** Mirrors the CHECK constraint on agent_runs.status (107_agent_runs.sql). */
export type AgentRunStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Canonical stage order, exactly as it reads in the migration's CHECK constraint.
 * `nextStage` walks this array for its answer, EXCEPT for TERMINAL_STAGES (below),
 * which always return no successor regardless of where they sit in this array.
 *
 * The array is not one single unbroken chain: the automatic pipeline this phase and
 * Phase 6 drive runs queued -> ... -> awaiting_review and then STOPS there by design --
 * V1 has no autonomous publish, so a human reviewer, not this state machine, is what
 * moves a run from awaiting_review into media_pending and eventually complete (Phase 9/10).
 * awaiting_review is therefore terminal from this module's point of view even though
 * media_pending textually follows it in the array.
 */
export const STAGE_SEQUENCE: readonly AgentRunStage[] = [
  'queued',
  'brief_ready',
  'novelty_checked',
  'story_generated',
  'draft_created',
  'narration_pending',
  'narration_complete',
  'evaluated',
  'awaiting_review',
  'media_pending',
  'complete',
  'failed',
  'cancelled',
] as const;

/** Stages with no successor. awaiting_review is the automatic pipeline's hand-off point to human review, not a failure. */
const TERMINAL_STAGES: ReadonlySet<AgentRunStage> = new Set(['awaiting_review', 'complete', 'failed', 'cancelled']);

export function isTerminalStage(stage: AgentRunStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

/** The next stage in STAGE_SEQUENCE, or undefined when `current` is terminal or unrecognised. */
export function nextStage(current: AgentRunStage): AgentRunStage | undefined {
  if (isTerminalStage(current)) return undefined;
  const index = STAGE_SEQUENCE.indexOf(current);
  if (index === -1 || index === STAGE_SEQUENCE.length - 1) return undefined;
  return STAGE_SEQUENCE[index + 1];
}

// ── Checkpoint contract ────────────────────────────────────────────────

/** agent_runs.checkpoint's shape: stage name -> whatever that stage produced. */
export type AgentRunCheckpoint = Record<string, unknown>;

/** True when `stage` has already run and recorded a result -- a retry must never re-execute it. */
export function isCheckpointed(checkpoint: AgentRunCheckpoint, stage: AgentRunStage): boolean {
  return Object.prototype.hasOwnProperty.call(checkpoint, stage);
}

/**
 * Returns a NEW checkpoint object with `stage`'s result recorded. Never mutates
 * `checkpoint` -- the caller (orchestrator.ts) writes the return value back to the
 * database as the new column value; mutating the input in place would make it
 * impossible to tell, from the object reference alone, whether a write actually
 * happened, and would corrupt any copy of the pre-update checkpoint a caller kept
 * around for logging or comparison.
 */
export function recordCheckpoint(checkpoint: AgentRunCheckpoint, stage: AgentRunStage, payload: unknown): AgentRunCheckpoint {
  return { ...checkpoint, [stage]: payload };
}

/**
 * Resumes a run parked on a terminal stage (retryRun's use case: a run whose
 * stage was set to 'failed' by handleStageFailure) from the furthest point
 * its own checkpoint actually proves it reached, instead of leaving `stage`
 * on a terminal value nextStage() has no successor for -- which is exactly
 * what sent a retried run straight into advanceRun's "already terminal"
 * defensive branch and closed it out as 'succeeded' having done no work.
 *
 * Returns the LAST member of STAGE_SEQUENCE present as a key in `checkpoint`,
 * or 'queued' when none is. 'queued' is itself STAGE_SEQUENCE's first entry
 * and is never itself checkpointed (recordCheckpoint is only ever called
 * with `nextStage(run.stage)`, and nextStage('queued') is 'brief_ready'), so
 * an empty checkpoint correctly resumes at the very start of the pipeline.
 *
 * MUST iterate STAGE_SEQUENCE and test membership with isCheckpointed, never
 * iterate the checkpoint object's own keys. The checkpoint also carries
 * story_generated_progress (story-assembly.ts's
 * STORY_PROGRESS_CHECKPOINT_KEY) -- an intra-stage progress side-channel for
 * story_generated's per-beat loop, written into this same object but never a
 * stage name and never a member of this array. A naive "last key in the
 * object" (or "last key inserted") would treat that key as if it were a
 * stage and misresolve the resume point; this is not hypothetical; it is
 * exactly the shape of the checkpoint that hid this bug on run b7ac6093.
 * Same reasoning covers story-assembly.ts's two novelty_checked_verdict /
 * novelty_checked_avoid_titles side-channels (the cached pre-generation
 * verdict and its re-brief avoid-list) -- also written into this object,
 * also never a stage name.
 */
export function resumeStageFromCheckpoint(checkpoint: AgentRunCheckpoint): AgentRunStage {
  let resumeStage: AgentRunStage = 'queued';
  for (const stage of STAGE_SEQUENCE) {
    if (isCheckpointed(checkpoint, stage)) resumeStage = stage;
  }
  return resumeStage;
}

// ── Retry and backoff ──────────────────────────────────────────────────

export const MAX_RUN_ATTEMPTS = 3;

/** Base delay for nextAttemptDelayMs's exponential backoff. */
export const RETRY_BASE_DELAY_MS = 2_000;
/** Backoff never grows past this, however many attempts have been made. */
export const RETRY_MAX_DELAY_MS = 60_000;

export interface RetryableRun {
  attemptCount: number;
  maxAttempts: number;
}

/** False once attemptCount has reached (or passed) maxAttempts -- the run fails terminally instead. */
export function shouldRetry(run: RetryableRun): boolean {
  return run.attemptCount < run.maxAttempts;
}

/**
 * Exponential backoff keyed off how many attempts have already been made (1 for the
 * first retry after the initial attempt), capped at RETRY_MAX_DELAY_MS. Deterministic
 * on purpose -- no jitter -- so it stays trivially testable; a worker re-kick already
 * has its own natural scheduling slop.
 */
export function nextAttemptDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const delay = RETRY_BASE_DELAY_MS * 2 ** exponent;
  return Math.min(RETRY_MAX_DELAY_MS, delay);
}

// ── Stale-run reclaim ──────────────────────────────────────────────────

/** A processing run whose worker died mid-run is reclaimable after 10 minutes untouched. */
export const RUN_STALE_AFTER_MS = 10 * 60 * 1000;

export interface StaleCheckRun {
  status: AgentRunStatus;
  /** ISO timestamp of when the run was claimed, or null if never claimed. */
  claimedAt: string | null;
}

/**
 * True when `run` is `processing` and has been claimed for longer than `staleAfterMs`.
 * A run that is not `processing`, or has no claimedAt at all, is never stale -- there is
 * nothing to reclaim. The boundary is strict (`>`, not `>=`): a run claimed EXACTLY
 * staleAfterMs ago is not yet reclaimable, matching image-job-runner.ts's
 * `.lt('claimed_at', cutoff)` (strictly less than the cutoff counts as stale).
 */
export function isRunStale(run: StaleCheckRun, now: number, staleAfterMs: number): boolean {
  if (run.status !== 'processing' || !run.claimedAt) return false;
  const claimedAtMs = new Date(run.claimedAt).getTime();
  if (Number.isNaN(claimedAtMs)) return false;
  return now - claimedAtMs > staleAfterMs;
}

// ── Error classification ───────────────────────────────────────────────

/**
 * Few and meaningful, on purpose -- these are for an operator scanning a run list, not
 * for exhaustive taxonomy. `schema_missing` is checked first and takes priority over
 * every other signal, since a migration-107-absent database can otherwise throw errors
 * that superficially look like any of the other categories.
 */
export type AgentRunErrorCategory = 'schema_missing' | 'model_call_failed' | 'validation_failed' | 'timeout' | 'unknown';

/**
 * Tag an error thrown from a model call so classifyRunError can recognise it without
 * matching on message text. Phase 6's story-generation stages are the intended throwers.
 */
export class AgentModelCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentModelCallError';
  }
}

/** Tag an error thrown when a model or caller response failed structural validation. */
export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentValidationError';
  }
}

/**
 * True when a Postgres/PostgREST error means "migration 107 hasn't run on this database
 * yet", as opposed to any other failure that should surface as a real error. Codes only,
 * DELIBERATELY -- never match on message text. That exact bug (a bare table-name string
 * match on the error message misreporting a real constraint violation as an unapplied
 * migration) has already been fixed twice in this codebase: see isMissingPersonaSchemaError
 * in personas.shared.ts and isMissingTaskSchemaError in supervisor.shared.ts for the
 * defect this guards against. This is its own dedicated latch classifier for migration
 * 107 alone -- per GOTCHAS.md, latches (and the classifiers behind them) are one per
 * migration group, never reused across groups.
 */
export function isMissingRunSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_runs / agent_run_events / agent_schedules absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}

/**
 * Maps an arbitrary thrown value to a stable AgentRunErrorCategory for agent_runs.error_category.
 * Never throws itself -- an error it doesn't recognise lands in 'unknown' rather than
 * propagating, since classification must never be the thing that crashes a failure handler.
 */
export function classifyRunError(error: unknown): AgentRunErrorCategory {
  const asPgError = error as { code?: string; message?: string } | null | undefined;
  if (isMissingRunSchemaError(asPgError)) return 'schema_missing';

  const name = error instanceof Error ? error.name : undefined;
  if (name === 'AgentModelCallError') return 'model_call_failed';
  if (name === 'AgentValidationError') return 'validation_failed';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';

  return 'unknown';
}

// ── Enqueue selection (commissioned tasks -> runs) ─────────────────────

/**
 * A commissioned/assigned agent_tasks row (written by the Editorial Supervisor, an admin,
 * a schedule, or the Persona Test Lab) sits idle until something decides it is time to
 * spawn a run for it -- see enqueueCommissionedTasks in orchestrator.ts. WHICH tasks are
 * eligible right now, and in what order, is pure policy with no database dependency (it
 * needs only a task's id, persona, and creation time, plus the caller's set of currently
 * active personas), so it lives here rather than inside the query that fetches candidates
 * -- exactly the reason this file is split from orchestrator.ts at all: the eligibility
 * policy is the thing worth testing on its own, and it must not be buried in a round trip
 * to Postgres where exercising it would require a live database.
 */
export const MAX_RUNS_ENQUEUED_PER_DRAIN = 3;

export interface EnqueueCandidateTask {
  id: string;
  personaId: string | null;
  createdAt: string;
}

/**
 * Decides which commissioned/assigned tasks are eligible to become runs, oldest first,
 * capped at `limit`. A task with `personaId: null` has nothing to generate it as and is
 * never eligible; a task whose persona is not in `activePersonaIds` (paused, archived, or
 * simply not yet activated) is never eligible either. Ordering is ascending `createdAt`,
 * with `id` as an explicit tiebreaker for equal timestamps -- fairness (oldest work goes
 * first) plus a deterministic total order that does not depend on `Array.prototype.sort`
 * happening to be stable or on whatever order the caller's query returned rows in, so the
 * same input always enqueues the same tasks in the same order, run to run. `limit <= 0`
 * (and an empty `tasks` input) both yield `[]`.
 */
export function selectTasksToEnqueue(
  tasks: readonly EnqueueCandidateTask[],
  activePersonaIds: ReadonlySet<string>,
  limit: number
): EnqueueCandidateTask[] {
  if (limit <= 0) return [];

  return tasks
    .filter((task): task is EnqueueCandidateTask & { personaId: string } => task.personaId !== null && activePersonaIds.has(task.personaId))
    .slice()
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit);
}

// ── Time budget ─────────────────────────────────────────────────────────

/**
 * Same budget contract as image-job-runner.ts's JOB_TIME_BUDGET_MS (lib/media/
 * image-job-runner.ts:31): stop draining before the serverless duration cap and let the
 * worker route re-kick itself for whatever work remains. Read once at module load, like
 * its sibling.
 */
export const RUN_TIME_BUDGET_MS = Math.max(5_000, Number(process.env.WORKER_TIME_BUDGET_MS) || 20_000);
