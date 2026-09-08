import 'server-only';

// ── Agentic Creator: execution orchestrator, server half ────────────────
//
// Reads/writes agent_runs, agent_run_events (both migration 107) and agent_tasks (106).
// Everything that decides WHETHER a stage may re-execute, HOW LONG a run may retry, and
// WHAT a run's error means lives in the pure sibling lib/agentic/orchestrator.shared.ts,
// exactly like the supervisor.ts / supervisor.shared.ts split from Phase 4; this file
// only claims rows, calls stage executors, and persists.
//
// THE CLAIM PATTERN IS COPIED, NOT REINVENTED, from lib/media/image-job-runner.ts:
// claimRun() is an optimistic conditional UPDATE (`SET status='processing' WHERE id=?
// AND status='pending'`) that checks rows-affected -- there is no `FOR UPDATE SKIP
// LOCKED` anywhere in this repo, and none is introduced here. reclaimStaleAgentRuns()
// resets a `processing` run whose worker died mid-run back to `pending`, mirroring
// reclaimStaleImageJobs(), with one addition that image jobs don't need: a stale run
// that has already exhausted max_attempts is failed terminally instead of being handed
// back for an attempt it isn't entitled to.
//
// STORY GENERATION IS PHASE 6, AND IT HAS SHIPPED. Every non-terminal stage in
// agent_runs.stage past 'queued' requires content-generation logic (writing a brief,
// running a novelty check, authoring seed prose, materializing beats), which now lives in
// lib/agentic/story-assembly.ts's storyAssemblyExecutor. drainAgentRuns() takes a
// StageExecutor function as an OPTIONAL parameter; when a caller omits one -- both
// production callers, app/api/agentic/run/route.ts and app/api/batch/reconcile/route.ts,
// do -- it resolves storyAssemblyExecutor itself via resolveStoryAssemblyExecutor's lazy
// dynamic import. That import cannot be static: story-assembly.ts imports appendRunEvent,
// AgentRun, StageExecutor and StageExecutionOutcome back from this module, so a top-level
// import here would be a cycle. Laziness is worth keeping even setting the cycle aside --
// it keeps story-assembly's heavy transitive dependency graph (the Gemini proxy,
// save-story, beat-orchestration) out of this module's graph for as long as the feature
// stays off. defaultAgentRunExecutor still exists, but only as the explicit "defer every
// stage" executor, for callers and tests that want to exercise the deferral/
// return-to-pending path without invoking real generation.
//
// FAILS CLOSED for its own migration group (107): while it is unapplied, listRuns/getRun
// degrade to empty/null and every write throws a clear "not applied yet" message rather
// than a raw Postgres error, via its own dedicated latch (runSchemaUnavailable /
// isMissingRunSchemaError) -- never the 106 latch (isMissingTaskSchemaError) or any
// other group's, per GOTCHAS.md: latches are one per migration group, never reused.
//
// drainAgentRuns() ALSO fails closed on the master flag: it returns 0 immediately when
// getAgenticFlags().creatorEnabled is false, before any agent_runs/agent_run_events
// query -- the feature_flags read that decides this is unavoidable (every agentic
// surface makes it first) but the Phase-5 tables themselves are never touched while the
// system is off.

import { createAdminClient } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import {
  MAX_RUN_ATTEMPTS,
  MAX_RUNS_ENQUEUED_PER_DRAIN,
  RUN_STALE_AFTER_MS,
  RUN_TIME_BUDGET_MS,
  classifyRunError,
  isCheckpointed,
  isMissingRunSchemaError,
  isRunStale,
  isTerminalStage,
  nextStage,
  recordCheckpoint,
  resumeStageFromCheckpoint,
  selectTasksToEnqueue,
  shouldRetry,
  type AgentRunCheckpoint,
  type AgentRunStage,
  type AgentRunStatus,
  type EnqueueCandidateTask,
} from '@/lib/agentic/orchestrator.shared';
// Type-only: isMissingTaskSchemaError below comes from the pure, isomorphic
// supervisor.shared.ts (safe to import at runtime too), but AgentTaskStatus is declared
// in supervisor.ts itself, which is `server-only` and drags in the Gemini proxy and the
// rest of the Editorial Supervisor's heavy dependency graph. `import type` is erased at
// compile time -- it never becomes a `require`/`import` in the emitted JS -- so pulling
// only the TYPE from supervisor.ts costs nothing at runtime and does not widen this
// module's graph. Never change this to a value import.
import type { AgentTaskStatus } from '@/lib/agentic/supervisor';
import { isMissingTaskSchemaError } from '@/lib/agentic/supervisor.shared';
import { isMissingPersonaSchemaError } from '@/lib/agentic/personas.shared';

type AdminClient = ReturnType<typeof createAdminClient>;

const RUN_SCHEMA_UNAVAILABLE_MESSAGE =
  'Run storage is not available yet — migration 107 has not been applied to this environment.';

// One latch for migration 107 alone (GOTCHAS: latches are one per migration group).
// Logged once, then quiet: an unapplied migration is a steady state, not an incident.
let runSchemaUnavailable = false;
function latchRunSchemaUnavailable(context: string): void {
  if (!runSchemaUnavailable) {
    runSchemaUnavailable = true;
    console.warn(
      `[agentic-orchestrator] agent_runs unavailable (${context}); migration 107 is not applied on this database. ` +
        'Reads will report empty and writes will throw until it is.'
    );
  }
}

function isRunSchemaMissing(error: unknown): boolean {
  return isMissingRunSchemaError(error as { code?: string; message?: string } | null | undefined);
}

// A SECOND, independent latch for migration 106 (agent_tasks), deliberately not the same
// variable as runSchemaUnavailable above. GOTCHAS.md's rule is "never reuse ONE migration
// group's latch for a DIFFERENT group" -- it says nothing against a module having its own
// latch per group it touches. supervisor.ts already has its own 106 latch
// (taskSchemaUnavailable / latchTaskSchemaUnavailable) for ITS reads and writes; this
// module reads/writes agent_tasks too (enqueueCommissionedTasks, setTaskStatus below), so
// it needs the same protection independently. Do not "simplify" this into a shared/
// imported latch -- the two modules' migration-107 and migration-106 concerns are
// deliberately decoupled, and importing supervisor.ts's latch would mean importing
// supervisor.ts itself, which is exactly the heavy, server-only dependency graph this
// module goes out of its way to avoid (see the header comment on resolveStoryAssemblyExecutor).
let taskSchemaUnavailable = false;
function latchTaskSchemaUnavailable(context: string): void {
  if (!taskSchemaUnavailable) {
    taskSchemaUnavailable = true;
    console.warn(
      `[agentic-orchestrator] agent_tasks unavailable (${context}); migration 106 is not applied on this database. ` +
        'Task-lifecycle writes will be skipped until it is.'
    );
  }
}

