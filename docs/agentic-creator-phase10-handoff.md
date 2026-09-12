# Handoff — Phase 10 Round 1 is complete; Round 3 was in flight when this was written

Written 2026-09-12 at 87% of the session window, which is why it exists: the delegation ceiling is 90%
and a fresh session should start from here rather than from a compacted summary.

**The plan is the source of truth: [agentic-creator-phase10-plan.md](agentic-creator-phase10-plan.md).**
Read it before anything else. This file records only what has happened since, and what is owed.

Read also: [WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md),
[GOTCHAS.md](agent-context/GOTCHAS.md), [PROJECT_STATE.md](agent-context/PROJECT_STATE.md). All three are
current as of Round 1 — GOTCHAS' `saveBeat` section and PROJECT_STATE's migration table were both
rewritten to match what shipped.

---

## 1. First thing to do: check what landed

**Updated at 96% session usage, after Round 3 had landed most of its work.** Exact state:

**Committed and done** — plan section 5's four parts:

| Commit | Part |
|---|---|
| `d920006` | 5.1 — `/review` keeps the app header (`KissagoLogo` + `UserMenu`) |
| `77f0a59` | 5.2 — the review queue scoped by role |
| `21a2ee6` | 5.3 — "My assignments" retired for a plain reviewer |
| `897946f` | 5.4 — assigned-count bubble in the profile menu |

