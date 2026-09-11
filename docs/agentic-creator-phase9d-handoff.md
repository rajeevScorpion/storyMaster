# Handoff — Phase 9 is code-complete; what is left is 9J's live test and one open billing path

Written 2026-09-11 at the end of the session that finished Unit 9M, finished Unit 9K, ran the browser
proof that was owed, and fixed the fourth blocker that proof found. Everything a fresh session needs is
here; do not re-derive it. Specs live in
[agentic-creator-phase9c-plan.md](agentic-creator-phase9c-plan.md) — sections 10 and 11 of that file are
the record of what was investigated and what shipped, and **11.4 and 11.5 are the new ones**.

Read first: [WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md),
[GOTCHAS.md](agent-context/GOTCHAS.md), [PROJECT_STATE.md](agent-context/PROJECT_STATE.md).

---

## 1. Where things stand

**Landed this session** (branch `feat/agentic-creator`, nothing pushed):

| Commit | What |
|---|---|
| `1bdf726` | **Unit 9M's actual feature** — "Open in authoring" in the queue's row menu, and a "Review queue" link back, keyed off `?from=review` |
| `d025804` | **Unit 9K** — the reviewer's own history at `/review/history`, and the admin workload view at `/admin/authors/workload` |
| `04e739b` | **The fourth blocker**, found by the browser run: interactive narration billed the reviewer *and* then wrote nothing |

Gate at handoff: **types clean, lint clean, 992 unit tests, production build green, e2e 22/22.**

Everything in the previous handoff's "not done" list is now done, except 9J, which was never mine to run.

**What is actually left:**

1. **9J — automatic assignment has never run against a database.** Unchanged from the last handoff:
   **the owner drives this test themselves. Do not start it; wait to be asked.**
2. **The interactive per-beat image regeneration still bills the reviewer.** Found by the browser run,
   deliberately not fixed — see section 4. This is the one piece of real work left.
3. Nothing else is blocking. Phase 9's units are built.

---

## 2. What the browser run proved, so nobody runs it again

Run as `testuser` against agent draft `568fb4bd` (रफ़ कट) on `npm run dev:agent` (port 3100). Every
claim was checked **in the database**, not in the UI — the whole family of bugs in this phase reports
success and writes nothing, so the UI is not evidence.

- **A reviewer's edit now writes.** `stories.updated_at` moved `2026-09-09 11:10:43` →
  `2026-09-11 17:10:45`, the beat text changed and changed back, and `beats.generated_by` stayed the
  agent account. Blocker A (`3347ffb`) is genuinely fixed.
- **Narration billed the reviewer, and persisted nothing.** Now fixed and re-measured: both charges land
  on the agent account with `agenticBypass true`, the reviewer pays nothing, and the beat carries
  `audio_url`, `audio_status 'ready'`, a synced timestamp, its voice id and its overlay captions.
- **Publishing is absent from the authoring screen** on an agent draft, replaced by the panel that
  explains why and links to `/review`.
- **`/admin/agents/spend` has real data now** — 0.80 beats / 8 coins for Kabir Sinha across 2 operations,
  all flagged as never deducted. It read zero before this session because nothing had ever run through it.

Most of that is now a **durable spec**, so none of it needs clicking again:

- `e2e/agentic-review-doorway.spec.ts` — the row action, its href, the way back, and the absence of any
  publish control on an agent draft.
- `e2e/agentic-review-reviewer.spec.ts` — now also covers `/review/history` under a forced timezone, and
  asserts the History sidebar link **exists** (it asserted the opposite until 9K shipped).
- `e2e/agentic-admin.spec.ts` — now covers `/admin/agents/spend`, `/admin/authors`,
  `/admin/authors/reviewers` and `/admin/authors/workload`.

The two things not in a spec, on purpose: the beat-text edit (a spec that rewrites story content on every
run is worse than a one-off) and the narration press (it spends real money each time).

---

## 3. Two traps the specs hit, so you do not spend an hour on them again

- **`next/link` clicks on `/story/[id]` look broken and are not.** A click taken while that screen is
  still pulling beats and painting its first image is handled — `next/link` calls `preventDefault` — but
  its router transition is deferred until the page stops being busy, so the URL does not change for many
  seconds. This affects the Kissago logo too, which predates all of this. Wait for the screen to settle
  before clicking; the doorway spec does.
- **Playwright strict mode, three times.** `Review queue` matches both the header link and the agent-draft
  panel's link; `Queue` matches the sidebar item and the empty state's prose; `This is an agent draft.`
  matches twice because the ending actions render twice by design (inline for mobile, a column for
  desktop) with exactly one visible. Scope to `getByRole('banner')`, pass `exact: true`, or
  `.filter({ visible: true })`.

---

## 4. The one piece of real work left

**The interactive per-beat image regeneration bills the reviewer, not the agent.** Full reasoning in
phase9c-plan section 11.5 and PROJECT_STATE; the short version:

- `regenerateImageForNode` bills through `authorizeCurrentUserImageModelBillableAction`, which resolves
  the payer as `getCurrentUserId()`.
