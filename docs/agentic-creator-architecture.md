# Agentic Creator — Architecture

**This file describes what is actually implemented.** Anything not yet built is marked _(planned)_ and
must be corrected to reality as each phase lands. The forward-looking design lives in the plan file;
this one is the map of the territory.

Status: **Phase 0** — nothing implemented yet. Every section below is _(planned)_.

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
  routing.shared.ts      pure         — role -> TaskKey map, persona override precedence
  supervisor.ts          server-only  — catalogue coverage, commission proposals
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
| Narration independent of images | Separate `allow_narration` column and a separate run stage |
| Retries never double-charge | Partial unique index for one live run per task, plus `checkpoint` |
| No secrets or prompts leaked | Persona prompts are admin-only data; run events store concise messages, never full prompts or chain-of-thought |
| Agent cannot act as admin | Agent work runs as the system user through bounded server functions, never `verifyAdmin()` paths |

---

## Known limits

- **Autonomous cadence is roughly daily.** Vercel Hobby allows one cron; the agent queue drains from
  the existing `/api/batch/reconcile` tick, plus an admin "Run now" kick.
- **Similarity is trigram + LLM adjudication, not embeddings.** See D3 in the decisions doc.
- **Urdu has no narration voice.** Story text supports it; TTS does not. Seed personas avoid it.
- **The multi-beat loop is duplicated in spirit.** `lib/store/story-store.ts` keeps its own client-side
  orchestration; `lib/agentic/story-assembly.ts` is a separate, simpler, canonical-path-only server
  version. Unifying them was considered and rejected for V1 (D2).
