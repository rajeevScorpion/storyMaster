# Phase 9 — Reviewer authorization, the review queue, and agentic narration billing

**Status:** plan, not started. Written 2026-09-09 against `feat/agentic-creator` @ `b886780`.
**Read first:** `docs/agentic-creator-working-memory.md` (the 2026-09-09 handoff), decisions **D6**, **D10**,
**D11**, **D12** in `docs/agentic-creator-decisions.md`.

This plan is a handover document. A fresh session should be able to execute it without re-deriving
discovery. Every fact in §1 was checked against the code or the dev database on 2026-09-09; where it
contradicts an existing doc, the contradiction is called out rather than quietly fixed.

---

## 0. What Phase 9 is

Agent runs finish at `awaiting_review` with a saved draft owned by `AGENTIC_SYSTEM_USER_ID`. Today a human
can look at that draft and can change **nothing** about it. Phase 9 makes a reviewer a real actor:

1. `agent_reviewers` + `requireReviewer()` (D6).
2. A reviewer can **edit**, **narrate**, **generate images for**, and **publish** an agent-owned draft.
3. Unit **8d** — agent narration bills correctly instead of draining a human's wallet.
4. A review queue at `/admin/authors`.

Units 8d and the reviewer-authorization work are two halves of one thing and ship together: neither is
observable alone.

---

## 1. Verified current-state facts

Checked 2026-09-09. Line numbers are from the commit named above.

### 1.1 CORRECTION — Unit 8d's specified derivation is a no-op

The 2026-09-09 handoff says to derive `actorKind` inside `processNarrationJob` from
`job.user_id === process.env.AGENTIC_SYSTEM_USER_ID`. **That condition can never be true on the path 8d
exists to serve.**

`submitStoryNarrationBatch` (`app/actions/narration-batch.ts:141`) stamps the job row with
`user_id: user.id` — the **caller**, resolved from the session cookie — not the story's owner. A reviewer
pressing "narrate" on an agent draft writes *their own* id. `job.user_id` equals the system user only if
the system user itself submitted a batch, and nothing does: D10 removed narration from the pipeline.

So the handoff's prescription would compile, pass every test, bill the reviewer exactly as before, and
look implemented. **This is the decision D13 below exists to settle**, and it is a policy question about
whose money, not a plumbing question.

### 1.2 CORRECTION — the wall is query filters, not RLS

`PROJECT_STATE.md` frames reviewer editing as needing "either a reviewer RLS policy or an admin-client
server-action path". RLS is real but it is **not the binding constraint**, and a migration that only
widens RLS would fix nothing observable. Every write path carries its own hardcoded ownership filter in
application code:

| Path | Guard | File |
|---|---|---|
| Narration submit | `if (data.user_id !== userId) throw new Error('Forbidden.')` | `app/actions/narration-batch.ts:132` |
| Image submits (both) | same `loadOwnedStory` shape | `app/actions/image-batch.ts:154-163`, called at `:301`, `:837` |
| Beat text edit | `.eq('user_id', user.id)` inside `requireOwnedStory` | `app/actions/beat-control.ts:119-135` |
| Beat save | `.eq('generated_by', user.id)` | `app/actions/persistence.ts:744` |
| Publish | `.eq('user_id', user.id)` | `app/actions/persistence.ts` (`publishStoryline`, `autoPublishStoryline`) |

Note the narration and image guards run on the **service-role client** — RLS is already bypassed at the
query level there, and `loadOwnedStory` *is* the entire access-control boundary. Those two need **no
migration at all**, only a code change.

### 1.3 RLS as it actually stands (queried on dev, not read from a migration)

```
stories  SELECT  is_archived = false AND auth.uid() IS NOT NULL   (plus owner-only, plus anon gallery)
stories  UPDATE  auth.uid() = user_id
beats    UPDATE  generated_by = auth.uid()          <-- NOT story ownership
beats    INSERT  auth.uid() IS NOT NULL AND generated_by = auth.uid() AND story not archived
```

`beats.UPDATE` is a **differently shaped** predicate from `stories.UPDATE`, and no doc records it. A fix
that widens only `stories` lets a reviewer rename the story and then fail on every beat edit. (Only
migrations 001 and 003 ever touch `stories` RLS; UPDATE has never been altered since 001.)

`agent_runs` has RLS **enabled with zero policies** — service-role only, by design. The review queue must
therefore read through admin-client server actions, exactly as `RunMonitor` already does.

`narration_batch_jobs` SELECT is `auth.uid() = user_id`. This matters to D13: re-stamping the payer takes
the job row out of the submitting reviewer's own RLS visibility.

