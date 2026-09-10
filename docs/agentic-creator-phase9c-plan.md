# Agentic Creator — Phase 9c: the reviewer workspace (Units 9L, 9M, 9J)

Continues [agentic-creator-phase9b-plan.md](agentic-creator-phase9b-plan.md). 9f/9g/9h/9i are landed and
gated; 113 and 114 are applied on dev. This document plans the remaining work and **resequences it**:
the reviewer *workspace* now outranks auto-routing.

Owner-approved scope, 2026-09-10. Written to the standard in
[WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md): a fresh session must execute this without
re-deriving discovery.

---

## 0. Why the sequence changed

Phase 9b treated a reviewer as a **decision-maker**: read some metadata, press one of four buttons. The
owner's actual model, stated 2026-09-10, is that a reviewer is the **finisher**:

> open an assigned draft → read the whole story beat by beat → judge it → approve → enter creation mode →
> re-read and edit the text → generate narration for all beats → then images → publish, under the agent
> persona's name only.

That makes the review queue a doorway, not the product. Auto-routing (9j) is worth little until there is
somewhere worth routing *to*, so it moves last.

---

## 1. Verified current-state facts

Checked against the code and the dev database on 2026-09-10. Read, not assumed.

### 1.1 Live state

| Fact | Evidence |
|---|---|
| **113 applied** 2026-09-10 03:07:27+00; **114 applied** 08:07:22+00. Both verified against the live schema, not just the ledger. | dev |
| `agent_review_assignments_one_active_idx` is **UNIQUE and partial** (`WHERE status='active'`). | `pg_indexes` |
| **One real reviewer exists**: `testuser`, role `reviewer`, status `active`, languages `[english, hindi]`, age groups all five concrete ones, genres `[]`. | `agent_reviewers` |
| `agentic_reviewer_workflow_enabled` is **true**. | `feature_flags` |
| 5 runs at `awaiting_review`; one is assigned to testuser (assignee pill confirmed working in the UI). | dev + owner screenshot |
| **Production still has no agentic schema at all** — the prod ledger returns zero rows for `migration_number >= 103`. | prod |

### 1.2 What a reviewer can ALREADY do (this is most of 9M)