function isTaskSchemaMissing(error: unknown): boolean {
  return isMissingTaskSchemaError(error as { code?: string; message?: string } | null | undefined);
}

// ── Row shapes ─────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  taskId: string;
  personaId: string | null;
  stage: AgentRunStage;
  status: AgentRunStatus;
  attemptCount: number;
  maxAttempts: number;
  claimedAt: string | null;
  idempotencyKey: string | null;
  checkpoint: AgentRunCheckpoint;
  storyId: string | null;
  errorCategory: string | null;
  errorDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface AgentRunRow {
  id: string;
  task_id: string;
  persona_id: string | null;
  stage: AgentRunStage;
  status: AgentRunStatus;
  attempt_count: number;
  max_attempts: number;
  claimed_at: string | null;
  idempotency_key: string | null;
  checkpoint: Record<string, unknown> | null;
  story_id: string | null;
  error_category: string | null;
  error_detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function rowToRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.task_id,
    personaId: row.persona_id,
    stage: row.stage,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    claimedAt: row.claimed_at,
    idempotencyKey: row.idempotency_key,
    checkpoint: row.checkpoint ?? {},
    storyId: row.story_id,
    errorCategory: row.error_category,
    errorDetail: row.error_detail,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export type AgentRunEventLevel = 'info' | 'warn' | 'error';

export interface AgentRunEvent {
  id: string;
  runId: string;
  stage: string;
  level: AgentRunEventLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AgentRunEventRow {
  id: string;
  run_id: string;
  stage: string;
  level: AgentRunEventLevel;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function rowToEvent(row: AgentRunEventRow): AgentRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    level: row.level,
    message: row.message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// ── Run events ─────────────────────────────────────────────────────────

/**
 * Appends one timeline entry. Best-effort: a failure to write telemetry must never take
 * down the run it is describing, so this logs and swallows rather than throwing --
 * mirroring how lib/ai/cost-telemetry.ts treats a failed cost-event write. `message`
 * must always be concise -- never chain-of-thought, never a full prompt, never a secret
 * (see CLAUDE.md).
 */
export async function appendRunEvent(
  runId: string,
  stage: string,
  level: AgentRunEventLevel,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (runSchemaUnavailable) return;

  try {
    const admin = createAdminClient();
    const { error } = await admin.from('agent_run_events').insert({ run_id: runId, stage, level, message, metadata });
    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('appendRunEvent');
        return;
      }
      console.error(`Failed to append agent_run_event for run ${runId}:`, error.message);
    }
  } catch (error) {
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('appendRunEvent');
      return;
    }
    console.error(`Failed to append agent_run_event for run ${runId}:`, error);
  }
}

// ── Reclaim ────────────────────────────────────────────────────────────

/**
 * Resets `processing` runs whose worker died mid-run back to `pending` so another
 * worker can claim them, mirroring reclaimStaleImageJobs(). A stale run that has already
 * used up its attempts is not handed back for one it isn't entitled to -- it is failed
 * terminally instead, with error_category 'timeout' (classifyRunError's stable name for
 * this class of failure) and an agent_run_events entry recording why.
 *
 * Returns the number of runs actually returned to `pending` (not the number failed).
 */
export async function reclaimStaleAgentRuns(): Promise<number> {
  if (runSchemaUnavailable) return 0;

  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - RUN_STALE_AFTER_MS).toISOString();

    const { data, error } = await admin
      .from('agent_runs')
      .select('id, attempt_count, max_attempts')
      .eq('status', 'processing')
      .lt('claimed_at', cutoff);

    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('reclaimStaleAgentRuns');
        return 0;
      }
      throw new Error(`Failed to read stale agent_runs: ${error.message}`);
    }

    const staleRows = (data ?? []) as { id: string; attempt_count: number; max_attempts: number }[];
    if (staleRows.length === 0) return 0;

    const reclaimable = staleRows.filter((row) => shouldRetry({ attemptCount: row.attempt_count, maxAttempts: row.max_attempts }));
    const exhausted = staleRows.filter((row) => !shouldRetry({ attemptCount: row.attempt_count, maxAttempts: row.max_attempts }));

    if (reclaimable.length > 0) {
      await admin
        .from('agent_runs')
        .update({ status: 'pending', claimed_at: null })
        .in('id', reclaimable.map((row) => row.id))
        .eq('status', 'processing');
    }

    if (exhausted.length > 0) {
      const exhaustedIds = exhausted.map((row) => row.id);
      await admin
        .from('agent_runs')
        .update({
          status: 'failed',
          stage: 'failed',
          error_category: 'timeout',
          error_detail: `Run exceeded max_attempts (${MAX_RUN_ATTEMPTS}) after being reclaimed as stale.`,
          finished_at: new Date().toISOString(),
        })
        .in('id', exhaustedIds)
        .eq('status', 'processing');

      for (const id of exhaustedIds) {
        await appendRunEvent(id, 'failed', 'error', 'Reclaimed as stale with no attempts remaining; marked failed.');
      }
    }

    return reclaimable.length;
  } catch (error) {
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('reclaimStaleAgentRuns');
      return 0;
    }
    throw error;
  }
}

// ── Claim ──────────────────────────────────────────────────────────────

/** Atomic claim: only one worker wins the pending -> processing transition. */
async function claimRun(admin: AdminClient, runId: string, attemptCount: number): Promise<boolean> {
  const { data, error } = await admin
    .from('agent_runs')
    .update({ status: 'processing', claimed_at: new Date().toISOString(), attempt_count: attemptCount + 1 })
    .eq('id', runId)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('claimRun');
      return false;
    }
    throw new Error(`Failed to claim agent_run ${runId}: ${error.message}`);
  }

  return Boolean(data && data.length > 0);
}

// ── Create ─────────────────────────────────────────────────────────────

