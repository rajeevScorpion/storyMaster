# Agentic Creator — Phase 10 and the closing rounds

Continues [agentic-creator-phase9c-plan.md](agentic-creator-phase9c-plan.md) and its handoff. Phase 9's
units are all built. This document plans **everything that remains** and sequences it into five rounds.

Owner-approved scope, 2026-09-12. Written to the standard in
[WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md): a fresh session must execute this without
re-deriving discovery.

---

## 0. What the owner decided, 2026-09-12

1. **Creation mode becomes owner-or-reviewer.** A signed-in user must not be able to edit or explore
   anyone else's story in creation mode. This was previously filed under "pre-existing, unrelated"; it is
   neither.
2. **Shared branching goes dormant.** Forking someone's story to take it in a different direction was the
   original intent and remains wanted *later*. For now it is switched off, not deleted.
3. **The reviewer queue is scoped to assigned work** for role `reviewer`. An **editor** still sees
   everything — they are the ones who assign. This retires "My assignments" as a separate concept.
4. **`/review` keeps the normal app header**, so a reviewer can get back to `/` and the rest of the
   profile menu.
5. **Assigned-task count** shows as a bubble in the profile menu beside "Review queue".
6. **Phase 10 is reviewer-driven images, with no automation.** Beat-by-beat, batch and external all work
   already. Nothing is being automated now.
7. **Phase 11 does not exist** — the numbering jumped 10 to 12 and nothing was ever written for 11. The
   old Phase 12 (separating agent spend from human spend) is **renumbered to Phase 11** so the sequence is
   honest.
8. **Finish the phases first, then one tightening round.**

---

## 1. Verified current-state facts

Checked by reading code and migrations on 2026-09-12. Where a claim is inferred rather than observed, it
says so.

| Fact | Evidence |
|---|---|
| `/story/[id]` has **no server-side ownership gate**. It is a `'use client'` page that loads through the store. | `app/story/[id]/page.tsx` line 1 |
| `stories` SELECT RLS admits any signed-in user to any non-archived story. | phase9c-plan 1.2, re-confirmed |
| `beats` INSERT admits any signed-in user into **anyone's** non-archived story; `beats` UPDATE keys on `generated_by`, not the story owner. | `supabase/migrations/003_normalize_beats.sql` lines 119-127 |
| Shared branching is a **real working feature**, and `saveBeat` is its persistence path. Phase 9 nearly broke it by gating `saveBeat`. | `docs/agent-context/GOTCHAS.md` line 293 |
| `/review`'s header is a bare `span` — no link home, no profile menu. | `app/review/layout.tsx` lines 37-39 |
| `/review` shows **all** rows unless `?assignment=mine`. The sidebar's "My assignments" is the same page under a filter, not a route. | `app/review/page.tsx` lines 15-26; `components/review/ReviewSidebar.tsx` lines 37-58 |
| Reviewer standing already rides the pricing-runtime payload as `{ role } | null`, fetched once per session and cached. | `app/actions/pricing-runtime.ts` line 193; `lib/agentic/reviewers.ts` lines 175-187 |
| `beat_spend_reservations` **already carries `user_id`** (the payer) and `related_story_id`. | `supabase/migrations/017_wallet_core.sql` lines 30-44 |
| `pricing_finalize_reservation` matches `WHERE id = p_reservation_id AND user_id = p_user_id`. The user id is a **guard**; the reservation row is the source of truth for the payer. | `supabase/migrations/021_pricing_enforcement_primitives.sql` lines 175-176 |
| `finalizeCurrentUserBillableAction` / `releaseCurrentUserBillableAction` override that payer with `getCurrentUserId()`. | `app/actions/pricing-enforcement.ts` lines 64-89 |
| `publishStoryline` checks `publicPublishingEnabled`; `autoPublishStoryline` does not. | `app/actions/persistence.ts` line 2283 vs line 1295 |
| Migrations **113 and 114 are applied on dev and frozen.** The next number is **115**. Production has no agentic schema at all. | phase9d handoff section 5 |

---

## 2. Decisions

### D23 — shared branching goes dormant at the database, not behind a feature flag

Kissago's convention is to ship behaviour behind a `feature_flags` row. **This one does not get a flag.**

**Why.** The enforcement point is `beats` RLS, and a Postgres policy cannot cheaply read a `feature_flags`
row. A flag would therefore be a lie: flipped on, writes would still be refused at the database, and the
failure would present as "branching is enabled but silently does nothing" — the exact silent-write class of
bug that has already cost this phase four separate fixes.

