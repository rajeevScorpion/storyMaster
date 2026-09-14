# Text Model Gateway — Implementation Plan

Branch `feature/text-model-gateway` (cut from `dev` at `6cf7f49`). Source pack:
`prompt-packs/kisago_text_model_gateway_prompt_pack/`. Working memory:
[text-model-gateway-working-memory.md](text-model-gateway-working-memory.md).

Opus plans and reviews; each phase below is one Sonnet delegation and one commit. A phase is not done until
Opus has read its diff.

---

## 0. Owner decisions (2026-09-14)

| # | Decision |
|---|---|
| O1 | **The evaluate → writer-repair loop is deferred.** Recorded in PROJECT_STATE. It also conflicts with D9 (a model verdict may not trigger an automatic consequence), which must be resolved before it is built. |
| O2 | Luna / Qwen / DeepSeek IDs were looked up online (section 2.4) and ship as **disabled** registry rows. |
| O3 | **No routing change on deploy.** Every task stays on its current Gemini model until the owner switches it in Admin. |
| O4 | Live smoke test: one or two tiny paid calls per provider. `OPENROUTER_API_KEY` gets an empty placeholder; the owner fills it. |

## 1. Scope

**In:** a text model registry (migration 119) and an admin Text Models page; one server-side gateway with
Gemini, OpenAI and OpenRouter adapters; every text call site moved behind it; every text-model picker reading the
registry; server-side allow-listing of model keys; provider-aware cost telemetry; tests; smoke test; docs.

**Out:** image generation, TTS and forced alignment (unchanged); the repair loop (O1); role aliases
(`creative_writer`, …) — decision D4 already made TaskKeys the role layer, so a parallel alias system is
rejected; model-level fallback graphs; streaming (no call site streams).

---

## 2. Verified current-state facts (checked 2026-09-14)

### 2.1 Model selection
- `lib/ai/model-config.shared.ts`: `TaskKey` (23 keys), `DEFAULT_TEXT_MODEL_ID = 'gemini-3.5-flash'`,
  `DEFAULT_MODELS` (per-task `{modelId, temperature}`), `KNOWN_MODELS.text` = 6 Gemini ids — the only allow-list,
  and nothing enforces it.
- `lib/ai/model-config.ts`: `getModelConfig(task)` reads `model_config` (60s cache) and falls back to
  `DEFAULT_MODELS` on **any** error. `updateModelConfig` validates nothing.
- Consumer beat path: `getStoryModelOverrides()` (`app/actions/admin.ts:242`, no admin check) returns model ids
  from `model_config`; the client passes them back into server actions as `modelOverrides.storyModel` etc.
  **The model id reaching the server is client-controlled.** Harmless while only Gemini exists; with OpenRouter
  it would let any caller run any paid model. The gateway must therefore resolve every id against the registry.
- Agent personas: `agent_personas.model_overrides` JSONB (migration 103), edited as raw JSON
  (`components/admin/agentic/PersonaEditorDrawer.tsx:535`), written unvalidated by
  `app/actions/agentic-personas.ts` (`mapInputToRow` ~L121). Read defensively by `lib/agentic/routing.shared.ts`.
- **Dev DB `model_config`** (queried 2026-09-14): text tasks use `gemini-3.5-flash` except `voice_selection` =
  `gemini-2.5-flash-lite` and `graphic_style_extraction` = `gemini-2.5-flash`. No agentic rows (they use
  `DEFAULT_MODELS`). No persona has `model_overrides`. Ledger max = 118. **Prod was not queried** (read denied);
  see the pre-apply check in section 4.

### 2.2 Text call sites
Through `app/actions/gemini-proxy.ts` (`'use server'`, all exports client-callable):

| Function | Tasks | Output | System instruction | Default temp |
|---|---|---|---|---|
| `callGeminiText` L79 | story_generation, reel_story_generation, seed_plan_generation, seeded_beat_materialization, visual_prompt, reel_visual_prompt | JSON + `responseSchema` from local `schemaMap` L83 | `LOCKED_PROMPT_GUARDRAILS[task]` | 0.7 |
| `callGeminiVisionText` L139 | graphic_style_extraction | text, images | guardrail | 0.4 |
| `callGeminiReferenceAnalysis` L210 | reference_character/world_analysis | JSON no schema, images | none | 0.2 |
| `callGeminiAgenticJson` L287 | agent_novelty_assessment, agent_supervisor_planning, agent_story_brief, agent_seed_story_writing, agent_story_evaluation | JSON no schema | none | 0.2 |

