# Text Model Gateway — Working Memory

Short and current. Read this first, then the plan: [text-model-gateway-plan.md](text-model-gateway-plan.md).
Branch `feature/text-model-gateway` off `dev`. Pack: `prompt-packs/kisago_text_model_gateway_prompt_pack/`.

---

## Session 3 — 2026-09-14: thinking control, Gemini refresh, reader-safe errors, card layout

**Current state — supersedes "Current state" under Session 2.** Owner reopened the branch before merge with
five decisions (plan section 0): no provider/model names in reader errors (text and image); thinking per model
plus per task; add Gemini 3.8 Flash and remove Gemini text models older than 3.5 Flash; Gemini always at
temperature 1.0; card-grid layout on `/admin/text-models`.

- Plan: [text-model-thinking-plan.md](text-model-thinking-plan.md) — self-contained, incl. migration 120 SQL.
- **Delegated in parallel to Sonnet** (disjoint files, path-scoped commits): Phase A reader-safe errors
  (commit `fix(errors): never show provider or model names…`) and Phase B thinking data layer + migration 120
  (commits `feat(text-models): migration 120 …` then `feat(text-models): thinking levels per model and per
  task…`). If this session ends mid-way, review those diffs before anything else.
- **Migration 120 committed as `7702e34`, byte-identical to plan section 3, and applied to dev by the owner.
  Frozen: any change ships as 121.** Usage 56% at that point.
- **Phase A landed as `45e32a1`, reviewed by Opus: passes.** Also covered two legacy `story_map` fallback paths
  the plan missed. Opus fix `7c9c941`: empty image error stays "no error".
- **Phase B landed as `2a593e9`, reviewed by Opus: passes.** Deviation accepted: `capabilities.reasoningLevels`
  typed optional (always an array after normalization). Agent also fixed the edit form wiping seeded levels.
- **Delegated in parallel to Sonnet:** Phase C gateway (commit `feat(text-models): gateway sends each task's
  thinking level…`) and Phase D admin page (commit `feat(text-models): card-grid Text Models page…`).
- **Phase C landed as `73a2fbe`, reviewed by Opus: passes.** Level resolved server-side per call; Gemini
  temperature 1; thoughts counted as output; "no row" config cached 60s.
- **Phase E live smoke delegated to Sonnet** (only `scripts/text-gateway.smoke.ts`; commit `test(text-models):
  live smoke per thinking level…`).
- **Phase D landed as `0cf116f`, reviewed by Opus: passes** (tsc, lint, build:verify, e2e 30/30 incl. the new
  Thinking control assertion). Opus nit: Gemini model cards say "temperature fixed at 1.0". GOTCHAS and
  PROJECT_STATE (120 row, deferred list) updated.
- Full `npm test` after D: 118 files, 1216 tests, all green.
- **Usage 83%** — no new delegations this session. Left: smoke results (agent already running; if this session
  ends, look for commit `test(text-models): live smoke per thinking level…`, else rerun
  `TEXT_GATEWAY_SMOKE=1 npm run test:text-gateway-smoke`) → `npx tsc --noEmit` → report addendum in
  `text-model-gateway-report.md` → owner click-through → merge into `dev` `--no-ff`.
- Production `model_config` could not be read from this session (permission denied); the plan carries a
  read-only pre-apply check for the owner. Prod has no `agent_personas` table and no 119.

---

## Session 2 — 2026-09-14 (usage 10% at start)

- **P4a (`311d019`) reviewed by Opus: passes.** Playground tests are strict; production apply and persona saves
  reject disabled/unknown keys; narration keeps telemetry; image/TTS untouched; wrappers pass telemetry
  metadata; the retry `attempt` reaches the cost row (context metadata is merged). One nit, recorded as
  deferred in PROJECT_STATE: options regeneration shows gateway error text to readers.
- Agentic tasks read `model_config` through `getModelConfig`, so a global assignment is honoured.
- Dev queried: ledger has 119 (05:27:43+00); all non-Gemini rows disabled; every text task on Gemini; no
  agentic `model_config` rows (they use code defaults).
- **Delegated in parallel to Sonnet:** (A) "Task assignments" section on `/admin/text-models`
  (`assignTextModelToTask`, `isTextModelTask`); (B) `scripts/text-gateway.smoke.ts` live run on all three
  providers plus an e2e check for `/admin/text-models`. If this session ends mid-way, look for commits
  `feat(text-models): assign any text task…` and `test(text-models): live gateway smoke…` and review their diffs.
