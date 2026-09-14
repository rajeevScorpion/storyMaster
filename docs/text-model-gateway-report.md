# Text Model Gateway — Implementation Report

Branch `feature/text-model-gateway`, cut from `dev` at `6cf7f49`. Plan: [text-model-gateway-plan.md](text-model-gateway-plan.md).
Handoff: [text-model-gateway-working-memory.md](text-model-gateway-working-memory.md). Format: pack template 12.

## A. What I found
- **Existing text model flow:** per-task model and temperature in `model_config`, read with a 60s cache and a code
  default on any error. Four Gemini-only server actions plus five direct Gemini SDK calls. The only allow-list was a
  hard-coded Gemini list nothing enforced, and on the reader path the model id reaching the server came from the
  browser unchecked.
- **Prompt Playground storage:** prompts versioned in prompt config; model and temperature in `model_config`; the
  picker was a hard-coded Gemini list in a native `<select>`.
- **Gemini integration:** `@google/genai`, no retries, a 30s timeout flag (`gemini_text_timeout_ms`).
- **Existing evaluation loop:** beats and seed plans get one code-validated repair retry; agent story evaluation is
  advisory only (decision D9).
- **Image adapter pattern reused:** the image model registry (migration 062, fail-closed loader, allow-listed admin
  save, admin studio page).
- **Existing handoff mechanism:** `docs/agent-context/` plus a per-feature working memory file.

## B. What I implemented
- **Text model registry:** migration 119, one row per model with capabilities, default params, timeout, advisory
  prices and required env vars. Existing Gemini ids are the keys, so current config resolves unchanged.
  Non-Gemini rows seed disabled.
- **Gateway:** one server-side entry point for every text call. It resolves the requested key against the
  registry and runs only an enabled row; otherwise it falls back to the task's Gemini default and logs why. It
  never retries, never falls back to a non-Gemini or premium model, and fails clearly when a provider key is
  missing.
- **OpenAI direct:** Chat Completions over `fetch`; strict JSON schema; reasoning effort; temperature omitted for
  models that reject it.
- **OpenRouter:** same adapter; routes only to hosts that honour the response format; real charge taken from
  `usage.cost`.
- **Gemini migration:** every text call site now goes through the gateway with the same request shape. Gemini
  output validation is observe-only, so live behaviour is unchanged.
- **Admin Text Models (`/admin/text-models`):** list, enable/disable (refused while the provider key is missing),
  edit, add (saved disabled), live Test, a banner for tasks running on fallback, and a Task assignments section
  that sets the model for any text task, the five agentic tasks included.
- **Prompt Playground:** picker reads enabled registry models through the shared dropdown; a test of a disabled or
  unknown model errors instead of silently running the fallback; applying to production rejects such keys.
- **Evaluation changes:** no logic change. The evaluator's model can now be set globally (Task assignments) or
  per persona (overrides, validated on save).
- **Repair/retry changes:** none to behaviour. Cost rows now record which attempt they were.
- **Observability:** cost events carry provider, model key, provider model id, actual model, request id, cached and
  reasoning tokens, finish reason, resolution source and fallback reason, schema issue count, and whether cost
  was unknown. Failures are logged, not recorded, so event counts stay honest.

## C. Current routing (dev, queried 2026-09-14)

No routing changed on deploy (owner decision O3). Every task still runs where it did.

| Task / Role | Model | Provider | Fallback | Notes |
|---|---|---|---|---|
| Story Generation | `gemini-3.5-flash` | Gemini | task default, same model | Switchable to Luna once its row is enabled |
| Seed Plan Generation | `gemini-3.5-flash` | Gemini | same | |
| Seeded Beat Materialization | `gemini-3.5-flash` | Gemini | same | |
| Story Bible Writer | `gemini-3.5-flash` | Gemini | same | Code default; no config row |
| Visual Prompt Composer | `gemini-3.5-flash` | Gemini | same | |
| Semantic evaluator (`agent_story_evaluation`) | `gemini-3.5-flash` | Gemini | same | Code default; switchable to Qwen once enabled |
| Creative repair | same model as the task being repaired | — | — | No separate repair role; the repair loop is deferred (O1) |

## D. Economics
- **Deterministic checks replacing model calls:** none added. The existing deterministic novelty layer and code
  schema validation are unchanged.