All four read timeout flag `gemini_text_timeout_ms` (default 30s), log `[timing:gemini_proxy.<task>]`, record
cost only when `telemetry` is passed, and throw `Empty response from Gemini for task: X`. **No caller matches on
any of these error messages** (grepped).

Their importers: `app/actions/story-runtime.ts` (L170, L290; file is `'use client'`), `lib/ai/beat-orchestration.ts`
(L503 with 1 repair retry L530-541; L721 composer with code fallback), `lib/ai/seed-authoring.ts` (L144, L233, each
1 repair retry), `lib/ai/reference-analysis.ts` (L54, L106), `app/actions/reel-styles.ts:295`,
`lib/agentic/memory.ts:335`, `lib/agentic/supervisor.ts:299`, `lib/agentic/story-assembly.ts` (L564, L918),
`lib/agentic/evaluation.ts:180`. Image providers import the `InlineImagePart` type from gemini-proxy.

Direct `GoogleGenAI` text calls bypassing the proxy:
- `app/actions/beat-control.ts:543-552` — options regeneration, `optionsRegenerationSchema`, model from
  `getModelConfig('story_generation')`, no telemetry.
- `app/actions/episodes.ts:187-197` — story bible, `storyBibleGenerationSchema`, guardrail, no telemetry.
- `app/actions/storyline-discovery.ts:118-128` — discovery metadata, `storylineDiscoveryMetadataSchema`
  (the only schema with optional fields: `genre`, `ageFit`), guardrail, no telemetry.
- `app/actions/narration.ts:2199-2219` — `voice_selection`, plain text, guardrail, records telemetry.
- `app/actions/prompt-playground.ts:142-181` `executeTaskTest` — admin test runner; text branches call
  `generateContent` directly with the matching schema and guardrail. Image/TTS branches stay as they are.
- `app/actions/playground.ts` — **dead: nothing imports it.** Leave untouched; record in PROJECT_STATE.

### 2.3 Schemas, telemetry, patterns
- `lib/ai/generation-schemas.ts`: Gemini `Type` schemas using only OBJECT/ARRAY/STRING/INTEGER/BOOLEAN;
  no enum/nullable/anyOf/format; every field required except `storylineDiscoveryMetadataSchema.genre/ageFit`.
  Max depth 3 (`seedPlanSchema`, `storyboardPlanSchema`).
- `lib/ai/cost-telemetry.ts` `recordModelCostEvent` never throws; `provider` defaults to `'google_gemini'`;
  cost = `estimatedCostUsdOverride` else `estimateCost()` from `lib/ai/pricing.ts`, which **returns 0 for any
  model id not in its Gemini-only map**. `app/actions/cost-admin.ts` reads `metadata.cachedTokens`, labels
  rows `${provider}:${model_id}`, and does **not** filter on `status`.
- `ai_cost_events` already has `provider`, `status`, `metadata jsonb` — no telemetry migration needed.
- Image registry precedent: migration 062 (table, CHECK on provider, touch trigger, RLS with no policies,
  disabled seed rows with `required_env_vars`); `lib/ai/image-models.ts` (fail-closed read, allow-listed
  patch save); `app/actions/image-models.ts` (`verifyAdmin()` first line, `revalidatePath`);
  `components/admin/ImageModelRegistryStudio.tsx`. Nav: `lib/admin/nav.ts:499` (Studio group).
- Missing-schema classifiers are one per migration group, classified by the query (GOTCHAS "Column-availability
  latches"). Codes in use: `42P01`, `42703`, `PGRST200`, `PGRST204`; also accept `PGRST205` (table not in schema
  cache).
- No retry helper exists. The OpenAI image provider talks to OpenAI over raw `fetch`; `openai`, `zod`, `ajv`
  are **not** installed. Validation in this codebase is hand-written.
- Tests: `vi.mock('server-only', () => ({}))` is the convention for testing a server-only module
  (`lib/agentic/billing-identity.test.ts:19`). Only `app/actions/beat-bundle.test.ts` mocks
  `@/lib/ai/model-config` (`getFeatureFlag` only). No test touches gemini-proxy.
- `vitest.smoke.config.ts` includes **every** `scripts/**/*.smoke.ts` and backs `test:character-novelty-smoke`,
  so a new smoke file must be env-gated or it will run (and spend) there too.

