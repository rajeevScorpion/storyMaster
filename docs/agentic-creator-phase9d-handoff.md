# Handoff — finish Unit 9M, then 9K

Written 2026-09-11 at the end of the session that fixed 9M's three blockers. Everything a
fresh session needs is here; do not re-derive it. Specs live in
[agentic-creator-phase9c-plan.md](agentic-creator-phase9c-plan.md) — sections 10 and 11 of
that file are the record of what was investigated and what shipped.

Read first: [WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md),
[GOTCHAS.md](agent-context/GOTCHAS.md), [PROJECT_STATE.md](agent-context/PROJECT_STATE.md).

---

## 1. Where things stand

**Landed this session** (branch `feat/agentic-creator`, nothing pushed):

| Commit | What |
|---|---|
| `723265c` | The pre-flight investigation that found the three blockers |
| `3347ffb` | A reviewer's story save reported success and wrote nothing. Fixed. |
| `a5e9bff` | Image batches charged the reviewer. Now charged to the agent account. |
| `4974611` | The authoring screen would have published an agent draft under the reviewer's name. Refused server-side. |
| `5a02d04` | Docs; also corrected PROJECT_STATE, which had migration 114 wrongly listed as not applied |
| `df4ac37` | The billing bypass now records what it skipped, and `/admin/agents/spend` reports spend per persona |

Gate at handoff: **types clean, lint clean, 977 tests, production build green, e2e 19/19.**

**Not done** — this is the work:

1. **9M's actual feature.** A reviewer still has no way to get from the review queue into the
   story, and no way back. The blockers are fixed; the doorway was never built.
2. **Nothing has been clicked through in a browser.** Every fix above is proven by reading code
   and by the static gate only.
3. **9K** — the reviewer's own history, and the admin workload view. Not started, nothing blocking.
4. **9J** — automatic assignment has never run against a database. **The owner will drive this
   test themselves at the start of the session. Do not start it; wait to be asked.**

---

## 2. Task 1 — the doorway into the story, and the way back

The decision is already made (D19): a reviewer edits in the existing authoring screen at
`/story/[id]`, not in a second editor. What is missing is only the navigation.

**Into the story.** `components/admin/agentic/ReviewQueue.tsx` already builds a row actions menu
(`RowActionsMenu`, actions assembled around line 528). Add an **Open in authoring** action linking
to `/story/{row.story.id}?from=review`. The story id is already on the row as `row.story?.id`;
disable or omit the action when it is null. Do not add a new column — the table was deliberately
narrowed in 9L and must not scroll horizontally again.

**Back to the queue.** `?from=review` is the marker. Read it in the authoring screen and show a
"Back to review queue" affordance. Two constraints:

- **Do not put this in the story store.** `lib/store/story-store.ts` is a module singleton with no
  persistence and does not survive a reload, so the marker must come from the URL every time.
- `components/story/StoryScreen.tsx` is split: the outer `StoryScreen` holds the auth hook, the
  inner `StoryScreenInner` takes props. It already receives `isAnotherUsersAgentDraft`, computed in
  the outer component, for exactly this kind of reviewer-aware behaviour. Follow that shape.

**Publishing stays in the queue.** Do not add a publish button to the authoring screen. The
authoring screen already explains this and links to `/review`; the queue's own Publish is the only
correct path because it also records the decision and moves the run (phase 9c plan §3.5).

---

## 3. Task 2 — prove it in a browser

None of this session's work has been exercised as a real reviewer. Run
`npm run dev:agent` (port 3100, its own build directory — never take port 3000). Reviewer
credentials are in `.env.local`; never write them into a file, a spec, or a message.

Check, in order:

1. Sign in as the reviewer. The profile menu shows a **Reviewer** badge and a **Review queue** link.
2. `/review` renders with its sidebar, no horizontal scrollbar, no hydration error in the console.
3. Open an assigned draft in authoring via the new link.
4. **Edit a beat's text and save. Then confirm the database actually changed** — this is the fix
   that matters most, because the bug it replaces reported success while writing nothing:
   `select updated_at from stories where id = '<story id>';` before and after. If `updated_at`
   does not move, the fix did not work.
5. Submit narration for all beats. Confirm it does **not** charge the reviewer.
6. Submit images for all beats. Same check. Note `agentic_image_generation_enabled` is **false**
   on dev — turn it on if the image path needs exercising, and turn it back off after.
