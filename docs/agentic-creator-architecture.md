# Agentic Creator — Architecture

**This file describes what is actually implemented.** Anything not yet built is marked _(planned)_ and
must be corrected to reality as each phase lands. The forward-looking design lives in the plan file;
this one is the map of the territory.

Status: **Phase 4 complete.** Implemented: `lib/agentic/flags.ts`, `lib/agentic/personas.shared.ts`,
`lib/agentic/memory.shared.ts` + `memory.ts`, `lib/agentic/supervisor.shared.ts` + `supervisor.ts`,
`app/actions/agentic-memory.ts`, `app/actions/agentic-admin.ts`, `app/actions/agentic-personas.ts`,
`app/actions/agentic-supervisor.ts`, and the `/admin/agents` shell with its Overview, Personas and Tasks
pages. Migrations 102-105 are **applied on dev 2026-09-06, none on prod**; **106 is written and applied
nowhere**, so every Phase 4 query currently runs its fail-closed path. Phases 5-12 below are still
_(planned)_.

---

## The shape

```
Editorial Supervisor  ->  agent_tasks  ->  Execution Orchestrator  ->  Persona run
   (catalogue gaps)       (commissions)     (claim/retry/resume)       (writes story)
                                                     |
   agent_story_memory <- novelty check <- seed plan -> materialize canonical beats
                                                     |
                                       saveStory() -> normal editable Kissago draft
                                                     |
                          evaluation -> review queue -> human reviewer -> publish
```

Two responsibilities are kept apart on purpose:

- The **Supervisor** decides *what should be created and by whom*. It is editorial.
- The **Orchestrator** decides *how and when a job runs safely, economically and recoverably*. It is operational.

Personas supply creative identity, never infrastructure decisions. Human reviewers certify
publishability; nothing publishes without one.

---

## Module map _(planned)_

```
lib/agentic/
  flags.ts               server-only  — the only place the six agentic flags are read
  personas.shared.ts     pure         — persona types, StoryConfig derivation, permission resolution
  memory.shared.ts       pure         — novelty scoring and thresholds
  memory.ts              server-only  — agent_story_memory reads/writes, trigram candidate query
  supervisor.shared.ts   pure         — coverage matrix, deterministic gap ranking, proposal validation
  supervisor.ts          server-only  — catalogue coverage, commission proposals, task pool CRUD
  routing.shared.ts      pure         — role -> TaskKey map, persona override precedence  (Phase 5)
  orchestrator.ts        server-only  — claim / execute / retry / resume state machine
  story-assembly.ts      server-only  — headless seed-plan -> canonical StoryMap -> saveStory
  evaluation.ts          server-only  — deterministic + model evaluation          (Phase 7)
  reviewers.ts           server-only  — requireReviewer(), assignment queries      (Phase 9)

lib/ai/seed-authoring.ts               moved out of app/actions/story-runtime.ts   (Phase 6)

app/actions/
  agentic-admin.ts       flag toggles
  agentic-personas.ts    persona CRUD, clone, status, test-lab run
  agentic-supervisor.ts  gap report, commission, assign
  agentic-runs.ts        run list/detail/cancel/retry, "Run now" kick
  agentic-review.ts      reviewer queue, approve/reject/publish                    (Phase 9)

app/api/agentic/run/route.ts   CRON_SECRET-guarded worker

app/admin/agents/**      Overview, Personas, Test Lab, Task Pool, Runs, Model Routing
app/admin/authors/**     Reviewers, Review Queue                                   (Phase 9)
```

The `*.shared.ts` / `*.ts` split follows the repository convention: the shared half is pure and
isomorphic and carries the unit tests; the server half starts with `import 'server-only'`.

---

## Data _(planned)_

| Table | Migration | Holds |
|---|---|---|
| `agent_personas` | 103 | Creative identity, defaults, permissions, lifecycle, model overrides |
| `agent_persona_memory` | 103 | One row per persona, created by trigger — recent titles, premises, names, themes |
| `agent_story_memory` | 105 | Global catalogue memory with trigram indexes on title and premise |
| `agent_novelty_checks` | 105 | Auditable pre- and post-generation verdicts |
| `agent_tasks` | 106 | The commission / task pool |
| `agent_runs` | 107 | Recoverable execution state, `checkpoint` of completed expensive steps |
| `agent_run_events` | 107 | Per-run stage timeline |
| `agent_schedules` | 107 | Per-persona cadence |
| `agent_evaluations` | 108 | Evaluation results and warnings |
| `agent_reviewers`, `agent_review_assignments`, `agent_editorial_audit_events` | 109 | Human review |

Columns added to existing tables, all nullable so human content is unaffected:
`stories.agent_persona_id`, `stories.agent_task_id`, `storylines.editorial_label`,
`storylines.agent_persona_id`.

**No parallel story model.** An agent-generated story is an ordinary `stories` row with an ordinary
`story_map`, created through `saveStory()`, published through `publishStoryline()`, and editable by a
human at `/story/[id]` like any other. The agentic tables hold tasks, runs, memory and review state —
never a second representation of a story.

---

## How an agent creates a story _(planned, Phase 6)_

1. **Brief** — `agent_story_brief` produces working title, premise, themes, intended characters.
2. **Pre-generation novelty** — scored against global and persona memory; `block` fails the run.
3. **Write** — `agent_seed_story_writing` produces full prose in the persona's language, within the
   existing source word cap.
