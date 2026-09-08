import { describe, expect, it } from 'vitest';
import {
  AgentModelCallError,
  AgentValidationError,
  MAX_RUN_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  RUN_STALE_AFTER_MS,
  STAGE_SEQUENCE,
  classifyRunError,
  isCheckpointed,
  isMissingRunSchemaError,
  isRunStale,
  isTerminalStage,
  nextAttemptDelayMs,
  nextStage,
  recordCheckpoint,
  resumeStageFromCheckpoint,
  selectTasksToEnqueue,
  shouldRetry,
  type AgentRunCheckpoint,
  type AgentRunStage,
  type EnqueueCandidateTask,
} from './orchestrator.shared';

describe('checkpoint contract — the load-bearing idempotency guarantee', () => {
  it('a stage present in checkpoint is reported as already executed, and must never be re-run', () => {
    const checkpoint: AgentRunCheckpoint = { brief_ready: { workingTitle: 'Test' } };
    expect(isCheckpointed(checkpoint, 'brief_ready')).toBe(true);

    // The contract in practice: a caller branches on isCheckpointed() before doing any
    // expensive work. Simulate that branch directly so a regression here fails loudly.
    let modelCalls = 0;
    function maybeRunStage(cp: AgentRunCheckpoint, stage: AgentRunStage): void {
      if (isCheckpointed(cp, stage)) return; // must short-circuit, no model call
      modelCalls += 1;
    }
    maybeRunStage(checkpoint, 'brief_ready');
    expect(modelCalls).toBe(0);
  });

  it('a stage absent from checkpoint is reported as not yet executed', () => {
    expect(isCheckpointed({}, 'brief_ready')).toBe(false);
    expect(isCheckpointed({ brief_ready: {} }, 'novelty_checked')).toBe(false);
  });

  it('recordCheckpoint does not mutate its input', () => {
    const original: AgentRunCheckpoint = { brief_ready: { a: 1 } };
    const frozen = Object.freeze({ ...original });
    const result = recordCheckpoint(frozen, 'novelty_checked', { verdict: 'clear' });

    expect(frozen).toEqual({ brief_ready: { a: 1 } }); // untouched
    expect(result).not.toBe(frozen); // new object
    expect(result).toEqual({ brief_ready: { a: 1 }, novelty_checked: { verdict: 'clear' } });
  });

  it('recordCheckpoint on an empty checkpoint produces a fresh single-key object', () => {
    const result = recordCheckpoint({}, 'queued', { at: 'now' });
    expect(result).toEqual({ queued: { at: 'now' } });
  });

  it('recordCheckpoint overwrites an existing entry for the same stage rather than merging into it', () => {
    const original: AgentRunCheckpoint = { brief_ready: { version: 1 } };
    const result = recordCheckpoint(original, 'brief_ready', { version: 2 });
    expect(result.brief_ready).toEqual({ version: 2 });
  });
});