### 2.4 Provider facts (researched 2026-09-14, sources in the phase 1 research notes)
| Model | Provider id | $/1M in / out / cached-in | Structured output | Vision | Temperature |
|---|---|---|---|---|---|
| GPT-5.6 Luna | OpenAI `gpt-5.6-luna`; OpenRouter `openai/gpt-5.6-luna` | 0.20 / 1.20 / 0.02 | strict json_schema | yes | **rejected** (400) |
| Qwen 3.7 Flash | OpenRouter `qwen/qwen3.7-flash` | 0.03 / 0.13 / 0.006 (prompt < 32K; tiered above) | JSON mode only, no strict schema | yes | yes |
| DeepSeek V4 Flash | OpenRouter `deepseek/deepseek-v4-flash-0731` (dated; avoid the moving `-latest` alias) | 0.06 / 0.12 / 0.012 | strict json_schema | no | yes |

- Luna is a reasoning model: `reasoning_effort` (Chat) values none/low/medium/high/xhigh/max, default medium;
  output cap `max_completion_tokens`; reasoning tokens billed as output.
- OpenAI and OpenRouter both serve Chat Completions (`/v1/chat/completions`); strict mode needs every property in
  `required` and `additionalProperties: false`.
- OpenRouter: `provider.require_parameters: true` routes only to hosts that honour `response_format`; never send the
  top-level `models` fallback array; the model actually used is `response.model`; `usage.cost` is the real charge;
  errors 402 (credits), 429 (rate limit), 502/503 (unavailable).
- `openai` npm SDK defaults to `maxRetries: 2` — one reason we use `fetch` instead (section 3.3).

---

## 3. Design

### 3.1 Registry (migration 119)
One row per **model**, not per task (tasks point at rows through the existing `model_config.model_id` and persona
`model_overrides[*].modelId`, which now mean *registry `model_key`*). No change to `model_config`.

- **Gemini rows keep their bare provider id as `model_key`** (`gemini-3.5-flash`), so every existing config row
  resolves unchanged. New non-Gemini rows use `provider:providerModelId` (`openrouter:qwen/qwen3.7-flash`).
- `model_key` is immutable after creation (admin UI never edits it). Renaming a key silently re-routes every task
  still pointing at it.
- `capabilities`: `{ structuredOutput: 'native' | 'json' | 'none', vision: boolean, temperature: boolean }`.
  `native` = provider enforces the supplied schema; `json` = JSON mode, schema is described in the prompt and
  validated in code.
- `default_params`: `{ maxOutputTokens?: number, reasoningEffort?: string, reasoningEnabled?: boolean }`.
- Prices are advisory, USD per 1M tokens, nullable. Gemini rows seed NULL → cost falls back to `MODEL_PRICING`.

### 3.2 Resolution (pure)
`resolveTextModel({ taskKey, requestedKey, registry, requireVision })` returns the record to run plus
`source: 'registry' | 'legacy' | 'fallback'`, `fallbackReason?: 'unknown_model' | 'disabled' | 'missing_capability'`.

1. `registry === null` (migration 119 absent, or registry read failed) → **legacy mode**: an id matching
   `^gemini-[a-z0-9.-]+$` runs on Gemini as today (`source: 'legacy'`); anything else → fallback. Legacy mode can
   never reach OpenAI/OpenRouter.
2. Registry present: key not found → fallback `unknown_model`; found but disabled → `disabled`; vision task on a
   non-vision model → `missing_capability`; else `source: 'registry'`.
3. **Fallback target** is `DEFAULT_MODELS[taskKey].modelId` (always Gemini). Use its registry row if present
   (even if disabled — it is the emergency path), else a synthetic Gemini record. Always `console.warn`
   `[text-gateway] fallback` with task, requested key and reason, and record both in telemetry metadata.
   Never fall back to a non-Gemini or premium model.
4. Provider credentials missing for the resolved record → throw `auth_missing`. **No fallback** — a configured
   model fails clearly (pack phase 6). The admin save path blocks enabling a row whose env vars are unset, so this
   only fires on env drift.

Registry read: 60s in-process cache like `getModelConfig`, `invalidateTextModelRegistryCache()` on admin save.
A missing-schema error (classifier `isMissingTextModelRegistrySchemaError`, codes above, this query only) latches
legacy mode for the process; any other error returns `null` for that call without latching.

### 3.3 Gateway
`lib/ai/text-gateway/` (every non-`.shared.ts` file `import 'server-only'`):

- `types.shared.ts` — `TextProviderKey`, `TextGenerationRequest`, `TextGenerationResult`, `TextUsage`,
  `TextGatewayErrorCategory`, `class TextGatewayError extends Error { category; providerKey; modelKey; status?;
  retryable }`.
