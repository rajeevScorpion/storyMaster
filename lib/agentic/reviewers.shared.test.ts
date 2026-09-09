import { describe, expect, it } from 'vitest';
import {
  canPublish,
  canTriggerMedia,
  canTriggerMediaForEditAccess,
  decideStoryEditAccess,
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

// Unit 9b (D14): the owner-vs-reviewer-vs-stranger decision behind
// assertCanEditStory. This is the three-way branch the brief calls out as
// the subtlety that matters most, so it's tested directly and independent
// of any database.
describe('decideStoryEditAccess', () => {
  const OWNER = 'owner-1';
  const OTHER_USER = 'someone-else';

  it('grants the owner access, even with no reviewer row at all', () => {
    // The load-bearing case: an ordinary user with zero rows in
    // agent_reviewers must still be able to edit their OWN story.
    const grant = decideStoryEditAccess({
      userId: OWNER,
      storyUserId: OWNER,
      agentPersonaId: null,
      reviewer: null,
    });
    expect(grant).toEqual({ granted: true, via: 'owner' });
  });

  it('grants the owner access to their own AGENT-owned story with no reviewer row', () => {
    // Same case, but on an agent-owned story -- ownership must still win
    // outright, without ever touching reviewer status.
    const grant = decideStoryEditAccess({
      userId: OWNER,
      storyUserId: OWNER,
      agentPersonaId: 'persona-1',
      reviewer: null,
    });
    expect(grant).toEqual({ granted: true, via: 'owner' });
  });

  it('grants an active reviewer access to an agent-owned story they do not own', () => {
    const reviewer: AgentReviewer = {
      userId: OTHER_USER,
      status: 'active',
      canPublish: false,
      canTriggerMedia: true,
      displayName: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: null,
    };
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: 'persona-1',
      reviewer,
    });
    expect(grant).toEqual({ granted: true, via: 'reviewer', reviewer });
  });

  it('denies a reviewer with no standing over an ordinary (non-agent) story', () => {
    const reviewer: AgentReviewer = {
      userId: OTHER_USER,
      status: 'active',
      canPublish: true,
      canTriggerMedia: true,
      displayName: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: null,
    };
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: null,
      reviewer,
    });
    expect(grant).toEqual({ granted: false });
  });

  it('denies a suspended reviewer on an agent-owned story', () => {
    const reviewer: AgentReviewer = {
      userId: OTHER_USER,
      status: 'suspended',
      canPublish: true,
      canTriggerMedia: true,
      displayName: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: null,
    };
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: 'persona-1',
      reviewer,
    });
    expect(grant).toEqual({ granted: false });
  });

  it('denies a plain stranger (no reviewer row, not the owner) on an agent-owned story', () => {
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: 'persona-1',
      reviewer: null,
    });
    expect(grant).toEqual({ granted: false });
  });

  it('denies a plain stranger on an ordinary story', () => {
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: null,
      reviewer: null,
    });
    expect(grant).toEqual({ granted: false });
  });
});

// Unit 9b (D14): the capability check that must run AFTER edit access is
// already decided, and must be skipped entirely for the owner branch.
describe('canTriggerMediaForEditAccess', () => {
  it('is true for the owner branch (reviewer === null) with no capability check at all', () => {
    // This is the case the brief calls out explicitly: an ordinary owner
    // has no agent_reviewers row, so canTriggerMedia(null) is false -- but
    // that must never be consulted for an owner. reviewer === null here
    // means "granted as owner", not "no row", per assertCanEditStory's
    // contract, and this function must read it that way.
    expect(canTriggerMediaForEditAccess(null)).toBe(true);
  });

  it('is true for an active reviewer with can_trigger_media', () => {
    const reviewer: AgentReviewer = {
      userId: 'reviewer-1',
      status: 'active',
      canPublish: false,
      canTriggerMedia: true,
      displayName: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: null,
    };
    expect(canTriggerMediaForEditAccess(reviewer)).toBe(true);
  });

  it('is false for an active reviewer without can_trigger_media', () => {
    const reviewer: AgentReviewer = {
      userId: 'reviewer-1',
      status: 'active',
      canPublish: true,
      canTriggerMedia: false,
      displayName: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: null,
    };
    expect(canTriggerMediaForEditAccess(reviewer)).toBe(false);
  });

  it('is false for a suspended reviewer even with can_trigger_media true', () => {
    const reviewer: AgentReviewer = {
      userId: 'reviewer-1',
      status: 'suspended',
      canPublish: false,
      canTriggerMedia: true,
      displayName: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: null,
    };
    expect(canTriggerMediaForEditAccess(reviewer)).toBe(false);
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
