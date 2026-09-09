import { describe, expect, it } from 'vitest';
import {
  decideReviewTransition,
  isMissingReviewDecisionSchemaError,
} from './review-decisions.shared';

describe('decideReviewTransition', () => {
  it('approved: leaves the run untouched and marks the task approved', () => {
    expect(decideReviewTransition('approved')).toEqual({
      run: null,
      taskStatus: 'approved',
    });
  });

  it('rewrite_requested: changes no state at all', () => {
    expect(decideReviewTransition('rewrite_requested')).toEqual({
      run: null,
      taskStatus: null,
    });
  });

  it('rejected: cancels the run and marks the task rejected (not cancelled)', () => {
    expect(decideReviewTransition('rejected')).toEqual({
      run: { stage: 'cancelled', status: 'cancelled' },
      taskStatus: 'rejected',
    });
  });

  // Load-bearing distinction: an operator abandoning a run (cancelAgentTask/cancelRun)
  // writes agent_tasks.status = 'cancelled'; a reviewer's editorial rejection must write
  // 'rejected' instead, never reuse 'cancelled' -- otherwise the two are indistinguishable
  // in the task history.
  it('never produces taskStatus "cancelled" for any decision', () => {
    const kinds = ['approved', 'rewrite_requested', 'rejected'] as const;
    for (const kind of kinds) {
      expect(decideReviewTransition(kind).taskStatus).not.toBe('cancelled');
    }
  });

  // approved must never advance the run into 'media_pending' or 'complete' -- both are
  // reserved for the (unbuilt) publish flow, and 'media_pending' has no consumer at all
  // (verified: no worker, no cron drains it). Asserting `run: null` here is what proves
  // approval never touches agent_runs.stage.
  it('approved never advances agent_runs.stage', () => {
    expect(decideReviewTransition('approved').run).toBeNull();
  });
});

describe('isMissingReviewDecisionSchemaError', () => {
  it('is true for undefined_table (42P01)', () => {
    expect(isMissingReviewDecisionSchemaError({ code: '42P01' })).toBe(true);
  });

  it('is true for undefined_column (42703)', () => {
    expect(isMissingReviewDecisionSchemaError({ code: '42703' })).toBe(true);
  });

  it('is true for PostgREST schema-cache misses (PGRST200, PGRST204)', () => {
    expect(isMissingReviewDecisionSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingReviewDecisionSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('is false for an unrelated error code', () => {
    expect(isMissingReviewDecisionSchemaError({ code: '23505', message: 'duplicate key' })).toBe(false);
  });

  it('is false for null and undefined', () => {
    expect(isMissingReviewDecisionSchemaError(null)).toBe(false);
    expect(isMissingReviewDecisionSchemaError(undefined)).toBe(false);
  });

  it('is false for an error with no code at all', () => {
    expect(isMissingReviewDecisionSchemaError({ message: 'something else broke' })).toBe(false);
  });
});
