# Production promotion runbook — `dev` → `main`

Rewritten 2026-09-16, verified directly against both databases on that date (ledger, flags, `model_config`,
`image_model_registry`, `prompt_configs`, `managed_pages`).

> **EXECUTED 2026-09-16.** Migrations 102-114 and 116-123 applied to production, `main` merged `--no-ff` at
> `084c2ed` and deployed live, signed-out gallery verified populated, and a prompt-only beat generated
> cleanly on a real account. **Section 2's post-deploy step — migration 115 — is still outstanding**, along
> with the two settings decisions in section 5. Everything else here is done; kept as the record of what was
> run and as the procedure for the next promotion.
>
> **One thing this runbook did not catch, and the next one should:** 120 was skipped during the hand-run and
> only surfaced by querying the ledger for the whole expected range. A hand-applied sequence does not
> self-check — verify the range, not just the last file you ran.

Scope has grown since the 2026-09-14 version of this file, which covered the Agentic Creator system alone
(16 migrations). `dev` is now **238 commits and 21 migrations** ahead of `main`, carrying four merged packs:

| Pack | Migrations |
|---|---|
| Agentic Creator (Phases 1-11) | 102-108, 110-118 |
| Text Model Gateway | 119, 120 |
| Content-block fallback | 121 |
| Image composer continuity | 122, 123 |

Plus two code-only packs with no migration: text task guidance, and beat length allowance.

**Blast radius is far wider than `lib/agentic/`.** The push also changes shared pricing, narration (batch and
interactive), story runtime, the beat bundle, both story route layouts, the anonymous gallery policy, and
every text model call in the app. Do not treat it as one feature behind a flag.

**Verified state, 2026-09-16:** dev ledger holds 95-108 and 110-123. Prod ledger stops at **101**. Prod is
missing exactly 21 migrations and 13 tables — the twelve `agent_*` tables plus `text_model_registry` — which
is an independent cross-check that the list below is complete.

---

## 1. Before touching production

- [ ] Finish the three verifications still owed on **dev** (`agentic-creator-phase10-handoff.md` section 2).
      None has been reported done: signed-out gallery after 116, the reviewer-billing proof read from the
      database, and Unit 9J's auto-assignment row. Promoting first is promoting untested behaviour.
- [ ] Confirm the prod ledger yourself rather than trusting this file:
      `select migration_number from public.schema_migration_ledger where migration_number >= 102 order by 1;`
      Expect **zero rows**.
- [ ] Decide the two questions in section 5 — the compiler mode and the prod story prompt. Both change
      user-visible behaviour and neither is covered by a migration.

## 2. Migrations — by hand, in numeric order

**Twenty of the 21 go in before the deploy. Only 115 goes in after.** Applying schema ahead of the code that
needs it is the standing rule here, and it also solves the text-gateway restart caveat: a running server that
saw `text_model_registry` missing stays Gemini-only until it restarts, and the deploy is that restart.

**There is no 109** — deliberate, do not go looking for it. Every file records itself in the ledger as its
last statement, so re-running one is safe but pointless. Each has a verified `_rollback.sql` twin.

### Before the deploy — 20 files, in this order

| # | Migration | Notes |
|---|---|---|
| 102 | `agentic_creator_flags` | Six flags, all `false`. Nothing observable changes |
| 103 | `agent_personas` | **must precede 104, 105, 106** — they FK to its tables |
| 104 | `seed_agent_personas` | 15 personas; 103's trigger creates 15 memory rows. **Must precede 120** |
| 105 | `agent_story_memory` | |
| 106 | `agent_tasks` | |
| 107 | `agent_runs` | |
| 108 | `agent_evaluations` | |
| 110 | `riya_sen_narration_voice` | data-only; needs 103 + 104, not a contiguous run |
| 111 | `agent_reviewers` | lands empty — until a row exists only `ADMIN_USER_ID` passes the reviewer gate |
| 112 | `agent_review_decisions` | |
| 113 | `agent_reviewer_roles` | **drops** two booleans. Safe only because 111 is empty on prod |
| 114 | `agent_review_assignments` | |
| 116 | `narrow_anonymous_stories_read` | ⚠ **changes signed-out reads the moment it runs** — check immediately, see below |
| 117 | `agent_review_decisions_reviewer_index` | additive index |
| 118 | `rename_agentic_pipeline_image_flag` | order-independent: updates 102's row, or inserts it off |
| 119 | `text_model_registry` | 12 seed rows. **Must precede 120** |
| 120 | `text_model_thinking` | rewrites `model_config` — see the pre-apply check below |
| 121 | `text_task_content_block_fallback` | adds one column |
| 122 | `image_prompt_budget_target` | 2,800 → 3,000 on 7 prod rows. **Must precede 123** |
| 123 | `image_prompt_budget_3800` | 3,000 → 3,800; only touches rows already at 122's value |