### 1.4 The billing chain, as it really is

Traced hop by hop. **There is no shared `serverAuth` type** — it is four separately-declared inline
`{ userId: string }` shapes in four files, and half the chain flattens it away:

| # | Function | File:line | Carries |
|---|---|---|---|
| 1 | `processNarrationJob` (private) | `app/actions/narration-batch.ts:244` | `job.user_id` |
| 2 | `generateAndPersistStoryNarrationWithOverlay` | `app/actions/story-narration.ts` | `serverAuth: { userId }` |
| 3 | `generateAndPersistNarration` | `app/actions/narration.ts` | `serverAuth: { userId }` |
| 4 | `runMeteredNarrationOperation` (private) | `app/actions/narration.ts:85` | flat `userId?: string \| null` |
| 5 | `authorizeCoinOperationForUser` | `lib/pricing/coin-economy.ts:69` | flat `userId: string \| null` |
| 6 | `authorizeBillableAction` | `lib/pricing/enforcement.ts:213` | flat `actorKind?: 'user' \| 'agentic_system'` |
| 7 | `buildMeteredStoryOverlayTiming` (private) | `app/actions/story-narration.ts:301` | flat **required** `userId: string` |

The single defect is `coin-economy.ts:117-134`: the object literal forwarded to `authorizeBillableAction`
has **no `actorKind` key**, so the bypass is structurally unreachable from every narration path.

**The design rule that follows:** `actorKind` rides beside `userId` wherever `userId` already sits — inside
`serverAuth` at hops 1-3, flat at hops 4-7. Do **not** try to push a `serverAuth` object down the whole
chain; that shape is not precedented anywhere, including at hop 6 where `actorKind` already exists flat.

There is no named `ActorKind` type anywhere — it is an inline union at hop 6. Introducing one is optional.

### 1.5 The bypass branch, and why the metered path already tolerates it

`lib/pricing/enforcement.ts:281-294`. The bypass requires **three** conditions plus an implicit fourth —
`actorKind === 'agentic_system'`, the `agentic_billing_bypass_enabled` flag,
`process.env.AGENTIC_SYSTEM_USER_ID` truthy, and `input.userId === systemUserId`. `actorKind` is tested
first so a human call never pays the flag read. It returns `status: 'bypassed'`.

**`runMeteredNarrationOperation` already handles `bypassed` correctly, by construction** — verified at
`app/actions/narration.ts:108-140`:

- only `status === 'denied'` throws;
- the release path is guarded `status === 'allowed' && authorization.reservationId`;
- the finalize path carries the same guard.

A bypass therefore skips reserve, finalize and release with **zero changes to the reserve→finalize/release
cycle**. This is the decisive argument against the alternative in §2.

### 1.6 The precedents that already exist

- `lib/agentic/story-assembly.ts:386-394` already calls `authorizeBillableAction` **directly** with
  `actorKind: 'agentic_system'` and accepts `bypassed`/`allowed`. It is the only code that reaches the
  bypass today. It is a precedent for the *value*, not for a parallel billing path (see §2).
- `app/actions/admin-media-pipeline.ts:198-214` (`requeueImageJob`) is the house pattern for
  "`verifyAdmin()` verified → admin client writes to any story's beats, no per-row ownership check". A
  survey of seven admin-client write sites found this is the **only** one without an ownership check
  somewhere in its call chain — so it is the sole precedent, not a common idiom.
- `app/actions/persistence.ts:897-1095` — the `serverAuth?: { userId: string }` escape hatch swaps to the
  admin client and drops the `generated_by` / `user_id` filters at `:998`, `:1014`, `:1095`. Exactly one
  caller in the codebase supplies it (`narration-batch.ts:328`) and it always passes the story owner's own
  id — **never** for impersonation. Not reusable for reviewer writes; it is only the shape to imitate.

### 1.7 Dev database state

- Ledger: 102-108 and 110 applied. **No 109 and there never will be** — that gap is deliberate and
  permanent (a dropped `agentic_narration_enabled` flag, per D10). **The reviewer migration is 111.**
- `agent_reviewers` does not exist.
- 5 runs at `awaiting_review`; 5 agent stories, all owned by `616af55e-8dfa-4a3e-bb0f-802462ef3333`.
- Costs: `generate_story_narration` 0.50 + `align_story_text_overlay` 0.30 = **0.80/beat**.
- The system user has **no entitlement override → free tier**, and **5.00 beats**. An 8-beat story needs
  6.40, so today it would die partway — but only on the path where the system user pays at all.
