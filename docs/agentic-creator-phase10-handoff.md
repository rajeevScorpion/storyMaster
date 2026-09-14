# Handoff — Phases 1-11 are done and merged to `dev`

Updated 2026-09-14. Rounds 1, 1b, 3, 4 and 5 are complete and gated. **Migrations 102-118 are all applied
on dev** (verified against `schema_migration_ledger` 2026-09-14), and the branch was merged into `dev`
with `--no-ff` for online testing. Round 2 is still the owner's to run.
Production has none of the agentic schema — see the promotion checklist in PROJECT_STATE.

**The plan is the source of truth: [agentic-creator-phase10-plan.md](agentic-creator-phase10-plan.md)** —
but see section 5, which lists places the plan is now known to be wrong. Where a document and the code
disagree, the code is right; where the code and the database disagree, the database is right.

Read also: [WORKING_AGREEMENTS.md](agent-context/WORKING_AGREEMENTS.md),
[GOTCHAS.md](agent-context/GOTCHAS.md), [PROJECT_STATE.md](agent-context/PROJECT_STATE.md).

---

## 1. What landed since Round 3 closed

| Commit | What |
|---|---|
| `8f113b5` | **Round 1b** — migration **116** narrows the anonymous `stories` read to published storylines |
| `452a8a4` | Working agreement: keep migration comments minimal (116 was cut 99 to 34 lines) |
| `189b75b` | Profile menu now tells "payload loading" apart from "not a reviewer" |
| `42fc085` | **Round 4** — regenerating a beat image no longer bills the reviewer |
| `79a52a1` | **Round 5** — agent-composed beats now get a real final image prompt |

Gate after `79a52a1`, run independently: tsc clean, lint clean, **108 files / 1017 tests**,
`build:verify` green, **e2e 28/28**.

Three more landed after that, all gated at **108 files / 1017 tests**, e2e 28/28:

| Commit | What |
|---|---|
| `6d510ef` | **Phase 11** — reviewer spend on agent-owned stories is now marked and separable in the admin cost view |
| `c967add` | Migration **117** — per-reviewer index on review decisions |
| `a7222e5` | Migration **118** — renamed the misleading pipeline image-generation flag |

**Phase 11 is complete. Phases 1-11 are done.** What remains is verification the owner owes (section 2)
and two design-sized items nobody has started (section 4).

**Migrations 116, 117 and 118 are applied on dev** (2026-09-13/14, confirmed against the ledger).
Production has none of 102-118. Next free number is **119**.

---

## 2. What the OWNER owes

1. ~~**Apply migration 116.**~~ **DONE** — 116, 117 and 118 all applied on dev 2026-09-13/14. The check
   that still matters and is not yet reported: load `/` **signed out** and confirm the gallery rails
   populate. If they go empty, 116's rollback restores the old policy exactly.
2. **Round 4's proof, in the database, not by reasoning.** Press "Regenerate image..." as `testuser` on
   an agent draft. Confirm the charge landed on the agent account with `agenticBypass true`, the reviewer
   paid nothing, **and the image actually persisted**. That last clause is the point — the narration fix
   got the billing right and the write wrong, and that is how it was caught.
3. **Unit 9J has still never run against a database** (Round 2). Re-drive a run to `awaiting_review` and
   confirm `agent_review_assignments` gains a row with `source='auto'` and a populated `match_reason`.
   The `all_ages` pooling case (D16) has no fixture. This gates trusting Round 3's scoped queue: once
   scoped, an unassigned draft is invisible to a reviewer rather than merely unlabelled.

---

## 3. Round 1b — what was decided and why

Two findings were held back from Round 1. Both are now settled.

**Fixed (migration 116).** The anonymous `stories` policy had no auth predicate, so any anonymous caller
could read every non-archived row, drafts included. It could not simply be dropped: the gallery joins
`stories` as an INNER join on the anon client, so with no anonymous visibility the join drops **every
storyline** and the signed-out gallery renders empty. Narrowed to stories backing a public storyline —
exactly the set the gallery ever joins — and scoped to the anonymous role so no signed-in path can be
affected.

**Deliberately NOT fixed.** The storage policy letting any authenticated user read the private
`story-assets` bucket looks stale — its comment justifies it by "exploration of other users' story
trees", which stopped being a thing when creation became owner-or-reviewer. **It is still load-bearing.**
The published-storyline reader signs in-story beat images from that private bucket on the session client
for any signed-in reader, and only the *cover* is ever copied to the public bucket. Dropping the policy
would break in-story artwork for every reader of a story they did not write. The real fix is
architectural — sign the reader path on the admin client, or copy beats to the public bucket at publish —
and belongs in a later round, not a one-line narrowing.

The authenticated `stories` policy is wide for the same reason and was left alone deliberately: three
read paths rely on the route gate above them rather than repeating an ownership check in the query.

---

## 4. Round 5 — scoped 2026-09-14, smaller than the plan implies