**116 is the one that can take the gallery down.** Prod has 46 public storylines out of 47, so the narrowed
policy should cover everything the gallery joins — but the gallery reads `stories` as an inner join on the
anonymous client, so over-narrowing renders an **empty gallery rather than an error**. No exception, no log
line, just no content. The moment 116 is applied, load `/` in a private window and confirm the rails
populate. Its rollback restores the old policy exactly.

**120 rewrites `model_config`, and prod's rows differ from dev's — this was checked.** Prod runs two tasks on
models 120 removes: style extraction on Gemini 2.5 Flash, voice selection on Gemini 2.5 Flash-Lite. Both move
to Gemini 3.8 Flash at Low thinking, with history rows written, and a novelty-assessment row is inserted.
Prod's remaining text tasks are on 3.5 Flash, which 120 keeps; image and TTS rows are untouched. **No prod
task is left pointing at a deleted model.** Re-run the check before applying, since an admin may have changed
an assignment since: `select task_key, model_id from public.model_config order by task_key;`

### After the deploy — 1 file

| # | Migration | Notes |
|---|---|---|
| 115 | `beats_owner_only_writes` | ⚠ **RLS. Never before the deploy.** Still outstanding as of 2026-09-16 — the deploy is verified, so it is now cleared to run once the 5-row decision below is made |

**Why 115 waits.** It narrows beat writes to the story owner. The application-level gates that make it safe
ship in the code. Applying it against the old code means a non-owner's continuation is charged and generated,
then refused at the database — the charge-and-write-nothing defect this project has already fixed four times.

**115 has a data consequence on prod that dev never had, and it is now measured: 5 beat rows** have a
`generated_by` that is not the story's owner — real shared-branching history, which prod still allows and dev
has none of. After 115 those 5 rows can no longer be updated through the session client. Batch narration and
image jobs run on the admin client and are unaffected, and the interactive single-beat path already refuses
someone else's beat today. Decide deliberately before applying: leave them read-only, or reassign
`generated_by` to the story owner. Five rows is small enough that either is defensible.

## 3. Environment — Vercel, production scope

- [ ] **`AGENTIC_SYSTEM_USER_ID` — create a new auth user in the *production* Supabase project** and set its
      UUID. **It is a different UUID from dev's; copying dev's value across is wrong.** A wrong or unset
      value makes the billing bypass stop matching, so agent runs are *denied* rather than billed. That
      fails closed, which is safe, but it presents as "agent runs mysteriously fail", not as a config error.
      Not urgent on day one — the flags are off — but set it during promotion rather than later.
- [ ] **`OPENROUTER_API_KEY` — new in this push.** Registry rows are gated on their required env vars, so
      without it the OpenRouter models stay unavailable. Not needed day one: after 119/120 every prod text
      task is on Gemini. Needed before anyone assigns a task to Qwen or DeepSeek.
- [ ] **`OPENAI_API_KEY`** — already used by the image providers; confirm it is set, since the gateway's
      OpenAI rows now depend on it too.
- [ ] `CRON_SECRET` — **no action.** Already set; the agentic worker reuses it and rides the existing daily
      reconcile cron rather than adding a second `vercel.json` entry (Hobby allows one).
- [ ] `NEXT_PUBLIC_LOG_TIMING` — optional, leave unset in production.
- [ ] `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` — local test-only, **never** set in production.

## 4. Deploy

```bash
git checkout main
git pull
git merge dev --no-ff -m "Merge dev: agentic creator, text model gateway, image composer continuity"
git push
git checkout dev
```

`--no-ff` is required, not stylistic: it makes the whole promotion revertible with
`git revert -m 1 <merge-commit>`. A fast-forward destroys that.