- This is **not** "Create all visuals" — `a5e9bff` fixed that batch, and it is fine.
- It was not patched because it is a **bigger** change than the narration one, not a smaller one.
  Narration's authorize/run/finalize all sit inside one server action, so one resolved identity covered
  the whole operation. The interactive image path has the **client** call `authorize`, `finalize` and
  `release` as three separately-invocable server actions, each deriving the payer from the session
  independently. Paying from the agent account means all three accepting a story-derived payer and each
  re-running `assertCanEditStory` — a client-supplied `storyId` deciding who pays, on three endpoints.
- **Measure it, do not reason about it.** Press the button as the reviewer, then read
  `beat_spend_reservations` and the beat row. That is how the narration twin was found, and reading the
  code alone had already missed it twice.
- `agentic_image_generation_enabled` is **false** on dev and was left false. That flag gates the agent
  pipeline generating images, not a reviewer regenerating one, so it does not protect this path.

D22 in [agentic-creator-decisions.md](agentic-creator-decisions.md) records the rule this is the last
violation of.

---

## 5. Facts already verified — do not spend tokens re-checking

- Migrations **113 and 114 are applied on dev and frozen.** Any schema change is a **115**. The owner
  applies every migration by hand in the dashboard; never run the Supabase CLI. **9K needed no migration** —
  `agent_review_decisions` (112) and `agent_review_assignments` (114) already carry everything it reads.
- Production has **no agentic tables at all**. Everything degrades to an honest empty state there.
- Dev flags: reviewer workflow **on**, agent billing bypass **on**, pricing hard enforcement **on**, agent
  image generation **off**. Every `beat_*` control flag is **on**.
- The agent account holds no subscription and no entitlement override, so it resolves to the **free**
  plan. This is why the image *entitlement* check deliberately still runs on the caller rather than the
  payer, and why `resolveAgentDraftServerAuth` fails closed to ordinary billing when
  `AGENTIC_SYSTEM_USER_ID` does not line up — naming the agent as payer without `actorKind` would produce
  a denial, not a bypass.
- The one reviewer, `testuser`, has role **reviewer**, not editor, so **cannot publish**. To test
  publishing, promote them in the roster first, then put it back.
- Five agent stories exist, all owned by the single agent account. One of them (`568fb4bd`) now has
  narration on beat 8 — put there by this session's proof, and correctly billed to the agent.
- `E2E_REVIEWER_*` and `E2E_ADMIN_*` are both set in `.env.local`, so every authenticated spec really
  runs rather than skipping. Never write those credentials into a file, a spec, or a message.

---

## 6. Hazards

- **Never `git add -A`.** Stage explicit paths; agents share this tree.
- **Never apply a migration**, and never run the Supabase CLI.
- **Never export a non-function value from a `'use server'` file** — it lints clean and throws at runtime.
- **Never import a plain value from a `'use client'` module into server code.** This bit 9K: `ReviewHistory`
  reuses `run-presentation.tsx`'s decision badge tables, and that module is `'use client'`, so the
  component had to be a client component too. Duplicating a label table would have been worse.
- **Every beat image is a 2×2 storyboard grid and must never reach a viewer.**
- **All dropdowns use `FilterDropdown`; row actions use `RowActionsMenu`.** Never a native `<select>`.
- **Server actions are directly invocable.** A hidden button gates nothing; the check belongs in the
  action. `resolveAgentDraftServerAuth` gates on `assertCanEditStory` for exactly this reason — it is what
  moves a write onto the service-role client.
- **Reviewer writes run on the service-role client and bypass row-level security entirely.**
  `assertCanEditStory` is the whole boundary.
- Line endings are handled by `.gitattributes`. Write whatever your editor produces.
- **`npm run dev:agent` can fail to start with an empty log if something already holds its state.** Run it
  again; it started cleanly on the second attempt. Never take port 3000 or `.next`.
- **This plan has been wrong more often than the code.** Eight plan-level errors across phase 9b, three
  more in the 9M pre-flight, and this session added another: the handoff asserted narration was already
  proven safe for reviewers, and it was not. If a document contradicts the code, the code is right — and
  if the code contradicts the database, the database is right.

---

## 7. Still open, deliberately

- The interactive image billing path (section 4) — the only one with real work attached.
- Per-persona wallets. All personas share one account, so spend is attributed per persona but balances are
  pooled.
- `/review` sends a signed-out visitor to the home page rather than to sign-in with a return URL.
- Assignment is advisory, not enforced. No notification when work is assigned.
- Per-person capability overrides on top of role; full audit history for role changes.
- A per-reviewer index on `agent_review_decisions`. 9K's history read filters on `reviewer_id`, which the
  table has no index for. Irrelevant at current row counts; if it ever matters it is a **115**, never an
  edit to 112.
- **Pre-existing, unrelated to reviewers:** the beats insert policy lets any signed-in user insert beats
  into anyone's non-archived story; and `autoPublishStoryline` never checks the admin's public-publishing
  switch.