- **A landed as `fb87733`, reviewed by Opus: passes** (admin check and text-task check server-side, temperature
  preserved, registry validation, configured key always listed). 40/40 registry tests.
- **B landed as `15c3106`, reviewed by Opus: passes.** Live smoke through the real gateway: Gemini 2.5 Flash-Lite
  22/18 tokens ~1.2s; Luna (OpenAI, reasoning low) 59/16 tokens ~$0.000031; Qwen 3.7 Flash (OpenRouter, JSON mode)
  76/**324** tokens ~$0.000044 ~5s — passes alone, but got HTTP 429 (`rate_limited`, no retry) when fired straight
  after the other two. `npm test` does not pick up smoke files. New `e2e/text-models-admin.spec.ts`.
- Full gate delegated to Sonnet after A and B (tsc, lint, test, build:verify, test:e2e) — report-only, no commits.
- **Gate green:** tsc, lint (no warnings), 1122/1122 unit tests, `build:verify`, e2e 30/30 including the
  authenticated `/admin/text-models` render.
- Docs committed: final report [text-model-gateway-report.md](text-model-gateway-report.md); GOTCHAS "Text
  models"; PROJECT_STATE 119 row, deferred text-model gaps, roadmap note.

### Current state — supersedes the older sections below
**Code-complete on `feature/text-model-gateway`; not merged into `dev`.** Every phase P1–P5 is done and
Opus-reviewed. Next, all owner actions:
1. Sign in and click through Task assignments, Test and Enable on `/admin/text-models` (e2e proves render only).
2. Merge into `dev` with `--no-ff`.
3. Production: pre-apply `model_config` check (plan section 4), apply 119, redeploy.
Genuine follow-ups are in the report's section J and PROJECT_STATE "Deferred → Text models".

---

## Session handoff — 2026-09-14 close of session 1 (P3 done and reviewed; P4a next)

**Supersedes the P3 row below:** P3 landed as `968a7f2` (57 new tests, full suite 1102 green) and Opus
reviewed it. The follow-up commit on top of it fixes what review found: both adapters now keep the
provider's HTTP status and a trimmed upstream error message (Gemini previously swallowed every SDK error
into one generic message; OpenAI/OpenRouter dropped `error.message`, the only clue to a Luna 400), and a
non-abort network failure is `provider_error`, not `timeout`.

**Known P3 gaps, not blocking — fold into P4a:**
- Telemetry metadata no longer carries `promptChars` / `temperature` / `referenceCount` (the old proxy sent
  them). Add an optional `telemetryMetadata` to the request and pass them from the wrappers.
- Gemini `finishReason` / `promptFeedback.blockReason` are not mapped (the old code didn't either).
- `.env.local` has an empty `OPENROUTER_API_KEY=""` placeholder for the owner to fill.

**Update, still session 1 (usage 79%):**
- **Migration 119 applied on dev** by the owner and verified live against the file (18 columns, all
  constraints, trigger, RLS with 0 policies, 12 seed rows with correct enabled flags, ledger row).
  **Frozen** — any change ships as 120. Not applied on prod.
- `OPENROUTER_API_KEY` is now set in `.env.local`, so the P5 smoke can cover all three providers.
- **P4a delegated to Sonnet** with the telemetry gap above in its brief. Next session: if a
  `feat(text-models): route every text call…` commit exists, review its diff first; otherwise check
  `git status` for partial work.

**P4b progress (Opus, directly, at 93% usage — no delegation):**
- `2d6e3f7` admin Text Models page (`/admin/text-models`, nav under Studio): list, enable/disable (refused
  server-side while the provider key is missing), edit, add (saved disabled), live Test, fallback-task banner.
- Story/Reel Playground model picker now reads enabled registry models via `FilterDropdown` (native `<select>`
  removed); shows the production key even when disabled/unknown; disables the temperature slider for models
  that reject it. Committed right after this note (`feat(text-models): registry-backed playground picker`).
- Persona drawer help text and `/admin/agents/routing` resolution/fallback display: committed with this note.
- **Gap found — top of next session's work:** the five agentic tasks (incl. `agent_story_evaluation`,
  `agent_novelty_assessment`) are **not** in the Story Playground (their prompts live in code), so the only way
  to point the evaluator at a cheap model today is a per-persona override. Pack acceptance #7 wants it globally.
  Add a "Task assignments" section to `/admin/text-models`: one `FilterDropdown` per agentic task, saved through
  `updateModelConfig` behind `validateTextModelSelection` (new admin action, `verifyAdmin` first).
- **Nothing in P4b is browser-verified** — tsc and lint only. P5 should add an e2e route check for
  `/admin/text-models` redirecting signed-out visitors, and the owner checks the page signed in.

**Next session — start here:**
1. Ask the owner for a usage reading.
2. **P4a landed as `311d019`** after session 1's usage cap — agent reports tsc/lint clean, 1117/1117 tests,
   15 new. **Not yet reviewed by Opus.** Its stated deviations: beat-control/episodes/discovery call the
   gateway directly (their schemas aren't in the wrapper map); their manual `GEMINI_API_KEY` pre-checks were
   removed in favour of the gateway's credential check; dead `buildResult` removed from prompt-playground.
   **Review its diff** against plan 5/P4a (Opus reads the diff, not the agent report). Check specifically: the playground
   test runner uses `strictModel`; `applyModelToProduction` and persona saves reject disabled/unknown keys;
   narration keeps its telemetry; image/TTS branches untouched; wrappers pass `telemetryMetadata`.
   If no such commit, `git status` shows partial P4a work — finish it against the same checklist.
3. Then delegate **P4b** (admin Text Models page, registry-backed dropdowns, nav, routing page) and **P5**
   (env-gated smoke on all three providers, full gate incl. `build:verify` + e2e, PROJECT_STATE ledger row
   "119 applied on dev", GOTCHAS entry, final report per pack template 12).

---

## Earlier handoff — 2026-09-14 (P2 done; P3 was running)

### Where things stand

| Phase | State |
|---|---|
| P1 plan | **Done** — `3da6952` |
| P2 registry (migration 119) | **Done** — `7065153`, reviewed by Opus. Two review fixes to `lib/ai/text-models.ts` (provider key always required by `getMissingEnvVars`; latch comment) ride in the P3 commit. |
| P3 gateway + wrappers | Delegated to Sonnet late in session 1. **Next session: check `git log` first.** If a `feat(text-models): provider gateway…` commit exists, review its diff against plan 3.3/3.4 before anything else; if not, check `git status` for partial work and finish or redo P3. |
| P4a call sites + write validation | not started |
| P4b admin surfaces | not started |
| P5 smoke, gate, docs | not started |

Migration 119: **written, not applied anywhere** (as of session 1 close). Freeze the file once the owner applies it.

### Reviewer additions agreed after the plan was written (apply to P3+)
- `TextGenerationRequest.strictModel`: fallback → throw `model_unavailable` (admin playground uses it in P4a).
- Output cap sent only when `maxOutputTokens > 0`. Router does not re-warn on fallback (resolver already does).
- A process that latched "registry missing" stays Gemini-only until restart/redeploy — applying 119 needs one.

### Next-session start
Opus: read this file and the plan, check P3 state as above, ask the owner for a usage reading, then delegate
P4a (plan 5) to Sonnet. P4b after, then P5.

### Owner decisions that bound the work
- Repair loop **deferred** (conflicts with D9).
- No routing change on deploy; owner switches tasks in Admin.
- Non-Gemini rows seed disabled. IDs verified online 2026-09-14 (plan 2.4).
- Smoke: tiny paid calls on all three providers once `OPENROUTER_API_KEY` is filled in.

### Things a fresh session would otherwise re-derive
- The model id a server action receives on the reader path comes from the client. Resolve every id against the
  registry; never pass a raw id to a paid provider.
- Luna rejects `temperature` (HTTP 400). Qwen 3.7 Flash has JSON mode only, no strict schema.
- `estimateCost` returns 0 for unknown model ids — non-Gemini cost must come from the row or `usage.cost`.
- `vitest.smoke.config.ts` runs every `*.smoke.ts`; gate new smoke files behind an env var.
- `app/actions/playground.ts` is dead code (no importers). Don't migrate it.
- Prod `model_config` was not queried (read denied). The owner runs the plan's pre-apply check before 119 on prod.

### Usage log
- 2026-09-14 start of implementation: 16%.
- After P2 (two discovery agents + P2 cost ~47 points): 63%. During P3: 76%. Owner allowed P4a at 79%; 90% reached during P4a — session 1 closed, handoff written.
- Budget lesson: each Sonnet phase costs roughly 10–15 points of the 5-hour window. Plan two phases per
  session, not four.
