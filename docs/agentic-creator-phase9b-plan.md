# Agentic Creator — Phase 9b: reviewer roles, coverage, and routing

Extends Phase 9 (reviewer workflow) with a role model, per-reviewer coverage, a reviewer-facing
route outside `/admin`, and assignment — manual first, then automatic. Phase 10 is already
reserved for media/publish, so this is **9f–9k**, not Phase 10.

Owner-approved scope, 2026-09-10. Written to the standard in
[WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md): a fresh session must be able to
execute this without re-deriving discovery.

---

## 0. Verified current-state facts

Checked against the code and both live databases on 2026-09-10. Everything below was read, not
assumed.

### 0.1 Databases

| Fact | Evidence |
|---|---|
| **Production has NO agentic schema at all.** `schema_migration_ledger` returns zero rows for `migration_number >= 103`. | prod ledger query |
| Dev has 103–108, 110, 111, 112. **There is no migration 109** — it never existed, and is not a gap to fill. | dev ledger query |
| `agent_reviewers`: **0 rows.** Columns are exactly `user_id, status, can_publish, can_trigger_media, display_name, notes, created_at, updated_at, created_by`. | dev `information_schema` |
| `agent_review_decisions`: **0 rows.** | dev |
| `agent_tasks`: **8 rows.** `agent_runs` at `awaiting_review`: **5.** | dev |
| All six `agentic_*` feature flags exist. The column is **`flag_key`**, not `key`. | dev `feature_flags` |

### 0.2 The five live queue rows — the routing test fixture

These already exist on dev and are what Unit 9j will be proven against:

| run_id (short) | language | age_group | genre |
|---|---|---|---|
| `e9cd7325` | english | kids_5_8 | sci-fi |
| `ca2bb41b` | english | kids_5_8 | sci-fi |
| `73283a43` | english | adults | mystery |
| `8fa3a959` | hindi | teens | drama |
| `2accd281` | hindi | teens | drama |

Three distinct routing cells. **No `all_ages` row exists**, so the pool path (D16) has no natural
fixture — Unit 9j must cover it with a unit test, and the owner should commission one `all_ages`
task to prove it live.

### 0.3 Code facts that shape the design