describe('resumeStageFromCheckpoint — where retryRun resumes a run parked on a terminal stage', () => {
  it('an empty checkpoint resumes at the very start of the pipeline: queued', () => {
    expect(resumeStageFromCheckpoint({})).toBe('queued');
  });

  it('an unrecognized key alone resumes at queued -- it proves nothing about real progress', () => {
    expect(resumeStageFromCheckpoint({ some_random_key: { anything: true } })).toBe('queued');
  });

  // This is the exact shape that killed run b7ac6093: story_generated_progress is
  // story-assembly.ts's intra-stage progress side-channel (STORY_PROGRESS_CHECKPOINT_KEY),
  // written into this same checkpoint object but NOT a stage name and NOT a member of
  // STAGE_SEQUENCE. A naive "last key in the object" would pick it up as if it were the
  // furthest-reached stage and resume in the wrong place (or not resolve to a real stage
  // at all). The correct answer here is novelty_checked -- the last REAL stage present.
  it('a checkpoint holding brief_ready, novelty_checked and story_generated_progress resumes at novelty_checked', () => {
    const checkpoint: AgentRunCheckpoint = {
      brief_ready: { workingTitle: 'Test' },
      novelty_checked: { verdict: 'clear' },
      story_generated_progress: { completedBeats: [{ beatNumber: 1 }] },
    };
    expect(resumeStageFromCheckpoint(checkpoint)).toBe('novelty_checked');
  });

  it('a checkpoint carrying every stage through the automatic pipeline resumes at the last one', () => {
    const checkpoint: AgentRunCheckpoint = {
      queued: {},
      brief_ready: {},
      novelty_checked: {},
      story_generated: {},
      draft_created: {},
      narration_pending: {},
      narration_complete: {},
      evaluated: {},
    };
    expect(resumeStageFromCheckpoint(checkpoint)).toBe('evaluated');
  });

  it('is not fooled by insertion order -- STAGE_SEQUENCE order decides the "last" stage, not object key order', () => {
    const checkpoint: AgentRunCheckpoint = {
      novelty_checked: {},
      brief_ready: {}, // inserted after novelty_checked, but earlier in STAGE_SEQUENCE
    };
    expect(resumeStageFromCheckpoint(checkpoint)).toBe('novelty_checked');
  });
});

describe('stage machine — ordering and terminality', () => {
  it('advances the full automatic pipeline in order, queued through awaiting_review', () => {
    const automaticPipeline: AgentRunStage[] = [
      'queued',
      'brief_ready',
      'novelty_checked',
      'story_generated',
      'draft_created',
      'narration_pending',
      'narration_complete',
      'evaluated',
      'awaiting_review',
    ];
    for (let i = 0; i < automaticPipeline.length - 1; i += 1) {
      expect(nextStage(automaticPipeline[i])).toBe(automaticPipeline[i + 1]);
    }
  });

  it('every terminal stage returns no successor', () => {
    const terminalStages: AgentRunStage[] = ['awaiting_review', 'complete', 'failed', 'cancelled'];
    for (const stage of terminalStages) {
      expect(isTerminalStage(stage)).toBe(true);
      expect(nextStage(stage)).toBeUndefined();
    }
  });

  it('a non-terminal stage is never reported as terminal', () => {
    const nonTerminal: AgentRunStage[] = [
      'queued', 'brief_ready', 'novelty_checked', 'story_generated', 'draft_created',
      'narration_pending', 'narration_complete', 'evaluated', 'media_pending',
    ];
    for (const stage of nonTerminal) {
      expect(isTerminalStage(stage)).toBe(false);
    }
  });

  it('media_pending (reviewer-driven, post awaiting_review) still advances to complete', () => {
    expect(nextStage('media_pending')).toBe('complete');
  });

  it('STAGE_SEQUENCE contains every stage exactly once, matching the migration CHECK constraint', () => {
    const expected: AgentRunStage[] = [
      'queued', 'brief_ready', 'novelty_checked', 'story_generated', 'draft_created',
      'narration_pending', 'narration_complete', 'evaluated', 'awaiting_review',
      'media_pending', 'complete', 'failed', 'cancelled',
    ];
    expect([...STAGE_SEQUENCE]).toEqual(expected);
    expect(new Set(STAGE_SEQUENCE).size).toBe(STAGE_SEQUENCE.length);
  });
});

describe('shouldRetry / nextAttemptDelayMs', () => {
  it('allows a retry while attemptCount is below maxAttempts', () => {
    expect(shouldRetry({ attemptCount: 0, maxAttempts: MAX_RUN_ATTEMPTS })).toBe(true);
    expect(shouldRetry({ attemptCount: 1, maxAttempts: MAX_RUN_ATTEMPTS })).toBe(true);
    expect(shouldRetry({ attemptCount: 2, maxAttempts: MAX_RUN_ATTEMPTS })).toBe(true);
  });

  it('is false once attemptCount reaches maxAttempts', () => {
    expect(shouldRetry({ attemptCount: 3, maxAttempts: MAX_RUN_ATTEMPTS })).toBe(false);
  });

  it('is false once attemptCount exceeds maxAttempts', () => {
    expect(shouldRetry({ attemptCount: 5, maxAttempts: MAX_RUN_ATTEMPTS })).toBe(false);
  });

  it('backs off exponentially and never exceeds RETRY_MAX_DELAY_MS', () => {
    const first = nextAttemptDelayMs(1);
    const second = nextAttemptDelayMs(2);
    const third = nextAttemptDelayMs(3);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(nextAttemptDelayMs(20)).toBe(RETRY_MAX_DELAY_MS);
  });

  it('is deterministic for the same input', () => {
    expect(nextAttemptDelayMs(2)).toBe(nextAttemptDelayMs(2));
  });
});

