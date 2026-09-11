// ── Agentic Creator System: Phase 9b reviewer assignment, pure half (Unit 9i) ────
//
// No `server-only`, no `'use client'`, no Supabase, no network -- mirrors
// reviewers.ts/.shared.ts and review-decisions.ts/.shared.ts's split exactly. This
// file holds only the row shape and migration-114 schema classifier;
// `lib/agentic/review-routing.ts` (which IS `server-only`) is where
// `agent_review_assignments` is actually read and written.
//
// THIS IS MIGRATION 114's OWN LATCH. Per GOTCHAS.md ("Column-availability latches
// are per migration group"), isMissingAssignmentSchemaError below must never be
// conflated with isMissingReviewerSchemaError (111, reviewers.shared.ts),
// isMissingReviewDecisionSchemaError (112, review-decisions.shared.ts), or
// isMissingRunSchemaError (107, orchestrator.shared.ts) -- even though all four
// accept an identical set of Postgres/PostgREST codes. What tells them apart is
// only ever which table the failing query touched: this classifier is called
// exclusively from queries against agent_review_assignments in review-routing.ts.

/** Every value migration 114's `source` CHECK constraint allows. */
export type AssignmentSource = 'manual' | 'auto';

/** Every value migration 114's `status` CHECK constraint allows. */
export type AssignmentStatus = 'active' | 'released' | 'superseded';

/**
 * Mirrors public.agent_review_assignments (migration 114), camelCased.
 *
 * `reviewerId: null` is a REAL, reachable state on an otherwise-`active` row (the
 * FK is `ON DELETE SET NULL`, exactly like `agent_reviewers`/`agent_review_decisions`
 * before it) -- not a sign of a malformed row. A caller must read
 * `status === 'active' && reviewerId == null` as "unassigned", never as "assigned
 * to nobody in particular". See listAssignmentsForTasks (review-routing.ts).
 */
export interface ReviewAssignment {
  id: string;
  taskId: string;
  reviewerId: string | null;
  assignedBy: string | null;
  source: AssignmentSource;
  status: AssignmentStatus;
  matchReason: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * True when a Postgres/PostgREST error means "migration 114 hasn't run on this
 * database yet", as opposed to any other failure that should surface as a real
 * error. Codes only, deliberately -- see isMissingReviewerSchemaError
 * (reviewers.shared.ts) for the defect this guards against: a bare message match
 * on the table name would also catch an unrelated error that happens to mention
 * it, and misreport it as an unapplied migration.
 *
 * This is migration 114's OWN classifier -- never reused from 107/111/112, per
 * this file's header.
 */
export function isMissingAssignmentSchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_review_assignments absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}

// ── Unit 9j: the pure automatic-assignment matcher ──────────────────────
//
// Phase 9b plan section 6.1. No Supabase, no `AdminClient`, no side effects -- given a
// task's routing axes and the currently-active reviewer roster (already loaded, already
// carrying each reviewer's open-assignment count), decide who gets it. The caller
// (tryAutoAssignReview, review-routing.ts) is the only thing that talks to the database;
// this function is deterministic and exhaustively unit-testable without one.

/** The three axes a task is routed on -- the same tuple the Editorial Supervisor already reasons in (supervisor.shared.ts's cellKey). */
export interface RoutableTask {
  language: string;
  ageGroup: string;
  genre: string | null;
}

/** One active reviewer as the matcher needs to see them: declared coverage plus current load. */
export interface RoutableReviewer {
  userId: string;
  languages: string[];
  ageGroups: string[];
  /** Genre preference, NOT a hard filter (step 5 below) -- empty means no preference. */
  genres: string[];
  /** Count of this reviewer's currently-active assignments (countOpenAssignmentsByReviewer). */
  openAssignments: number;
}

/**
 * Why an `assigned: true` outcome picked who it picked. Persisted verbatim into
 * agent_review_assignments.match_reason (migration 114) so a routing decision can be
 * explained after the fact without re-deriving it.
 */