- `image_generation` is `free_enabled: false`.
- **Production has none of 102-111.**

### 1.8 CORRECTION — the image entitlement note in the architecture doc is wrong

`docs/agentic-creator-architecture.md` says images will need "promoting the system user's entitlement
tier". **The system user's tier is irrelevant to the image path.** Both image submits call
`assertImageGenerationEntitled(user.id)` (`app/actions/image-batch.ts:323`, `:861`) and
`authorizeCoinOperationForUser({ userId: user.id })` (`:373`, `:882`) — the **caller**, not the story
owner. A reviewer on a paid tier passes the gate and pays for the images out of their own wallet.

Note also that `assertImageGenerationEntitled` returns a `PlanKey` consumed downstream for image-model
resolution, so it is not a boolean gate that can simply be skipped.

This is the same money question as D13, in a second place. Images are **out of scope** for this phase
beyond the `Forbidden.` fix; the billing half is deferred and recorded in §6.

### 1.9 Test coverage

**Zero unit tests** cover any function in the billing chain, or the bypass branch itself.
`coin-economy.shared.test.ts` tests pure quote math only. Anything Unit 9d adds is the first coverage
this path has ever had.

---

## 2. Rejected: mirroring `story-assembly`'s direct call

Tempting, because `story-assembly.ts:386` proves it works: skip `authorizeCoinOperationForUser` entirely
and call `authorizeBillableAction` with `actorKind` directly from the narration path.

**Rejected.** It creates a second billing path for narration that skips
`runMeteredNarrationOperation`'s reserve→finalize/release cycle — the cycle that releases a reservation
when the provider fails. D12 already paid for this lesson in the re-brief work: a parallel implementation
of a paid call is how you get an unbilled call or a duplicate-key collision, silently either way. And
§1.5 removes the only motivation: the existing metered path **already** no-ops correctly on `bypassed`, so
threading one optional field reuses the whole cycle for free.

---

## 3. Decisions this plan needs

### D13 — whose wallet pays when a reviewer narrates an agent draft? **RESOLVED 2026-09-09**

**Nobody.** The system user is the payer of record: stamp the job with the story owner, derive `actorKind`
from it, let the bypass fire. Full reasoning and the two rejected alternatives are in
`docs/agentic-creator-decisions.md` under **D13**. Unit 9d is unblocked and its step 1 below is correct
as written.

### D14 — reviewer writes go through a shared authorization helper, not widened RLS

**Proposed.** Add `requireReviewer()` mirroring `verifyAdmin()`, and a single shared helper —
`assertCanEditStory(storyId, userId)` in `lib/agentic/reviewers.ts` — that returns the story when the
caller is **either** the owner **or** an active reviewer and `stories.agent_persona_id IS NOT NULL`. Every
guard in §1.2 delegates to it. Reviewer writes then run on the admin client, following `requeueImageJob`.

**Why not RLS.** §1.2: the query filters are the binding constraint, so an RLS-only change is invisible.
Widening `stories.UPDATE` *and* `beats.UPDATE` for reviewers would additionally mean two policies
referencing a new table on every story write for every user, forever, to serve a handful of admin edits.
The predicate is also awkward: `beats.UPDATE` keys on `generated_by`, not ownership.

**Cost.** Reviewer writes bypass RLS, so `requireReviewer()` becomes load-bearing security. It is the same
trust model `verifyAdmin()` already carries across ~40 admin pages and 25 files.

---

## 4. Units

Each unit is one commit. Gate after each: `npx tsc --noEmit`, `npm run lint`, `npm test`.
Full gate (`build:verify`, `test:e2e`) before declaring the phase done.

### Unit 9a — `agent_reviewers` + migration 111

**Files:** `supabase/migrations/111_agent_reviewers.sql` + `_rollback.sql`, `lib/agentic/reviewers.ts`,
`lib/agentic/reviewers.shared.ts` + `.test.ts`.

Complete migration SQL, ready to paste — the ledger row is mandatory (WORKING_AGREEMENTS):