describe('isRunStale — boundary conditions', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');

  it('is false just under the staleness threshold', () => {
    const claimedAt = new Date(now - (RUN_STALE_AFTER_MS - 1)).toISOString();
    expect(isRunStale({ status: 'processing', claimedAt }, now, RUN_STALE_AFTER_MS)).toBe(false);
  });

  it('is false exactly at the staleness threshold (strict greater-than only)', () => {
    const claimedAt = new Date(now - RUN_STALE_AFTER_MS).toISOString();
    expect(isRunStale({ status: 'processing', claimedAt }, now, RUN_STALE_AFTER_MS)).toBe(false);
  });

  it('is true just over the staleness threshold', () => {
    const claimedAt = new Date(now - (RUN_STALE_AFTER_MS + 1)).toISOString();
    expect(isRunStale({ status: 'processing', claimedAt }, now, RUN_STALE_AFTER_MS)).toBe(true);
  });

  it('is false for a non-processing run regardless of age', () => {
    const claimedAt = new Date(now - RUN_STALE_AFTER_MS * 10).toISOString();
    expect(isRunStale({ status: 'pending', claimedAt }, now, RUN_STALE_AFTER_MS)).toBe(false);
    expect(isRunStale({ status: 'succeeded', claimedAt }, now, RUN_STALE_AFTER_MS)).toBe(false);
  });

  it('is false when claimedAt is null', () => {
    expect(isRunStale({ status: 'processing', claimedAt: null }, now, RUN_STALE_AFTER_MS)).toBe(false);
  });
});

describe('classifyRunError', () => {
  it('classifies a missing-schema Postgres/PostgREST error, taking priority over any other signal', () => {
    expect(classifyRunError({ code: '42P01' })).toBe('schema_missing');
    expect(classifyRunError({ code: '42703' })).toBe('schema_missing');
    expect(classifyRunError({ code: 'PGRST200' })).toBe('schema_missing');
    expect(classifyRunError({ code: 'PGRST204' })).toBe('schema_missing');
  });

  it('classifies a tagged model-call failure', () => {
    expect(classifyRunError(new AgentModelCallError('provider returned no result'))).toBe('model_call_failed');
  });

  it('classifies a tagged validation failure', () => {
    expect(classifyRunError(new AgentValidationError('missing required field'))).toBe('validation_failed');
  });

  it('classifies an AbortSignal.timeout()-style error', () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    expect(classifyRunError(timeoutError)).toBe('timeout');

    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    expect(classifyRunError(abortError)).toBe('timeout');
  });

  it('does not classify by message text — an ordinary Error naming a known category in prose stays unknown', () => {
    expect(classifyRunError(new Error('42P01: relation does not exist'))).toBe('unknown');
    expect(classifyRunError(new Error('the model call failed'))).toBe('unknown');
  });

  it('never throws, and lands an unrecognised error in "unknown"', () => {
    expect(classifyRunError(new Error('something odd'))).toBe('unknown');
    expect(classifyRunError('a bare string')).toBe('unknown');
    expect(classifyRunError(null)).toBe('unknown');
    expect(classifyRunError(undefined)).toBe('unknown');
    expect(classifyRunError({ weird: 'shape' })).toBe('unknown');
    expect(() => classifyRunError(42)).not.toThrow();
  });
});