- `json-schema.shared.ts` — `geminiSchemaToJsonSchema(schema, { strict })` (strict: optional → required +
  `[type, 'null']`, `additionalProperties: false` everywhere; handles `enum` and `nullable`; throws on
  `anyOf`), `validateAgainstGeminiSchema(value, schema): string[]` (types, required, integer, array items; extra
  properties allowed), `stripNullOptionals(value, schema)`, `extractJsonText(text)` (strips ``` fences).
- `openai-compatible.shared.ts` — pure `buildChatCompletionsBody(record, request)` and
  `parseChatCompletionsResponse(json, headers)` plus `classifyHttpError(status, body)`.
- `openai-compatible.ts` — `fetch` adapter for `openai` (`https://api.openai.com/v1`) and `openrouter`
  (`https://openrouter.ai/api/v1`, headers `HTTP-Referer: process.env.APP_URL || 'https://kissago.cc'`,
  `X-Title: Kissago`). `AbortController` timeout. **No retries.**
- `gemini.ts` — `@google/genai` adapter reproducing today's request exactly (`contents`, `systemInstruction`,
  `responseMimeType`, `responseSchema`, `temperature`), plus `maxOutputTokens` only when set. Same
  `Promise.race` timeout as today.
- `cost.shared.ts` — `computeTextCostUsd(record, usage)`: OpenRouter `usage.cost` if present → row prices if
  non-null (cached input billed at the cached rate) → `null` (caller falls back to `estimateCost`).
- `router.ts` — `generateText(request)` and `testTextModel(record)` (admin test, no task).

Request body rules (OpenAI-compatible):
- messages: `system` (if any), `user` = string, or content parts with `image_url` data URLs for images.
- `temperature` only when `capabilities.temperature` and a value is given; otherwise omitted and
  `temperatureApplied: false` recorded.
- `max_completion_tokens` from `defaultParams.maxOutputTokens`.
- OpenAI: `reasoning_effort` from params. OpenRouter: `reasoning: { effort }` or `{ enabled: false }`.
- JSON with schema: `native` → `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`;
  `json` → `{ type: 'json_object' }` and the compact JSON Schema appended to the system message;
  `none` → no `response_format`, instruction appended. JSON without schema → `json_object` unless `none`.
- OpenRouter with any `response_format` → `provider: { require_parameters: true }`.

Response rules: text = `choices[0].message.content`; `message.refusal` or `finish_reason: 'content_filter'` →
`refusal`; `finish_reason: 'length'` → `finishReason: 'length'`. Usage → `inputTokens`, `outputTokens`,
`cachedInputTokens` (`prompt_tokens_details.cached_tokens`), `reasoningTokens`, `costUsd` (`usage.cost`).
`requestId` = body `id` or `x-request-id`. `actualModel` = `response.model`.

HTTP mapping: 400 `bad_request`, 401/403 `auth_failed`, 402 `insufficient_credits`, 404 `model_unavailable`,
408/504 `timeout`, 429 `rate_limited` (retryable), 502/503 `model_unavailable` (retryable), other 5xx
`provider_error`, abort → `timeout`. Error messages name provider, model key and task — **never** the key or
headers.

**Output validation policy** (one named constant in the router, commented):
- JSON parse or schema failure on **openai/openrouter** → throw `malformed_output` with up to 3 issues. On success
  the returned text is `JSON.stringify(stripNullOptionals(parsed))`.
- On **gemini** → validate, but on failure only `console.warn` and record `schemaIssueCount`; return the text
  unchanged. Gemini output is production-proven with the existing callers' own tolerance; tightening it would
  change live behaviour this change promises not to change.

Telemetry (only when `request.telemetry` is given, as today): `modelId` = `model_key`; `provider` =
`google_gemini | openai | openrouter`; tokens; `latencyMs`; `estimatedCostUsdOverride` = `computeTextCostUsd`
when non-null; metadata `{ providerModelId, actualModel, requestId, cachedTokens, reasoningTokens, finishReason,
temperatureApplied, resolutionSource, fallbackReason, requestedModelKey, schemaIssueCount, costUnknown }` merged
with caller metadata (`promptChars`, `temperature`, `referenceCount`, `attempt`). **Failures are logged, not
recorded** — cost-admin does not filter on `status`, so failed rows would inflate event counts. Log scope becomes
`[timing:text_gateway.<task>]` with provider and model key.

### 3.4 Server-action wrappers
New `app/actions/text-model-proxy.ts` (`'use server'`, async exports only; types are erased and allowed):
`callTextModel`, `callTextModelVision`, `callTextModelReferenceAnalysis`, `callTextModelAgenticJson` — **same
params, same return type, same default temperatures, same `schemaMap` and guardrails** as the four
gemini-proxy functions, now calling `generateText`. `model` is a registry key. Delete the four functions from
gemini-proxy.ts (it keeps image code and `InlineImagePart`). Update every importer. The name change is deliberate:
a function called `callGeminiText` that runs Luna is the kind of lie migration 118 had to fix.