**Uncommitted and unfinished** — the honest empty state (plan section 4's consequence). Three files were
mid-edit when the session hit its ceiling:

```
app/actions/agentic-review.ts
app/review/page.tsx
components/admin/agentic/ReviewQueue.tsx
```

**Do not assume those edits are complete or correct** — they were left deliberately uncommitted rather than
committed half-done, because the full gate could not be re-run at that point. Read the diff
(`git diff`) and decide whether to finish it or discard it and redo it from the spec. **The five gates have
NOT been run since `897946f`**, so the first thing to do after resolving those three files is run all five
and compare against the baseline in section 2.

The empty state matters more than it looks: once 5.2 scopes the queue, an unassigned draft becomes
*invisible* to a reviewer rather than merely unlabelled, and since 9J has never run against a database
(section 3), a blank page is what a reviewer will actually hit. It must distinguish "nothing is assigned to
you" from "nothing is waiting".

---

## 2. What shipped in Round 1 (complete, 13 commits, `ef28cb1`..`a952aa4`)

Creation mode is now **owner-or-reviewer**. Shared branching is **dormant by decision (D23)**, not deleted.

| Commit | What |
|---|---|
| `ef28cb1` | The Phase 10 plan |
| `67fad24` | Removed the one non-owner doorway (`StorylinePlayer`'s "Explore full story tree") |
| `e25d065` | Server gates on `app/story/[id]/layout.tsx` and `app/explore/[id]/layout.tsx` |
| `d20ecb3` | Non-owner continuation refused **before** the coin authorize step, both paths |
| `61172fd` | Migration **115** + rollback — **written, applied nowhere** |
| `df137df` | `e2e/agentic-creation-mode-gate.spec.ts` |
| `cc7ba14` | **Regression fix** — the gates had been bouncing signed-out visitors |
| `2c7156e` | `beat-bundle.ts`'s existing-target gate made reviewer-aware |
| `08cd0c1` | `autoPublishStoryline` honours the publishing switch |
| `168f6c8` | `publishStoryline` gained a source-story ownership check |
| `e291df1`, `9fc8e1b`, `a952aa4` | D24 correction, GOTCHAS rewrite, PROJECT_STATE reconciliation |

**Gate at Round 1 close, independently re-run rather than taken from a report:** tsc clean, lint clean,
**106 files / 995 tests**, build green, **e2e 27/27, 0 skipped**. Pre-change baseline was 105/992 and
e2e 22 — all five gates were green before Round 1 too, so any future deviation is attributable.

---

## 3. What the OWNER owes — none of this is an agent's to do

1. **Apply migration 115 by hand, dev first.** The application-level gates are already in the branch, so
   the ordering plan 3.2 requires is satisfied. **Never apply it before those gates exist** — that ordering
   is the whole reason it is not a charge-and-write-nothing bug.
2. **Before 115 reaches production, run the count in plan 3.6.** Production has real shared-branching data;
   dev has none. Beats whose `generated_by` is not the story's owner become session-client-immutable after
   115. Batch media is unaffected (admin client in the worker) and the interactive path already refuses
   them, so the blast radius is narrow — but it should be a decision, not a discovery.
   Production reads are blocked from an agent session; the owner runs this.
3. **Unit 9J has never run against a database.** Re-drive a run to `awaiting_review` and confirm
   `agent_review_assignments` gains a row with `source='auto'` and a populated `match_reason`. The
   `all_ages` pooling case (D16) still has no fixture. **This now gates relying on Round 3's queue
   scoping** — once scoped, an unassigned draft is invisible to a reviewer rather than merely unlabelled.

---

## 4. What is left, in order

- **Round 3** — plan section 5. In flight; see section 1.
- **Round 1b** — the two findings deliberately held back, each needing one question answered first:
  - `stories` carries an **anonymous SELECT policy with no auth predicate**
    (`003_normalize_beats.sql` lines 219-222). Any anonymous caller can read any non-archived story row,
    including unpublished drafts. **Question: what actually reads `stories` anonymously — does the gallery
    depend on it, or does it read `storylines`?** Then narrow to published rows, or remove.
  - `storage.objects` lets **any authenticated user read the `story-assets` bucket** (same file, lines
    228-234), justified by a comment about "exploration of other users' story trees" — a justification that
    expired when exploration became owner-or-reviewer. **Question: what serves images today?**
  - Neither was bundled into 115 on purpose: narrowing either blind could break the gallery, and the
    gallery is the front door.
- **Round 4 — Phase 10 proper.** One billing defect, per **D25**: `regenerateImageForNode` bills the
  reviewer. `beat_spend_reservations` already stores `user_id` and `related_story_id`, and the finalize RPC
  already matches on the reservation id — so `finalize`/`release` must **stop overriding** the payer, not
  start accepting one. One endpoint decides who pays instead of three. **No migration.** Measure it in the
  database afterwards; do not reason about it.
- **Round 5** — Phase 11 (renumbered from 12) and the tightening round, including the agent prompt-quality
  work. **Read plan 7.2's trap before starting that**: a 2x2 grid of 16:9 panels is itself 16:9, so stating
  the aspect rule on the grid silently produces 4:3 panels.

---

## 5. Facts established this session — do not re-derive

- **`/story/[id]` never had a server-side ownership gate.** `loadStory` uses the session client and never
  compares `story.user_id` to the caller, though it returns it as `savedByUserId`. That is now closed.
- **Reading `/explore/[id]` writes** an `explored_stories` row. Bookkeeping only, never story content.
- **`sourceStoryOwnerId` is set for owner and non-owner alike** in `loadStoryTree`; `explorationMode` is the
  non-owner signal. The 9c plan's 10.1 leaned on the wrong one.
- **`continueStory` runs `authorize → generate → plan → save`** (`lib/store/story-store.ts` line 4024).
  This is why gates go above the authorize step, never at the database.
- **Both `DROP POLICY` names in 115 match `003` exactly.** RLS policies are OR'd — a misspelled name in a
  `DROP … IF EXISTS` no-ops and leaves the permissive policy standing beside the new one, applying cleanly
  while changing nothing. Verified, not assumed.
- **The agentic pipeline passes the admin client explicitly** (`story-assembly.ts` line 1280), so 115
  cannot affect headless generation.
- **The implicit admin is synthesized with role `editor`** (`lib/agentic/reviewers.ts` line 82), so any
  clamp keyed on `role === 'reviewer'` leaves `/admin/authors` intact with no special case.
- **Migrations 113, 114 are applied on dev and frozen. 115 is written and applied nowhere.** The next
  number is **116**. Production still has no agentic schema at all.
- Dev flags: reviewer workflow **on**, agent billing bypass **on**, pricing hard enforcement **on**, agent
  image generation **off**, `beat_bundle_enabled` **on** (so the bundle path is the live one on dev).

---

## 6. Hazards

- **Never apply a migration**, and never run the Supabase CLI.
- **Never `git add -A`.** Stage explicit paths; agents share this tree.
- **Never export a non-function value from a `'use server'` file**; never import a plain value from a
  `'use client'` module into server code (this bit Unit 9K).
- **Server actions are directly invocable.** A hidden button gates nothing.
- **Reviewer writes run on the service-role client and bypass RLS entirely.** `assertCanEditStory` is the
  whole boundary — and `saveBeat` must keep consulting it for **routing only**, never as a strict gate, or
  every reviewer continuation breaks. See the rewritten GOTCHAS section.
- **Every beat image is a 2x2 storyboard grid and must never reach a viewer.**
- **`next/link` clicks on `/story/[id]` are deferred while the screen is busy** — they look broken and are
  not.
- **Playwright strict mode** bites on `Review queue`, `Queue`, and `This is an agent draft.` — scope with
  `getByRole`, `exact: true`, or `.filter({ visible: true })`.
- **Review delegated work by reading the diff, not the agent's report.** Round 1 proved this again: all
  five gates were green while the signed-out regression was live. It took reading the layout to find it.
- **This plan has been wrong more often than the code.** D24 contradicted itself and an executing agent
  caught it. If a document contradicts the code, the code is right; if the code contradicts the database,
  the database is right.