Dormancy is instead **migration 115** (narrow the policy) plus removing the entry point. Re-enabling later
is `115_..._rollback.sql` plus restoring the entry point, recorded in PROJECT_STATE so it is one lookup,
not an excavation.

*Rejected:* a `shared_branching_enabled` flag gating application code only. Server actions are directly
invocable, so the flag would gate the button while the database still accepted the write.

### D24 — creation mode is owner-or-reviewer, enforced server-side at the route

`/story/[id]` **and `/explore/[id]`** each gain a **server-component layout** that resolves access and
redirects a non-owner to `/storyline/[id]` where one exists, `/` otherwise. The predicate already exists as
`assertCanEditStory` — owner, or an authorized reviewer on an agent draft — so this adds a gate, not a new
rule.

> **Corrected 2026-09-12.** This decision first said the layout redirects a non-owner *to* `/explore/[id]`,
> which section 3 then contradicted by gating that route too. The text above is the operative version. The
> executing agent caught the inconsistency and followed section 3, which was right.

**A signed-out visitor is NOT a non-owner for this gate's purposes.** Both pages already handle anonymity
themselves by opening the sign-in dialog with a return URL back to the story
(`app/story/[id]/page.tsx` lines 56-61, `app/explore/[id]/page.tsx` lines 50-53). A layout that redirects
on `!user` destroys that and bounces someone away from their *own* story. The gate must therefore let
signed-out through to the page and refuse only a **signed-in** non-owner. This is safe because `loadStory`
and `loadStoryTree` both require a session and throw for an anonymous caller, so nothing loads and nothing
leaks.

*Why a layout, not the page:* the page is `'use client'` by necessity (it drives the store). A sibling
server layout is how `/admin` and `/review` already gate, so this matches the codebase rather than
inventing a third shape.

### D25 — finalize and release read the payer from the reservation, never from the session

The 9c plan (11.5) proposed making all three interactive-image billing endpoints accept a story-derived
payer, and correctly flagged the hazard: a client-supplied `storyId` deciding who pays, on three endpoints.

**That is not necessary.** `beat_spend_reservations` already stores `user_id` and `related_story_id`, and
the finalize/release RPCs already match on the reservation id. So:

- **`authorize`** is the only endpoint that derives a payer from a story, and it already has to run
  `assertCanEditStory`.
- **`finalize` and `release`** look the reservation up, use **its** `user_id` as the payer, and prove the
  caller's authority with `assertCanEditStory(reservation.related_story_id)`.

The client never says who pays. **No migration.** This is smaller *and* safer than the sketch it replaces.

---

## 3. Round 1 — creation mode becomes owner-or-reviewer

Audit completed 2026-09-12. Findings in 3.1; sequencing constraint in 3.2; the work itself in 3.3.

**Owner decision, 2026-09-12:** `/explore/[id]` is **owner-or-reviewer only**, the same gate as
`/story/[id]`. Non-owners read published work at `/storyline/[id]`. This closes the exposure of
*unpublished* branches alongside the branching itself, and is the more literal reading of "users shall not
be able to edit/explore anyone else's stories".

### 3.1 Confirmed by audit, 2026-09-12

- **`/story/[id]` has no server-side gate of any kind.** `loadStory` (`app/actions/persistence.ts` line
  558) uses the **session client** and checks only that *someone* is signed in — there is no
  `.eq('user_id', …)` and no post-fetch owner comparison anywhere in the function. It returns
  `savedByUserId: story.user_id`, so the owner's id is right there in the payload and simply never
  compared. A non-owner gets a fully functional creation-mode editor.
- **Reading `/explore/[id]` does write** — an `explored_stories` upsert (`app/actions/exploration.ts`
  lines 316-329) on every non-owner load. It is per-user bookkeeping, **not** a story mutation, so
  narrowing `beats` RLS does not affect reading.
- **`sourceStoryOwnerId` is set for owner and non-owner alike** in `loadStoryTree`; `explorationMode` is
  the actual non-owner signal. The 9c plan's 10.1 leaned on `sourceStoryOwnerId` as the non-owner flag —
  do not repeat that reading.
- **The doorway is one link:** `components/story/StorylinePlayer.tsx` lines 1328-1337, "Explore full story
  tree", `href={/explore/${storyId}}`, gated only on `isLoggedIn` with **no ownership check**.
