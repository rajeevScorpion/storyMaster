# Agentic Creator — Implementation Log

One entry per completed phase: what was built, which files changed, migration and config impact, what
was tested, and the commit. Append only; do not rewrite history here.

Plan of record: `C:\Users\User\.claude\plans\kisago-agentic-creator-prompt-pack-imple-refactored-dragon.md`
Source pack: `prompt-packs/Kisago_Agentic_Creator_Prompt_Pack/`

---

## Phase 0 — Baseline and branch

**Date:** 2026-09-06
**Branch:** `feat/agentic-creator`, cut from `dev` at `1d93dea`

**Work.** No feature code. Read the 17-file prompt pack in full, audited the repository across admin /
auth / flags, the story-creation pipeline, and jobs / models / memory / tests, then recorded the
grounded architecture and the operator's decisions.

**Findings that changed the plan.**

1. `app/actions/story-runtime.ts` is `'use client'`, so `generateSeedPlanPreview` and
   `materializeSeededBeat` cannot be called from server code where they sit — and the multi-beat loop
   exists only inside the browser-only Zustand store. A headless path has to be created, not merely
   wired up. (D2)
2. There is no role system at all — `verifyAdmin()` is one env-var comparison. The reviewer role is
   genuinely new work. (D6)
3. There is no pgvector and no generic job queue, but there *are* strong reusable patterns:
   `pg_trgm` similarity, `lib/ai/character-novelty.shared.ts`, and the claim / reclaim / re-kick shape
   in `lib/media/image-job-runner.ts`. (D3)
4. `imageGenerationMode: 'prompt_only'` already exists and is exactly the "images off" gate the pack
   asks for, so no new gate was invented. (D5)
5. Vercel Hobby permits one daily cron, which caps autonomous cadence. (D7)

**Files added.**

| Path | Purpose |
|---|---|
| `docs/agentic-creator-working-memory.md` | Current phase, next step, flags, migration status |
| `docs/agentic-creator-decisions.md` | D1–D8 with codebase evidence and costs |
| `docs/agentic-creator-architecture.md` | Module map and safety properties, kept truthful per phase |
| `docs/agentic-creator-implementation-log.md` | This file |
| `docs/agentic-creator-test-status.md` | Pre-implementation baseline |

**Migrations.** None.
**Config / env.** None yet. `AGENTIC_SYSTEM_USER_ID` arrives in Phase 6.
**Tests.** Baseline only — see `agentic-creator-test-status.md`. No behaviour changed, so no new tests.

**Commit:** `d0cb822`

---

## Phase 1 — Feature isolation and admin shell

**Date:** 2026-09-06

**Work.** The kill switch and the admin surface that hosts it. No generation, no jobs, no personas.

**Files added.**

| Path | Purpose |
|---|---|
| `supabase/migrations/102_agentic_creator_flags.sql` (+ rollback) | Six flags, all `false`, self-recording into the ledger |
| `lib/agentic/flags.ts` | `server-only`. `AGENTIC_FLAG_KEYS`, `AgenticFlags`, `getAgenticFlags()` — the sole read path, always `fallback = false` |
| `app/actions/agentic-admin.ts` | `'use server'`. Six `verifyAdmin()` → `setFeatureFlag()` setters plus `getAgenticFlagsAction()` |
| `app/admin/agents/layout.tsx` | Thin server shell, re-verifies admin with the parent's try/redirect shape |
| `app/admin/agents/page.tsx` | Server component; fetches flags, passes them down (the `admin/policies` pattern) |
| `components/admin/agentic/AgenticOverview.tsx` | Client. Off-state card, master switch, five subordinate toggles, honest "not yet implemented" list |

**Files modified.**

- `lib/admin/nav.ts` — new `AGENTS_CHILD_GROUPS` (one Overview child) and a top-level `agentic` group after `content`.
- `lib/admin/nav.test.ts` — added `/admin/agents` to the hub-self-link exclusion in the duplicate-href test. **Reviewed and confirmed legitimate:** `/admin/settings` and `/admin/pricing` are already excluded for the identical reason — a hub item deliberately shares its href with its overview child. The test's intent is intact.

**Migrations.** 102 written; **not applied to dev or prod.** Owner applies by hand.

**Config / env.** None.

**Design notes.**

- The subordinate toggles are *disabled* while the master switch is off, rather than hidden. Hiding them would make the page look complete when it is inert; disabling them says why.
- The off-state card does **not** redirect or hide the switch — an admin has to be able to reach the toggle from the page that explains it.
- `lib/agentic/flags.ts` carries a header comment forbidding flag reads elsewhere. That single choke point is what makes "un-migrated database behaves as feature-off" true rather than aspirational.

**Tests.** No new unit tests — this phase adds no pure logic worth pinning; `nav.test.ts` already covers the nav tree it touches. Full gate re-run after a copy correction: tsc clean, lint clean, 594/594 unit, `build:verify` passing, 14/14 Playwright.

**Commit:** _(filled in at commit time)_

---

_(Phase 2 onward appended here.)_