---

## 4. Migration 119 (complete SQL)

**Pre-apply check on prod** (owner, before applying 119 there): every key below must cover what prod uses.

```sql
select task_key, model_id from public.model_config order by task_key;
```
Any text `model_id` not seeded below resolves to its task default after 119 — add a row first.

### `supabase/migrations/119_text_model_registry.sql`
```sql
-- 119_text_model_registry.sql
--
-- Text model catalogue. model_config.model_id and agent_personas.model_overrides[*].modelId now name a
-- row here by model_key; the runtime refuses any key that is not an enabled row.
--
-- Trap: Gemini rows keep their bare provider ids as model_key so existing config resolves unchanged.
-- Never rename a model_key -- every task pointing at the old key silently drops to its code default.
-- Add a new row instead.
--
-- Non-Gemini rows seed disabled. Prices are advisory USD per 1M tokens, checked 2026-09-14; NULL means
-- "use the code price table". Without this table the app runs Gemini-only, exactly as before.
--
-- Verify: select model_key, provider_key, is_enabled from public.text_model_registry order by sort_order;

CREATE TABLE IF NOT EXISTS public.text_model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL UNIQUE,
  provider_key TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  default_params JSONB NOT NULL DEFAULT '{}'::JSONB,
  timeout_ms INTEGER NULL,
  input_cost_per_mtok_usd NUMERIC(12,6) NULL,
  output_cost_per_mtok_usd NUMERIC(12,6) NULL,
  cached_input_cost_per_mtok_usd NUMERIC(12,6) NULL,
  required_env_vars TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT text_model_registry_provider_key CHECK (provider_key IN ('gemini', 'openai', 'openrouter')),
  CONSTRAINT text_model_registry_model_key_format CHECK (model_key ~ '^[a-z0-9][a-z0-9._:/-]{0,119}$'),
  CONSTRAINT text_model_registry_provider_model_id_length CHECK (char_length(trim(provider_model_id)) BETWEEN 1 AND 200),
  CONSTRAINT text_model_registry_display_name_length CHECK (char_length(trim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT text_model_registry_description_length CHECK (char_length(description) <= 500),
  CONSTRAINT text_model_registry_timeout_range CHECK (timeout_ms IS NULL OR timeout_ms BETWEEN 1000 AND 300000),
  CONSTRAINT text_model_registry_costs_nonnegative CHECK (
    COALESCE(input_cost_per_mtok_usd, 0) >= 0
    AND COALESCE(output_cost_per_mtok_usd, 0) >= 0
    AND COALESCE(cached_input_cost_per_mtok_usd, 0) >= 0
  )
);

CREATE OR REPLACE FUNCTION public.touch_text_model_registry_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS text_model_registry_touch_updated_at ON public.text_model_registry;
CREATE TRIGGER text_model_registry_touch_updated_at
  BEFORE UPDATE ON public.text_model_registry
  FOR EACH ROW EXECUTE FUNCTION public.touch_text_model_registry_updated_at();

ALTER TABLE public.text_model_registry ENABLE ROW LEVEL SECURITY;

INSERT INTO public.text_model_registry (
  model_key, provider_key, provider_model_id, display_name, description, is_enabled,
  capabilities, default_params, timeout_ms,
  input_cost_per_mtok_usd, output_cost_per_mtok_usd, cached_input_cost_per_mtok_usd,
  required_env_vars, sort_order
) VALUES
  ('gemini-3.5-flash', 'gemini', 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'Current default text model.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 10),
  ('gemini-3.1-pro-preview', 'gemini', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview)', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 20),
  ('gemini-3.1-flash-lite', 'gemini', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 30),
  ('gemini-2.5-pro', 'gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 40),
  ('gemini-2.5-flash', 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'Default for novelty assessment and style extraction.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 50),
  ('gemini-2.5-flash-lite', 'gemini', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 60),
  ('gemini-3-flash-preview', 'gemini', 'gemini-3-flash-preview', 'Gemini 3 Flash (preview)', 'Legacy id kept so older config resolves.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 70),
  ('gemini-3.1-flash-lite-preview', 'gemini', 'gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash-Lite (preview)', 'Legacy id kept so older config resolves.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 80),
  ('openai:gpt-5.6-luna', 'openai', 'gpt-5.6-luna', 'GPT-5.6 Luna (OpenAI)', 'Preferred creative writer. Rejects temperature.', FALSE,
   '{"structuredOutput":"native","vision":true,"temperature":false}', '{}', 120000, 0.20, 1.20, 0.02, ARRAY['OPENAI_API_KEY'], 100),
  ('openrouter:openai/gpt-5.6-luna', 'openrouter', 'openai/gpt-5.6-luna', 'GPT-5.6 Luna (OpenRouter)', 'Experimentation route for Luna.', FALSE,
   '{"structuredOutput":"native","vision":true,"temperature":false}', '{}', 120000, 0.20, 1.20, 0.02, ARRAY['OPENROUTER_API_KEY'], 110),
  ('openrouter:qwen/qwen3.7-flash', 'openrouter', 'qwen/qwen3.7-flash', 'Qwen 3.7 Flash (OpenRouter)', 'Cheap evaluator/planner candidate. JSON mode only; prices rise above 32K prompt tokens.', FALSE,
   '{"structuredOutput":"json","vision":true,"temperature":true}', '{}', 60000, 0.03, 0.13, 0.006, ARRAY['OPENROUTER_API_KEY'], 120),
  ('openrouter:deepseek/deepseek-v4-flash-0731', 'openrouter', 'deepseek/deepseek-v4-flash-0731', 'DeepSeek V4 Flash (OpenRouter)', 'Cheap structured-output candidate. Text only.', FALSE,
   '{"structuredOutput":"native","vision":false,"temperature":true}', '{}', 60000, 0.06, 0.12, 0.012, ARRAY['OPENROUTER_API_KEY'], 130)
ON CONFLICT (model_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (119, '119_text_model_registry.sql')
ON CONFLICT (migration_number) DO NOTHING;
```
`ON CONFLICT DO NOTHING` (not `DO UPDATE` as in 062) so a re-run never overwrites admin edits.