- **`saveBeat` is exactly as GOTCHAS describes it** — the helper decides routing only, and an explorer
  falls through to the session client. No correction needed to that doc.
- **RLS is the only thing permitting an explorer's beat write.** The reviewer path uses the admin client
  and bypasses RLS entirely, so it is unaffected by migration 115.
- For an explorer the follow-up `stories.story_map` patch is filtered `.eq('user_id', <explorer>)` and
  therefore **never matches** — it silently skips today. Explorer branches live only in normalized `beats`.

### 3.2 The sequencing constraint — gate BEFORE the spend

**This is the part that must not be got wrong.** `continueStory` runs
**`authorize → generate → plan → save`** (`lib/store/story-store.ts` line 4024). The coin reservation and
the AI generation both happen *before* the beat write.

So narrowing `beats` RLS **on its own** would produce exactly the defect this phase has already paid for
four times: the confirm dialog takes the coins, the model generates the beat, and the write is then
refused at the database with nothing to show for it. That would be the **fifth** member of the
charge-and-write-nothing family, introduced by the very change meant to tighten things.

Round 1 therefore lands in this order, and a partial landing is worse than none:

1. **Remove the doorway** — `StorylinePlayer.tsx`'s "Explore full story tree" link.
2. **Refuse the continuation server-side, before `authorize`** — a non-owner, non-reviewer continuation
   must fail at the top of the path, not at the database at the bottom of it.
3. **Narrow `beats` RLS (migration 115)** as the backstop for direct server-action invocation.
4. **Gate `/story/[id]`** with the server layout (D24).
5. **Add the publishing-switch check** to `autoPublishStoryline`.

Steps 1 and 2 are what make step 3 safe. Ship them together.

### 3.3 The work, in landing order

Each numbered item is one commit. Stage explicit paths; never `git add -A`.

**1. Close the doorway.** Remove the "Explore full story tree" link at
`components/story/StorylinePlayer.tsx` lines 1328-1337. It is the only non-owner entry point into
`/explore/[id]` (audit §3). Everything else linking to `/story/[id]` is already scoped by its data source.

**2. Gate both creation-mode routes (D24).** A server-component layout resolving access through
`assertCanEditStory`, redirecting a non-owner to `/storyline/[id]` where one exists and `/` otherwise:

- `app/story/[id]/layout.tsx` (new)
- `app/explore/[id]/layout.tsx` (new)

Mirror `app/review/layout.tsx`'s shape — `try { … } catch { redirect(…) }`. Do **not** convert either page
away from `'use client'`; they drive the store and must stay as they are.

**3. Refuse the continuation server-side, before `authorize`.** Per 3.2 this must fail at the top of the
path, never at the database. With step 2 in place a non-owner cannot reach the screen at all, so this is
defence in depth against direct server-action invocation — which is exactly the hazard this codebase keeps
being bitten by.

**4. Migration 115 — narrow `beats` INSERT and UPDATE (D23).** Plus its `_rollback.sql` twin, plus the
`schema_migration_ledger` insert and the matching ledger delete in the rollback. Produce the file only;
**never apply it.** The owner applies it by hand, on dev first. Code must fail closed while it is
unapplied — the application gates in steps 1-3 do the real work, so an un-migrated database simply keeps
today's behaviour rather than breaking.

**5. `publishStoryline` gains a source-story ownership check.** Audit §5 found it has **no ownership check
on the source story at all**; `storylines` INSERT RLS only requires `user_id = auth.uid()`, so a non-owner
can publish a storyline built from someone else's tree and credit themselves. The 9c plan (11.3) recorded
this as *intended* for shared branching. With branching dormant, that justification is gone and the check
belongs there. Keep the existing agent-draft guard (`assertNotAnotherUsersAgentDraft`) — this is an
additional check, not a replacement.

**6. `autoPublishStoryline` honours the publishing switch.** It never calls `getMediaPipelineSettings()`
and hardcodes `is_public: true` in both write branches (`app/actions/persistence.ts` lines 1433 and 1568),
setting neither `moderation_status` nor `visibility`. `publishStoryline` does both at lines 2282-2288 and
2354-2361 — mirror it. `lib/agentic/review-publish.ts`'s header comment already describes this gap
accurately; `MEDIA_PIPELINE_FINAL_REVIEW.md` line 74 undersells it and should be corrected.

### 3.4 Found by the audit, NOT in Round 1 — reported, with reasons

