import { describe, expect, it } from 'vitest';
import {
  canAssignWork,
  canPublish,
  canTriggerMedia,
  canTriggerMediaForEditAccess,
  decideStoryEditAccess,
  isActiveReviewer,
  isMissingReviewerSchemaError,
  validateReviewerCoverage,
  type AgentReviewer,
} from './reviewers.shared';

function reviewer(overrides: Partial<AgentReviewer> = {}): AgentReviewer {
  return {
    userId: 'reviewer-1',
    status: 'active',
    role: 'reviewer',
    ageGroups: [],
    languages: [],
    genres: [],
    displayName: 'Test Reviewer',
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: null,
    updatedBy: null,
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

// D17: role is the only stored capability. can_publish / can_trigger_media are gone --
// these four describe blocks are the capability matrix from the migration 113 header,
// each one a row of: role x reviewer/editor x status active/suspended.
describe('canPublish', () => {
  it('is true for an active editor', () => {
    expect(canPublish(reviewer({ status: 'active', role: 'editor' }))).toBe(true);
  });

  it('is false for an active reviewer (not an editor)', () => {
    expect(canPublish(reviewer({ status: 'active', role: 'reviewer' }))).toBe(false);
  });

  // The load-bearing case: suspension must win over role -- suspending an editor
  // must never leave their publish right silently active.
  it('is false when suspended even though role is editor', () => {
    expect(canPublish(reviewer({ status: 'suspended', role: 'editor' }))).toBe(false);
  });

  it('is false for null and undefined (no row)', () => {
    expect(canPublish(null)).toBe(false);
    expect(canPublish(undefined)).toBe(false);
  });
});

describe('canTriggerMedia', () => {
  it('is true for an active reviewer', () => {
    expect(canTriggerMedia(reviewer({ status: 'active', role: 'reviewer' }))).toBe(true);
  });

  it('is true for an active editor', () => {
    expect(canTriggerMedia(reviewer({ status: 'active', role: 'editor' }))).toBe(true);
  });

  it('is false when suspended, regardless of role', () => {
    expect(canTriggerMedia(reviewer({ status: 'suspended', role: 'editor' }))).toBe(false);
    expect(canTriggerMedia(reviewer({ status: 'suspended', role: 'reviewer' }))).toBe(false);
  });

  it('is false for null and undefined (no row)', () => {
    expect(canTriggerMedia(null)).toBe(false);
    expect(canTriggerMedia(undefined)).toBe(false);
  });
});

describe('canAssignWork', () => {
  it('is true for an active editor', () => {
    expect(canAssignWork(reviewer({ status: 'active', role: 'editor' }))).toBe(true);
  });

  it('is false for an active reviewer (not an editor)', () => {
    expect(canAssignWork(reviewer({ status: 'active', role: 'reviewer' }))).toBe(false);
  });

  it('is false when suspended even though role is editor', () => {
    expect(canAssignWork(reviewer({ status: 'suspended', role: 'editor' }))).toBe(false);
  });

  it('is false for null and undefined (no row)', () => {
    expect(canAssignWork(null)).toBe(false);
    expect(canAssignWork(undefined)).toBe(false);
  });
});

// Unit 9g's write guard, specified in the Unit 9f plan section 3.1 and built here
// because it is pure and belongs beside the type it validates.
describe('validateReviewerCoverage', () => {
  it('accepts a fully empty input (no preference declared yet)', () => {
    expect(validateReviewerCoverage({ ageGroups: [], languages: [], genres: [] })).toEqual({ ok: true });
  });

  it('accepts a valid combination of concrete age groups, languages, and genres', () => {
    expect(
      validateReviewerCoverage({
        ageGroups: ['kids_5_8', 'teens'],
        languages: ['english', 'hindi'],
        genres: ['sci-fi', 'mystery'],
      })
    ).toEqual({ ok: true });
  });

  // D16: an all_ages task is never auto-routed to a reviewer, so a reviewer must
  // never be able to declare coverage of it -- that would silently defeat routing.
  it("rejects 'all_ages' as a coverage value even though it is a real AgeGroup", () => {
    const result = validateReviewerCoverage({ ageGroups: ['all_ages'], languages: [], genres: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('all_ages'))).toBe(true);
    }
  });

  it('rejects an unrecognized age group', () => {
    const result = validateReviewerCoverage({ ageGroups: ['toddlers'], languages: [], genres: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('toddlers'))).toBe(true);
    }
  });

  it('rejects an unrecognized language', () => {
    const result = validateReviewerCoverage({ ageGroups: [], languages: ['klingon'], genres: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('klingon'))).toBe(true);
    }
  });

  it('rejects an unrecognized genre', () => {
    const result = validateReviewerCoverage({ ageGroups: [], languages: [], genres: ['noir'] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('noir'))).toBe(true);
    }
  });

  it('collects every problem at once rather than stopping at the first', () => {
    const result = validateReviewerCoverage({
      ageGroups: ['all_ages', 'toddlers'],
      languages: ['klingon'],
      genres: ['noir'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(4);
    }
  });

  it('an empty genres array is valid (no preference, never a rejection)', () => {
    expect(validateReviewerCoverage({ ageGroups: ['adults'], languages: ['english'], genres: [] })).toEqual({ ok: true });
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
    const activeReviewer = reviewer({ userId: OTHER_USER, status: 'active', role: 'reviewer' });
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: 'persona-1',
      reviewer: activeReviewer,
    });
    expect(grant).toEqual({ granted: true, via: 'reviewer', reviewer: activeReviewer });
  });

  it('denies a reviewer with no standing over an ordinary (non-agent) story', () => {
    const activeReviewer = reviewer({ userId: OTHER_USER, status: 'active', role: 'editor' });
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: null,
      reviewer: activeReviewer,
    });
    expect(grant).toEqual({ granted: false });
  });

  it('denies a suspended reviewer on an agent-owned story', () => {
    const suspendedReviewer = reviewer({ userId: OTHER_USER, status: 'suspended', role: 'editor' });
    const grant = decideStoryEditAccess({
      userId: OTHER_USER,
      storyUserId: OWNER,
      agentPersonaId: 'persona-1',
      reviewer: suspendedReviewer,
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

  it('is true for an active reviewer (either role -- both can trigger media)', () => {
    expect(canTriggerMediaForEditAccess(reviewer({ status: 'active', role: 'reviewer' }))).toBe(true);
    expect(canTriggerMediaForEditAccess(reviewer({ status: 'active', role: 'editor' }))).toBe(true);
  });

  it('is false for a suspended reviewer', () => {
    expect(canTriggerMediaForEditAccess(reviewer({ status: 'suspended', role: 'editor' }))).toBe(false);
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