- **Cheap evaluator:** available, not switched on. Enable the Qwen 3.7 Flash row, then assign it to Agent Story
  Evaluation.
- **Strong writer calls:** unchanged.
- **Retry cap:** unchanged — one repair retry for beats and seed plans; the gateway itself never retries.
- **Observed token behaviour** (live smoke, one tiny structured reply per provider, 2026-09-14):

  | Model | Tokens in / out | Cost | Latency |
  |---|---|---|---|
  | Gemini 2.5 Flash-Lite | 22 / 18 | code price table | ~1.2s |
  | GPT-5.6 Luna via OpenAI (reasoning low) | 59 / 16 | ~$0.000031 | 1.7–3.2s |
  | Qwen 3.7 Flash via OpenRouter (JSON mode) | 76 / 324 | ~$0.000044 | ~5s |

  Qwen spent about 20× the output tokens of the others on the same one-word answer, which suggests it reasons by
  default; reasoning is billed as output. It is still cheap in absolute terms, but measure it on a real
  evaluation before assuming it is the cheapest evaluator. The adapter can switch OpenRouter reasoning off; the
  admin form cannot yet set that (see J).

## E. Admin workflow
1. **Add a model:** Admin → Text Models → Add model. Pick the provider, type the provider's model id, set
   capabilities and prices. It saves disabled. The model key is permanent.
2. **Enable it:** set the provider key in the server environment, press Test, then Enable. Enabling is refused
   while the key is missing.
3. **Switch Story Generation:** Task assignments → Story Generation → pick the model. Or test it in the Story
   Playground first and apply to production.
4. **Switch the evaluator separately:** Task assignments → Agent Story Evaluation → e.g. Qwen 3.7 Flash. A
   persona's own override still wins for that persona.
5. **Disable a model:** tasks on it drop to their Gemini default and show in the fallback banner.

## F. Environment/config
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, optional `APP_URL` (OpenRouter referer). Feature flag
`gemini_text_timeout_ms` is now the default timeout for every provider when a row sets none. `TEXT_GATEWAY_SMOKE=1`
enables the live smoke test.

## G. Tests
- **Unit:** registry resolution and validation, schema conversion and validation, request/response building,
  cost, router behaviour (fallback, missing key, malformed output, no retry on 429, legacy mode), persona override
  validation, task-assignment guard. Full suite: **113 files, 1122 tests, all passing.**
- **Integration:** none against a live database. The admin page is covered by e2e for rendering only; assigning,
  testing and enabling a model have not been clicked through.
- **Live smoke** (`TEXT_GATEWAY_SMOKE=1 npm run test:text-gateway-smoke`): Gemini, OpenAI and OpenRouter each
  returned schema-valid JSON through the real gateway with usage and provider telemetry recorded. Qwen on
  OpenRouter returned HTTP 429 (`rate_limited`, correctly not retried) when run immediately after the other two,
  and passed when run on its own.
- **Build/typecheck/lint/e2e:** `tsc` clean; lint clean with no warnings; `build:verify` passes; e2e **30/30**,
  including `/admin/text-models` rendering for a signed-in admin and redirecting a signed-out visitor.
- **Pre-existing unrelated failures:** none.

## H. Handoff
- **Existing handoff updated:** `docs/agent-context/PROJECT_STATE.md` (migration 119 row, deferred gaps, roadmap)
  and `docs/agent-context/GOTCHAS.md` ("Text models").
- **Feature handoff:** [text-model-gateway-working-memory.md](text-model-gateway-working-memory.md).
- **Future starting point:** the follow-ups below.

## I. Deviations
| Proposed | Implemented | Reason |
|---|---|---|
| Evaluate → repair → re-evaluate loop | Deferred | Owner decision O1; conflicts with D9 |
| Role aliases (creative_writer, cheap_evaluator) | Not built; task keys are the role layer | Decision D4 rejected a parallel role system |
| OpenAI SDK | Raw `fetch` for OpenAI and OpenRouter | Matches the image provider; the SDK retries by default; no new dependency |
| Provider fallback | Only an emergency fallback to the task's Gemini default, logged | Avoids silent premium escalation and quality changes |
| Validate every provider's JSON strictly | Strict for OpenAI/OpenRouter, observe-only for Gemini | Preserves live Gemini behaviour |
| Model selection in the Prompt Playground | Also a Task assignments section on Text Models | Agentic tasks have no playground entry, so the evaluator could only be switched per persona |