export interface CreateRunResult {
  run: AgentRun | null;
  /** True when idx_agent_runs_active_task already had a live run for this task. */
  alreadyRunning: boolean;
}

/**
 * Creates a fresh run for a commissioned task. Respects the partial unique index
 * (task_id) WHERE status IN ('pending','processing') -- a task with a live run cannot
 * get a second one, so the resulting unique violation (code 23505) is handled as
 * "already running" and returned to the caller rather than thrown as an error.
 */
export async function createRunForTask(taskId: string): Promise<CreateRunResult> {
  if (runSchemaUnavailable) throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const admin = createAdminClient();

    // Carry the task's persona onto the run so callers never have to look it up
    // separately; a task with no persona assigned yet still gets a run.
    const { data: taskRow, error: taskError } = await admin
      .from('agent_tasks')
      .select('persona_id')
      .eq('id', taskId)
      .maybeSingle();

    if (taskError) throw new Error(`Failed to read agent_task for run creation: ${taskError.message}`);
    if (!taskRow) throw new Error(`No agent_task found with id ${taskId}.`);

    const { data, error } = await admin
      .from('agent_runs')
      .insert({
        task_id: taskId,
        persona_id: taskRow.persona_id ?? null,
        stage: 'queued',
        status: 'pending',
        attempt_count: 0,
        max_attempts: MAX_RUN_ATTEMPTS,
        checkpoint: {},
      })
      .select('*')
      .single();

    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('createRunForTask');
        throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      if (error.code === '23505') {
        return { run: null, alreadyRunning: true };
      }
      throw new Error(`Failed to create agent_run: ${error.message}`);
    }

    const run = rowToRun(data as AgentRunRow);
    await appendRunEvent(run.id, 'queued', 'info', 'Run created for commissioned task.');
    return { run, alreadyRunning: false };
  } catch (error) {
    if (error instanceof Error && error.message === RUN_SCHEMA_UNAVAILABLE_MESSAGE) throw error;
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('createRunForTask');
      throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

// ── Task lifecycle ─────────────────────────────────────────────────────

/**
 * Best-effort task-lifecycle write: moves agent_tasks.status alongside a run's own
 * progress. NEVER throws -- swallows and logs every failure instead, mirroring
 * appendRunEvent's contract above -- because a task-status write failing must never
 * corrupt the run's own state or abort a drain that is otherwise progressing fine.
 * Latches migration 106 through latchTaskSchemaUnavailable on a schema-missing error,
 * same classifier and latch every other agent_tasks access in this module uses.
 */
async function setTaskStatus(admin: AdminClient, taskId: string, status: AgentTaskStatus, context: string): Promise<void> {
  if (taskSchemaUnavailable) return;

  try {
    const { error } = await admin.from('agent_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', taskId);

    if (error) {
      if (isTaskSchemaMissing(error)) {
        latchTaskSchemaUnavailable(context);
        return;
      }
      console.error(`Failed to set agent_task ${taskId} status to '${status}' (${context}):`, error.message);
    }
  } catch (error) {
    if (isTaskSchemaMissing(error)) {
      latchTaskSchemaUnavailable(context);
      return;
    }
    console.error(`Failed to set agent_task ${taskId} status to '${status}' (${context}):`, error);
  }
}

/**
 * Turns commissioned/assigned agent_tasks rows into agent_runs rows. This is the ONLY
 * path that puts anything into the pipeline drainAgentRuns then advances -- before this
 * function existed, createRunForTask above had no caller at all, so a commissioned task
 * sat forever and nothing was ever generated.
 *
 * The task-status writes at the bottom of this function are not polish, they are what
 * stops an unbounded loop of paid story generation: the partial unique index
 * idx_agent_runs_active_task only blocks a SECOND live run (status IN
 * ('pending','processing')) for a given task_id -- it says nothing about
 * agent_tasks.status. The moment a run's status leaves that live window (succeeds,
 * fails, or is cancelled) while its task is still sitting in 'commissioned' or
 * 'assigned', the very next drain reads that same task back out of the query below and
 * commissions ANOTHER run for it -- forever, each pass a real, paid model call. Flipping
 * the task to 'running' as soon as a run exists for it is what removes it from that
 * `status IN ('commissioned','assigned')` filter and makes this a one-shot enqueue
 * instead of a loop.
 */
export async function enqueueCommissionedTasks(limit: number = MAX_RUNS_ENQUEUED_PER_DRAIN): Promise<number> {
  if (runSchemaUnavailable) return 0;
  if (taskSchemaUnavailable) return 0;
  if (limit <= 0) return 0;

  const admin = createAdminClient();

  type CandidateTaskRow = { id: string; persona_id: string | null; created_at: string };
  let candidateRows: CandidateTaskRow[];

  try {
    const { data, error } = await admin
      .from('agent_tasks')
      .select('id, persona_id, created_at')
      .in('status', ['commissioned', 'assigned'])
      .eq('is_test', false)
      .not('persona_id', 'is', null)
      .order('created_at', { ascending: true })
      // Over-fetch 4x `limit`: the persona-active filter happens AFTER this query (it
      // needs a second, separate query against agent_personas -- see below), so some of
      // the oldest `limit` rows fetched here may turn out to belong to an inactive
      // persona and get filtered out by selectTasksToEnqueue. Fetching more up front
      // means there are still enough genuinely-eligible candidates left to fill `limit`
      // slots, rather than under-filling every pass a persona happens to be paused.
      .limit(limit * 4);

    // ONLY the 106 latch is consulted here, deliberately. isMissingRunSchemaError and
    // isMissingTaskSchemaError accept an IDENTICAL set of codes (42P01, 42703, PGRST200,
    // PGRST204) -- they are told apart solely by WHICH TABLE the failing query touched,
    // never by the error itself. This query touches agent_tasks and nothing else, so a
    // schema-missing error here is always migration 106. Classifying it as 107 as well
    // would latch runSchemaUnavailable, and that latch is read at the top of
    // drainAgentRuns and by listRuns/getRun -- so an agent_tasks problem would kill the
    // whole run pipeline and blank /admin/agents/runs behind a "migration 107 is not
    // applied" message that is simply false. That is the exact defect GOTCHAS.md's
    // "Column-availability latches are per migration group" section describes.
    if (error) {
      if (isTaskSchemaMissing(error)) {
        latchTaskSchemaUnavailable('enqueueCommissionedTasks');
        return 0;
      }
      throw new Error(`Failed to read commissioned agent_tasks: ${error.message}`);
    }

    candidateRows = (data ?? []) as CandidateTaskRow[];
  } catch (error) {
    if (isTaskSchemaMissing(error)) {
      latchTaskSchemaUnavailable('enqueueCommissionedTasks');
      return 0;
    }
    throw error;
  }

  if (candidateRows.length === 0) return 0;

  const personaIds = [...new Set(candidateRows.map((row) => row.persona_id).filter((id): id is string => id !== null))];

  let activePersonaIds: Set<string>;
  try {
    const { data, error } = await admin.from('agent_personas').select('id').eq('status', 'active').in('id', personaIds);

    if (error) {
      // Migration 103 missing. No dedicated latch here -- unlike 106/107 above, this is
      // a purely defensive branch, not a steady state worth remembering across calls:
      // agent_tasks.persona_id and agent_runs.persona_id both carry a foreign key onto
      // agent_personas, so in practice 106/107 cannot even be applied, let alone have
      // rows in them, without 103 already being applied too. If this ever fires it means
      // something stranger than "the migrations haven't run yet in order".
      if (isMissingPersonaSchemaError(error)) {
        console.warn(
          '[agentic-orchestrator] agent_personas unavailable (enqueueCommissionedTasks); migration 103 is not applied on this database.'
        );
        return 0;
      }
      throw new Error(`Failed to read active agent_personas for enqueue: ${error.message}`);
    }

    activePersonaIds = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
  } catch (error) {
    if (isMissingPersonaSchemaError(error as { code?: string; message?: string } | null | undefined)) {
      console.warn(
        '[agentic-orchestrator] agent_personas unavailable (enqueueCommissionedTasks); migration 103 is not applied on this database.'
      );
      return 0;
    }
    throw error;
  }

  const candidates: EnqueueCandidateTask[] = candidateRows.map((row) => ({
    id: row.id,
    personaId: row.persona_id,
    createdAt: row.created_at,
  }));

  const selected = selectTasksToEnqueue(candidates, activePersonaIds, limit);

  let created = 0;
  for (const task of selected) {
    if (runSchemaUnavailable) break;

    let result: CreateRunResult;
    try {
      result = await createRunForTask(task.id);
    } catch (error) {
      console.error(
        `Failed to create agent_run for commissioned task ${task.id}:`,
        error instanceof Error ? error.message : error
      );
      continue;
    }

    if (result.alreadyRunning) {
      // idx_agent_runs_active_task refused a second live run for this task -- another
      // worker (or an earlier, crashed pass of this very function) already created one.
      // That is the index doing exactly its job: a benign race, NEVER an error worth
      // logging as one. The task is still flipped to 'running' below regardless of which
      // branch got here -- a crash between a PRIOR createRunForTask call succeeding and
      // ITS task-status write would otherwise leave this task stuck 'assigned' forever
      // even though a live run already exists for it; re-flipping it here on this pass
      // is what heals that.
      await setTaskStatus(admin, task.id, 'running', 'enqueueCommissionedTasks (already running)');
      continue;
    }

    if (result.run) {
      created += 1;
      await setTaskStatus(admin, task.id, 'running', 'enqueueCommissionedTasks');
    }
  }

  return created;
}

// ── Stage execution seam ───────────────────────────────────────────────

export interface StageAdvancedOutcome {
  kind: 'advanced';
  /** Recorded into checkpoint[targetStage]. Kept out of agent_run_events verbatim -- see appendRunEvent's contract. */
  checkpointPayload?: unknown;
  /** Set once a story row exists, so agent_runs.story_id can be stamped. */
  storyId?: string;
}

export interface StageDeferredOutcome {
  kind: 'deferred';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface StageFailedOutcome {
  kind: 'failed';
  message: string;
  metadata?: Record<string, unknown>;
  /** The underlying thrown value, passed to classifyRunError -- never derived from `message` text. */
  error?: unknown;
}

export type StageExecutionOutcome = StageAdvancedOutcome | StageDeferredOutcome | StageFailedOutcome;

/**
 * A function that attempts to produce `targetStage`'s result for `run`. Checkpoint-skip
 * happens OUTSIDE this function (in advanceRun, before it is ever called) -- an executor
 * is only invoked for a stage that is not already checkpointed, so it never needs to
 * check isCheckpointed itself.
 */
export type StageExecutor = (run: AgentRun, targetStage: AgentRunStage) => Promise<StageExecutionOutcome>;

/**
 * No longer drainAgentRuns's default -- storyAssemblyExecutor (lib/agentic/story-assembly.ts)
 * is, resolved lazily by resolveStoryAssemblyExecutor below. This is now the explicit
 * "defer every stage" executor: it defers on the very first stage it is asked to produce
 * and says so plainly, without attempting any real generation. Retained (and still
 * exported) for callers and tests that want to exercise the deferral/return-to-pending
 * path in isolation, without paying for or depending on real story generation.
 */
export const defaultAgentRunExecutor: StageExecutor = async (_run, targetStage) => ({
  kind: 'deferred',
  message: `Stage '${targetStage}' requires story-generation logic that has not shipped yet (Phase 6). Run left pending.`,
});

// ── Advancing one claimed run ──────────────────────────────────────────

async function persistStageAdvance(
  admin: AdminClient,
  run: AgentRun,
  target: AgentRunStage,
  checkpoint: AgentRunCheckpoint,
  storyId?: string
): Promise<AgentRun> {
  const patch: Record<string, unknown> = { stage: target, checkpoint };
  if (storyId) patch.story_id = storyId;
  if (isTerminalStage(target)) {
    patch.status = 'succeeded';
    patch.finished_at = new Date().toISOString();
  }

  const { data, error } = await admin.from('agent_runs').update(patch).eq('id', run.id).select('*').single();
  if (error) throw new Error(`Failed to persist stage advance for run ${run.id}: ${error.message}`);
  const updated = rowToRun(data as AgentRunRow);

  // Both of advanceRun's branches land here: the checkpoint-skip branch (a stage
  // already recorded, applied "for free" with no executor call) and the
  // executor-advanced branch (a stage the executor just produced). Writing the
  // task-lifecycle transition in this ONE shared spot, rather than duplicating it in
  // both callers, is what guarantees a checkpoint-skipped run reaching awaiting_review
  // flips its task just as reliably as one that got there by actually running the
  // stage. No other stage maps to a task status: 'complete' and 'media_pending' belong
  // to the Phase 9/10 human-reviewer workflow and are deliberately left untouched here.
  if (target === 'awaiting_review') {
    await setTaskStatus(admin, updated.taskId, 'awaiting_review', 'persistStageAdvance');
  }

  return updated;
}

/**
 * Returns a deferred run to 'pending' WITHOUT consuming an attempt. Deferred is not a
 * failure -- claimRun already incremented attempt_count when this run was claimed, and
 * undoing that here is deliberate: Phase 6 not existing yet must never cost this run one
 * of its max_attempts, or every commissioned task would silently fail once Phase 6 takes
 * longer to ship than MAX_RUN_ATTEMPTS drain cycles.
 */
async function returnRunToPending(admin: AdminClient, run: AgentRun): Promise<void> {
  await admin
    .from('agent_runs')
    .update({ status: 'pending', claimed_at: null, attempt_count: Math.max(0, run.attemptCount - 1) })
    .eq('id', run.id)
    .eq('status', 'processing');
}

async function handleStageFailure(
  admin: AdminClient,
  run: AgentRun,
  message: string,
  metadata: Record<string, unknown> | undefined,
  rawError: unknown
): Promise<void> {
  const category = classifyRunError(rawError);
  const truncatedDetail = message.slice(0, 500);

  if (shouldRetry({ attemptCount: run.attemptCount, maxAttempts: run.maxAttempts })) {
    await admin
      .from('agent_runs')
      .update({ status: 'pending', claimed_at: null, error_category: category, error_detail: truncatedDetail })
      .eq('id', run.id)
      .eq('status', 'processing');
    await appendRunEvent(
      run.id,
      run.stage,
      'warn',
      `Stage failed (attempt ${run.attemptCount}/${run.maxAttempts}), will retry: ${truncatedDetail}`,
      metadata
    );
    return;
  }

  await admin
    .from('agent_runs')
    .update({
      status: 'failed',
      stage: 'failed',
      error_category: category,
      error_detail: truncatedDetail,
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id)
    .eq('status', 'processing');
  await appendRunEvent(run.id, 'failed', 'error', `Run failed permanently after ${run.attemptCount} attempt(s): ${truncatedDetail}`, metadata);
  // Only the PERMANENT-failure branch flips the task -- the will-retry branch above
  // returns early and leaves the task exactly as it was, since the run itself hasn't
  // given up yet and may still succeed on the next attempt.
  await setTaskStatus(admin, run.taskId, 'failed', 'handleStageFailure');
}

/**
 * Drives one claimed run forward as far as it can go in this pass: for each stage
 * still ahead of it, a stage already present in checkpoint is applied for free (no
 * executor call, no re-billed model call -- this is the idempotency contract in
 * action); the first stage NOT yet checkpointed is handed to `executor`. Stops at the
 * first 'deferred' or 'failed' outcome, or once a terminal stage is reached.
 *
 * `stopAfterStage`, when given, is a SECOND stopping condition on top of those:
 * once the run has just advanced ONTO that stage, the loop stops there too and the
 * run is returned to 'pending' (via returnRunToPending, same as a deferral -- the
 * attempt is not consumed) instead of continuing toward the next stage. This is the
 * entire mechanism behind the Persona Test Lab's safety property: stopping a run
 * after 'story_generated' means `draft_created` -- the ONLY stage that calls
 * saveStoryForUser/recordStoryMemory/updatePersonaMemory (see story-assembly.ts) --
 * never runs until something explicitly asks for it (promoteTestLabRun, with no
 * stopAfterStage at all). There is no separate "is this a test" flag anywhere in
 * this function or in story-assembly.ts; the guarantee is structural, not a check
 * that could be forgotten.
 */
async function advanceRun(
  admin: AdminClient,
  initialRun: AgentRun,
  executor: StageExecutor,
  stopAfterStage?: AgentRunStage
): Promise<void> {
  let run = initialRun;

  for (;;) {
    const target = nextStage(run.stage);
    if (!target) {
      // Defensive, not unreachable: retryRun is a first-party path that can hand this
      // loop a claimed 'pending' run whose stage is legitimately terminal (a permanent
      // failure leaves stage: 'failed', and 'failed' has no successor). retryRun
      // guards against that by recomputing stage via resumeStageFromCheckpoint before
      // the run ever gets here, so in the normal case this branch is not reached for a
      // run resuming from failure -- but if some other caller ever lands a run here
      // sitting on a terminal stage regardless, there is nothing left to do but close
      // it out cleanly rather than loop forever.
      await admin
        .from('agent_runs')
        .update({ status: 'succeeded', finished_at: new Date().toISOString() })
        .eq('id', run.id)
        .eq('status', 'processing');
      return;
    }

    if (isCheckpointed(run.checkpoint, target)) {
      run = await persistStageAdvance(admin, run, target, run.checkpoint);
      if (isTerminalStage(target)) return;
      // Checked here too, not only in the 'advanced' branch below -- a run resumed
      // by executeRunNow (continueTestLabRun's second-and-later passes) can find
      // its next target stage ALREADY checkpointed from a prior pass and take this
      // free branch instead of ever calling the executor. Without this check, a
      // resumed run would sail straight past stopAfterStage with no executor call
      // to have stopped it at -- for the Test Lab specifically, straight into
      // draft_created's memory writes. See this function's own doc comment.
      if (target === stopAfterStage) {
        await returnRunToPending(admin, run);
        return;
      }
      continue;
    }

    let outcome: StageExecutionOutcome;
    try {
      outcome = await executor(run, target);
    } catch (error) {
      await handleStageFailure(admin, run, error instanceof Error ? error.message : 'Unknown stage executor error.', undefined, error);
      return;
    }

    if (outcome.kind === 'advanced') {
      // `run.checkpoint` MUST be read here, after the executor returned -- never
      // hoisted to a local above the executor call. A long stage (story_generated)
      // writes intra-stage progress straight to the row and mutates run.checkpoint
      // in place so this line sees it; see persistStoryGenerationProgress in
      // lib/agentic/story-assembly.ts. Reading a pre-executor copy would overwrite
      // that progress with a stale value, and a retry would re-pay for every model
      // call the stage had already completed. The bug would be silent -- correct
      // stories, duplicated spend.
      const newCheckpoint = recordCheckpoint(run.checkpoint, target, outcome.checkpointPayload ?? null);
      run = await persistStageAdvance(admin, run, target, newCheckpoint, outcome.storyId);
      await appendRunEvent(run.id, target, 'info', `Advanced to stage '${target}'.`);
      if (isTerminalStage(target)) return;
      // Same stop check as the checkpoint-skip branch above -- this is the branch a
      // FIRST pass through `stopAfterStage` takes (the executor actually ran), so
      // it is the one that fires for startTestLabRun's very first executeRunNow call.
      if (target === stopAfterStage) {
        await returnRunToPending(admin, run);
        return;
      }
      continue;
    }

    if (outcome.kind === 'deferred') {
      // Logged against `target`, not `run.stage`. The run stays on run.stage after a
      // deferral, but the EVENT describes an attempt at the stage that deferred, and
      // using run.stage attributes it to the previous one. Observed live: every
      // 'Time budget exhausted before beat N/5' line -- unmistakably story_generated
      // work -- was filed under novelty_checked in the run timeline, which is the
      // admin's only window into where a long run actually is.
      await appendRunEvent(run.id, target, 'info', outcome.message, outcome.metadata);
      await returnRunToPending(admin, run);
      return;
    }

    // outcome.kind === 'failed'
    await handleStageFailure(admin, run, outcome.message, outcome.metadata, outcome.error);
    return;
  }
}

// ── Single-run inline execution (Persona Test Lab) ──────────────────────

export interface ExecuteRunNowOptions {
  stopAfterStage?: AgentRunStage;
}

/**
 * Claims and advances ONE run inline, for the Persona Test Lab's synchronous path.
 * Unlike drainAgentRuns -- which enqueues commissioned tasks, reclaims stale runs,
 * and then claims whatever pending run is oldest, in a loop bounded by a time
 * budget -- this claims a SPECIFIC run by id, does none of that surrounding
 * housekeeping, and lets the caller stop the advance early via `stopAfterStage`.
 *
 * Does not statically import lib/agentic/story-assembly.ts (see this module's own
 * header comment on resolveStoryAssemblyExecutor, and commit 5e14249): the caller
 * passes `executor` -- the Persona Test Lab passes storyAssemblyExecutor itself --
 * so this module never needs to know that module exists.
 */
export async function executeRunNow(
  runId: string,
  executor: StageExecutor,
  options?: ExecuteRunNowOptions
): Promise<AgentRun | null> {
  if (runSchemaUnavailable) throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);

  const admin = createAdminClient();

  let existingRow: AgentRunRow | null;
  try {
    const { data, error } = await admin.from('agent_runs').select('*').eq('id', runId).maybeSingle();
    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('executeRunNow');
        throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to read agent_run ${runId}: ${error.message}`);
    }
    existingRow = (data as AgentRunRow | null) ?? null;
  } catch (error) {
    if (error instanceof Error && error.message === RUN_SCHEMA_UNAVAILABLE_MESSAGE) throw error;
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('executeRunNow');
      throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }

  if (!existingRow) throw new Error(`No agent_run found with id ${runId}.`);
  // A run already 'processing' is being worked by something else right now (the
  // cron drain, or another concurrent executeRunNow call) -- claiming it out from
  // under that worker would let two callers advance the same run at once, which is
  // exactly the race claimRun's conditional UPDATE exists to prevent. Refuse
  // loudly here rather than letting claimRun's `eq('status', 'pending')` silently
  // fail to match and return null, which would look identical to "lost the race"
  // even though nothing here raced anyone.
  if (existingRow.status !== 'pending') {
    throw new Error(
      `Run ${runId} is '${existingRow.status}', not 'pending'; it is already being worked by something else.`
    );
  }

  const claimed = await claimRun(admin, runId, existingRow.attempt_count);
  if (!claimed) return null; // Lost the claim race between the read above and now.

  const run = rowToRun({
    ...existingRow,
    status: 'processing',
    attempt_count: existingRow.attempt_count + 1,
    claimed_at: new Date().toISOString(),
  });

  // Same safety net drainAgentRuns wraps its own advanceRun call in, and for the same
  // reason. advanceRun already converts an executor THROW into handleStageFailure
  // internally, but a failure of its own persistence (persistStageAdvance's update)
  // still propagates. Without this, that throw would escape while the run is still
  // 'processing', leaving it stuck and unclaimable for a full RUN_STALE_AFTER_MS
  // (10 minutes) until reclaimStaleAgentRuns hands it back -- a bad failure mode
  // anywhere, and a particularly bad one for the Persona Test Lab, whose entire job
  // is to make a run's failures legible immediately. Routing it through
  // handleStageFailure instead records the error on the run and in its event
  // timeline, where the admin can actually see it.
  try {
    await advanceRun(admin, run, executor, options?.stopAfterStage);
  } catch (error) {
    console.error(`Agent run ${run.id} threw while advancing (executeRunNow):`, error instanceof Error ? error.stack ?? error.message : error);
    await handleStageFailure(
      admin,
      run,
      error instanceof Error ? error.message : 'Unknown orchestrator error.',
      undefined,
      error
    ).catch(() => {});
  }

  const { data: freshData, error: freshError } = await admin.from('agent_runs').select('*').eq('id', runId).maybeSingle();
  if (freshError) {
    if (isRunSchemaMissing(freshError)) {
      latchRunSchemaUnavailable('executeRunNow (re-read)');
      return null;
    }
    throw new Error(`Failed to re-read agent_run ${runId} after advancing: ${freshError.message}`);
  }
  return freshData ? rowToRun(freshData as AgentRunRow) : null;
}

// ── Drain loop ─────────────────────────────────────────────────────────

/**
 * Memoised handle to storyAssemblyExecutor -- populated at most once per process by the
 * dynamic import in resolveStoryAssemblyExecutor.
 */
let cachedStoryAssemblyExecutor: StageExecutor | undefined;

/**
 * Lazily resolves lib/agentic/story-assembly.ts's storyAssemblyExecutor for use as
 * drainAgentRuns's default. This MUST be a dynamic import, not a top-level one, for two
 * independent reasons:
 *
 * (a) story-assembly.ts imports appendRunEvent, AgentRun, StageExecutor and
 *     StageExecutionOutcome from this module at its own top level. A static import of
 *     story-assembly.ts here would close that into a cycle.
 * (b) even setting the cycle aside, story-assembly.ts drags in a heavy transitive
 *     dependency graph -- the Gemini proxy, save-story, beat-orchestration -- that has no
 *     business loading into every module graph that merely imports drainAgentRuns (the
 *     reconcile cron route, in particular) while the feature is off. A dynamic import
 *     defers that cost to the first drain that actually needs it.
 *
 * Memoised on a module-level variable so the import only happens once per process.
 */
async function resolveStoryAssemblyExecutor(): Promise<StageExecutor> {
  if (!cachedStoryAssemblyExecutor) {
    const mod = await import('@/lib/agentic/story-assembly');
    cachedStoryAssemblyExecutor = mod.storyAssemblyExecutor;
  }
  return cachedStoryAssemblyExecutor;
}

/**
 * Enqueues commissioned tasks into fresh runs (enqueueCommissionedTasks), reclaims stale
 * runs, then claims and advances pending runs one at a time until `budgetMs` is spent.
 * Returns how many runs were claimed and processed in this call (regardless of whether
 * each one succeeded, deferred, or failed) -- the same "processed" semantics as
 * runImageGenerationJobs's result. Enqueueing does not add to this count; it is a
 * separate, best-effort step ahead of the claim loop, not something this return value
 * reports on.
 *
 * Returns 0 immediately, WITHOUT touching agent_runs/agent_run_events, when the master
 * kill switch (agentic_creator_enabled) is off. `executor` is optional: both production
 * callers (app/api/agentic/run/route.ts, app/api/batch/reconcile/route.ts) omit it, and
 * get storyAssemblyExecutor via resolveStoryAssemblyExecutor's lazy dynamic import above.
 * Pass defaultAgentRunExecutor explicitly to get the old defer-every-stage behaviour.
 */
export async function drainAgentRuns(
  budgetMs: number = RUN_TIME_BUDGET_MS,
  executor?: StageExecutor
): Promise<number> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) return 0;

  if (runSchemaUnavailable) return 0;

  const activeExecutor = executor ?? (await resolveStoryAssemblyExecutor());

  const admin = createAdminClient();
  const startedAt = Date.now();
  let processed = 0;

  await reclaimStaleAgentRuns().catch(() => 0);

  // Same defensive posture as reclaimStaleAgentRuns just above: an enqueue failure must
  // never stop this call from advancing runs that already exist. See
  // enqueueCommissionedTasks's own doc comment for why skipping this step for too long
  // is fine (a task just waits one more drain) but silently swallowing every attempt at
  // it forever is not (a task would sit 'commissioned' with nothing ever generated).
  await enqueueCommissionedTasks().catch((error) => {
    console.error('enqueueCommissionedTasks failed during drainAgentRuns:', error instanceof Error ? error.message : error);
    return 0;
  });

  while (Date.now() - startedAt < budgetMs) {
    let candidate: AgentRunRow | null;
    try {
      const { data, error } = await admin
        .from('agent_runs')
        // Inner-join filter, not a plain select('*'): makes a run belonging to a TEST
        // task invisible to this cron path. The Persona Test Lab creates a run against a
        // task with is_test = true and deliberately parks it mid-pipeline for a human to
        // inspect -- if the cron claimed it, it would execute draft_created and save a
        // story nobody approved. agent_runs.task_id carries a foreign key to agent_tasks
        // (migration 107), so this embed is valid; if PostgREST cannot resolve it, the
        // error code is PGRST200, which isMissingRunSchemaError already classifies, so
        // the existing 107 latch below handles that failure mode with no change needed.
        // A PGRST200 here could equally mean agent_tasks (106) is absent rather than
        // agent_runs (107) -- the two classifiers share a code set and cannot tell them
        // apart -- but latching 107 is the right outcome either way: agent_runs.task_id
        // is a FOREIGN KEY onto agent_tasks, so 107 cannot be applied without 106, and a
        // database missing 106 is necessarily missing 107 too. Contrast
        // enqueueCommissionedTasks above, where the query touches agent_tasks ALONE and
        // consulting the 107 latch would therefore be a genuine cross-wire.
        // The extra embedded `agent_tasks` key this puts on the row object is harmless
        // where `candidate` is spread into rowToRun a few lines down -- rowToRun reads
        // only its own named fields and ignores anything else present on the object.
        .select('*, agent_tasks!inner(is_test)')
        .eq('status', 'pending')
        .eq('agent_tasks.is_test', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (isRunSchemaMissing(error)) {
          latchRunSchemaUnavailable('drainAgentRuns');
          return processed;
        }
        throw new Error(`Failed to read pending agent_runs: ${error.message}`);
      }
      candidate = (data as AgentRunRow | null) ?? null;
    } catch (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('drainAgentRuns');
        return processed;
      }
      throw error;
    }

    if (!candidate) break;

    const claimed = await claimRun(admin, candidate.id, candidate.attempt_count);
    if (!claimed) continue; // another worker won the race -- try the next candidate

    const run = rowToRun({
      ...candidate,
      status: 'processing',
      attempt_count: candidate.attempt_count + 1,
      claimed_at: new Date().toISOString(),
    });

    try {
      await advanceRun(admin, run, activeExecutor);
    } catch (error) {
      console.error(`Agent run ${run.id} threw while advancing:`, error instanceof Error ? error.stack ?? error.message : error);
      await handleStageFailure(
        admin,
        run,
        error instanceof Error ? error.message : 'Unknown orchestrator error.',
        undefined,
        error
      ).catch(() => {});
    }

    processed += 1;
  }

  return processed;
}

// ── Admin-facing reads and actions (app/actions/agentic-runs.ts delegates to these) ──

export interface AgentRunListFilters {
  status?: AgentRunStatus;
  stage?: AgentRunStage;
  taskId?: string;
  personaId?: string;
}

export async function listRuns(filters: AgentRunListFilters = {}): Promise<AgentRun[]> {
  if (runSchemaUnavailable) return [];

  try {
    const admin = createAdminClient();
    let query = admin.from('agent_runs').select('*').order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.stage) query = query.eq('stage', filters.stage);
    if (filters.taskId) query = query.eq('task_id', filters.taskId);
    if (filters.personaId) query = query.eq('persona_id', filters.personaId);

    const { data, error } = await query;
    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('listRuns');
        return [];
      }
      throw new Error(`Failed to list agent_runs: ${error.message}`);
    }

    return ((data ?? []) as AgentRunRow[]).map(rowToRun);
  } catch (error) {
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('listRuns');
      return [];
    }
    throw error;
  }
}

export interface AgentRunWithTimeline extends AgentRun {
  events: AgentRunEvent[];
}

/** One run plus its full agent_run_events timeline, oldest first. */
export async function getRun(id: string): Promise<AgentRunWithTimeline | null> {
  if (runSchemaUnavailable) return null;

  try {
    const admin = createAdminClient();
    const { data: runData, error: runError } = await admin.from('agent_runs').select('*').eq('id', id).maybeSingle();

    if (runError) {
      if (isRunSchemaMissing(runError)) {
        latchRunSchemaUnavailable('getRun');
        return null;
      }
      throw new Error(`Failed to read agent_run: ${runError.message}`);
    }
    if (!runData) return null;

    const { data: eventRows, error: eventsError } = await admin
      .from('agent_run_events')
      .select('*')
      .eq('run_id', id)
      .order('created_at', { ascending: true });

    if (eventsError) {
      if (isRunSchemaMissing(eventsError)) {
        latchRunSchemaUnavailable('getRun (events)');
        return { ...rowToRun(runData as AgentRunRow), events: [] };
      }
      throw new Error(`Failed to read agent_run_events: ${eventsError.message}`);
    }

    return {
      ...rowToRun(runData as AgentRunRow),
      events: ((eventRows ?? []) as AgentRunEventRow[]).map(rowToEvent),
    };
  } catch (error) {
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('getRun');
      return null;
    }
    throw error;
  }
}

/** Cancels a run outright, regardless of its current stage or status. */
export async function cancelRun(id: string): Promise<AgentRun> {
  if (runSchemaUnavailable) throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('agent_runs')
      .update({ status: 'cancelled', stage: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('cancelRun');
        throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to cancel agent_run: ${error.message}`);
    }

    const run = rowToRun(data as AgentRunRow);
    await appendRunEvent(run.id, 'cancelled', 'warn', 'Run cancelled by an admin.');
    await setTaskStatus(admin, run.taskId, 'cancelled', 'cancelRun');
    return run;
  } catch (error) {
    if (error instanceof Error && error.message === RUN_SCHEMA_UNAVAILABLE_MESSAGE) throw error;
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('cancelRun');
      throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

/**
 * Manually resumes a failed or cancelled run. checkpoint is left exactly as it is --
 * resuming from where it stopped, never restarting from 'queued', is the entire point
 * of the checkpoint contract. attempt_count IS reset to 0 here, unlike the automatic
 * retry-on-failure path in handleStageFailure: an admin choosing to retry has looked at
 * the failure and decided it deserves a fresh budget of attempts, which is a
 * deliberately different decision from the automatic path silently reusing the same
 * counter toward the same cap.
 *
 * `stage` is a different story. handleStageFailure sets stage: 'failed' on permanent
 * failure, and 'failed' is a TERMINAL_STAGES member -- nextStage('failed') has no
 * successor. Left alone, this run would come back as 'pending' sitting on a terminal
 * stage, and advanceRun's very next loop iteration would read that as "nothing left to
 * do" and close it out as 'succeeded' without calling the executor even once: no work
 * done, the failure reason erased, and the run painted green. So a run parked on a
 * terminal stage has its stage recomputed via resumeStageFromCheckpoint, which walks
 * STAGE_SEQUENCE and returns the last stage this run's own checkpoint actually proves
 * it reached -- still never re-executing a checkpointed stage (isCheckpointed is
 * unaffected by this), just putting `stage` somewhere nextStage() can move it forward
 * from. A run whose stage was already non-terminal (there is no first-party path that
 * produces one today, but a future caller might) is left untouched.
 */
export async function retryRun(id: string): Promise<AgentRun> {
  if (runSchemaUnavailable) throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const admin = createAdminClient();
    const { data: existing, error: fetchError } = await admin.from('agent_runs').select('*').eq('id', id).maybeSingle();

    if (fetchError) {
      if (isRunSchemaMissing(fetchError)) {
        latchRunSchemaUnavailable('retryRun');
        throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to read agent_run for retry: ${fetchError.message}`);
    }
    if (!existing) throw new Error(`No agent_run found with id ${id}.`);

    const current = rowToRun(existing as AgentRunRow);
    if (current.status === 'pending' || current.status === 'processing') {
      throw new Error(`Run ${id} is already ${current.status}; it cannot be retried.`);
    }

    // See this function's doc comment: a run parked on a terminal stage (the
    // permanent-failure path always leaves one on 'failed') must have its
    // stage moved off that terminal value or advanceRun will treat it as
    // already finished and mark it 'succeeded' without doing any work.
    const stageUpdate: Partial<Record<'stage', AgentRunStage>> = isTerminalStage(current.stage)
      ? { stage: resumeStageFromCheckpoint(current.checkpoint) }
      : {};

    const { data, error } = await admin
      .from('agent_runs')
      .update({
        status: 'pending',
        attempt_count: 0,
        claimed_at: null,
        error_category: null,
        error_detail: null,
        finished_at: null,
        ...stageUpdate,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (isRunSchemaMissing(error)) {
        latchRunSchemaUnavailable('retryRun');
        throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to retry agent_run: ${error.message}`);
    }

    const run = rowToRun(data as AgentRunRow);
    await appendRunEvent(run.id, run.stage, 'info', 'Run manually retried by an admin; resuming from its last checkpoint.');
    await setTaskStatus(admin, run.taskId, 'running', 'retryRun');
    return run;
  } catch (error) {
    if (error instanceof Error && (error.message === RUN_SCHEMA_UNAVAILABLE_MESSAGE || error.message.includes('cannot be retried'))) {
      throw error;
    }
    if (isRunSchemaMissing(error)) {
      latchRunSchemaUnavailable('retryRun');
      throw new Error(RUN_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}