- **`stories` carries an anonymous SELECT policy** — `USING (is_archived = false)`, no auth predicate at
  all (`003_normalize_beats.sql` lines 219-222). Any anonymous caller can read any non-archived story row,
  **including unpublished drafts**. The comment says "for gallery metadata", but the policy is on the whole
  table rather than on published rows.

  **Not bundled into 115 on purpose.** Narrowing it blind could break the front door, and the front door is
  the product. It needs one targeted question answered first — *what actually reads `stories` anonymously,
  and does the gallery depend on it or does it read `storylines`?* — then either a narrowing to published
  rows or a removal. Treat as **Round 1b**, immediately after Round 1, not as a fifth thing in Round 1.

- **`storylines` has no UPDATE policy anywhere**, in any of the 222 migration files. This is fail-closed, so
  it is a note rather than a hole: every storyline update must already be going through the service-role
  client. Recorded so nobody adds a session-client update and is baffled when it silently writes nothing.

- **`storage.objects` lets any authenticated user read the `story-assets` bucket**
  (`003_normalize_beats.sql` lines 228-234), with the comment "needed for exploration of other users' story
  trees". With exploration gated to owner-or-reviewer, that justification expires too. Same treatment as
  the anonymous policy: Round 1b, after checking what actually serves images today.

### 3.5 Blast radius — verified, essentially nil

The audit checked this specifically. Every reviewer write site uses the **admin client**, which bypasses
RLS entirely, so migration 115 cannot affect the reviewer path. The agentic pipeline never writes `beats`
through a session client (only `lib/agentic/review-publish.ts`, admin-only). No `app/api/` route writes
`beats` outside admin-client workers. Properly-gated already, and untouched: `beat-control.ts` (all six
functions), `image-batch.ts`, `narration-batch.ts`, `beat-bundle.ts`, `episodes.ts`.

**Only shared branching breaks — which is the point.**

Verified directly while reviewing 115, beyond what the audit was asked for:

- Both `DROP POLICY` names in 115 match `003_normalize_beats.sql` exactly ("Authenticated users can insert
  beats" line 120, "Beat generator can update own beats" line 132). This matters more than it looks:
  RLS policies are **OR'd**, so a misspelled name in a `DROP … IF EXISTS` would no-op and leave the
  permissive policy standing beside the new one, making the migration ineffective while appearing to apply
  cleanly.
- The agentic pipeline passes the **admin client explicitly** — `saveStoryForUser(admin, systemUserId, …)`
  at `lib/agentic/story-assembly.ts` line 1280 — so headless agent generation bypasses RLS and 115 cannot
  affect it.

### 3.6 A consequence of 115 to understand BEFORE applying it to production

Dev has no real shared-branching data. **Production does** — branching has been live there, so real stories
may carry beats with `generated_by = <some explorer>` and `stories.user_id = <the owner>`.

After 115, such a beat satisfies neither new policy through the session client: the explorer fails
`s.user_id = auth.uid()`, and the owner fails `generated_by = auth.uid()`. **Those existing beats become
immutable via the session client.**

In practice this is narrow rather than alarming, and should be confirmed rather than assumed:

- Batch narration and batch images run on the **admin client** in the worker, so "narrate/illustrate the
  whole story" is unaffected on such beats.
- The interactive single-beat path already refuses someone else's beat today (`updateBeatMediaState` throws
  `BEAT_ROW_NOT_FOUND`), so 115 removes nothing that currently works there.

**Owed before production:** count the affected rows on prod —
`select count(*) from beats b join stories s on s.id = b.story_id where b.generated_by <> s.user_id` — and
decide deliberately whether to leave them, reassign `generated_by` to the story owner, or keep them
read-only. Dev-first application is unaffected either way.

---

## 4. Round 2 — Unit 9J proven live (owner-driven)

Unchanged in substance from the 9d handoff, but **its priority has changed**: scoping the queue to
assigned-only (Round 3) makes auto-assignment load-bearing. An unassigned draft stops being merely
unlabelled and becomes *invisible to every reviewer*. So 9J must be proven working before Round 3 ships.

**The owner drives this test.** Do not start it; wait to be asked. Re-drive a run to `awaiting_review` and
confirm `agent_review_assignments` gains a row with `source='auto'` and a populated `match_reason`. The
`all_ages` pooling case (D16) still has no fixture.