## J. Follow-ups
- **Owner, before merging:** sign in and click through Task assignments, Test and Enable on
  `/admin/text-models`. The authenticated e2e proves the page renders for an admin, not that those actions work.
- **Owner, to try non-Gemini models on dev:** Test then Enable the Luna or Qwen row, then assign it under Task
  assignments. Nothing routes to them until then.
- **Merge** `feature/text-model-gateway` into `dev` with `--no-ff`.
- **Production:** run the pre-apply `model_config` check, apply 119, redeploy.
- **Qwen as evaluator:** add a "reasoning off" control to the admin form (the adapter already supports it) and
  measure a real evaluation's cost. Expect occasional 429s under back-to-back calls; the evaluation step already
  treats a model failure as non-fatal.
- The rest are recorded in PROJECT_STATE "Deferred / known gaps → Text models": open text RPCs, three calls with
  no cost events, gateway error text shown on options regeneration, unmapped Gemini block reasons, function
  duration for slow reasoning models, dead `playground.ts`, and the deferred repair loop.

## K. Follow-up — thinking control, Gemini refresh, reader-safe errors, card layout (2026-09-14)

Plan: [text-model-thinking-plan.md](text-model-thinking-plan.md). Commits `7702e34` (migration 120) through `4d337fa`.

- **Reader-safe errors:** a failed text call shows readers a fixed sentence with no provider, model or task
  name; the full text stays in `detail` for logs, admin screens and agent run records. Image failures are
  replaced where readers receive them: job status polls, beat loads, batch writes, placeholder metadata.
- **Thinking:** each model lists the levels it accepts and a default; each task can override it
  (`model_config.reasoning_level`, migration 120). The gateway resolves the level on the server per call and
  applies a task's level only on that task's assigned model. Gemini `thinkingLevel`, OpenAI `reasoning_effort`,
  OpenRouter `reasoning.effort`.
- **Gemini:** 3.8 Flash added; seven older Gemini text models removed; graphic style extraction, legacy voice
  selection and novelty assessment moved to 3.8 Flash at Low. Every Gemini text call runs at temperature 1.0.
  Thinking tokens now count as output — **Gemini cost was under-recorded before this change**.
- **Admin page:** task assignments and models as card grids; a Thinking dropdown per task; accepted levels and
  a default per model.
- **Checks:** full unit suite 118 files / 1216 tests; `build:verify` and e2e 30/30 at `0cf116f`; tsc and lint
  clean; live smoke 10/10.

**Live smoke** — one short logic question, every answer correct ("Crow"). One run each: indicative, not a
benchmark.

| Model | Thinking | Tokens in / out | Of which thinking | Cost | Latency |
|---|---|---|---|---|---|
| Gemini 3.8 Flash | Low | 45 / 36 | 35 | $0.000169 | 3.3s |
| Gemini 3.8 Flash | Default (Medium) | 45 / 197 | 196 | $0.000772 | 2.0s |
| Gemini 3.5 Flash | Minimal | 45 / 1 | 0 | $0.000077 | 1.1s |
| Qwen 3.7 Flash (OpenRouter) | Off | 55 / 1 | 0 | $0.000002 | 0.9s |
| Qwen 3.7 Flash (OpenRouter) | Default | 53 / 607 | 604 | $0.000081 | 8.8s |
| GPT-5.6 Luna (OpenAI) | Off | 49 / 4 | 0 | $0.000015 | 2.8s |
| GPT-5.6 Luna (OpenAI) | Low | 49 / 37 | 27 | $0.000054 | 1.6s |

What it shows:
- The thinking level decides the bill. The same answer cost 4.6× more at Medium than Low on 3.8 Flash, and 40×
  more at Qwen's default than Off.
- **3.8 Flash cannot go below Low**, so on this small call 3.5 Flash at Minimal cost less than half as much.
  Measure the three economy tasks before assuming 3.8 Flash is the cheaper home for them.
- Qwen at Off was cheapest by far. No 429 this run, with 3s between OpenRouter calls.

Not verified: admin Save / Test / Enable / Thinking changes clicked in a real browser; DeepSeek at any thinking
level; production (119 and 120 not applied).
