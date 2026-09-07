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
  shouldRetry,
  type AgentRunCheckpoint,
  type AgentRunStage,
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