## 5. Settings — what to change, and what to leave alone

**Nothing has to be enabled for this push to be safe.** Every new flag lands off and every new code path
fails closed. Two settings are real decisions, though, and neither is a migration.

### The six agentic flags — leave OFF

They arrive from 102 at `false` and stay there. Turning the system on is a separate, deliberate act after
prod is verified quiet.

| Flag | dev today | prod at promotion |
|---|---|---|
| `agentic_creator_enabled` | on | **off** |
| `agentic_billing_bypass_enabled` | on | **off** |
| `agentic_reviewer_workflow_enabled` | on | **off** |
| `agentic_supervisor_enabled` | on | **off** |
| `agentic_scheduler_enabled` | off | off |
| `agentic_pipeline_image_generation_enabled` | off | off — and enforced **nowhere in code**, so it does nothing either way |

### Decision 1 — the image prompt compiler mode

**Prod is on `shadow`; dev is on `new`.** In shadow mode the compiled prompt is built and recorded but the
**legacy prompt is what gets sent**. So if prod ships unchanged, none of the image composer continuity work
goes live — not the English prompts, not attribute-specific continuity, and migrations 122 and 123 have no
observable effect at all, because nothing reads the budget they raise.

Recommended: **deploy on `shadow`**, confirm the rest of the push is quiet, then flip
`image_prompt_compiler_mode` to `new` as its own step with its own verification. That mirrors how dev got
there and keeps two large changes from landing in one blast.

### Decision 2 — prod's published story prompt

**This is the largest silent dev/prod behaviour difference in the push, and it is not a migration.** Prod
carries one published prompt override — `story_generation`, last touched 2026-04-04 — and **dev has no
overrides at all**, so dev has been running the default templates this whole time.

That April prompt still instructs the model to write "a short paragraph", which is exactly the wording the
beat-length work moved out of the prompt and into the runtime length contract, and it contains **no series or
episode rules**. Shipping without touching it means prod keeps April's prompt while every test and every dev
verification ran against the current default.

**RESOLVED 2026-09-16 — the override was deleted**, so production now reads the code template like dev, and
prompt changes ship with deploys. Verified by query: `prompt_configs` is empty on both environments. The April
prompt is retained in `prompt_history` and restorable from the playground's Published History.

**For the next promotion, check this first:** `select task_key from public.prompt_configs;` on both
environments. Any row there means that task is pinned and has silently stopped following the code — which is
how production drifted for five months without anyone noticing.

### Leave alone, deliberately

- Reference personalization stays **off** on prod — dormant by design.
- Runware rows stay disabled on both; their prices are still unverified guesses.
- **The legal consent gate needs no work.** Contrary to older notes, all four legal documents are already
  published on prod at `1.0.0` (effective 2026-08-29) and the gate is already **on**.

## 6. After deploying

- [ ] Signed-out `/` — gallery rails populate. Do this first; it is the 116 check.
- [ ] A signed-in non-owner can still see in-story beat images on a published storyline. This exercises the
      storage policy the branch deliberately left wide; if artwork broke, that is why.
- [ ] **Ordinary story generation, one beat, on a real account.** The push touched story runtime, the beat
      bundle, pricing and every text call — this is the regression that matters most and has nothing to do
      with agents.
- [ ] Narration on a normal user's story still bills that user (batch and single-beat paths both changed).
- [ ] The admin Text Models page lists rows rather than reporting a missing migration. If it looks empty,
      the server did not restart after 119 — redeploy.
- [ ] `/admin/agents` renders with the flags off.
- [ ] Ledger: `select count(*) from public.schema_migration_ledger where migration_number >= 102;` → **21**.
- [ ] Then, and only then, apply 115 and re-check that an owner can still continue their own story.

## 7. If it goes wrong

Revert with `git revert -m 1 <merge-commit>` and push. Code reverts cleanly; **migrations do not roll back
automatically**. Only 115 and 116 change existing behaviour — both have exact rollbacks. Everything else is
additive and can stay in place while the code is reverted, because the application fails closed when the
tables are absent and behaves identically when they are present with the flags off.

## 8. Not in scope

Assignment notifications and role-change audit history are deferred by the owner (2026-09-14). The pipeline
image-generation flag is enforced nowhere in code; wiring it up is a behaviour change, not a cleanup.