export interface ReviewRoutingReason {
  /** How many reviewers were still in the running at the tie-break step (after language/age filtering, and genre narrowing if it applied). */
  candidateCount: number;
  /** Whether the winner was chosen from a genre-narrowed pool (true) or the full age/language pool because nobody's genres[] matched (false). */
  genreMatched: boolean;
  /** The winner's openAssignments count at match time. */
  load: number;
}

/**
 * `assigned: false` reasons are honest about WHERE the task fell out, not just THAT it
 * did -- `/admin/authors/workload` (Unit 9k) and a reviewer asking "why wasn't this
 * routed" both need to distinguish "nobody covers this language at all" from "someone
 * covers the language but not this age group" from "this task is pooled by design (D16)".
 */
export type ReviewRoutingOutcome =
  | { assigned: true; reviewerId: string; reason: ReviewRoutingReason }
  | {
      assigned: false;
      reason: 'no_active_reviewers' | 'all_ages_pooled' | 'no_language_match' | 'no_age_match';
    };

/**
 * The Unit 9j matcher (Phase 9b plan section 6.1). Step order is EXACTLY as specified
 * and is load-bearing -- do not reorder:
 *
 *   1. No reviewers at all -> 'no_active_reviewers'.
 *   2. `task.ageGroup === 'all_ages'` -> 'all_ages_pooled' (D16), checked BEFORE any
 *      filtering runs, so the reason reported is honest rather than an incidental
 *      'no_age_match' (no reviewer's ageGroups[] can ever contain 'all_ages' --
 *      validateReviewerCoverage forbids it -- so this task would otherwise fall through
 *      every filter and report a mismatch that isn't the real reason).
 *   3. Hard filter on language. Empty -> 'no_language_match'.
 *   4. Hard filter on age group. Empty -> 'no_age_match'.
 *   5. Genre is a TIE-BREAK, never a filter: narrow to reviewers whose genres[] contains
 *      the task's genre, but only ADOPT that narrower pool if it is non-empty. An empty
 *      genres[] on a reviewer is "no preference" and must never exclude them from the
 *      fallback pool -- it just means they never win the narrowing in step 5, only the
 *      tie-break in step 6.
 *   6. Lowest `openAssignments` wins; ties broken by `userId` ascending. Deterministic on
 *      purpose -- a random pick could not be explained to a reviewer who asks why they
 *      got a draft, and could not be asserted on in a test.
 */
export function routeTaskToReviewer(
  task: RoutableTask,
  reviewers: readonly RoutableReviewer[]
): ReviewRoutingOutcome {
  if (reviewers.length === 0) {
    return { assigned: false, reason: 'no_active_reviewers' };
  }

  if (task.ageGroup === 'all_ages') {
    return { assigned: false, reason: 'all_ages_pooled' };
  }

  const languageMatches = reviewers.filter((r) => r.languages.includes(task.language));
  if (languageMatches.length === 0) {
    return { assigned: false, reason: 'no_language_match' };
  }

  const ageMatches = languageMatches.filter((r) => r.ageGroups.includes(task.ageGroup));
  if (ageMatches.length === 0) {
    return { assigned: false, reason: 'no_age_match' };
  }

  const genreMatches = task.genre
    ? ageMatches.filter((r) => r.genres.includes(task.genre as string))
    : [];
  const pool = genreMatches.length > 0 ? genreMatches : ageMatches;

  // Lowest load wins; tie-break by userId ascending. `pool` is provably non-empty here
  // (ageMatches already proved non-empty above, and genreMatches only ever narrows it
  // when non-empty), so reduce needs no seed and no empty-array guard.
  const winner = pool.reduce((best, candidate) => {
    if (candidate.openAssignments !== best.openAssignments) {
      return candidate.openAssignments < best.openAssignments ? candidate : best;
    }
    return candidate.userId < best.userId ? candidate : best;
  });

  return {
    assigned: true,
    reviewerId: winner.userId,
    reason: {
      candidateCount: pool.length,
      genreMatched: genreMatches.length > 0,
      load: winner.openAssignments,
    },
  };
}
