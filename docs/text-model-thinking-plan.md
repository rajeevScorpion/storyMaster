# Text Models — Thinking Control, Gemini Refresh, Reader-Safe Errors, Card Layout

Follow-up to [text-model-gateway-plan.md](text-model-gateway-plan.md), on the same branch
(`feature/text-model-gateway`, not yet merged into `dev`). Handoff: [text-model-gateway-working-memory.md](text-model-gateway-working-memory.md).

## 0. Owner decisions (2026-09-14)

- **O-T1** Failed calls never show a provider or model name to readers. Fix once where the error is created;
  keep the detail for server logs and admin screens. Covers text calls and reader-visible image failures.
- **O-T2** Thinking is controllable: a default per model, and an override per task.
- **O-T3** Add Gemini 3.8 Flash. Remove every Gemini **text** model older than 3.5 Flash. Keep 3.5 Flash and 3.8
  Flash. Image and TTS models are out of scope.
- **O-T4** Gemini text calls always run at temperature 1.0 (Google's recommendation for Gemini 3).
- **O-T5** Text Models admin page: task assignments and models as card grids.
- Tasks that must leave a removed model move to 3.8 Flash. The three economy tasks (graphic style extraction,
  legacy voice selection, novelty assessment) get thinking **Low**; every other task keeps the model default.
  Nothing else is reassigned.

## 1. Verified current-state facts

Checked in code and on the dev database on 2026-09-14.

**Gateway**
- `lib/ai/text-gateway/gemini.ts:58-71` builds the Gemini config. It sends **no `thinkingConfig`**, and sends
  `request.temperature` whenever it is a number, ignoring `capabilities.temperature`.
- `gemini.ts:112-114` reads `promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`.
  **`thoughtsTokenCount` is ignored**, though Google bills thinking as output. Gemini cost is under-recorded.
- `lib/ai/text-gateway/openai-compatible.shared.ts:59-61` sends temperature only when the capability allows it.
  `:68-77` maps `defaultParams.reasoningEffort` to `reasoning_effort` (OpenAI) or `reasoning.effort`
  (OpenRouter), and `reasoningEnabled === false` to `reasoning: { enabled: false }` (OpenRouter).
- `lib/ai/text-gateway/router.ts:118-186` `generateText`: resolve → `assertCredentials` → `callProvider` →
  `finalizeOutputText` → cost event. `:188-196` `logTiming` logs `error.message`. `:200-214` `testTextModel`.
- `TextGatewayError` (`types.shared.ts:80-96`) carries `category`, `providerKey`, `modelKey`, `status`,
  `retryable`, `message`. Messages naming provider and model are built at `router.ts:44,100,112,133`,
  `gemini.ts:28,93,104`, `openai-compatible.ts:69-70,85,97`.
- `@google/genai` `ThinkingConfig` = `{ includeThoughts?, thinkingBudget?, thinkingLevel? }`;
  `ThinkingLevel` enum string values `MINIMAL | LOW | MEDIUM | HIGH`.

**Registry and config**
- `lib/ai/text-models.shared.ts:10-20` capabilities `{ structuredOutput, vision, temperature }`; default params
  `{ maxOutputTokens?, reasoningEffort?, reasoningEnabled? }`. Normalizers at `:115-141` ignore unknown keys.
- `buildSyntheticGeminiRecord` (`:181-203`) gives unknown Gemini ids `temperature: true`, no reasoning.
- `validateTextModelInput` (`:337-381`) has no `defaultParams` field. `lib/ai/text-models.ts:204` persists
  `patch.defaultParams` as a whole object; `:163` on create.
- `lib/ai/model-config.ts:46,75` select exactly `task_key, model_id, temperature, updated_at`.
  `updateModelConfig` (`:273-312`) upserts `task_key, model_id, temperature, updated_at`, so a new column that
  is not in the payload is preserved.
- `model_config` (dev): PK `task_key`; columns `task_key text not null`, `model_id text not null`,
  `temperature numeric null`, `updated_at timestamptz`. No other constraints.
- `model_config_history` (dev): `task_key, old_model_id, old_temperature, new_model_id, new_temperature,
  changed_by uuid null, experiment_id, change_reason, created_at`.
- `lib/ai/model-config.shared.ts:81,90` code defaults `graphic_style_extraction` and `agent_novelty_assessment`
  are `gemini-2.5-flash`; `:98-106` `KNOWN_MODELS.text` lists the old Gemini ids (legacy picker).
- `lib/ai/pricing.ts:21-29` code price table; no `gemini-3.8-flash` entry.
- Admin form `components/admin/TextModelRegistryStudio.tsx:340-342` is a free-text "Reasoning effort";
  `:173-177` merges it into `defaultParams`.

**Dev database (2026-09-14)**
- `model_config` text rows: `graphic_style_extraction → gemini-2.5-flash (0.4)`,
  `voice_selection → gemini-2.5-flash-lite (0.3)`; every other row `gemini-3.5-flash`. No rows for
  `story_bible_generation`, `storyline_discovery_metadata` or any `agent_*` task (code defaults).
- `text_model_registry`: the 12 rows from 119, all `default_params = {}`. Luna (OpenAI), Qwen and DeepSeek are
  enabled on dev.
- `agent_personas.model_overrides`: no non-empty rows.
- **Production:** `agent_personas` does not exist; 119 is not applied; `model_config` could not be read from
  this session (permission denied). Migration 120 is written to be correct whatever prod holds.

**Provider facts**
- Gemini thinking (`ai.google.dev/gemini-api/docs/thinking`): 3.8 Flash `low | medium | high`, default medium,
  `minimal` returns an error. 3.5 Flash `minimal | low | medium | high`, default medium. Gemini 3 cannot turn
  thinking off. `thinking_level` and `thinking_budget` cannot be sent together.
- Gemini 3 guide: "we strongly recommend keeping the temperature parameter at its default value of 1.0";
  lower values "may lead to unexpected behavior, such as looping or degraded performance".
- Gemini 3.8 Flash: stable id `gemini-3.8-flash`; $0.75 in / $3.75 out / $0.075 cached per 1M through
  2026-12-31, then $1.50 / $7.50 / $0.15.
- GPT-5.6 Luna reasoning effort: `none | low | medium | high | xhigh | max`, default medium. Chat Completions
  rejects `reasoning_effort` only together with function tools, which the gateway never sends.
- OpenRouter `reasoning.effort`: `none | minimal | low | medium | high | xhigh | max`; `"none"` disables
  reasoning where the model allows it.

## 2. Design

### 2.1 Reader-safe errors (O-T1)

**Text — fix at the source.** `TextGatewayError.message` becomes a fixed reader-safe sentence; today's text
moves to a new `detail` field. Every reader path is then safe by default, including future ones. Admin and
log consumers read `detail` through one helper.

**Why only two reader leaks exist today.** Next masks errors *thrown* across a server-action boundary in
production. Text leaks happen only where server code catches the error and returns or persists its message:
- `app/actions/beat-control.ts:581-585` `regenerateBeatOptions` returns `error.message` as data.
- `lib/references/adoption-job-runner.ts:376-378` persists `error.message` to `reference_adoptions.error`,
  which `app/actions/references.ts:444` `getReferenceSetupStatus` returns to the story creator.

**Images — no single gateway, so fix where readers get the text.** Provider errors carry the provider name and
up to 300 characters of raw provider body (`lib/ai/image-providers/openai-provider.ts`, `runware-provider.ts`),
and `lib/ai/image-models.ts:244,304` name the model. Job and batch tables keep the raw text for ops; readers get:
- `app/actions/image-jobs.ts:210-239` `getStoryImageJobStatuses` returns `image_generation_jobs.error`
  verbatim (`:234`); `lib/store/story-store.ts:2335` shows it.
- `app/actions/image-jobs.ts:303-315` returns `beats.image_error`.
- `app/actions/image-batch.ts:766` writes `result?.error` and `:1294` writes the raw `message` into
  `beats.image_error`. (`lib/media/image-job-runner.ts:185` already writes a friendly constant.)
- `beats.image_error` is mapped to `imageError` for readers at `app/actions/persistence.ts:396,1404,1542`,
  `app/actions/exploration.ts:35,560,729`, `lib/agentic/review-publish.ts:194` — historical rows may hold raw
  provider text.
- `app/actions/story-runtime.ts:651` sends `reason: error.message` to the browser in placeholder metadata.

**Unaffected, verified:** `classifyRunError` classifies by error name and Postgres codes, never message text.
No test asserts on `TextGatewayError.message`. Agentic `evaluation.ts:192-201` persists no error text.
`app/actions/prompt-playground.ts runPlaygroundTest` has no catch, so admins already see a masked error in
production — pre-existing, recorded as deferred.

### 2.2 Thinking (O-T2)

**Vocabulary** (`lib/ai/text-models.shared.ts`):

```ts
export const TEXT_REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type TextReasoningLevel = (typeof TEXT_REASONING_LEVELS)[number];
export const TEXT_REASONING_LEVEL_LABELS: Record<TextReasoningLevel, string> = {
  none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
};
/** What each provider's API can express at all. A model's own list must be a subset. */
export const PROVIDER_REASONING_LEVELS: Record<TextProviderKey, readonly TextReasoningLevel[]> = {
  gemini: ['minimal', 'low', 'medium', 'high'],
  openai: TEXT_REASONING_LEVELS,
  openrouter: TEXT_REASONING_LEVELS,
};
```

**Where it lives**
- `capabilities.reasoningLevels: TextReasoningLevel[]` — the levels this model accepts. Empty means the model
  has no thinking control: nothing is sent and the UI hides the dropdown. Normalized to vocabulary order,
  deduplicated, unknown values dropped.
- `defaultParams.reasoningLevel?: TextReasoningLevel` — the model's default. Absent means provider default
  (send nothing). Normalization folds the legacy fields: a valid `reasoningLevel` wins; else
  `reasoningEnabled === false` → `'none'`; else a `reasoningEffort` in the vocabulary → that level. The legacy
  fields are removed from `TextModelDefaultParams`; saves write `reasoningLevel` only.
- `model_config.reasoning_level TEXT NULL` — the per-task override (migration 120).

**Resolution** — pure, in `text-models.shared.ts`:

```ts
export function resolveReasoningLevel(input: {
  record: TextModelRecord;
  taskReasoningLevel: TextReasoningLevel | null;
  taskConfiguredKey: string | null;
}): { level: TextReasoningLevel | undefined; source: 'task' | 'model' | 'provider_default' }
```

1. Task override, **only if** `record.modelKey === taskConfiguredKey` and the record lists that level. The
   override belongs to the task's assigned model; it must not leak onto a persona override's model or the
   emergency fallback.
2. Else the model default, if the record lists it.
3. Else `{ level: undefined, source: 'provider_default' }`.

The level is **never** accepted from a caller. The router reads it server-side from `model_config` for
`request.taskKey`. `TextGenerationRequest` gains no reasoning field.

**Adapters**
- Gemini: `thinkingConfig: { thinkingLevel: level.toUpperCase() }` for `minimal | low | medium | high`; any
  other level is skipped with a warning (validation should make that unreachable). Never send `thinkingBudget`.
- OpenAI: `reasoning_effort: level`.
- OpenRouter: `reasoning: { effort: level }`, including `'none'`. The old `{ enabled: false }` path goes.
- Gemini usage: `outputTokens = candidatesTokenCount + thoughtsTokenCount`,
  `reasoningTokens = thoughtsTokenCount`. This matches OpenAI, whose `completion_tokens` already include
  reasoning, so cost rows are comparable.
- Cost-event metadata gains `reasoningLevel` and `reasoningSource`.

**Validation**
- A model's `reasoningLevels` must be a subset of `PROVIDER_REASONING_LEVELS[providerKey]`.
- `defaultParams.reasoningLevel` must be in that model's `reasoningLevels`.
- A task override must be in the configured model's `reasoningLevels`; `null` clears it.
- On update, validate against the merged record (patch over current), since a patch carries no provider.

**Un-migrated database (fail closed)**
- `getModelConfig` / `getAllModelConfigs` select `reasoning_level` too. On a missing-column error from **that**
  query (`42703`, `PGRST204`), set a module latch `reasoningLevelColumnUnavailable` and retry the old
  column list. Never let the missing column fail the model read: that would silently send every task to its
  code default. Latch name and comment per GOTCHAS "Column-availability latches are per migration group".
- `ModelConfig.reasoningLevel` is `null` when unavailable. Writers throw
  "Migration 120 is not applied" rather than write.
- Registry rows without `reasoningLevels` (a DB with 119 but not 120) simply get no thinking control.

### 2.3 Gemini refresh and temperature (O-T3, O-T4)

- Migration 120 adds `gemini-3.8-flash`, moves tasks and persona overrides off removed keys, then deletes the
  removed rows (SQL in section 3).
- Code: `DEFAULT_MODELS.graphic_style_extraction` and `.agent_novelty_assessment` → `'gemini-3.8-flash'`
  (update the D3 "economy tier" comment: economy now means Low thinking). `KNOWN_MODELS.text` →
  `['gemini-3.8-flash', 'gemini-3.5-flash']`. `pricing.ts` gains
  `'gemini-3.8-flash': { inputPerMToken: 0.75, outputPerMToken: 3.75 }` with a comment that it becomes
  1.50 / 7.50 on 2027-01-01. Old price entries stay: historical cost rows reference them.
- Gemini adapter always sends `temperature: 1`. Gemini rows get `capabilities.temperature = false` (migration),
  and `buildSyntheticGeminiRecord` returns `temperature: false`, so every picker shows temperature as not
  tunable for Gemini. `temperatureApplied` in telemetry stays "task temperature applied" (false for Gemini);
  add `temperatureSent`.
- Deploy order is safe either way. Old code on a migrated DB runs 3.8 Flash with the task temperature and no
  thinking. New code on an un-migrated DB latches the column, keeps assignments, forces 1.0, sends no thinking.

### 2.4 Admin layout (O-T5)

`components/admin/TextModelRegistryStudio.tsx`
- **Task assignments:** `grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`. Each card: task label;
  amber problem line if any; **Model** dropdown; **Thinking** dropdown. Thinking options are
  "Model default (<level or provider default>)" plus the assigned model's `reasoningLevels`. Hidden with a
  one-line note when the model has no levels; disabled with "Needs migration 120" when the column is
  unavailable. Changing the model clears a task override the new model does not list.
- **Models:** `grid gap-4 md:grid-cols-2 2xl:grid-cols-3`, cards `flex flex-col`. Top: name and status badge.
  Middle: key · provider · provider id (truncate, full value in `title`); description; capability line;
  default thinking; missing env vars; test result. "Used by N tasks" is a button that expands the list.
  Bottom (`mt-auto`): Disable / Test / Edit.
- **Edit form:** full-width panel above the model grid; scrolls into view when opened. Replace the free-text
  reasoning field with **Thinking levels this model accepts** (checkboxes limited to
  `PROVIDER_REASONING_LEVELS[provider]`, `none` labelled Off) and **Default thinking** (Provider default + the
  checked levels). For Gemini, replace the "Accepts temperature" checkbox with "Temperature is fixed at 1.0
  for Gemini."
- All dropdowns stay `FilterDropdown`. Phone width: one column, 16px gutters.

## 3. Migration 120

Files: `supabase/migrations/120_text_model_thinking.sql` and `_rollback.sql`. **Once the file exists the owner
may apply it; after that it is frozen and changes ship as 121.**

```sql
-- 120_text_model_thinking.sql
--
-- Per-task thinking level, per-model thinking levels, Gemini 3.8 Flash, and removal of every Gemini text model
-- older than 3.5 Flash. Gemini rows stop accepting a task temperature: the gateway always sends 1.0.
--
-- Trap: tasks and persona overrides on a removed key move to gemini-3.8-flash BEFORE the rows are deleted.
-- Deleting first leaves them on a key the registry no longer knows, which silently runs the task's code default.
-- model_config also holds image and TTS ids; the removed list must only ever name text models.
--
-- Verify: select task_key, model_id, reasoning_level from public.model_config order by task_key;

ALTER TABLE public.model_config ADD COLUMN IF NOT EXISTS reasoning_level TEXT NULL;

ALTER TABLE public.model_config DROP CONSTRAINT IF EXISTS model_config_reasoning_level_values;
ALTER TABLE public.model_config ADD CONSTRAINT model_config_reasoning_level_values
  CHECK (reasoning_level IS NULL OR reasoning_level IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));

INSERT INTO public.text_model_registry (
  model_key, provider_key, provider_model_id, display_name, description, is_enabled,
  capabilities, default_params, timeout_ms,
  input_cost_per_mtok_usd, output_cost_per_mtok_usd, cached_input_cost_per_mtok_usd,
  required_env_vars, sort_order
) VALUES
  ('gemini-3.8-flash', 'gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'Thinks at medium by default; lowest setting is low.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":false,"reasoningLevels":["low","medium","high"]}', '{}', NULL,
   NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 5)
ON CONFLICT (model_key) DO NOTHING;

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"temperature":false,"reasoningLevels":["minimal","low","medium","high"]}'::JSONB
WHERE model_key = 'gemini-3.5-flash';

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"reasoningLevels":["none","low","medium","high","xhigh","max"]}'::JSONB
WHERE model_key IN ('openai:gpt-5.6-luna', 'openrouter:openai/gpt-5.6-luna');

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"reasoningLevels":["none","low","medium","high"]}'::JSONB
WHERE model_key IN ('openrouter:qwen/qwen3.7-flash', 'openrouter:deepseek/deepseek-v4-flash-0731');

INSERT INTO public.model_config_history (task_key, old_model_id, old_temperature, new_model_id, new_temperature, change_reason)
SELECT task_key, model_id, temperature, 'gemini-3.8-flash', temperature, '120: Gemini text model removed'
FROM public.model_config
WHERE model_id IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                   'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');

UPDATE public.model_config
SET model_id = 'gemini-3.8-flash',
    reasoning_level = CASE
      WHEN task_key IN ('graphic_style_extraction', 'voice_selection', 'agent_novelty_assessment') THEN 'low'
      ELSE NULL
    END,
    updated_at = NOW()
WHERE model_id IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                   'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');

INSERT INTO public.model_config (task_key, model_id, temperature, reasoning_level)
VALUES
  ('graphic_style_extraction', 'gemini-3.8-flash', 0.4, 'low'),
  ('agent_novelty_assessment', 'gemini-3.8-flash', 0.2, 'low')
ON CONFLICT (task_key) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.agent_personas') IS NOT NULL THEN
    UPDATE public.agent_personas AS persona
    SET model_overrides = (
      SELECT jsonb_object_agg(
        entry.key,
        CASE
          WHEN entry.value->>'modelId' IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                                           'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite')
          THEN jsonb_set(entry.value, '{modelId}', '"gemini-3.8-flash"')
          ELSE entry.value
        END
      )
      FROM jsonb_each(persona.model_overrides) AS entry
    )
    WHERE CASE
      WHEN jsonb_typeof(persona.model_overrides) = 'object' THEN EXISTS (
        SELECT 1 FROM jsonb_each(persona.model_overrides) AS entry
        WHERE entry.value->>'modelId' IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                                          'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite')
      )
      ELSE FALSE
    END;
  END IF;
END $$;

DELETE FROM public.text_model_registry
WHERE model_key IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                    'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (120, '120_text_model_thinking.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

```sql
-- 120_text_model_thinking_rollback.sql
--
-- Tasks and persona overrides on gemini-3.8-flash go back before its row is deleted: the three economy tasks to
-- their 119-era models, everything else to gemini-3.5-flash. Per-task thinking settings are lost.

INSERT INTO public.text_model_registry (
  model_key, provider_key, provider_model_id, display_name, description, is_enabled,
  capabilities, default_params, timeout_ms,
  input_cost_per_mtok_usd, output_cost_per_mtok_usd, cached_input_cost_per_mtok_usd,
  required_env_vars, sort_order
) VALUES
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
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 80)
ON CONFLICT (model_key) DO NOTHING;