**Consequence to handle in Round 3 regardless:** the queue needs an honest empty state that distinguishes
"nothing is assigned to you" from "nothing is waiting", so a reviewer is never shown a blank page that
looks like a bug.

---

## 5. Round 3 — the reviewer workspace

### 5.1 `/review` keeps the app header

`app/review/layout.tsx` currently renders a bare `span`. Replace it with the same header `/story/[id]`
uses — `KissagoLogo` linking to `/`, and `UserMenu`. The sidebar and the `requireReviewer()` gate stay
exactly as they are.

The layout is a server component and `UserMenu` is a client component; that composition is already used
elsewhere and needs no change to either.

### 5.2 The queue is scoped by role

- Role **`reviewer`** — sees only rows whose active assignment is theirs. Resolve this **server-side** from
  the session, never from a client-supplied filter.
- Role **`editor`** — sees everything, and keeps the assignment dropdown.

`ReviewQueueListFilters.assignment` already supports `'mine' | 'unassigned' | 'all'` and already resolves
`'mine'` against the session user rather than trusting the caller (`app/actions/agentic-review.ts` lines
149-159). So this is a **default and a clamp**, not new filtering: for a plain reviewer, force `'mine'` and
ignore any other value that arrives.

Do the clamp in `listReviewQueueAction` itself, not in the page. Server actions are directly invocable, so
a page-level default gates nothing.

**The admin is safe by existing design — do not "fix" this.** `listReviewQueueAction` also backs
`/admin/authors`, and `process.env.ADMIN_USER_ID` reaches it through a *synthetic* reviewer row built in
`buildImplicitAdminReviewer()` (`lib/agentic/reviewers.ts` line 82) whose role is **`editor`**, not
`reviewer`. So a clamp keyed on `role === 'reviewer'` leaves the admin seeing everything, on both routes,
with no special case. Verified 2026-09-12 by reading that function; do not add an `isImplicitAdmin` branch
to the clamp, it would be dead code.

### 5.3 Retire "My assignments"

With the queue scoped, "Queue" and "My assignments" are the same list for a reviewer. Drop the item from
`components/review/ReviewSidebar.tsx` for role `reviewer`; keep it for `editor`, where it still means
something. `?assignment=mine` must keep working as a URL someone may have bookmarked.

### 5.4 Assigned count in the profile menu

Extend `resolveMyReviewerStanding()` (`lib/agentic/reviewers.ts` line 175) to return
`{ role, assignedCount }`, and render the count as a bubble beside "Review queue" in
`components/auth/UserMenu.tsx` lines 158-167.

Constraints, all load-bearing:

- **It rides the existing pricing-runtime payload** (D20). No new request. The count query runs only inside
  the `isActiveReviewer` branch, so it costs nothing for the overwhelming majority of signed-in users who
  are not reviewers.
- **Current user only.** D20's constraint exists because of a real leak defect (`245588e`) — never another
  account's standing, never `notes`.
- **Count active assignments whose run is still awaiting review**, not all-time assignments. An assignment
  whose run has been decided is not outstanding work.
- **Fail closed to no bubble.** `resolveMyReviewerStanding` already returns `null` on any error and must
  keep that property; a count failure degrades to "no bubble", never to a thrown provider.
- Render nothing at all when the count is zero — a "0" bubble is noise.

---

## 6. Round 4 — Phase 10: reviewer-driven images

**Scope reduction, recorded deliberately.** Because images are reviewer-driven and all three generation
paths already work (beat-by-beat, batch, external), Phase 10 contains **no automation work at all**. What
remains is one billing defect and its proof.

### 6.1 The defect

`regenerateImageForNode` — the per-beat "Regenerate image…" in the beat actions menu — bills through
`authorizeCurrentUserImageModelBillableAction`, which resolves the payer as `getCurrentUserId()`. A
reviewer regenerating an image on an agent draft pays for it themselves. This is the image twin of the
narration defect fixed in `04e739b`.

It is **not** "Create all visuals" — `a5e9bff` fixed both batch submit paths and they are correct.

### 6.2 The fix, per D25

1. **`authorize`** — resolve the payer from the story, mirroring `lib/agentic/billing-identity.shared.ts`
   which `a5e9bff` extracted for exactly this, and pass `actorKind` so the agentic bypass is reachable.
   Gate on `assertCanEditStory`.
2. **`finalize` / `release`** — stop passing `getCurrentUserId()`. Load the reservation, use its `user_id`
   as the payer and its `related_story_id` to authorize the caller.
