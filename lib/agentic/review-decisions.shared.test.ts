import { describe, expect, it } from 'vitest';
import {
  canRecordDecisionForStage,
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

  // Unit 9e-ii (D15): publishing is the run's real terminal SUCCESS state, distinct from
  // 'rejected''s cancelled/cancelled pair -- see decideReviewTransition's own doc comment
  // for why 'published' (not 'approved', not 'cancelled') is the task-side word.
  it('published: completes the run and marks the task published', () => {
    expect(decideReviewTransition('published')).toEqual({
      run: { stage: 'complete', status: 'succeeded' },
      taskStatus: 'published',
    });
  });

  // Load-bearing distinction: an operator abandoning a run (cancelAgentTask/cancelRun)
  // writes agent_tasks.status = 'cancelled'; a reviewer's editorial rejection must write
  // 'rejected' instead, never reuse 'cancelled' -- otherwise the two are indistinguishable
  // in the task history. 'published' is included too: a published run must never be
  // mistakable for one an operator simply cancelled.
  it('never produces taskStatus "cancelled" for any decision', () => {
    const kinds = ['approved', 'rewrite_requested', 'rejected', 'published'] as const;
    for (const kind of kinds) {
      expect(decideReviewTransition(kind).taskStatus).not.toBe('cancelled');
    }
  });

  // approved must never advance the run into 'media_pending' or 'complete' -- 'complete' is
  // reserved for the publish flow (9e-ii), and 'media_pending' has no consumer at all
  // (verified: no worker, no cron drains it). Asserting `run: null` here is what proves
  // approval never touches agent_runs.stage. Unchanged by 9e-ii: this is the three
  // pre-existing decisions' behavior staying byte-identical.
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

describe('canRecordDecisionForStage', () => {
  it('allows a decision on a run still awaiting review', () => {
    expect(canRecordDecisionForStage('awaiting_review')).toBe(true);
  });

  it('refuses a decision on a run already cancelled by an earlier rejection', () => {
    // The two-reviewer race: A rejected the run, B's queue page is stale and still
    // lists it, B clicks approve. Without this guard B's write lands on a dead run.
    expect(canRecordDecisionForStage('cancelled')).toBe(false);
  });

  // The same race, one decision over: A published the run (stage -> 'complete'), B's page
  // is stale and still lists it, B clicks Publish too. This is the guard
  // recordReviewDecision (review-decisions.ts) re-checks right before its own writes --
  // see that function's doc comment for why publishRunAction ALSO pre-checks this before
  // creating the storyline, since by the time this function alone could refuse, the
  // storyline write may already be committed.
  it('refuses a decision on a run already completed by an earlier publish', () => {
    expect(canRecordDecisionForStage('complete')).toBe(false);
  });

  it('refuses a decision on every other stage in the sequence', () => {
    for (const stage of [
      'queued', 'brief_ready', 'novelty_checked', 'story_generated', 'draft_created',
      'narration_pending', 'narration_complete', 'evaluated', 'media_pending',
      'complete', 'failed',
    ]) {
      expect(canRecordDecisionForStage(stage)).toBe(false);
    }
  });

  it('does not block the rewrite-requested-then-approved sequence the unit must support', () => {
    // Neither decision moves the run (decideReviewTransition returns run: null for both),
    // so the stage is still 'awaiting_review' when the second one arrives.
    expect(decideReviewTransition('rewrite_requested').run).toBeNull();
    expect(canRecordDecisionForStage('awaiting_review')).toBe(true);
    expect(decideReviewTransition('approved').run).toBeNull();
    expect(canRecordDecisionForStage('awaiting_review')).toBe(true);
  });
});
