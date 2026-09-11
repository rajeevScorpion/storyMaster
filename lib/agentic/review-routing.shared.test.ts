import { describe, expect, it } from 'vitest';
import {
  isMissingAssignmentSchemaError,
  routeTaskToReviewer,
  type RoutableReviewer,
  type RoutableTask,
} from './review-routing.shared';

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

// Unit 9j (Phase 9b plan section 6.4). The pure matcher -- every case below is the
// literal minimum the plan names, plus the tie-break shuffle it explicitly asks for.
describe('routeTaskToReviewer', () => {
  function task(overrides: Partial<RoutableTask> = {}): RoutableTask {
    return { language: 'english', ageGroup: 'kids_5_8', genre: 'sci-fi', ...overrides };
  }

  function reviewer(overrides: Partial<RoutableReviewer> = {}): RoutableReviewer {
    return {
      userId: 'reviewer-1',
      languages: ['english'],
      ageGroups: ['kids_5_8'],
      genres: [],
      openAssignments: 0,
      ...overrides,
    };
  }

  it('pools with no_active_reviewers when the roster is empty', () => {
    expect(routeTaskToReviewer(task(), [])).toEqual({ assigned: false, reason: 'no_active_reviewers' });
  });

  it('pools all_ages tasks (D16) and never assigns one, even when a reviewer would otherwise match everything', () => {
    const outcome = routeTaskToReviewer(task({ ageGroup: 'all_ages' }), [
      reviewer({ languages: ['english', 'hindi'], ageGroups: ['kids_5_8', 'adults', 'teens'] }),
    ]);
    expect(outcome).toEqual({ assigned: false, reason: 'all_ages_pooled' });
  });

  it('step order is exact: an empty roster reports no_active_reviewers even for an all_ages task', () => {
    // The plan's step order is precise: step 1 (no reviewers at all) is a precondition
    // checked BEFORE step 2 (all_ages). "Checked before any filtering" in the plan
    // describes step 2 running ahead of steps 3/4 (the language/age hard filters), not
    // ahead of step 1 -- with zero reviewers there is nobody to filter in the first
    // place, so 'no_active_reviewers' is the honest reason, not 'all_ages_pooled'.
    const outcome = routeTaskToReviewer(task({ ageGroup: 'all_ages' }), []);
    expect(outcome).toEqual({ assigned: false, reason: 'no_active_reviewers' });
  });

  it('checks all_ages BEFORE the language/age hard filters, so the reason is honest even when no reviewer would match either axis', () => {
    // A reviewer who covers neither this language nor this age group is still present
    // (the roster is non-empty), so if step order were wrong this could incorrectly
    // report 'no_language_match' instead of the true reason: this task is pooled by
    // design (D16) and was never eligible for language/age filtering in the first place.
    const outcome = routeTaskToReviewer(task({ ageGroup: 'all_ages', language: 'hindi' }), [
      reviewer({ languages: ['english'], ageGroups: ['kids_5_8'] }),
    ]);
    expect(outcome).toEqual({ assigned: false, reason: 'all_ages_pooled' });
  });

  it('pools on no_language_match when no active reviewer covers the language, regardless of age/genre fit', () => {
    const outcome = routeTaskToReviewer(task({ language: 'hindi' }), [
      reviewer({ languages: ['english'], ageGroups: ['kids_5_8'], genres: ['sci-fi'] }),
    ]);
    expect(outcome).toEqual({ assigned: false, reason: 'no_language_match' });
  });

  it('pools on no_age_match when language matches but no candidate covers the age group', () => {
    const outcome = routeTaskToReviewer(task({ ageGroup: 'adults' }), [
      reviewer({ languages: ['english'], ageGroups: ['kids_5_8', 'teens'] }),
    ]);
    expect(outcome).toEqual({ assigned: false, reason: 'no_age_match' });
  });

  it('picks the genre-matching reviewer among otherwise-equal candidates', () => {
    const genreSpecialist = reviewer({ userId: 'specialist', genres: ['sci-fi'] });
    const generalist = reviewer({ userId: 'generalist', genres: ['drama'] });
    const outcome = routeTaskToReviewer(task({ genre: 'sci-fi' }), [generalist, genreSpecialist]);
    expect(outcome).toEqual({
      assigned: true,
      reviewerId: 'specialist',
      reason: { candidateCount: 1, genreMatched: true, load: 0 },
    });
  });

  it('never excludes a reviewer whose genres[] is empty -- it just loses the genre tie-break to a specialist', () => {
    const noPreference = reviewer({ userId: 'no-preference', genres: [] });
    // No candidate at all matches the task's genre, so the fallback pool must be every
    // age/language match, including the empty-genres reviewer -- an empty genres[] must
    // never read as "excluded" the way an empty languages[]/ageGroups[] would.
    const outcome = routeTaskToReviewer(task({ genre: 'mystery' }), [noPreference]);
    expect(outcome).toEqual({
      assigned: true,
      reviewerId: 'no-preference',
      reason: { candidateCount: 1, genreMatched: false, load: 0 },
    });
  });

  it('also falls back to the full pool (empty genres[] included) when nobody in it matches the genre, even alongside a genre-having non-matching reviewer', () => {
    const noPreference = reviewer({ userId: 'no-preference', genres: [] });
    const wrongGenre = reviewer({ userId: 'wrong-genre', genres: ['drama'] });
    const outcome = routeTaskToReviewer(task({ genre: 'mystery' }), [wrongGenre, noPreference]);
    expect(outcome.assigned).toBe(true);
    if (outcome.assigned) {
      expect(outcome.reason.genreMatched).toBe(false);
      expect(outcome.reason.candidateCount).toBe(2);
    }
  });

  it('picks the least-loaded reviewer among equally-eligible candidates', () => {
    const busy = reviewer({ userId: 'busy', openAssignments: 3 });
    const idle = reviewer({ userId: 'idle', openAssignments: 0 });
    const outcome = routeTaskToReviewer(task(), [busy, idle]);
    expect(outcome).toEqual({
      assigned: true,
      reviewerId: 'idle',
      reason: { candidateCount: 2, genreMatched: false, load: 0 },
    });
  });

  it('breaks a load tie by userId ascending, deterministically, regardless of input order', () => {
    const a = reviewer({ userId: 'aaa', openAssignments: 1 });
    const b = reviewer({ userId: 'bbb', openAssignments: 1 });
    const c = reviewer({ userId: 'ccc', openAssignments: 1 });

    const orderings = [
      [a, b, c],
      [c, b, a],
      [b, c, a],
      [c, a, b],
    ];

    for (const reviewers of orderings) {
      const outcome = routeTaskToReviewer(task(), reviewers);
      expect(outcome.assigned).toBe(true);
      if (outcome.assigned) expect(outcome.reviewerId).toBe('aaa');
    }
  });

  it('genre narrowing and load tie-break compose: the genre specialist pool still resolves ties by userId', () => {
    const specialistA = reviewer({ userId: 'a-specialist', genres: ['sci-fi'], openAssignments: 2 });
    const specialistB = reviewer({ userId: 'b-specialist', genres: ['sci-fi'], openAssignments: 2 });
    const generalistIdle = reviewer({ userId: 'z-idle-generalist', genres: [], openAssignments: 0 });

    const outcome = routeTaskToReviewer(task({ genre: 'sci-fi' }), [specialistB, generalistIdle, specialistA]);
    expect(outcome).toEqual({
      assigned: true,
      reviewerId: 'a-specialist',
      reason: { candidateCount: 2, genreMatched: true, load: 2 },
    });
  });
});