UPDATE public.model_config
SET model_id = CASE task_key
      WHEN 'graphic_style_extraction' THEN 'gemini-2.5-flash'
      WHEN 'agent_novelty_assessment' THEN 'gemini-2.5-flash'
      WHEN 'voice_selection' THEN 'gemini-2.5-flash-lite'
      ELSE 'gemini-3.5-flash'
    END,
    updated_at = NOW()
WHERE model_id = 'gemini-3.8-flash';

DO $$
BEGIN
  IF to_regclass('public.agent_personas') IS NOT NULL THEN
    UPDATE public.agent_personas AS persona
    SET model_overrides = (
      SELECT jsonb_object_agg(
        entry.key,
        CASE WHEN entry.value->>'modelId' = 'gemini-3.8-flash'
             THEN jsonb_set(entry.value, '{modelId}', '"gemini-3.5-flash"')
             ELSE entry.value END
      )
      FROM jsonb_each(persona.model_overrides) AS entry
    )
    WHERE CASE
      WHEN jsonb_typeof(persona.model_overrides) = 'object' THEN EXISTS (
        SELECT 1 FROM jsonb_each(persona.model_overrides) AS entry WHERE entry.value->>'modelId' = 'gemini-3.8-flash'
      )
      ELSE FALSE
    END;
  END IF;