### `supabase/migrations/119_text_model_registry_rollback.sql`
```sql
-- Rolling back returns the runtime to Gemini-only legacy mode; any task pointing at a non-Gemini key
-- drops to its code default.
DROP TABLE IF EXISTS public.text_model_registry;
DROP FUNCTION IF EXISTS public.touch_text_model_registry_updated_at();
DELETE FROM public.schema_migration_ledger WHERE migration_number = 119;
```

---

## 5. Phases

Every delegation brief carries: read this plan section and the working memory first; write files early; commit
before reporting; do not touch migrations after the owner says they are applied; run tsc + lint + the relevant
tests before committing. Opus reviews the diff, then runs the gate at P5.

### P2 — Registry (Sonnet, commit `feat(text-models): registry table, resolver and loader`)
1. Add the two migration files from section 4 verbatim.
2. `lib/ai/text-models.shared.ts`: `TextProviderKey`, `TextStructuredOutputSupport`, `TextModelCapabilities`,
   `TextModelDefaultParams`, `TextModelRecord`, `TextModelResolution`; `TEXT_PROVIDER_LABELS`;
   `TEXT_PROVIDER_ENV_VARS` (`gemini: GEMINI_API_KEY`, `openai: OPENAI_API_KEY`, `openrouter: OPENROUTER_API_KEY`);
   `TEXT_PROVIDER_TELEMETRY_KEYS` (`google_gemini`, `openai`, `openrouter`); `LEGACY_GEMINI_MODEL_ID_PATTERN`;
   `mapTextModelRow(row)` (defensive parse of capabilities/default_params JSONB — unknown/garbage → safe
   defaults: `structuredOutput: 'none'`, `vision: false`, `temperature: true`);
   `buildSyntheticGeminiRecord(modelId)`; `VISION_TEXT_TASKS` (`graphic_style_extraction`,
   `reference_character_analysis`, `reference_world_analysis`); `resolveTextModel(...)` per section 3.2;
   `isMissingTextModelRegistrySchemaError(error)`; `suggestModelKey(provider, providerModelId)`;
   `validateTextModelInput(input)` for create/update (key format regex identical to the SQL CHECK, lengths,
   timeout range, non-negative prices, capability enum).
3. `lib/ai/text-models.ts` (`server-only`): `getTextModelRegistry(): Promise<TextModelRecord[] | null>` (cache +
   latch per 3.2), `invalidateTextModelRegistryCache()`, `listTextModelRegistryForAdmin()` (returns
   `{ available: boolean, records }`), `createTextModelRecord(input, userId)`,
   `updateTextModelRecord(id, patch, userId)` (allow-listed fields; `model_key` not patchable),
   `getMissingEnvVars(record)` (reads `process.env` by name, returns names only).