describe('isMissingRunSchemaError', () => {
  it('recognizes the four schema-unavailable codes', () => {
    expect(isMissingRunSchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingRunSchemaError({ code: '42703' })).toBe(true);
    expect(isMissingRunSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingRunSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('does not match on message text alone', () => {
    expect(
      isMissingRunSchemaError({
        code: '23514',
        message: 'new row for relation "agent_runs" violates check constraint "agent_runs_stage_check"',
      })
    ).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isMissingRunSchemaError(null)).toBe(false);
    expect(isMissingRunSchemaError(undefined)).toBe(false);
  });
});

describe('selectTasksToEnqueue — commissioned-task eligibility policy', () => {
  const activePersonas = new Set(['persona-a', 'persona-b']);

  function task(id: string, personaId: string | null, createdAt: string): EnqueueCandidateTask {
    return { id, personaId, createdAt };
  }

  it('an empty input yields an empty array', () => {
    expect(selectTasksToEnqueue([], activePersonas, 10)).toEqual([]);
  });

  it('a task with personaId === null is never eligible', () => {
    const tasks = [task('t1', null, '2026-09-01T00:00:00.000Z')];
    expect(selectTasksToEnqueue(tasks, activePersonas, 10)).toEqual([]);
  });

  it('a task whose personaId is not in activePersonaIds is never eligible', () => {
    const tasks = [task('t1', 'persona-inactive', '2026-09-01T00:00:00.000Z')];
    expect(selectTasksToEnqueue(tasks, activePersonas, 10)).toEqual([]);
  });

  it('orders eligible tasks oldest createdAt first', () => {
    const newest = task('t-newest', 'persona-a', '2026-09-03T00:00:00.000Z');
    const oldest = task('t-oldest', 'persona-a', '2026-09-01T00:00:00.000Z');
    const middle = task('t-middle', 'persona-b', '2026-09-02T00:00:00.000Z');

    const result = selectTasksToEnqueue([newest, oldest, middle], activePersonas, 10);
    expect(result.map((t) => t.id)).toEqual(['t-oldest', 't-middle', 't-newest']);
  });

  it('breaks ties on equal createdAt by id, deterministically regardless of input order', () => {
    const sameTime = '2026-09-01T00:00:00.000Z';
    const b = task('b-task', 'persona-a', sameTime);
    const a = task('a-task', 'persona-b', sameTime);
    const c = task('c-task', 'persona-a', sameTime);

    const forward = selectTasksToEnqueue([b, a, c], activePersonas, 10).map((t) => t.id);
    const reversed = selectTasksToEnqueue([c, a, b], activePersonas, 10).map((t) => t.id);

    expect(forward).toEqual(['a-task', 'b-task', 'c-task']);
    expect(reversed).toEqual(['a-task', 'b-task', 'c-task']);
  });

  it('caps results at `limit`, keeping the oldest', () => {
    const tasks = [
      task('t1', 'persona-a', '2026-09-01T00:00:00.000Z'),
      task('t2', 'persona-a', '2026-09-02T00:00:00.000Z'),
      task('t3', 'persona-a', '2026-09-03T00:00:00.000Z'),
    ];
    expect(selectTasksToEnqueue(tasks, activePersonas, 2).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('limit of 0 yields an empty array, even with eligible tasks present', () => {
    const tasks = [task('t1', 'persona-a', '2026-09-01T00:00:00.000Z')];
    expect(selectTasksToEnqueue(tasks, activePersonas, 0)).toEqual([]);
  });

  it('a negative limit yields an empty array', () => {
    const tasks = [task('t1', 'persona-a', '2026-09-01T00:00:00.000Z')];
    expect(selectTasksToEnqueue(tasks, activePersonas, -5)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const tasks = [
      task('t2', 'persona-a', '2026-09-02T00:00:00.000Z'),
      task('t1', 'persona-a', '2026-09-01T00:00:00.000Z'),
    ];
    const original = [...tasks];
    selectTasksToEnqueue(tasks, activePersonas, 10);
    expect(tasks).toEqual(original);
  });
});