```sql
-- 111_agent_reviewers.sql
-- Phase 9 (D6): reviewers get their own additive table rather than a role column on
-- admin_user_directory, which is a trigger-synced mirror of auth.users and not a place
-- to put authorization state. ADMIN_USER_ID is implicitly a reviewer in code, not here.
create table if not exists public.agent_reviewers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  status             text not null default 'active'
                       check (status in ('active', 'suspended')),
  can_publish        boolean not null default false,
  can_trigger_media  boolean not null default false,
  display_name       text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null
);

comment on table public.agent_reviewers is
  'Phase 9 reviewers for agent-generated drafts. Additive to the user model: no role column exists '
  'anywhere else. Read only through requireReviewer() on the service-role client -- RLS is enabled '
  'with no policies, matching agent_runs.';

create index if not exists agent_reviewers_status_idx
  on public.agent_reviewers (status) where status = 'active';

-- Service-role only, exactly like agent_runs: enabled, no policies, all access via admin client.
alter table public.agent_reviewers enable row level security;

insert into public.schema_migration_ledger (migration_number, file_name)
values (111, '111_agent_reviewers.sql')
on conflict (migration_number) do nothing;
```

```sql
-- 111_agent_reviewers_rollback.sql
drop index if exists public.agent_reviewers_status_idx;
drop table if exists public.agent_reviewers;
delete from public.schema_migration_ledger where migration_number = 111;
```

`reviewers.ts` exports `requireReviewer()` — mirroring `verifyAdmin()` in `lib/supabase/admin.ts`, throwing
on failure, treating `ADMIN_USER_ID` as implicitly a reviewer with all capabilities — and
`assertCanEditStory(storyId, userId)` per D14. Capability checks (`can_publish`, `can_trigger_media`) are
pure and live in `reviewers.shared.ts` with the tests.

**Fails closed:** if `agent_reviewers` is absent (production has none of 102-111), `requireReviewer()`
must deny for everyone except `ADMIN_USER_ID` rather than throw a 500. Detect the missing relation on the
query error; do not probe `information_schema` on every call.

### Unit 9b — the four `Forbidden.` guards

**Files:** `app/actions/narration-batch.ts:125-134`, `app/actions/image-batch.ts:154-163`,
`app/actions/beat-control.ts:119-135`, `app/actions/persistence.ts:744`.

Each guard delegates to `assertCanEditStory`. `loadOwnedStory` in the two batch files already runs on the
admin client, so this is a pure predicate swap. `requireOwnedStory` in `beat-control.ts` must additionally
switch to the admin client when the caller is a reviewer rather than the owner, because its `.eq()` runs on
the session client.

`can_trigger_media` gates the narration and image submits; plain review access does not.

**Do not touch** `processNarrationJob`, `runNarrationJob`, `reconcileStoryNarration`,
`reconcileActiveNarrationJobs`. They deliberately carry no ownership check — they are worker/cron paths
where ownership was established at submit.

### Unit 9c — the review queue at `/admin/authors`

**Files:** `app/admin/authors/{layout,page}.tsx` + `reviewers/page.tsx`, `app/actions/agentic-review.ts`,
`components/admin/agentic/ReviewQueue.tsx`, `lib/admin/nav.ts:341-440`.

Nav is data-driven from `lib/admin/nav.ts`. Add a **second top-level item inside the existing `agentic`
group**, sibling to `Agents`, with its own `AUTHORS_CHILD_GROUPS` — the flag's own doc comment and the
architecture doc both name `/admin/authors`, so do not nest it under `/admin/agents`.
`app/admin/authors/layout.tsx` is a thin `verifyAdmin()` re-guard shell, copying
`app/admin/agents/layout.tsx` verbatim.

The queue lists runs at `awaiting_review` joined to their story and evaluation, filtered by
`review_readiness` (`deriveReviewReadiness` at `lib/agentic/evaluation.shared.ts:368`:
`fail → needs_rewrite`, else `ready_for_review`). Reuse `RunMonitor`'s `EvaluationEntry`, `shortId`,
`formatDateTime`, `stageLabel` rather than re-inventing them. All reads go through admin-client server
actions — `agent_runs` has no RLS policies.

Behind `reviewerWorkflowEnabled`, failing closed per D8. Dropdowns use `FilterDropdown`; row actions use
`RowActionsMenu`.

### Unit 9d — agentic narration billing (was 8d)

Per D13 (resolved — the system user is the payer of record and the bypass fires):

1. `app/actions/narration-batch.ts:141` — when the story is agent-owned, stamp the job's `user_id` with
   the **story owner** (the system user) instead of the caller. Record the submitting reviewer in the job's
   metadata so the queue can still show who pressed it.
2. `processNarrationJob:244` — derive `actorKind: job.user_id === process.env.AGENTIC_SYSTEM_USER_ID ?
   'agentic_system' : 'user'` and put it in the `serverAuth` object at `:328`. Deriving it **here**, not at
   submit, is what keeps the bypass alive through `reconcileStoryNarration` and
   `reconcileActiveNarrationJobs`, which both re-enter with no agentic context.