4. Tests `lib/ai/text-models.shared.test.ts`: legacy mode (gemini id passes, openrouter id falls back); registry
   hit; unknown; disabled; vision requirement; fallback uses default row even if disabled; synthetic record when
   default absent; row mapping of garbage JSONB; key validation matches the SQL regex; classifier codes.

**Verify:** tsc, lint, `npx vitest run lib/ai/text-models`.

### P3 — Gateway and wrappers (Sonnet, commit `feat(text-models): provider gateway for Gemini, OpenAI and OpenRouter`)
1. Build `lib/ai/text-gateway/*` per 3.3.
2. `@google/genai` 2.x retries **only** when `httpOptions.retryOptions` is passed (verified in
   `dist/node/index.cjs` `apiCall`: no `retryOptions` → plain `fetch`). Construct the client with no
   `retryOptions`, and leave one comment line saying why, so nobody adds it and multiplies paid calls.
3. Create `app/actions/text-model-proxy.ts` per 3.4; delete the four text functions from gemini-proxy.ts; update
   all importers listed in 2.2. `grep -rn "callGemini\(Text\|VisionText\|ReferenceAnalysis\|AgenticJson\)"` must
   return nothing afterwards.
4. `.env.example`: add `OPENROUTER_API_KEY=""` with a one-line comment; extend the `OPENAI_API_KEY` comment to
   mention text models. Add `OPENROUTER_API_KEY=""` to `.env.local` **only if the line is absent** (never print or
   commit it).
5. Tests (mock `server-only`, `fetch`, `@google/genai`, the registry loader and `recordModelCostEvent`):
   - `json-schema.shared.test.ts`: every exported schema in generation-schemas converts; strict makes
     `genre`/`ageFit` nullable+required; `additionalProperties: false` at every object; validator catches
     missing field / wrong type / non-integer; strip removes only optional nulls; fence extraction.
   - `openai-compatible.shared.test.ts`: Luna body has no `temperature`; Qwen `json` mode uses `json_object` and
     appends schema; native uses strict `json_schema`; OpenRouter adds `require_parameters` and never `models`;
     images become data URLs; usage/cost/refusal/length parsing; HTTP status → category table.
   - `router.test.ts`: a task configured to `openrouter:qwen/qwen3.7-flash` calls OpenRouter with the provider id;
     disabled key → default Gemini + warn + metadata; missing env var → `auth_missing` and no fetch; non-Gemini
     malformed JSON → `malformed_output`; Gemini schema mismatch → text returned + warn; telemetry provider/cost
     override; no retry on 429 (fetch called once); legacy mode never calls fetch.
   - `cost.shared.test.ts`.

**Verify:** tsc, lint, full `npm test`.

### P4a — Remaining call sites and write-path validation (Sonnet, commit `feat(text-models): route every text call through the gateway`)
1. Move `beat-control.ts:543`, `episodes.ts:187`, `storyline-discovery.ts:118`, `narration.ts:2199` onto
   `generateText` with the same schema, guardrail, temperature default and error handling. Keep narration's
   telemetry; the other three stay without telemetry (no activity key fits — recorded as a follow-up).
2. `prompt-playground.ts` `executeTaskTest`: text branches call `generateText` (no telemetry); build `TestResult`
   from the gateway result (tokens, latency, cost via `computeTextCostUsd` else `estimateCost`). A playground test
   of a disabled or unknown key must **error**, not silently fall back — add `request.strictModel: true`, which
   makes the resolver throw `model_unavailable` instead of falling back.
3. `applyModelToProduction` (prompt-playground.ts L120): for text tasks, reject a key that is not an enabled
   registry row (when the registry is available). Image/TTS unchanged.
4. `app/actions/agentic-personas.ts`: validate `modelOverrides` on write — keys must be in `AGENT_TASK_KEYS`,
   each `modelId` an enabled registry key when the registry is available; readable error otherwise.
5. Retry attempts: pass `attempt: 1 | 2` in telemetry metadata at the repair retries in beat-orchestration
   (L503/L530) and seed-authoring (L144/L175, L233/L254).
6. Tests for 2-4 in the relevant `.shared.ts` halves (extract the validation as pure functions).

**Verify:** tsc, lint, full `npm test`; grep proves no `new GoogleGenAI` remains in beat-control, episodes,
storyline-discovery; narration and prompt-playground keep it only for TTS/image.