END $$;

DELETE FROM public.text_model_registry WHERE model_key = 'gemini-3.8-flash';

UPDATE public.text_model_registry
SET capabilities = capabilities - 'reasoningLevels',
    default_params = default_params - 'reasoningLevel';

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"temperature":true}'::JSONB
WHERE provider_key = 'gemini';

ALTER TABLE public.model_config DROP CONSTRAINT IF EXISTS model_config_reasoning_level_values;
ALTER TABLE public.model_config DROP COLUMN IF EXISTS reasoning_level;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 120;
```

**Pre-apply check on production** (owner, read-only): tasks that will move.

```sql
select task_key, model_id, temperature from public.model_config
where model_id in ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                   'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');
```

Production order: 119, then 120, then redeploy.

## 4. Phases

Each phase is one Sonnet delegation, one commit, reviewed by Opus from the diff. Sequential: A and C both
touch the adapters and router.

### Phase A — Reader-safe errors
1. `lib/ai/text-gateway/types.shared.ts`:
   ```ts
   export const TEXT_FAILURE_MESSAGE = 'Something went wrong while generating this. Please try again.';
   export const TEXT_BUSY_MESSAGE = 'This is taking longer than usual. Please try again in a moment.';
   /** Reader-safe: never contains a provider, model or task name. */
   export function readerSafeTextFailureMessage(category: TextGatewayErrorCategory): string {
     return category === 'timeout' || category === 'rate_limited' ? TEXT_BUSY_MESSAGE : TEXT_FAILURE_MESSAGE;
   }
   /** Full failure text for server logs and admin screens only. */
   export function errorDetail(error: unknown, fallback = 'Unknown error'): string {
     if (error instanceof TextGatewayError) return error.detail;
     return error instanceof Error && error.message ? error.message : fallback;
   }
   ```
   `TextGatewayErrorInput.message` is renamed `detail`. The class stores `detail` and calls
   `super(readerSafeTextFailureMessage(input.category))`. Update the doc comment.
2. Every construction: `router.ts:44,100,112,133`, `gemini.ts:28,93,104`, `openai-compatible.ts:69-70,85,97`
   — `message:` → `detail:`, text unchanged.
3. Admin and log consumers → `errorDetail(...)`: `router.ts logTiming` (`:194`); `app/actions/text-models.ts
   testAdminTextModel` (`:160`); `lib/agentic/orchestrator.ts:866,1006,1167`; `lib/agentic/story-assembly.ts:441`
   and the `{ kind: 'failed', message: error.message }` sites at `:1163,:1324`; `lib/agentic/supervisor.ts:309`.
   Any other `lib/agentic` or admin-only path that records a caught model error's text: same treatment.
4. `app/actions/beat-control.ts regenerateBeatOptions` catch (`:581-585`): log
   `errorDetail(error)` with `console.error`, and return `error.message` only for `BeatControlError` or
   `TextGatewayError`; anything else returns the existing fallback `'Failed to regenerate options.'`.
5. New `lib/references/adoption-errors.shared.ts`:
   `REFERENCE_ADOPTION_FAILURE_MESSAGE = "We couldn't prepare this reference. Please try again."` and
   `readerSafeAdoptionError(raw: string | null): string | null` — returns `raw` when it is one of the
   deliberate reader messages (`'This upload is no longer available.'`, `'Could not read the uploaded image.'`,
   the constant itself), `null` for `null`, otherwise the constant. Use it in
   `lib/references/adoption-job-runner.ts:376-378` (persist the result, `console.error` the detail) and in
   `app/actions/references.ts:444` (covers historical rows).
6. New `lib/media/image-failure.shared.ts`: `IMAGE_FAILURE_MESSAGE = 'Image generation failed. Please try again.'`
   and `readerSafeImageError(raw: string | null | undefined): string | undefined` (`raw` present → the constant).
   - `lib/media/image-job-runner.ts:34` imports the constant instead of its local `FRIENDLY_FAILURE`.
   - `app/actions/image-jobs.ts:234` and `:315`: pass through `readerSafeImageError`. The job table keeps the raw
     text for `/admin` media pipeline (`app/actions/admin-media-pipeline.ts:188`, admin-only — leave it).
   - `app/actions/image-batch.ts:766,1294`: write `IMAGE_FAILURE_MESSAGE` to `beats.image_error`;
     `image_batch_items.error` keeps the raw text.
   - Reader mappings of `beats.image_error`: `app/actions/persistence.ts:396,1404,1542`,
     `app/actions/exploration.ts:35,560,729`, `lib/agentic/review-publish.ts:194`.
   - `app/actions/story-runtime.ts:651`: `reason: 'image_generation_failed'` always (the `console.error` at
     `:645` already logs the detail).
   - Before changing a mapping, grep for code comparing `imageError` against specific strings; report any.
   - Constants go in `.shared.ts` plain modules, never in a `'use server'` file (GOTCHAS).
7. Tests: `TextGatewayError` — for every category, `message` contains neither the provider key, the model key
   nor the task key, and `detail` keeps the original text; `errorDetail` for gateway error, plain Error,
   non-Error. `readerSafeAdoptionError` and `readerSafeImageError` cases.

Verify: `npx tsc --noEmit`, `npm run lint`, `npm test`.

### Phase B — Thinking data layer, migration 120, Gemini list
1. Write both migration files **verbatim** from section 3. Do not edit them after writing.
2. `lib/ai/text-models.shared.ts`: vocabulary, labels, `PROVIDER_REASONING_LEVELS`;
   `capabilities.reasoningLevels`; `defaultParams.reasoningLevel` with legacy folding; remove
   `reasoningEffort` / `reasoningEnabled` from the type; `resolveReasoningLevel`;
   `validateReasoningConfig(providerKey, reasoningLevels, defaultLevel): string[]`;
   `validateTaskReasoningLevel(level, configuredRecord): string | null`; `TextModelInput.defaultParams`.
   `buildSyntheticGeminiRecord` → `temperature: false`, `reasoningLevels: []`.
3. `lib/ai/text-models.ts` create/update: run `validateReasoningConfig` against the merged record.
4. `openai-compatible.shared.ts:68-77`: read `defaultParams.reasoningLevel` only (OpenAI `reasoning_effort`,
   OpenRouter `reasoning: { effort }`). Minimal change so the build stays green; Phase C adds the task level.
5. `lib/ai/model-config.shared.ts`: `ModelConfig.reasoningLevel` (`import type` from text-models.shared);
   `DEFAULT_MODELS` and `KNOWN_MODELS.text` per 2.3.
6. `lib/ai/model-config.ts`: the `reasoning_level` select with its own latch and retry (2.2);
   `updateTaskReasoningLevel(taskKey, level | null)` upserting the full row (current model and temperature,
   or the task defaults when no row exists); `isReasoningLevelColumnAvailable()`.
7. `lib/ai/pricing.ts`: 3.8 Flash entry.
8. Every other non-migration, non-doc reference to a removed id that is a model **list or default** (from the
   sweep). Test fixtures that use an id only as an arbitrary string may stay.
9. Tests: normalization (legacy folding, unknown levels dropped), `resolveReasoningLevel` (task wins only for
   the configured key; unsupported level falls through; fallback record ignores the task level),
   `validateReasoningConfig` (Gemini cannot list `none`; default must be listed), model-config latch
   (missing-column error on the wide select retries narrow and keeps the model), synthetic record temperature.

Verify: `npx tsc --noEmit`, `npm run lint`, `npm test`.

### Phase C — Gateway: thinking, temperature, Gemini thinking tokens
1. New `lib/ai/text-gateway/gemini.shared.ts`: `buildGeminiConfig(record, request, reasoningLevel)`
   (system instruction, response MIME/schema, `temperature: 1`, `maxOutputTokens`, `thinkingConfig`) and
   `parseGeminiUsage(usageMetadata)`. `gemini.ts` uses both.
2. `router.ts generateText`: after resolution, `getModelConfig(request.taskKey)` →
   `resolveReasoningLevel({ record, taskReasoningLevel, taskConfiguredKey })`; pass the level to
   `callProvider` → adapters. `testTextModel` uses the model default only. Cost metadata gains
   `reasoningLevel`, `reasoningSource`, `temperatureSent`.
3. `openai-compatible.shared.ts buildChatCompletionsBody(record, request, reasoningLevel)`.
4. `lib/ai/model-config.ts getModelConfig`: cache the "no row" result (`PGRST116`) as the task defaults for
   the normal 60s, so the router's per-call lookup does not hit the database on every call for tasks without
   a row (story bible, discovery metadata, most agentic tasks). Every writer already calls `invalidateCache()`.
5. Tests: Gemini config (temperature always 1 even when the request says 0.2; thinkingConfig per level; none
   when undefined), usage (thoughts added to output and reported as reasoning), chat body per provider and
   level, router passes the task level only for the configured key, "no row" is cached.

Verify: tsc, lint, test.

### Phase D — Admin page: card grids and thinking controls
1. `app/actions/text-models.ts`: `AdminTextModelRegistryState.reasoningOverridesAvailable`;
   `TextTaskModelStatus.reasoningLevel`; `setTaskReasoningLevel(taskKey, level | null)` (verifyAdmin,
   `isTextModelTask`, validate against the configured record, write, revalidate);
   `assignTextModelToTask` clears an override the new model does not list; `testAdminTextModel` returns the
   admin detail (Phase A).
2. `TextModelRegistryStudio.tsx` per 2.4.
3. `e2e/text-models-admin.spec.ts`: keep it passing; add an assertion that a task card shows a Thinking control.
4. Story Playground (`components/admin/PlaygroundStudio.tsx` ~886-887): the disabled-slider note says the value
   "is not sent", which is wrong for Gemini (1.0 is sent). Add `providerKey` to `TextModelOption`
   (`app/actions/text-models.ts getTextModelOptions`) and show "Gemini always runs at temperature 1.0." for
   Gemini models.

Verify: tsc, lint, test, `npm run build:verify`, `npm run test:e2e`.

### Phase E — Live proof and gates
1. `scripts/text-gateway.smoke.ts`: add Gemini 3.8 Flash at Low and at Medium, Qwen at Off and provider default,
   Luna at None. Print input, output and reasoning tokens for each. Run providers one at a time (Qwen 429s
   under back-to-back calls).
2. Full gate: tsc, lint, test, build:verify, test:e2e.
3. Opus: review, then update PROJECT_STATE (120 row; remove the two closed deferred items; add the 2027-01-01
   price change), GOTCHAS "Text models", the report, and the working memory.

## 5. Out of scope (record in PROJECT_STATE)
- Thinking control in the Story Playground and on agent persona overrides.
- Image and TTS model lists.
- Evaluate → repair loop (still deferred, O1).
