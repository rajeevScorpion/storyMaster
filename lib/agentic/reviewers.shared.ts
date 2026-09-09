// ── Agentic Creator System: Phase 9 reviewers, pure half ─────────────────
//
// No `server-only`, no `'use client'`, no Supabase, no network -- everything here is
// deterministic and operates on plain data a caller already has. `lib/agentic/reviewers.ts`
// (which IS `server-only`) is where a reviewer row is actually fetched (migration 111,
// `public.agent_reviewers`) and where `requireReviewer()` / `assertCanEditStory()` live per
// decision D14 in docs/agentic-creator-phase9-plan.md.
//
// `process.env.ADMIN_USER_ID` is implicitly a reviewer with every capability -- that is
// server-side policy (it reads an env var and never touches the database), so it is built
// in reviewers.ts, not here. Everything in this module treats `AgentReviewer` as plain data:
// given a reviewer (or none), what can they do.

export type AgentReviewerStatus = 'active' | 'suspended';

/** Mirrors public.agent_reviewers (migration 111), camelCased. */
export interface AgentReviewer {
  userId: string;
  status: AgentReviewerStatus;
  canPublish: boolean;
  canTriggerMedia: boolean;
  displayName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/**
 * True when `reviewer` is a real, non-suspended reviewer. This is the gate every other
 * capability predicate below goes through first: a suspended reviewer's `canPublish` /
 * `canTriggerMedia` columns are deliberately NOT consulted once status !== 'active' --
 * suspension means "this account currently has no reviewer capability", not "this account
 * keeps whichever booleans it had before it was suspended". `null`/`undefined` (no row, or
 * a caller who was never a reviewer) is not active either -- this is also the fail-closed
 * return value when the schema itself is missing (see isMissingReviewerSchemaError below).
 *
 * Declared as a type predicate so a caller that has thrown on the false branch is left
 * holding a non-null AgentReviewer. That is what lets requireReviewer() promise a real
 * reviewer rather than a nullable one, and what removes the non-null assertions the two
 * capability predicates below would otherwise need.
 */
export function isActiveReviewer(
  reviewer: AgentReviewer | null | undefined
): reviewer is AgentReviewer {
  return reviewer != null && reviewer.status === 'active';
}

/** True when `reviewer` is active AND carries can_publish. Combines both checks so a caller never has to remember to test status separately. */
export function canPublish(reviewer: AgentReviewer | null | undefined): boolean {
  return isActiveReviewer(reviewer) && reviewer.canPublish;
}

/** True when `reviewer` is active AND carries can_trigger_media (gates narration/image submits on an agent draft -- Unit 9b). */
export function canTriggerMedia(reviewer: AgentReviewer | null | undefined): boolean {
  return isActiveReviewer(reviewer) && reviewer.canTriggerMedia;
}

/**
 * Unit 9b (D14): the pure owner-vs-reviewer-vs-stranger decision behind
 * `assertCanEditStory` (lib/agentic/reviewers.ts). Fetching `storyUserId` /
 * `agentPersonaId` / `reviewer` is that function's job; this only combines
 * data the caller already has, so the three-way branch can be unit tested
 * without a database.
 *
 * Order matters and is fixed: ownership is decided FIRST and unconditionally
 * wins, before `reviewer` is ever consulted. `storyUserId === userId` alone
 * grants `via: 'owner'` even when `agentPersonaId` is set and `reviewer` is
 * `null` -- an ordinary user with zero rows in agent_reviewers must still be
 * able to edit/narrate/generate images for their OWN story. Only a non-owner
 * falls through to the reviewer branch, and only onto an agent-owned story
 * (`agentPersonaId` truthy) with an actually-active reviewer row.
 */
export type StoryEditAccessGrant =
  | { granted: true; via: 'owner' }
  | { granted: true; via: 'reviewer'; reviewer: AgentReviewer }
  | { granted: false };

export function decideStoryEditAccess(params: {
  userId: string;
  storyUserId: string;
  agentPersonaId: string | null;
  reviewer: AgentReviewer | null;
}): StoryEditAccessGrant {
  if (params.storyUserId === params.userId) {
    return { granted: true, via: 'owner' };
  }
  if (params.agentPersonaId) {
    const { reviewer } = params;
    if (isActiveReviewer(reviewer)) {
      return { granted: true, via: 'reviewer', reviewer };
    }
  }
  return { granted: false };
}

/**
 * Unit 9b: whether a caller who has ALREADY been proven to have story-edit
 * access (via assertCanEditStory / decideStoryEditAccess above) may also
 * trigger narration or image generation. `reviewer` must be exactly what
 * that access check produced: `null` when access came from being the
 * story's own owner -- who needs no capability at all, and whose
 * `agent_reviewers` row (if any exists) is irrelevant -- or the resolved,
 * already-active `AgentReviewer` when access came from the reviewer branch,
 * which DOES need `can_trigger_media`.
 *
 * The order is load-bearing: `reviewer === null` must short-circuit to
 * `true` BEFORE `canTriggerMedia` is ever consulted. Calling
 * `canTriggerMedia(reviewer)` directly on a `null` reviewer returns `false`
 * -- correct for "does this account have the capability" but wrong for "may
 * this call proceed", because an ordinary owner is never subject to the
 * capability check in the first place. Getting this backwards breaks
 * narration/image generation for every human user on the site, not just
 * reviewers.
 */
export function canTriggerMediaForEditAccess(reviewer: AgentReviewer | null): boolean {
  return reviewer === null || canTriggerMedia(reviewer);
}

/**
 * True when a Postgres/PostgREST error means "migration 111 hasn't run on this database
 * yet", as opposed to any other failure that should surface as a real error. Codes only,
 * deliberately -- see isMissingPersonaSchemaError (personas.shared.ts) and
 * isMissingTaskSchemaError (supervisor.shared.ts) for the defect this guards against: a
 * bare message match on the table name would also catch an unrelated error that happens to
 * mention it, and misreport it as an unapplied migration. Per GOTCHAS.md, latches (and
 * their classifiers) are kept one per migration group.
 *
 * Unlike migration 103 (which added `stories.agent_persona_id`), 111 adds no column to any
 * other table -- 42703 is included anyway for the same reason the other classifiers include
 * codes their own migration may not strictly produce: a PostgREST schema-cache miss can
 * surface as any of these four codes depending on which part of the query it trips on, and
 * this function only needs to recognize "not deployed here", not diagnose which symptom.
 */
export function isMissingReviewerSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_reviewers absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