- **Read any agent story.** `stories` RLS carries `"Authenticated users can view non-archived stories"` (`is_archived = false AND auth.uid() IS NOT NULL`). `loadStory` ([persistence.ts:495](../app/actions/persistence.ts#L495)) uses the **session** client, so a reviewer's `/story/[id]` load already succeeds. **No RLS change is needed and none should be made.**
- **Edit beats.** Unit 9b (`b7041b2`) made four write paths reviewer-aware through `assertCanEditStory`:
  - `saveBeat` — [persistence.ts:730](../app/actions/persistence.ts#L730)
  - beat editing — [beat-control.ts:136](../app/actions/beat-control.ts#L136)
  - **narration for all beats** — `submitStoryNarrationBatch`, [narration-batch.ts:151](../app/actions/narration-batch.ts#L151)
  - **images for all beats** — `submitStoryImageBatch`, [image-batch.ts:297](../app/actions/image-batch.ts#L297)
- **Publish as the persona.** `publishReviewedStoryline` ([review-publish.ts](../lib/agentic/review-publish.ts)) already stamps the story's own owner (the agentic system user) and the persona's display name — decision **D15**.
- Every reviewer has `canTriggerMedia` under **D17**, so narration and images are permitted without a per-person grant.

### 1.3 What is NOT reviewer-aware — the real gaps

- **`saveStory` is not.** Only `saveBeat` was made reviewer-aware in 9b. If `StoryScreen` calls `saveStory` on any path a reviewer can reach, it will throw `Forbidden.` — `stories` UPDATE RLS is `auth.uid() = user_id`, owner-only. **Unit 9M must determine this before anything else** (see 3.1).
- **`PublishDialog` publishes as the wrong identity.** It calls `publishStoryline` ([PublishDialog.tsx:195](../components/story/PublishDialog.tsx#L195)), which is owner-only, takes client-supplied `beats`/`choices`/`nodePath`, and would attribute the storyline to **the reviewer**. That directly violates D15. A reviewer must reach `publishReviewedStoryline` instead.
- No link from the queue into `/story/[id]`, and no way back.
- No beat-by-beat reading surface in the queue itself.

### 1.4 UI facts

- `ReviewQueue`'s table is **11 columns at `min-w-[1180px]`** inside `overflow-x-auto` ([ReviewQueue.tsx:489-490](../components/admin/agentic/ReviewQueue.tsx#L489-L490)). That is the horizontal scrollbar.
- `formatDateTime` ([run-presentation.tsx:111](../components/admin/agentic/run-presentation.tsx#L111)) calls `toLocaleString('en-IN', …)` inside a `'use client'` component. Client components still render on the server, and Node's ICU and the browser's can disagree (`Sep` vs `Sept`), as can their timezones. **This is the prime suspect for the reported hydration error but is NOT yet confirmed** — see 2.4, which requires reproducing it before fixing it. The bug, if real, is **pre-existing since 9c** and also affects `/admin/authors`.
- `PricingRuntimeProvider` ([components/pricing/PricingRuntimeProvider.tsx](../components/pricing/PricingRuntimeProvider.tsx)) is a `'use client'` React context mounted app-wide in [Providers.tsx:12](../components/Providers.tsx#L12), fed by the `getPricingRuntimeContext()` server action with its own cache and refetch logic. `UserMenu` ([components/auth/UserMenu.tsx](../components/auth/UserMenu.tsx)) already consumes it via `usePricingRuntime()`.

---

## 2. Decisions to record in `agentic-creator-decisions.md`

### D19 — the reviewer finishes the story in `/story/[id]`, not in a second editor

A reviewer who approves a draft is handed off to the **existing authoring UI** with reviewer permissions,
rather than editing inside `/review`.

**Why.** The authoring UI is already where beat editing, narration batches, image batches and the media
pipeline live, and Unit 9b already made all four of those paths reviewer-aware. A second editor would
duplicate `StoryScreen` and then drift from it. The cost is that `StoryScreen` was written for an owner,
so a small number of owner assumptions have to be found and handled (3.1).

*Rejected:* a dedicated reviewer editor inside `/review` — cleaner boundary, far more code, and two
authoring surfaces to keep in sync forever.

### D20 — reviewer standing rides the pricing-runtime payload; it never gets its own request

The badge and the queue link need "is the current user a reviewer, and what role". That must **not** cost a
per-page round trip, because almost no signed-in user is a reviewer.

`getPricingRuntimeContext()` is already fetched once per session by an app-wide provider and cached.
Reviewer standing is added to that payload. **Zero additional requests.**

*Rejected:* a dedicated `getMyReviewerStanding()` action called from `UserMenu` (one extra request per page
for every user on the site); a Supabase JWT custom claim (also zero-cost, but adds an auth hook and the
claim goes stale until token refresh, so a revoked reviewer keeps their badge for up to an hour).

**Constraint:** the payload must carry only `{ role } | null` for the **current user**. Never another
account's standing, never `notes` — see `245588e` for the defect that shape prevents.

---

## 3. Unit 9M — the finish-and-publish workspace (do this FIRST)

Sequenced first because it is the only unit that can invalidate the others. If `StoryScreen` turns out to
be unusable by a non-owner, D19 is wrong and 9L's "Open in authoring" button has nowhere to go.

### 3.1 Step one, before writing any code: prove the handoff works

Sign in as the reviewer (credentials in `.env.local`, see section 6) and open an agent draft's
`/story/[id]` directly. Record what actually happens for each of:

1. Does the story load? (Expected **yes** — 1.2.)
2. Does `StoryScreen` render in authoring mode, or does it hide controls for a non-owner?
3. **Does anything call `saveStory`?** Grep `saveStory` in `lib/store/story-store.ts` and `components/story/`, then exercise it. This is the single most likely blocker (1.3).
4. Do beat edits save? (`saveBeat` is reviewer-aware.)
5. Does the narration batch submit? Does the image batch?
6. What does the Publish button do? (Expected: **wrong** — it calls `publishStoryline` and would attribute to the reviewer.)

**Write the findings into this document before continuing.** If `saveStory` is on a reachable path, making
it reviewer-aware — mirroring `saveBeat`'s `assertCanEditStory` shape at [persistence.ts:764](../app/actions/persistence.ts#L764) — is the first commit of this unit, on its own.

### 3.2 The handoff link

From `ReviewQueue`, a row action **"Open in authoring"** → `/story/[id]`. Carry a marker (a query param
such as `?from=review`) so the authoring UI knows this is a review session and can show a "Back to review
queue" affordance. Do not put reviewer state in the store — [story-store.ts](../lib/store/story-store.ts) is
a module singleton with no persistence and does not survive a reload.

### 3.3 Publishing — the part that must not be got wrong

A reviewer pressing Publish inside `/story/[id]` must reach `publishReviewedStoryline`, **never**
`publishStoryline`. Publishing through the owner path would stamp the storyline with the reviewer's
`user_id` and their display name, breaking D15 and putting a real person's name on an agent's story.

`PublishDialog` therefore needs a reviewer branch. The cleanest shape: the dialog receives an explicit
`mode: 'owner' | 'reviewer'` prop resolved server-side, and the reviewer branch calls a new
`publishReviewedStorylineAction(storyId)` wrapping the existing `publishReviewedStoryline`, gated on
`requireReviewer()` + `canPublish(reviewer)`.

**`canPublish` is editor-only under D17**, so a plain `reviewer` cannot publish. Today's only real reviewer
(`testuser`) is role `reviewer`, so the publish button must render **disabled with a reason**, not hidden —
matching how `ReviewQueue` already treats it.

### 3.4 Billing — a blocking question, not a detail

A reviewer generating narration and images spends money on someone's account.

- Narration already bills the system user, not the reviewer (`57b516b`).
- **Image billing for agent drafts is a known deferred gap** (PROJECT_STATE). A reviewer triggering an image batch may bill the wrong account or nothing at all.

**Confirm what actually happens before shipping the image path**, by reading `submitStoryImageBatch`'s
pricing calls and checking a real run's `coin_transactions`. If it bills the reviewer, that is a defect to
fix in this unit, not to discover in production.

### 3.5 Return path

After publish, return the reviewer to `/review` and record the decision. `publishRunAction` already writes
the `published` decision row and moves the run to `complete`/`succeeded` — reuse it; do not write a second
transition.

---

## 4. Unit 9L — the reviewer shell

### 4.1 Reviewer standing in the runtime payload (D20)

- `app/actions/pricing-runtime.ts` — `getPricingRuntimeContext()` gains `reviewer: { role: AgentReviewerRole } | null`. Resolve it with a **non-throwing** helper, because `requireReviewer()` throws by design. Add `resolveMyReviewerStanding()` to [lib/agentic/reviewers.ts](../lib/agentic/reviewers.ts) alongside `requireReviewer()`, reusing the existing `resolveReviewerForUser()` and returning `null` rather than throwing.
- `PricingRuntimeProvider` — carry the new field through its context value.
- `UserMenu` — render a **Reviewer** / **Editor** badge under the email, and a **Review queue** link to `/review`, both only when `reviewer` is non-null.

Fail closed: any error resolving standing yields `null` (no badge, no link), never a thrown provider.

### 4.2 The `/review` shell

- A sidebar in [app/review/layout.tsx](../app/review/layout.tsx): **Queue**, **My assignments**, **History**. It must not import `AdminSidebar` or any admin nav.
- History is a read-only list of this reviewer's own `agent_review_decisions` rows. That is a slice of Unit 9k, pulled forward because the sidebar needs somewhere to point.

### 4.3 Fix the table (11 columns → readable)

Drop `min-w-[1180px]` and the horizontal scroll. Keep in the row only what a reviewer decides from —
**Story, Readiness, Verdict, Assignee, Actions** — and move Persona, Decision, Entered review and Run into
the expandable detail that already exists. The queue must not scroll horizontally at any width.

### 4.4 Hydration — reproduce before fixing

**Do not fix this by guessing.** Reproduce first: `npm run dev:agent`, sign in as the reviewer, load
`/review`, and capture the actual console error. Only then fix, and re-check that the error is gone.

If it is `formatDateTime` (1.4), the durable fix is to stop formatting a locale string during SSR: either
format server-side once and pass the string down, or render the formatted value only after mount. An
explicit `timeZone` alone does **not** fix an ICU-version difference. Whatever the fix, apply it in
`run-presentation.tsx` so `/admin/authors` gets it too.

Add an e2e assertion that `/review` produces no hydration error, so it cannot regress silently.

---

## 5. Unit 9J — automatic assignment (unchanged, now last)

Specification is unchanged: **[agentic-creator-phase9b-plan.md](agentic-creator-phase9b-plan.md) section 6**
— the pure `routeTaskToReviewer` matcher, the non-fatal `tryAutoAssignReview` hook at
[orchestrator.ts:697-699](../lib/agentic/orchestrator.ts#L697-L699), and the `import type { AdminClient }`
cycle hazard called out there.

Two facts that have since become concrete:

- **114 is now applied**, so the hook has somewhere to write and this unit can be proven live immediately.
- **The roster is no longer empty.** `testuser` covers `[english, hindi]` × all five concrete age groups with **no genre preference** — so under section 6's algorithm they match 4 of the 5 waiting drafts on language+age, and the empty `genres[]` correctly never excludes them. The one `all_ages` case still has no fixture; commission one task to prove D16's pooling live.

---

## 6. Credentials for browser testing

A real reviewer account exists for local testing. Put it in **`.env.local`** (gitignored) as:

```
E2E_REVIEWER_EMAIL=...
E2E_REVIEWER_PASSWORD=...
```

following the existing `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` pattern that `e2e/agentic-admin.spec.ts`
already uses. **Never commit these, never write them into a spec, never send them anywhere.** A spec that
needs them reads `process.env` and skips when they are absent, exactly as the admin spec does.

---

## 7. Verification

Per unit and again at the end:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build:verify
npm run test:e2e
```

Browser proof is expected for every unit in this phase — all three are UI or flow work, and the static gate
cannot see any of it. `npm run dev:agent` runs on port 3100 against `.next-agent`; never take port 3000 or
`.next`, and always stop what you start.

**The end-to-end proof this whole phase exists for**, run as `testuser`:

1. Sign in → the profile menu shows a **Reviewer** badge and a **Review queue** link.
2. `/review` renders with a sidebar, no horizontal scrollbar, and **no hydration error**.
3. Open the assigned draft → read it beat by beat → open it in authoring.
4. Edit a beat's text and confirm it saves.
5. Submit narration for all beats; confirm it bills the **system user**, not the reviewer.
6. Submit images for all beats; confirm what it bills (3.4).
7. Confirm Publish is **disabled with a reason** for a plain `reviewer`. Promote to `editor` in the roster, then publish and confirm the storyline carries the **persona's name**, not testuser's.
8. Re-drive a run to `awaiting_review` and confirm auto-assignment picks testuser with a populated `match_reason`.

---

## 8. Standing hazards — read before touching anything

- **Never apply a migration.** The owner applies every one by hand in the dashboard. 113 and 114 are applied and **frozen**; a change to reviewer schema now ships as **115**.
- **Never `git add -A`.** Stage explicit paths — agents share this tree, and one commit (`3bc3b98`) already carries code under a docs message because of this.
- **Files must be LF.** The Write tool emits CRLF on this machine; run `sed -i 's/\r$//'` after writing and verify with `od -c`.
- **Never export a non-function value from a `'use server'` file.**
- **Every beat image is a 2×2 storyboard grid and must never reach a viewer.** Any new surface showing beat artwork renders panel 1 only.
- **All dropdowns use `FilterDropdown`; row actions use `RowActionsMenu`.** Never a native `<select>`.
- Reviewer writes run on the service-role client and bypass RLS entirely. `assertCanEditStory` is the whole boundary (D14).
- **The plan has been wrong far more often than the code.** Seven plan-level errors across four units in Phase 9b, against one code defect — and that defect was caused by a plan error. If this document contradicts the code, the code is right: say so loudly rather than working around it.

---

## 9. Deferred

Carried forward, still open:

- Per-person capability overrides on top of role (D17).
- Full audit history for role changes (113 ships `updated_by` only).
- `/review` redirects signed-out users to `/` rather than sign-in with a return URL.
- Enforced (rather than advisory) assignment.
- Reviewer notification that work was assigned.
- Thirteen comments across `ReviewQueue.tsx`, `image-batch.ts`, `narration-batch.ts` and others still describe `can_publish` / `can_trigger_media` as columns; 113 dropped both.
- **Pre-existing:** `autoPublishStoryline` never checks `publicPublishingEnabled` or `moderationRequiredForPublic`, so the auto-publish-on-ending path can publish publicly while the admin switch is off.
- **Pre-existing:** image billing for agent drafts is unpriced — now load-bearing for 9M (3.4).