- **`verifyAdmin()` is a single-person env check.** [admin.ts:32-35](../lib/supabase/admin.ts#L32-L35) — `user.id !== process.env.ADMIN_USER_ID` throws `Forbidden`. It gates every admin page through [app/admin/layout.tsx](../app/admin/layout.tsx), so a non-admin reviewer cannot reach `/admin/authors` today. [app/admin/authors/layout.tsx:9-16](../app/admin/authors/layout.tsx#L9-L16) says exactly this in its own comment.
- **The age-group taxonomy is triplicated and none of it is exported.** [supervisor.shared.ts:55-58](../lib/agentic/supervisor.shared.ts#L55-L58) hardcodes `ALL_AGE_GROUPS` / `AGE_GROUP_SET` as module-private, with a comment saying no canonical array exists; [storyline-discovery.ts:14](../app/actions/storyline-discovery.ts#L14) holds a second copy; [story-audience.ts:136](../lib/ai/story-audience.ts#L136) has `KIDS_AGE_GROUPS`. Languages (`STORY_LANGUAGE_OPTIONS`, [story-config.ts:109](../lib/ai/story-config.ts#L109)) and genres (`STORY_GENRES`, [genres.ts:5](../lib/story/genres.ts#L5)) do already have canonical homes.
- **`agent_tasks.age_group` and `.language` carry no CHECK constraint** ([106:69](../supabase/migrations/106_agent_tasks.sql#L69)) — the taxonomy is enforced in TypeScript only.
- **The supervisor already reasons in exactly this 3-tuple.** `cellKey(language, ageGroup, genre)` at [supervisor.shared.ts:71](../lib/agentic/supervisor.shared.ts#L71). Reviewer coverage uses the same axes the gap-finder does.
- **The single auto-assign hook point is [orchestrator.ts:697-699](../lib/agentic/orchestrator.ts#L697-L699)**, inside `persistStageAdvance`, where `target === 'awaiting_review'` already calls `setTaskStatus`. Both of `advanceRun`'s branches land there, so one hook also covers the checkpoint-skip path.
- **`setTaskStatus` and `type AdminClient` are already exported** from `orchestrator.ts` (done in 9e-i), so a new module can reuse them.
- **`ReviewQueue` takes only serialisable props** — `initialRows`, `schemaApplied`, `canPublish` ([app/admin/authors/page.tsx:78](../app/admin/authors/page.tsx#L78)). It has no admin coupling and ports to `/review` as-is.
- **`AgentRun` carries `taskId`**, so the queue can join to assignments with no schema change.
- The `admin_list_users` RPC already searches `lower(email)` **or** display name ([083:308-310](../supabase/migrations/083_admin_user_management.sql#L308-L310)), wrapped by `getAdminUsersPage` ([admin-users.ts:127](../app/actions/admin-users.ts#L127)).

---

## 1. Decisions to record in `agentic-creator-decisions.md`

### D16 — `all_ages` is never auto-routed; it goes to the pool

`all_ages` sits in the same enum as the five concrete groups but is not a wildcard. Reviewers tick
only the five concrete groups; an `all_ages` task returns no match and lands in the **unassigned
pool**, claimable by any reviewer whose language matches.

*Rejected:* treating `all_ages` as a wildcard (hands a kids-3-5 specialist adult-leaning work);
plain set-membership with no special case (routes to nobody **silently**, which is the precise
defect this decision exists to prevent).

### D17 — role is the only stored capability; `can_publish` / `can_trigger_media` are dropped

Capability is derived from `role` by a pure function. Keeping the booleans alongside a role column
is two sources of truth for one fact.

| role | review | publish | trigger media | assign work |
|---|---|---|---|---|
| `reviewer` | yes | no | yes | no |
| `editor` | yes | yes | yes | yes |
| ADMIN_USER_ID (implicit) | yes | yes | yes | yes |

Called **editor**, not "supervisor": `lib/agentic/supervisor.ts` is the AI Editorial Supervisor and
`agent_tasks.origin = 'supervisor'` already means "the AI commissioned this".

*Rejected:* role plus booleans as per-person overrides — deferred, not refused; add a
`capability_overrides` jsonb later if a real exception ever appears.

### D18 — assignment is task-level and advisory

Assignment attaches to `agent_tasks`, not `agent_runs`: a task can produce several runs via retry,
and the assignment must survive one. It is **advisory** — it drives a default filter and the
workload view, and never gates a decision. Any active reviewer may still act on any draft.

*Rejected:* enforced assignment. With auto-routing, a taxonomy typo would lock a draft with no
error, and this system already has one stage (`media_pending`) that nothing consumes.

---

## 2. Unit 9f — taxonomy consolidation, migration 113, derived capabilities

### 2.1 New file: `lib/story/age-groups.ts`

Mirrors `lib/story/genres.ts`'s shape exactly. Order must match the existing arrays element for
element — `supervisor.shared.ts` enumerates gaps in this order.

```ts
import type { AgeGroup } from '@/lib/types/story';

export const STORY_AGE_GROUPS = [
  { value: 'all_ages', label: 'All ages' },
  { value: 'kids_3_5', label: 'Kids 3-5' },
  { value: 'kids_5_8', label: 'Kids 5-8' },
  { value: 'kids_8_12', label: 'Kids 8-12' },
  { value: 'teens', label: 'Teens' },
  { value: 'adults', label: 'Adults' },
] as const satisfies readonly { value: AgeGroup; label: string }[];

export const AGE_GROUP_VALUES: readonly AgeGroup[] = STORY_AGE_GROUPS.map((g) => g.value);

/** The five concrete groups a reviewer may claim coverage of. Excludes 'all_ages' per D16. */
export const ROUTABLE_AGE_GROUPS: readonly AgeGroup[] =
  AGE_GROUP_VALUES.filter((v) => v !== 'all_ages');

export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === 'string' && (AGE_GROUP_VALUES as readonly string[]).includes(value);
}
```

### 2.2 Consume it in the two existing copies

- [supervisor.shared.ts:55-58](../lib/agentic/supervisor.shared.ts#L55-L58) — delete the hardcoded `ALL_AGE_GROUPS` and its 6-line "no canonical array exists" comment; import `AGE_GROUP_VALUES` and build `AGE_GROUP_SET` from it. **Behaviour must not change** — same values, same order.
- [storyline-discovery.ts:14](../app/actions/storyline-discovery.ts#L14) — replace the local `AGE_GROUPS` with the import.
- Leave `KIDS_AGE_GROUPS` ([story-audience.ts:136](../lib/ai/story-audience.ts#L136)) alone. It is a different concept — which groups count as "kids" — not a duplicate taxonomy.

### 2.3 Migration 113 — complete SQL

`supabase/migrations/113_agent_reviewer_roles.sql`:

```sql
-- 113_agent_reviewer_roles.sql
--
-- Phase 9b (D17): reviewer roles and routing coverage.
--
-- DEPENDS ON 111. Verify before applying:
--   select * from public.schema_migration_ledger where migration_number = 111;
--
-- 1. `role` becomes the SINGLE source of truth for capability. can_publish and
--    can_trigger_media are DROPPED rather than kept alongside it: two columns
--    describing one fact is exactly the drift bug this migration exists to avoid.
--    Capability is derived from role by a pure function (canPublish /
--    canTriggerMedia in lib/agentic/reviewers.shared.ts), so the matrix is one
--    readable table in code and is unit-testable without a database.
--
--    DROPPING IS SAFE HERE AND ONLY HERE: agent_reviewers holds ZERO rows on dev
--    (verified 2026-09-10) and does not exist at all on production -- no agentic
--    migration (103-112) has ever been applied there. No data is lost because no
--    data exists. If that stops being true, DO NOT apply this file as written:
--    backfill role from the booleans first.
--
-- 2. Routing coverage: three arrays, matching agent_personas.genres text[] (103)
--    rather than a join table, because there is no per-assignment metadata to
--    carry. These are the same three axes the Editorial Supervisor already
--    reasons in -- supervisor.shared.ts's cellKey(language, ageGroup, genre) --
--    so a reviewer's coverage is expressed in the taxonomy that produced the work.
--
-- Deliberately NO CHECK on array contents and NO GIN index:
--   * agent_tasks.age_group / .language carry no CHECK either (106); the taxonomy
--     lives in TypeScript (lib/story/age-groups.ts, lib/story/genres.ts,
--     lib/ai/story-config.ts) and a CHECK here would need a migration every time a
--     genre is added. Unit 9g validates on write against those same lists.
--   * the matcher (Unit 9j) loads the whole active roster into memory -- it must,
--     to compute least-loaded across all of them -- so there is no array-containment
--     query for a GIN index to serve.

ALTER TABLE public.agent_reviewers
  ADD COLUMN IF NOT EXISTS role       text   NOT NULL DEFAULT 'reviewer',
  ADD COLUMN IF NOT EXISTS age_groups text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS genres     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.agent_reviewers
  DROP CONSTRAINT IF EXISTS agent_reviewers_role_check;
ALTER TABLE public.agent_reviewers
  ADD CONSTRAINT agent_reviewers_role_check CHECK (role IN ('reviewer', 'editor'));

ALTER TABLE public.agent_reviewers
  DROP COLUMN IF EXISTS can_publish,
  DROP COLUMN IF EXISTS can_trigger_media;

COMMENT ON COLUMN public.agent_reviewers.role IS
  'Single source of truth for capability (D17). reviewer: review + trigger media. '
  'editor: also publish and assign. ADMIN_USER_ID is implicitly an editor in code, not here.';
COMMENT ON COLUMN public.agent_reviewers.age_groups IS
  'Concrete age groups this reviewer covers. Never contains all_ages (D16) -- an all_ages '
  'task is not auto-routed, it goes to the unassigned pool.';
COMMENT ON COLUMN public.agent_reviewers.genres IS
  'Genre preference, NOT a hard filter. Empty means no preference and never excludes.';

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (113, '113_agent_reviewer_roles.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

`supabase/migrations/113_agent_reviewer_roles_rollback.sql`:

```sql
-- Reverses 113. LOSSY IF ROWS EXIST: role is dropped and the restored booleans
-- default to false, so an editor would come back as a reviewer with no publish
-- capability. Harmless today (zero rows); check before running it later.

ALTER TABLE public.agent_reviewers
  ADD COLUMN IF NOT EXISTS can_publish       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_trigger_media boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_reviewers
  DROP CONSTRAINT IF EXISTS agent_reviewers_role_check;

ALTER TABLE public.agent_reviewers
  DROP COLUMN IF EXISTS role,
  DROP COLUMN IF EXISTS age_groups,
  DROP COLUMN IF EXISTS languages,
  DROP COLUMN IF EXISTS genres,
  DROP COLUMN IF EXISTS updated_by;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 113;
```

### 2.4 `lib/agentic/reviewers.shared.ts` — derive capability from role

- Add `export type AgentReviewerRole = 'reviewer' | 'editor';`
- `AgentReviewer`: **remove** the `canPublish` / `canTriggerMedia` fields — they become functions, and leaving the fields recreates the two-sources problem inside the type. **Add** `role: AgentReviewerRole`, `ageGroups: string[]`, `languages: string[]`, `genres: string[]`, `updatedBy: string | null`.
- Rewrite `canPublish()` ([:52](../lib/agentic/reviewers.shared.ts#L52)) as `isActiveReviewer(r) && r.role === 'editor'`.
- Rewrite `canTriggerMedia()` ([:57](../lib/agentic/reviewers.shared.ts#L57)) as `isActiveReviewer(r)` — both roles have it.
- Add `canAssignWork(r)`: `isActiveReviewer(r) && r.role === 'editor'`.
- `canTriggerMediaForEditAccess()` ([:105](../lib/agentic/reviewers.shared.ts#L105)) is **unchanged**. Its `reviewer === null` short-circuit is load-bearing for ordinary story owners and must stay exactly as written.
- `decideStoryEditAccess()` unchanged.

### 2.5 `lib/agentic/reviewers.ts` — server half

- `AgentReviewerRow`: swap the two booleans for `role`, `age_groups`, `languages`, `genres`, `updated_by`.
- `rowToReviewer()` ([:50](../lib/agentic/reviewers.ts#L50)): map the new columns; coalesce arrays with `?? []`.
- The `.select(...)` list in `fetchReviewerRow` ([:106](../lib/agentic/reviewers.ts#L106)): replace `can_publish, can_trigger_media` with `role, age_groups, languages, genres, updated_by`.
- `buildImplicitAdminReviewer()` ([:65](../lib/agentic/reviewers.ts#L65)): `role: 'editor'`, and **all three coverage arrays empty**. Empty is correct — the implicit admin is not in the routing pool and must never be auto-assigned work; they reach everything through `/admin/authors` regardless.
- The migration-111 latch stays as-is. **Do not add a second latch for 113** — the columns live on the same table, so a missing 113 surfaces as `42703` through the existing `isMissingReviewerSchemaError` classifier, which already accepts that code.

### 2.6 Callers to update

`grep -rn "canPublish\|canTriggerMedia"` — expected sites: [agentic-review.ts:48](../app/actions/agentic-review.ts#L48), [app/admin/authors/page.tsx:57](../app/admin/authors/page.tsx#L57), the Unit 9b write guards, and `reviewers.shared.test.ts`. All call the **functions**, so most need no change; only code reading `reviewer.canPublish` as a *field* does.

---

## 3. Unit 9g — grant, edit and revoke reviewers (admin only)

Stays on `/admin/authors/reviewers`, gated by `verifyAdmin()`. Granting reviewer standing is an
admin act, not an editor one.

### 3.1 Server actions — extend `app/actions/agentic-review.ts`

All gated on `verifyAdmin()`, not `requireReviewer()`. That is a deliberate departure from the
file's existing header rule — say so in a comment where it happens.

- `searchGrantableUsersAction(query: string)` — delegates to `getAdminUsersPage({ search, pageSize: 10 })`. Do **not** re-implement the RPC call.
- `grantReviewerAction({ userId, role, ageGroups, languages, genres, displayName, notes })` — upsert into `agent_reviewers`, stamping `created_by` / `updated_by` with the admin's id.
- `updateReviewerAction({ userId, ... })` — same validation, sets `updated_by`.
- `setReviewerStatusAction(userId, status)` — suspend / reinstate.

**Validation is mandatory and shared.** Every array value must pass `isAgeGroup` / `isStoryGenre` /
the `STORY_LANGUAGE_OPTIONS` membership check, and `ageGroups` must reject `'all_ages'` (D16). An
invalid value that reaches the column silently matches nothing, forever, with no error — this
validation *is* the CHECK constraint the migration deliberately omits.

Put the pure validator in `reviewers.shared.ts` as `validateReviewerCoverage(input)` returning
`{ ok: true } | { ok: false; errors: string[] }`, so it is unit-testable and reusable by the client
for inline feedback.

### 3.2 UI — `components/admin/agentic/ReviewerRosterEditor.tsx` (new, client)

- Email/name search box calling `searchGrantableUsersAction`, debounced, showing email + display name.
- A drawer following `PersonaEditorDrawer.tsx`'s existing shape.
- Role picked with **`FilterDropdown`** — never a native `<select>` (WORKING_AGREEMENTS).
- Coverage as three multi-select checkbox groups over `ROUTABLE_AGE_GROUPS`, `STORY_LANGUAGE_OPTIONS`, `STORY_GENRES`. The age list renders exactly five boxes — no `all_ages` — with a one-line note that all-ages drafts go to the pool.
- Row actions via **`RowActionsMenu`** (⋮): Edit, Suspend / Reinstate.
- [app/admin/authors/reviewers/page.tsx](../app/admin/authors/reviewers/page.tsx) — replace the "needs a future admin action that does not exist yet" empty-state copy, which this unit makes false. Keep the schema-not-applied branch untouched.
- `ReviewerRosterRow` ([agentic-review.ts:208](../app/actions/agentic-review.ts#L208)) gains role and coverage; the table renders them as pills.

---

## 4. Unit 9h — `/review`, the reviewer-facing route

### 4.1 `app/review/layout.tsx` (new)

`requireReviewer()`, and on throw `redirect('/')`. Mirrors `app/admin/layout.tsx`'s shape but
**never calls `verifyAdmin()`**. Minimal shell — a header and the page. No `AdminSidebar` and no
admin nav: a reviewer must not be shown the admin information architecture.

### 4.2 `app/review/page.tsx` (new)

Same body as [app/admin/authors/page.tsx](../app/admin/authors/page.tsx): flag check first (fail
closed, no fetch while off), then schema status, then rows, then `canPublish` resolved from
`requireReviewer()`. Renders the **same** `ReviewQueue` component — no fork, no second copy.

### 4.3 Scoping filter

`ReviewQueueListFilters` ([agentic-review.ts:112](../app/actions/agentic-review.ts#L112)) gains
`assignment?: 'mine' | 'unassigned' | 'all'`. Until Unit 9i lands there is no assignment table, so
this filter **must degrade to `'all'`** rather than returning nothing. Build it in 9i, not here.

### 4.4 Known limits, to state honestly

- A signed-out visitor to `/review` gets `redirect('/')`, matching admin behaviour. A sign-in redirect carrying a return URL is nicer, and is **deferred** — record it in PROJECT_STATE.
- `/admin/authors` keeps working unchanged for the admin. The two routes intentionally overlap.

---

## 5. Unit 9i — migration 114, manual assignment

### 5.1 Complete SQL

`supabase/migrations/114_agent_review_assignments.sql`:

```sql
-- 114_agent_review_assignments.sql
--
-- Phase 9b (D18): who is looking at which draft. TASK-level, not run-level: a task
-- can produce several runs via retry (retryRun resumes the same run, and a re-brief
-- makes a new one), and an assignment must survive that. agent_tasks is the durable
-- commission; agent_runs is one attempt at it.
--
-- ADVISORY, not a gate. Nothing in the decision path consults this table -- any
-- active reviewer may still act on any draft. It drives the default filter on
-- /review and the workload view (Unit 9k). Enforced routing was rejected because a
-- taxonomy typo would lock a draft with no error.
--
-- DEPENDS ON 106 (agent_tasks). Service-role only: RLS enabled with zero policies,
-- matching agent_runs / agent_reviewers / agent_review_decisions.

CREATE TABLE IF NOT EXISTS public.agent_review_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  reviewer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source       text NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual', 'auto')),
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'released', 'superseded')),
  match_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE CASCADE on task_id (the assignment is meaningless without its task) but
-- SET NULL on both user columns, exactly as 112 does: deleting an account must not
-- erase the record that the work was assigned. A row with reviewer_id IS NULL and
-- status 'active' therefore exists as a real state, and application code MUST read
-- it as unassigned -- see listAssignmentsForTasks in lib/agentic/review-routing.ts.

-- The load-bearing constraint: at most ONE active assignment per task. This is what
-- makes auto-assignment idempotent (a second attempt conflicts instead of
-- duplicating) and what stops two concurrent reassignments both landing.
CREATE UNIQUE INDEX IF NOT EXISTS agent_review_assignments_one_active_idx
  ON public.agent_review_assignments (task_id) WHERE status = 'active';

-- Serves both "my queue" and the least-loaded count the matcher needs.
CREATE INDEX IF NOT EXISTS agent_review_assignments_reviewer_idx
  ON public.agent_review_assignments (reviewer_id) WHERE status = 'active';

ALTER TABLE public.agent_review_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_review_assignments FROM anon, authenticated;
GRANT ALL ON TABLE public.agent_review_assignments TO service_role;

COMMENT ON COLUMN public.agent_review_assignments.match_reason IS
  'Why the matcher chose this reviewer (axes matched, candidate count, load at the '
  'time). Debugging aid for routing; empty for manual assignments.';

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (114, '114_agent_review_assignments.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

`supabase/migrations/114_agent_review_assignments_rollback.sql`:

```sql
-- Reverses 114. No other table references agent_review_assignments, so unlike 106's
-- rollback there is no column elsewhere to drop first.
DROP INDEX IF EXISTS public.agent_review_assignments_reviewer_idx;
DROP INDEX IF EXISTS public.agent_review_assignments_one_active_idx;
DROP TABLE IF EXISTS public.agent_review_assignments;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 114;
```

### 5.2 `lib/agentic/review-routing.ts` (new, `server-only`)

Its **own** latch for migration 114 — `isMissingAssignmentSchemaError` in the `.shared.ts` sibling,
never reusing the 111 / 112 / 107 latches (GOTCHAS: one latch per migration group).

- `listAssignmentsForTasks(admin, taskIds)` → `Map<taskId, Assignment>`, active only, with `reviewer_id IS NULL` treated as unassigned.
- `countOpenAssignmentsByReviewer(admin)` → `Map<userId, number>`.
- `assignTask(admin, { taskId, reviewerId, assignedBy, source, matchReason })` — supersede any existing active row, then insert. On unique-index conflict, treat it as "already assigned" and return the existing row rather than throwing.
- `releaseAssignment(admin, taskId, actorId)`.

### 5.3 Wiring

- `agentic-review.ts` gains `assignTaskAction` / `releaseAssignmentAction`, gated on `requireReviewer()` **and** `canAssignWork(reviewer)`.
- `ReviewQueueRow` gains `assignment: ReviewAssignment | null`; `listReviewQueueAction` ([:167](../app/actions/agentic-review.ts#L167)) joins via `run.taskId`.
- The 9h `assignment` filter becomes real.
- `ReviewQueue.tsx` shows an assignee pill and an "Assign to…" row action for editors.

---

## 6. Unit 9j — automatic assignment

### 6.1 `lib/agentic/review-routing.shared.ts` (new, pure)

```ts
export interface RoutableTask { language: string; ageGroup: string; genre: string | null }
export interface RoutableReviewer {
  userId: string;
  languages: string[];
  ageGroups: string[];
  genres: string[];
  openAssignments: number;
}
export type ReviewRoutingOutcome =
  | { assigned: true; reviewerId: string; reason: ReviewRoutingReason }
  | { assigned: false; reason: 'all_ages_pooled' | 'no_language_match'
                             | 'no_age_match' | 'no_active_reviewers' };

export function routeTaskToReviewer(
  task: RoutableTask,
  reviewers: readonly RoutableReviewer[]
): ReviewRoutingOutcome;
```

Algorithm, in this exact order:

1. No reviewers → `no_active_reviewers`.
2. `task.ageGroup === 'all_ages'` → `all_ages_pooled` (**D16**). Checked before any filtering, so the reason returned is honest.
3. Hard filter on `languages.includes(task.language)`. Empty → `no_language_match`.
4. Hard filter on `ageGroups.includes(task.ageGroup)`. Empty → `no_age_match`.
5. `genreMatched = candidates.filter(r => task.genre && r.genres.includes(task.genre))`. Pool = `genreMatched.length ? genreMatched : candidates`. **An empty `genres[]` never excludes anyone** — it means no preference.
6. Pick the lowest `openAssignments`; **tie-break by `userId` ascending**. Deterministic on purpose: a random pick is untestable and cannot be explained to a reviewer who asks why they got a draft.

`reason` records `{ candidateCount, genreMatched, load }`, which is what lands in `match_reason`.

### 6.2 Hook — `lib/agentic/review-routing.ts`

`tryAutoAssignReview(admin, taskId, context)`:

- Returns `void`. **Never throws.** Every failure path logs and returns.
- No-ops when `reviewerWorkflowEnabled` is false, when 113 or 114 is unapplied (latch), or when the task already has an active assignment.
- Loads active reviewers plus open-assignment counts, calls `routeTaskToReviewer`, and on `assigned: true` writes the row with `source: 'auto'` and `assigned_by: null`.
- On `assigned: false`, writes **nothing** and logs at info level. An unrouted task is a normal outcome, not an incident — it is visible in the unassigned pool.

### 6.3 The one edit in `orchestrator.ts`

At [:697-699](../lib/agentic/orchestrator.ts#L697-L699), immediately after the existing
`setTaskStatus` call:

```ts
if (target === 'awaiting_review') {
  await setTaskStatus(admin, updated.taskId, 'awaiting_review', 'persistStageAdvance');
  await tryAutoAssignReview(admin, updated.taskId, 'persistStageAdvance');
}
```

**Import hazard — read this before writing it.** `review-routing.ts` needs `type AdminClient` from
`orchestrator.ts`, and `orchestrator.ts` needs `tryAutoAssignReview` from `review-routing.ts`. That
is a cycle unless the type import is written as `import type { AdminClient }`, which TypeScript
erases. Any value import in that direction creates a genuine runtime cycle.

### 6.4 Tests (`review-routing.shared.test.ts`)

At minimum: `all_ages` is pooled and never assigned; language mismatch is pooled; age mismatch is
pooled; genre preference wins among otherwise-equal candidates; **an empty `genres[]` is not
excluded**; least-loaded wins; the tie-break is deterministic across shuffled input; no reviewers
is pooled.

---

## 7. Unit 9k — workload view

`/admin/authors/workload`, `verifyAdmin()`-gated, read-only. Per reviewer: role, coverage pills,
active assignments, decisions grouped by kind (from `agent_review_decisions`), and the age of the
oldest active assignment. Plus an unassigned-pool count with each row's blocking reason.

Pure query over 112 + 114 — **no schema change**. If this unit turns out to need one, the
assignment model in 9i was wrong.

---

## 8. Verification

Per unit, and again at the end:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build:verify
npm run test:e2e
```

`test:e2e` has now been skipped for three consecutive sessions. **Run it in this one.**

Live proof, which no amount of green suite substitutes for. Every real defect in Phases 6-8 was
found this way, and none by the 934-test suite:

1. Owner applies 113, then 114, on dev by hand. **Never programmatically, never the CLI.**
2. Owner flips `agentic_reviewer_workflow_enabled` on `/admin/agents`.
3. Grant a real non-admin reviewer through the new UI. This is the first time `role` is exercised against a real row rather than the `ADMIN_USER_ID` short-circuit, and the first time `canPublish` returns false for anybody.
4. Sign in as that reviewer and open `/review`. Confirm the queue renders and that `/admin/*` still redirects them away.
5. Give that reviewer `english` + `kids_5_8` and re-drive one run to `awaiting_review`; confirm auto-assignment picks them and that `match_reason` is populated.
6. Commission one `all_ages` task and confirm it lands in the pool, unassigned, with no error.

---

## 9. Deferred — record in PROJECT_STATE

- Per-person capability overrides on top of role (D17).
- Full audit history for role changes; 113 ships `updated_by` only, not a change log.
- `/review` redirects signed-out users to `/` rather than to sign-in with a return URL.
- Enforced (rather than advisory) assignment.
- Reviewer-side notification that work was assigned.
- **Pre-existing, not introduced here:** `autoPublishStoryline` never checks `publicPublishingEnabled` or `moderationRequiredForPublic`, so the auto-publish-on-ending path can publish publicly while the admin switch is off.
