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
  RUN_STALE_AFTER_MS,
  RUN_TIME_BUDGET_MS,
  classifyRunError,
  isCheckpointed,
  isMissingRunSchemaError,
  isRunStale,
  isTerminalStage,
  nextStage,
  recordCheckpoint,
  shouldRetry,
  type AgentRunCheckpoint,
  type AgentRunStage,
  type AgentRunStatus,
} from '@/lib/agentic/orchestrator.shared';

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
  return rowToRun(data as AgentRunRow);
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
}

/**
 * Drives one claimed run forward as far as it can go in this pass: for each stage
 * still ahead of it, a stage already present in checkpoint is applied for free (no
 * executor call, no re-billed model call -- this is the idempotency contract in
 * action); the first stage NOT yet checkpointed is handed to `executor`. Stops at the
 * first 'deferred' or 'failed' outcome, or once a terminal stage is reached.
 */
async function advanceRun(admin: AdminClient, initialRun: AgentRun, executor: StageExecutor): Promise<void> {
  let run = initialRun;

  for (;;) {
    const target = nextStage(run.stage);
    if (!target) {
      // Defensive: a claimed 'pending' run should never already sit on a terminal
      // stage, but if it does, there is nothing left to do but close it out cleanly.
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
      continue;
    }

    if (outcome.kind === 'deferred') {
      await appendRunEvent(run.id, run.stage, 'info', outcome.message, outcome.metadata);
      await returnRunToPending(admin, run);
      return;
    }

    // outcome.kind === 'failed'
    await handleStageFailure(admin, run, outcome.message, outcome.metadata, outcome.error);
    return;
  }
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
 * Reclaims stale runs, then claims and advances pending runs one at a time until
 * `budgetMs` is spent. Returns how many runs were claimed and processed in this call
 * (regardless of whether each one succeeded, deferred, or failed) -- the same
 * "processed" semantics as runImageGenerationJobs's result.
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

  while (Date.now() - startedAt < budgetMs) {
    let candidate: AgentRunRow | null;
    try {
      const { data, error } = await admin
        .from('agent_runs')
        .select('*')
        .eq('status', 'pending')
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
 * Manually resumes a failed or cancelled run. Stage and checkpoint are left exactly as
 * they are -- resuming from where it stopped, never restarting from 'queued', is the
 * entire point of the checkpoint contract. attempt_count IS reset to 0 here, unlike the
 * automatic retry-on-failure path in handleStageFailure: an admin choosing to retry has
 * looked at the failure and decided it deserves a fresh budget of attempts, which is a
 * deliberately different decision from the automatic path silently reusing the same
 * counter toward the same cap.
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

    const { data, error } = await admin
      .from('agent_runs')
      .update({
        status: 'pending',
        attempt_count: 0,
        claimed_at: null,
        error_category: null,
        error_detail: null,
        finished_at: null,
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
