import { describe, expect, it } from 'vitest';
import { isMissingAssignmentSchemaError } from './review-routing.shared';

// Migration 114's OWN latch/classifier (Unit 9i). Per GOTCHAS.md ("Column-availability
// latches are per migration group"), this must never be the same function as
// isMissingReviewerSchemaError (111), isMissingReviewDecisionSchemaError (112), or
// isMissingRunSchemaError (107) -- even though all four accept an identical code set.
describe('isMissingAssignmentSchemaError', () => {
  it('recognizes undefined_table (42P01)', () => {
    expect(isMissingAssignmentSchemaError({ code: '42P01' })).toBe(true);
  });

  it('recognizes undefined_column (42703)', () => {
    expect(isMissingAssignmentSchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes the PostgREST schema-cache codes', () => {
    expect(isMissingAssignmentSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingAssignmentSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  // The bug this guards against: a real constraint violation (e.g. the status/source
  // CHECK constraints, or the one-active-assignment-per-task unique index) must never
  // be misreported as "migration 114 not applied".
  it('does not treat a check-constraint violation as a missing schema', () => {
    expect(
      isMissingAssignmentSchemaError({
        code: '23514',
        message: 'new row for relation "agent_review_assignments" violates check constraint "agent_review_assignments_status_check"',
      })
    ).toBe(false);
  });

  it('does not treat the one-active-assignment unique violation as a missing schema', () => {
    expect(
      isMissingAssignmentSchemaError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "agent_review_assignments_one_active_idx"',
      })
    ).toBe(false);
  });

  it('does not misclassify an unrelated error that happens to name the table', () => {
    expect(
      isMissingAssignmentSchemaError({
        code: '23503',
        message: 'insert or update on table "agent_review_assignments" violates foreign key constraint',
      })
    ).toBe(false);
  });

  it('returns false for a null/undefined error', () => {
    expect(isMissingAssignmentSchemaError(null)).toBe(false);
    expect(isMissingAssignmentSchemaError(undefined)).toBe(false);
  });
});