**In flight: agent image prompts.** The agentic pipeline never built a final image prompt. It set only
the raw storyboard plan text, and image submission falls back to that when no final prompt exists — so
every agent image was generated with no visual-style lock, no world anchor, no text-overlay mode and no
layout requirements. This is the mechanical cause of all three symptoms in plan 7.2 (advanced settings
ignored, style not curated, no compositional rule). The fix is to give the agent path the same prompt
assembly the human path already uses. **Verified by grep: zero references to any final-prompt builder
anywhere in `lib/agentic/`.**

**Phase 11 (agent spend separable) is mostly already built.** Autonomous pipeline spend is already
separable — the admin cost view labels it, and a per-persona spend page already exists. The real gap is
spend a **reviewer** causes on an agent story: it bills as ordinary human activity with nothing marking
the target story as agent-owned. Code-only fix at the call sites that already resolve reviewer access;
no migration needed.

**The tightening list, re-checked against the code:**

| Item | State |
|---|---|
| Thirteen stale `can_publish` / `can_trigger_media` comments | **Already gone.** The backlog item is itself stale. |
| Per-persona spend attribution | **Already works.** Pooled balances are a recorded decision, not a defect. |
| Per-reviewer index on `agent_review_decisions` | **Done** — migration 117. |
| Rename `agentic_image_generation_enabled` | **Done** — migration 118. But see the finding below. |
| `/review` sends signed-out visitors to `/` | Real, but there is no return-URL convention anywhere — sign-in is a modal, not a route. Small design job. |
| Assignment notifications | No notification infrastructure exists at all. From scratch. |
| Role-change audit history | No audit table; only a "last editor" field. Needs design + migration. |
| Reviewer e2e spec races the pricing payload | Product bug fixed (`189b75b`); only test determinism left. Judged not worth fixing. |

---

**A gap the rename surfaced, NOT fixed.** The pipeline image-generation flag is enforced **nowhere**.
Only the admin toggle and some doc comments ever referenced it — nothing in the pipeline checks it, and
nothing combines it with a persona's own image permission despite a comment claiming it does. So an admin
can switch it on or off and nothing changes. Pre-existing, unrelated to the rename, and left alone
deliberately because wiring it up is a behaviour change, not a cleanup. Decide what it should gate before
implementing it.

---

## 5. Where the plan is now known to be WRONG

- **7.2's aspect-ratio "trap" is mathematically false.** It claims stating the rule on the grid silently
  produces 4:3 panels and that the rule must be restated at panel level. A 2x2 grid has the *same* aspect
  ratio as its panels — four 16:9 panels tile into a 16:9 grid. Grid-level and panel-level statements are
  equivalent. Do not restructure prompts to "fix" a distinction that does not exist.
- **7.1's two doc references were already renumbered.** That item is done.
- Plan 6.2 implies authorize and finalize could be approached separately. They cannot — see section 6.

---

## 6. Facts established this session — do not re-derive

- **The finalize RPC hard-matches the reservation's owner.** It selects the reservation by id *and*
  user id and raises "Reservation not found" when they disagree, then spends from that user's grants.
  So fixing only the authorize half of a billing defect makes the finalize throw *after* the work is
  paid for — the charge-and-write-nothing failure this phase has already fixed four times. Authorize and
  finalize/release must always change together.
- **Finalize and release now read the payer off the reservation, not the session**, and authorize the
  caller separately. This is safe because reviewer edit access is only ever consulted for agent-owned
  stories — on an ordinary person's story a non-owner is refused outright, so a reviewer cannot finalize
  a real user's reservation and drain their wallet.
- **Entitlement stays on the caller, never the payer.** The agent account resolves to the free plan, so
  routing the entitlement gate to it would refuse reviewers a submit that works today.
- **The gallery reads `storylines`, never `stories` directly** — but joins `stories` as an INNER join on
  the anonymous client, which is why anonymous visibility cannot simply be revoked.
- **Migrations 102-118 are applied on dev** (no 109 exists; the gap is deliberate). Next number is
  **119**. Production still has no agentic schema.
- Dev flags unchanged: reviewer workflow on, agent billing bypass on, pricing hard enforcement on, agent
  image generation off, beat bundle on.

---

## 7. Hazards

- **Never apply a migration**; never run the Supabase CLI. **Never `git add -A`** — agents share this tree.
- **Never export a non-function value from a `'use server'` file**; never import a plain value from a
  `'use client'` module into server code.
- **Server actions are directly invocable.** A hidden button gates nothing.
- **Reviewer writes run on the service-role client and bypass RLS entirely.** The edit-access check is
  the whole boundary, and `saveBeat` must keep consulting it for **routing only**, never as a strict
  gate, or every reviewer continuation breaks.
- **Every beat image is a 2x2 storyboard grid and must never reach a viewer.**
- **Review delegated work by reading the diff, not the agent's report.** This keeps paying for itself.
- **Keep migration comments minimal.** 115 and earlier are not the model to imitate.
