import { describe, expect, it } from 'vitest';
import {
  canPublish,
  canTriggerMedia,
  isActiveReviewer,
  isMissingReviewerSchemaError,
  type AgentReviewer,
} from './reviewers.shared';

function reviewer(overrides: Partial<AgentReviewer> = {}): AgentReviewer {
  return {
    userId: 'reviewer-1',
    status: 'active',
    canPublish: false,
    canTriggerMedia: false,
    displayName: 'Test Reviewer',
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: null,
    ...overrides,
  };
}

describe('isActiveReviewer', () => {
  it('is true for an active reviewer', () => {
    expect(isActiveReviewer(reviewer({ status: 'active' }))).toBe(true);
  });

  it('is false for a suspended reviewer', () => {
    expect(isActiveReviewer(reviewer({ status: 'suspended' }))).toBe(false);
  });

  it('is false for null and undefined (no row)', () => {
    expect(isActiveReviewer(null)).toBe(false);
    expect(isActiveReviewer(undefined)).toBe(false);
  });
});

describe('canPublish', () => {
  it('is true only when active AND can_publish', () => {
    expect(canPublish(reviewer({ status: 'active', canPublish: true }))).toBe(true);
  });

  it('is false when active but can_publish is false', () => {
    expect(canPublish(reviewer({ status: 'active', canPublish: false }))).toBe(false);
  });

  // The load-bearing case: suspension must win over a true capability column --
  // suspending a reviewer must never leave their publish right silently active.
  it('is false when suspended even though can_publish is true', () => {
    expect(canPublish(reviewer({ status: 'suspended', canPublish: true }))).toBe(false);
  });

  it('is false for null and undefined (no row)', () => {
    expect(canPublish(null)).toBe(false);
    expect(canPublish(undefined)).toBe(false);
  });
});

describe('canTriggerMedia', () => {
  it('is true only when active AND can_trigger_media', () => {
    expect(canTriggerMedia(reviewer({ status: 'active', canTriggerMedia: true }))).toBe(true);
  });

  it('is false when active but can_trigger_media is false', () => {
    expect(canTriggerMedia(reviewer({ status: 'active', canTriggerMedia: false }))).toBe(false);
  });

  it('is false when suspended even though can_trigger_media is true', () => {
    expect(canTriggerMedia(reviewer({ status: 'suspended', canTriggerMedia: true }))).toBe(false);
  });

  it('is false for null and undefined (no row)', () => {
    expect(canTriggerMedia(null)).toBe(false);
    expect(canTriggerMedia(undefined)).toBe(false);
  });
});

describe('isMissingReviewerSchemaError', () => {
  it('recognizes undefined_table (42P01)', () => {
    expect(isMissingReviewerSchemaError({ code: '42P01' })).toBe(true);
  });

  it('recognizes undefined_column (42703)', () => {
    expect(isMissingReviewerSchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes the PostgREST schema-cache codes', () => {
    expect(isMissingReviewerSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingReviewerSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  // The bug this guards against: a real constraint violation (e.g. the status
  // CHECK constraint) must never be misreported as "migration 111 not applied".
  it('does not treat a check-constraint violation as a missing schema', () => {
    expect(
      isMissingReviewerSchemaError({
        code: '23514',
        message: 'new row for relation "agent_reviewers" violates check constraint "agent_reviewers_status_check"',
      })
    ).toBe(false);
  });

  it('does not misclassify an unrelated error that happens to name the table', () => {
    expect(
      isMissingReviewerSchemaError({ code: '23505', message: 'duplicate key value violates unique constraint "agent_reviewers_pkey"' })
    ).toBe(false);
  });

  it('returns false for a null/undefined error', () => {
    expect(isMissingReviewerSchemaError(null)).toBe(false);
    expect(isMissingReviewerSchemaError(undefined)).toBe(false);
  });
});