3. **Entitlement stays on the caller**, not the payer — 9c plan 11.2 established why: the agent account
   resolves to the **free** plan, so routing `assertImageGenerationEntitled` to it would newly refuse
   reviewers a submit that works today.

### 6.3 Proof — measure, do not reason

Press the button as `testuser` on an agent draft, then read `beat_spend_reservations` and the beat row in
the database. Confirm: the charge lands on the agent account with `agenticBypass true`, the reviewer pays
nothing, **and the image actually persists.** Fixing only the billing would leave the image unpersisted —
precisely what happened with narration, where the charge was fixed and the write was not.

`agentic_image_generation_enabled` is **false** on dev and stays false. It gates the agent *pipeline*
generating images, not a reviewer regenerating one, so it does not protect this path and must not be
mistaken for a guard. Worth renaming in Round 5.

---

## 7. Round 5 — Phase 11 and the tightening round

### 7.1 Phase 11 (renumbered from 12) — agent spend is indistinguishable from human spend

Agent runs reuse `preview_seed_plan` and the `*_prompt_only` beat keys; only
`activity_key = 'agentic_creator'` separates them. Two references to renumber:
`docs/agent-context/PROJECT_STATE.md` line 481 and `docs/agentic-creator-working-memory.md` line 1138.

### 7.2 Agent prompt quality — noted 2026-09-12, not yet specified

The owner observed, and this needs its own testing round rather than a patch:

- The agent's prompts **do not properly use the advanced settings options**.
- **Visual direction / style is not curated correctly** — the style is not coming through consistently.
- **A hard compositional rule is missing: every storyboard must be 16:9 landscape or 9:16 portrait.**

**A trap to settle before that work starts.** Every beat image is a 2x2 storyboard grid. A 2x2 grid of 16:9
panels is *itself* 16:9, so stating the aspect rule on the grid would silently produce **4:3 panels**. The
rule has to be specified at the **panel** level, with the grid's own aspect derived from it. Getting this
backwards would degrade every image while appearing to satisfy the requirement.

### 7.3 Carried forward

- Per-persona wallets — personas share one account, so spend is attributed per persona but balances pool.
- `/review` sends a signed-out visitor to `/` rather than to sign-in with a return URL.
- Assignment is advisory, not enforced; no notification when work is assigned.
- Per-person capability overrides on top of role; full audit history for role changes.
- A per-reviewer index on `agent_review_decisions` — a **115+**, never an edit to 112.
- Thirteen stale comments still describing `can_publish` / `can_trigger_media` as columns; 113 dropped both.
- Rename `agentic_image_generation_enabled` to say what it actually gates (6.3).

---

## 8. Verification

Per round, and again at the end:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build:verify
npm run test:e2e
```

A **pre-change baseline of all five gates** was recorded before Round 1 so that any regression is
attributable. Report against that baseline, not against a remembered number.

Browser proof is expected for Rounds 1, 3 and 4 — all three are flow work the static gate cannot see.
`npm run dev:agent` runs on port 3100 against `.next-agent`; never take port 3000 or `.next`, and always
stop what you start.

New durable specs owed:

- Round 1 — a non-owner is redirected out of `/story/[id]`, and the owner and reviewer are not.
- Round 3 — `/review` header links home; a plain reviewer sees only assigned rows; the count bubble renders.
- Round 4 — no spec for the image press itself; it spends real money per run, the same reason the narration
  press has none.

---

## 9. Standing hazards

Unchanged from the 9d handoff, repeated because they are still live:

- **Never apply a migration**, and never run the Supabase CLI. 113 and 114 are frozen; the next is **115**.
- **Never `git add -A`.** Stage explicit paths; agents share this tree.
- **Never export a non-function value from a `'use server'` file**, and never import a plain value from a
  `'use client'` module into server code.
- **Server actions are directly invocable.** A hidden button gates nothing; the check belongs in the action.
- **Reviewer writes run on the service-role client and bypass RLS entirely.** `assertCanEditStory` is the
  whole boundary.
- **Every beat image is a 2x2 storyboard grid and must never reach a viewer.**
- **All dropdowns use `FilterDropdown`; row actions use `RowActionsMenu`.**
- `next/link` clicks on `/story/[id]` are deferred while the screen is busy — they look broken and are not.
- **This plan has been wrong more often than the code.** If a document contradicts the code, the code is
  right; if the code contradicts the database, the database is right.