4. **Config** — `resolvePersonaStoryConfig()` builds a real `StoryConfig`: `authoring.mode = 'seeded'`,
   `sourceFidelity = 'strictly_follow'`, beat count clamped to the persona's range, and
   `imageGenerationMode: 'prompt_only'` unless image permission is granted.
5. **Plan** — `generateSeedPlanPreview()` segments the prose into canonical beats.
6. **Materialize** — `materializeSeededBeat()` per beat, building `StoryMap` nodes linked by
   `parentId` + `selectedOptionId` along each beat's canonical option — the same links publish
   extraction already relies on.
7. **Persist** — `saveStory()`, then stamp `agent_persona_id` and `agent_task_id`.
8. **Post-generation novelty** — title, summary and character names re-checked.
9. Run advances to `awaiting_review`. **No publish.**

Every step records its result in `agent_runs.checkpoint` before advancing, and is skipped on retry if
already present. That is the whole idempotency contract for paid calls.

---

## Safety properties

| Property | How it is enforced |
|---|---|
| Feature can be fully disabled | `agentic_creator_enabled`, read via `lib/agentic/flags.ts` with `fallback = false` |
| Un-migrated database is safe | Every flag read fails closed; missing table means feature-off, not a 500 |
| No autonomous publish | The orchestrator's terminal stage is `awaiting_review`; only reviewer actions publish |
| Images off means no image call | Persona permission resolves to `imageGenerationMode: 'prompt_only'` |
| Narration independent of images | Separate `allow_narration` column; narration is a reviewer action, not a run stage (D10) |
| Retries never double-charge | Partial unique index for one live run per task, plus `checkpoint` |
| No secrets or prompts leaked | Persona prompts are admin-only data; run events store concise messages, never full prompts or chain-of-thought |
| Agent cannot act as admin | Agent work runs as the system user through bounded server functions, never `verifyAdmin()` paths |

---

## Known limits

- **Autonomous cadence is roughly daily.** Vercel Hobby allows one cron; the agent queue drains from
  the existing `/api/batch/reconcile` tick, plus an admin "Run now" kick.
- **Similarity is trigram + LLM adjudication, not embeddings.** See D3 in the decisions doc.
- **Coverage cannot be grouped by language in SQL alone.** `storylines` has `age_group` and `genre` but no
  `language` column, so `buildCatalogueCoverage()` joins `stories.story_config->>'language'`. Published
  rows also carry `moderation_status = 'none'` rather than `'approved'`, and real `genre` values include
  `'reel'`, which is outside `STORY_GENRES` — coverage tolerates off-taxonomy values, proposals never emit
  them.
- **The five agentic TaskKeys have no admin model editor.** The plan recorded "adding a TaskKey
  gives you the admin editor for free" as a verified fact. It is false for these tasks:
  `PlaygroundStudio.tsx` is the only component that renders `TASK_DEFINITIONS`, and it filters its
  task list through `isPromptTaskKey`. All five agentic keys are deliberately excluded from
  `PromptTaskKey` because they build prompts in code rather than from an admin template — which
  excludes them from the model editor at the same time. Today the only lever is a persona's
  `model_overrides`; everything else uses the compiled `DEFAULT_MODELS`. `/admin/agents/routing`
  states this plainly rather than linking to a page that does not list them.
- **The task pool is unpaginated.** `listAgentTasks` selects every matching row; the admin page's language
  and age-group filters are client-side and correct only while the pool returns whole.
- **Urdu has no narration voice.** Story text supports it; TTS does not. Seed personas avoid it.
- **The multi-beat loop is duplicated in spirit.** `lib/store/story-store.ts` keeps its own client-side
  orchestration; `lib/agentic/story-assembly.ts` is a separate, simpler, canonical-path-only server
  version. Unifying them was considered and rejected for V1 (D2).
- **Neither narration nor images happen in the pipeline.** Both are reviewer actions on a finished
  draft, using the batch flows that already exist (D10). The pipeline's job ends at `awaiting_review`.
- **A reviewer cannot yet press either button.** `submitStoryNarrationBatch`
  (`app/actions/narration-batch.ts:132`) and both image submits (`app/actions/image-batch.ts:161`)
  resolve the caller from the session and throw `Forbidden.` on a story they do not own. Agent drafts
  are owned by `AGENTIC_SYSTEM_USER_ID`, so this is the same reviewer-authorization gap already
  recorded against Phase 9 — narration and images are its first two customers, and it is worth solving
  once for both rather than twice.
- **Images will need two things narration did not, when that phase comes.** First, an entitlement
  gate: `assertImageGenerationEntitled` (`app/actions/image-batch.ts:72`) denies `tier_locked` because
  `image_generation` is `free_enabled: false`, and because it is a *quote* rather than an authorize,
  the `actorKind` bypass is never reached — the likely answer is promoting the system user's
  entitlement tier (an admin action; per GOTCHAS, a tier promotion grants access without granting
  coins), not a code change. Second, image batches hold **one reservation for the whole job**
  (`reservation_id` on the job row) where narration reserves and finalizes per beat, so the
  partial-failure release path is a different shape and narration's answer does not transfer.