### P4b — Admin surfaces (Sonnet, commit `feat(text-models): admin Text Models page and registry-backed pickers`)
1. `app/actions/text-models.ts` (`'use server'`, `verifyAdmin()` first line, `revalidatePath('/admin/text-models')`,
   invalidate the registry cache): `getAdminTextModelRegistry`, `createAdminTextModel`, `updateAdminTextModel`
   (refuse enabling when `getMissingEnvVars` is non-empty), `testAdminTextModel(id)` (tiny prompt via
   `testTextModel`, returns text/latency/tokens/cost/error category), `getTextModelOptions()` (enabled rows as
   `{ value: modelKey, label: 'Display — Provider', vision, temperature }`; legacy `KNOWN_MODELS.text` when the
   registry is unavailable), `getTextTaskModelStatus()` (each text task: configured key, resolution source,
   fallback reason).
2. `app/admin/text-models/page.tsx` + `components/admin/TextModelRegistryStudio.tsx`, following
   ImageModelRegistryStudio's layout: table (name, key, provider, provider model id, enabled toggle,
   capabilities, prices, timeout, env configured ✓/✗ with missing names), edit drawer (no key edit, no delete —
   disable instead), add-model form with suggested key, Test button, "Tasks using this model", and a banner for
   tasks currently running on fallback. Migration-absent state: read-only notice "migration 119 not applied —
   text tasks use the legacy Gemini list".
3. `lib/admin/nav.ts:499`: add `{ label: 'Text Models', href: '/admin/text-models', icon: <lucide icon> }` before
   Image Models.
4. `components/admin/PlaygroundStudio.tsx`: text tasks get options from `getTextModelOptions()`, vision tasks
   filtered to vision models; the configured key is always listed (labelled disabled/unknown when it is). Replace
   the native `<select>` `ModelDropdown` (L318) with the shared `FilterDropdown` for all tasks. Temperature
   slider disabled with a one-line note when the selected model ignores temperature. Production config line shows
   display name and a fallback warning.
5. `PersonaEditorDrawer.tsx`: under the model-overrides textarea, list enabled model keys (help text only).
6. `app/admin/agents/routing/page.tsx`: show each resolved model's display name/provider and any fallback. Keep
   the page heading (e2e `e2e/agentic-admin.spec.ts` matches `/routing|model/i`).

**Verify:** tsc, lint, full `npm test`, `npm run build:verify`, `npm run test:e2e`.

### P5 — Smoke, gate, docs (Sonnet runs, Opus reviews and writes docs; commit `docs(text-models): …` plus any fixes)
1. `scripts/text-gateway.smoke.ts`: skipped unless `TEXT_GATEWAY_SMOKE=1`; per provider whose key is set, one
   tiny JSON-schema call (`{ ok: boolean, word: string }`) through the adapters with synthetic records:
   `gemini-2.5-flash-lite`, `openai:gpt-5.6-luna` with `reasoningEffort: 'low'`, `openrouter:qwen/qwen3.7-flash`.
   Assert parsed shape, usage present, provider recorded. npm script
   `test:text-gateway-smoke` = `vitest run --config vitest.smoke.config.ts scripts/text-gateway.smoke.ts`; run it
   as `TEXT_GATEWAY_SMOKE=1 npm run test:text-gateway-smoke` (Git Bash). The env gate is what stops
   `test:character-novelty-smoke` from spending on it.
2. Full gate (WORKING_AGREEMENTS): tsc, lint, test, build:verify, test:e2e. Smoke run after owner confirms keys.
3. Docs: working memory → final state; PROJECT_STATE (ledger row for 119 "not applied", roadmap note, deferred:
   repair loop + D9, open client-callable text RPCs, dead `playground.ts`, telemetry gaps in beat-control/episodes/
   discovery, Vercel duration check for slow reasoning models); GOTCHAS entry for "model ids are registry keys;
   never trust a client-supplied id". Final report per pack template 12.

---

## 6. Deviations from the pack (so far)

| Proposed | Implemented | Reason |
|---|---|---|
| Evaluate → repair → re-evaluate loop | Deferred | Owner decision O1; conflicts with D9. |
| Role aliases (creative_writer, cheap_evaluator) | Not built; TaskKeys are the role layer | Decision D4 rejected a parallel role system. |
| OpenAI SDK | Raw `fetch` for OpenAI and OpenRouter | Matches the image provider; SDK retries by default; no new dependency. |
| Provider fallback | Only an emergency fallback to the task's Gemini default, logged | Avoids silent premium escalation and quality changes. |
| Validate every provider's JSON strictly | Strict for OpenAI/OpenRouter, observe-only for Gemini | Preserve live Gemini behaviour. |