7. Confirm the publish buttons are **absent** on the agent draft, replaced by the panel explaining
   why, with its link to `/review`.
8. Open `/admin/agents/spend`. After steps 5 and 6 it should show that persona's spend. Before
   them it will legitimately read zero — nothing has ever run through it.

Write what actually happened into phase9c-plan §11.4, replacing the "still owed" note.

---

## 4. Task 3 — Unit 9K

Two read-only views. Both tables are applied on dev and carry everything needed; no migration.

**Reviewer history**, in the `/review` sidebar. `ReviewSidebar` deliberately has only Queue and My
assignments and its comment says the third item is 9K's — add it there. Source is
`agent_review_decisions` (migration 112) filtered to the signed-in reviewer: decision, story,
storyline, notes, timestamp.

**Admin workload**, per reviewer: assigned, completed, pending. Source is
`agent_review_assignments` (114, indexed by reviewer) joined with decisions. This is what the owner
originally asked for — "admin can see the tasks assigned, completed, pending by the reviewer".

Notes that will save time:

- That table is indexed `(run_id, created_at)` only, so a per-reviewer history has no index on
  `reviewer_id`. Irrelevant at current row counts. If it ever matters it is a **115**, never an
  edit to 112.
- `reviewer_id` is nullable by design and `reviewer_label` snapshots the name, so history survives
  a deleted account. Render the label, not a lookup.
- Reviewer-facing reads must not leak the roster's `notes` field — that is admin-only, and leaking
  it was a real defect once (`245588e`).

---

## 5. Facts already verified — do not spend tokens re-checking

- Migrations **113 and 114 are applied on dev and frozen.** Any schema change is a **115**. The
  owner applies every migration by hand in the dashboard; never run the Supabase CLI.
- Production has **no agentic tables at all**. Everything must degrade to an honest empty state
  there, never an error.
- Dev flags: reviewer workflow **on**, agent billing bypass **on**, pricing hard enforcement **on**,
  agent image generation **off**.
- The agent account holds no subscription and no entitlement override, so it resolves to the
  **free** plan. This is why the image entitlement check deliberately still runs on the caller
  rather than the payer — routing it to the agent account would refuse reviewers a submit that
  works today. See phase9c-plan §11.2.
- The one reviewer, `testuser`, has role **reviewer**, not editor, so **cannot publish**. To test
  publishing, promote them in the roster first, then put it back.
- Five agent stories exist, all owned by the single agent account.

---

## 6. Hazards

- **Never `git add -A`.** Stage explicit paths; agents share this tree.
- **Never apply a migration**, and never run the Supabase CLI.
- **Never export a non-function value from a `'use server'` file** — it lints clean and throws at runtime.
- **Every beat image is a 2×2 storyboard grid and must never reach a viewer.** Any new surface
  showing beat artwork renders panel 1 only.
- **All dropdowns use `FilterDropdown`; row actions use `RowActionsMenu`.** Never a native `<select>`.
- **Server actions are directly invocable.** A hidden button gates nothing; the check belongs in the action.
- Line endings are handled by `.gitattributes` now. Write whatever your editor produces. No manual
  carriage-return stripping, and nothing about it in any brief.
- **Reviewer writes run on the service-role client and bypass row-level security entirely.**
  `assertCanEditStory` is the whole boundary.
- **This plan has been wrong more often than the code.** Eight plan-level errors across phase 9b,
  and three more found this session — including one that predicted an error where the real
  behaviour was a silent success. If a document contradicts the code, the code is right: say so
  loudly rather than quietly working around it.

---

## 7. Still open, deliberately

- Per-persona wallets. All personas share one account today, so spend is attributed per persona but
  balances are pooled. Real work; not needed to answer "which agent is costing what".
- `/review` sends a signed-out visitor to the home page rather than to sign-in with a return URL.
- Assignment is advisory, not enforced. No notification when work is assigned.
- Per-person capability overrides on top of role; full audit history for role changes.
- **Pre-existing, unrelated to reviewers, found while investigating:** the beats insert policy lets
  any signed-in user insert beats into anyone's non-archived story; and `autoPublishStoryline`
  never checks the admin's public-publishing switch.