3. Add `actorKind?: 'user' | 'agentic_system'` beside `userId` at hops 2-7 (§1.4) and forward it. The only
   semantic change is one new key in the literal at `lib/pricing/coin-economy.ts:117-134`.
4. `buildMeteredStoryOverlayTiming` (`story-narration.ts:301`) takes it flat and forwards it, so the 0.30
   alignment rides the same bypass as the 0.50 narration.
5. **No changes to reserve/finalize/release** — §1.5.

**Tests — the first this chain has ever had.** At minimum: `actorKind` is forwarded by
`authorizeCoinOperationForUser`; the bypass needs all four conditions; a human call is byte-for-byte
unchanged; the derivation survives a reconcile re-entry.

**Do not trust the claim.** `authorizeBillableAction` re-checks the id and the flag independently, and
that is deliberate — a caller asserting `actorKind` is not sufficient.

### Unit 9e — reviewer decisions

Approve / reject / request-rewrite recorded against the run, and publish gated on `can_publish`. Shape
this only after 9c exists; it is the least constrained unit.

**CORRECTION (2026-09-09, D15).** The line above originally said "reusing `publishStoryline`". That is
wrong on two counts, both verified:

1. `publishStoryline` (`app/actions/persistence.ts:2168`) takes `beats`, `choices` and `nodePath` as
   parameters, built by its only caller — `components/story/PublishDialog.tsx:195` — from the
   client-side Zustand session. An admin review queue has no such session. The server-side publish is
   **`autoPublishStoryline` (`:1217`)**, which derives all three itself by walking `parent_node_id` to
   the root through `walkPathToRoot` (`:1195`) and takes only
   `(storyId, endingNodeId, storyTitle, coverImageUrl?)`. That is the base to build on.
2. Both paths stamp the **caller** as the storyline's owner and author — `user_id: user.id` at `:2244`
   / `:1468`, `author_name: profile?.display_name` at `:2266` / `:1484`. A reviewer publish would put a
   staff account's name on the story. **D15** resolves this: the system user owns the storyline, the
   persona supplies the author name, and the write runs on the admin client because
   `autoPublishStoryline`'s session client would have RLS refuse a row it does not own.

---

## 5. Verification

Static gate per unit as above. **The phase is not done until it has been run against a live database** —
every real defect in Phases 6, 7 and 8 was found that way and none by the 877-test suite.

```sql
-- 9a: the table and the ledger row
select * from public.schema_migration_ledger where migration_number = 111;

-- 9b: a reviewer edit actually landed on an agent draft
select id, user_id, title, updated_at from public.stories
 where agent_persona_id is not null order by updated_at desc limit 3;

-- 9d: the bypass fired and nothing was charged
select action_key, status, reason from public.beat_spend_reservations
 where related_story_id = '<agent story>' order by created_at desc;      -- expect zero rows
select sum(beats_remaining) from public.beat_grants
 where user_id = '616af55e-8dfa-4a3e-bb0f-802462ef3333';                 -- expect still 5.00
select task_key, phase, cost_usd from public.ai_cost_events
 where related_story_id = '<agent story>' order by created_at desc;      -- expect real TTS spend
```

The third and fourth queries together are the whole point of 9d: **real provider cost, zero coin
movement.** Check the reviewer's own wallet is untouched too.

---

## 6. Deferred, recorded not dropped

- **Image billing for agent drafts** (§1.8). 9b lets a reviewer press the button; the images bill the
  reviewer. Needs its own decision, and the answer is not narration's: image batches hold **one
  reservation for the whole job** where narration reserves per beat.
- **`retryRun` cannot re-brief** — already in PROJECT_STATE; belongs with whoever next touches `retryRun`.
- **A succeeded run keeps a stale `error_category`** — the admin row reads "Succeeded" beside an error.
- **The re-brief path (`81f16f8`) has still never executed live.** Unrelated to Phase 9, still unproven.

---

## 7. D13, as decided

Resolved 2026-09-09: **nobody pays.** The system user becomes the job's payer of record, `actorKind`
derives from it inside `processNarrationJob`, and the bypass fires — real provider spend in
`ai_cost_events`, zero coin movement, the reviewer's own wallet untouched. The submitting reviewer is
kept in the job metadata.

The two rejected options — the reviewer paying personally, and deriving `actorKind` from the story while
leaving the reviewer as the job's user — are recorded with their reasons in
`docs/agentic-creator-decisions.md` under **D13**. The second is the dangerous one: it fails the bypass's
`userId === systemUserId` condition, and making it pass would weaken the only check that makes a claimed
`actorKind` non-forgeable.
