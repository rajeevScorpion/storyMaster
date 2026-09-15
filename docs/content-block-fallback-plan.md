# Content-Block Fallback and Transparent Failures — Plan

Branch `feature/content-block-fallback`, cut from `feature/text-task-guidance` (both unmerged) because Phase B
edits the Task assignments card that branch changed. Three phases, each one commit. A first; then B and C in
parallel (disjoint files).

## Why

2026-09-15 on dev: beat 2 of a Hindi story (an 11-year-old learning to swim, after a slip into a pool) had its
storyboard plan call to Gemini 3.8 Flash come back HTTP 200 with no text in ~1s. The gateway threw a generic
"Empty response" `provider_error`, discarded Gemini's block reason, wrote nothing to the cost log, and the app
silently drew the image from a thinner backup plan.

## Owner decisions (2026-09-15)

1. Record the real reason, and log failed calls.
2. Readers see the real cause when a failure is due to content-safety guidelines — never provider or model names.
3. Fallback model is chosen **per task** on the Task assignments card (migration 121).
4. **Every** kind of content block retries once on that task's fallback. The fallback model applies its own policy.
5. A successful fallback is invisible to readers (logged for admins). Readers are told only when the content still
   could not be produced, or when a simpler backup had to be used.

## Verified current-state facts (checked 2026-09-15)

- `lib/ai/text-gateway/types.shared.ts`: `TextGatewayErrorCategory` union lines 58–67; `TEXT_FAILURE_MESSAGE` /
  `TEXT_BUSY_MESSAGE` lines 78–79; `readerSafeTextFailureMessage` line 82; `TextGatewayError` lines 96–114 —
  `message` is always the reader-safe sentence, `detail` is admin-only.
- `lib/ai/text-gateway/gemini.ts` lines 86–95: `if (!response.text)` throws `provider_error` "Empty response…".
  Nothing reads `response.promptFeedback` or `response.candidates`.
- `@google/genai` types: `GenerateContentResponse.promptFeedback.blockReason` (`BlockedReason`: SAFETY, OTHER,
  BLOCKLIST, PROHIBITED_CONTENT, IMAGE_SAFETY, MODEL_ARMOR, JAILBREAK, BLOCKED_REASON_UNSPECIFIED) and
  `blockReasonMessage`; `candidates[0].finishReason` (`FinishReason`: STOP, MAX_TOKENS, SAFETY, RECITATION,
  LANGUAGE, OTHER, BLOCKLIST, PROHIBITED_CONTENT, SPII, MALFORMED_FUNCTION_CALL, IMAGE_SAFETY,
  UNEXPECTED_TOOL_CALL, IMAGE_PROHIBITED_CONTENT, NO_IMAGE, IMAGE_RECITATION, IMAGE_OTHER).
- `lib/ai/text-gateway/openai-compatible.shared.ts` line 141: `refusal = Boolean(message.refusal) ||
  finish_reason === 'content_filter'`. `openai-compatible.ts` lines 92–100 throw it as **`bad_request`**.
  `readProviderErrorMessage` (lines 15–23) reads only `error.message`. `classifyHttpError` maps 403 → `auth_failed`.
- `lib/ai/text-gateway/router.ts` `generateText` lines 121–208: on provider failure it logs timing and rethrows —
  **no cost event**. `recordModelCostEvent` only on success (lines 176–205). `finalizeOutputText` (69–119) throws
  `malformed_output` for non-Gemini after tokens were spent — also unlogged. `testTextModel` (224–239) is the
  admin Test button and must never fall back.
- `ai_cost_events.status` CHECK allows `'success' | 'failed'` (migration 026); `ModelCostEventInput.status`
  exists. RLS is on with no policies (service role only), so failure detail there is admin-only.
- `recordModelCostEvent` (`lib/ai/cost-telemetry.ts` line 22) wraps its work in try — it must still never be
  allowed to replace the original error.
- `app/actions/text-model-proxy.ts` `callTextModel` (lines 37–51) is a `'use server'` export that throws.
  Client callers: `lib/ai/beat-orchestration.ts` line 503 (story beat) and line 723 (storyboard composer);
  `lib/ai/seed-authoring.ts` lines 144 and 235 (dual client/server module, no directive).
- Next.js 16 docs (Error Handling): expected errors from Server Functions should be **returned**, not thrown.
  Don't rely on a thrown server action's `message` reaching the browser in production.
- The store shows `error?.message` for start (`lib/store/story-store.ts` ~2799), continue (~4302), reel (~3961).
  An `Error` constructed in the browser with a reader-safe message displays as-is.
- `composeStoryboardPlan` (`beat-orchestration.ts` 654–757) catches every error at 744 and returns
  `buildFallbackStoryboardPlan` (559). Called from the store (2961, 3790, 4458, 6231), `app/actions/beat-bundle.ts`
  164 (server, inside a server action that rethrows at 183), and `lib/agentic/story-assembly.ts` 1101.
- `StoryboardPlan` (`lib/types/story.ts` 134–142) is saved inside the story_map node (`persistence.ts` 641).
  `renderStoryboardPlan`, `summarizePreviousStoryboard` (~841) and the prompt compiler (`scene-spec.shared.ts` 340)
  read named fields only — an extra optional field does not reach any prompt.
- `model_config` columns: task_key, model_id, temperature, updated_at, reasoning_level. `lib/ai/model-config.ts`
  reads `reasoning_level` inside the wide select with a missing-column latch (37–132). `updateModelConfig`
  (430–467) and `updateTaskReasoningLevel` (235–262) upsert explicit columns only, so they never blank a new column.
- `app/actions/text-models.ts`: `TextTaskModelStatus` 37–45, `AdminTextModelRegistryState` 47–53,
  `buildTaskStatus` 81–95, `setTaskReasoningLevel` 148–169 (pattern for the new setter).
- Card JSX: `components/admin/TextModelRegistryStudio.tsx` task card map (~414–475 on this branch).
- Latest migration is 120. 119 and 120 applied on dev only.

---

## Phase A — record the real reason (gateway)

**Files:** `lib/ai/text-gateway/types.shared.ts`, `gemini.shared.ts`, `gemini.ts`, `openai-compatible.shared.ts`,
`openai-compatible.ts`, `router.ts`, new `outcome.shared.ts`; `app/actions/text-model-proxy.ts`; tests beside each.

A1. `types.shared.ts`
- Add `'content_blocked'` to `TextGatewayErrorCategory`.
- `export const TEXT_CONTENT_BLOCKED_MESSAGE = "This part couldn't be created because it ran into content safety guidelines. Try a different choice or wording.";`
- `readerSafeTextFailureMessage('content_blocked')` returns it (timeout/rate_limited unchanged).
- `TextGatewayErrorInput` and the class gain optional `providerReason?: string` (short machine reason, e.g.
  `prompt_blocked:PROHIBITED_CONTENT`, `finish:SAFETY`, `refusal`, `finish:content_filter`, `moderation`) and
  optional `usage?: TextUsage` (tokens the failed call still consumed).
- `export type TextCallOutcome = { ok: true; text: string } | { ok: false; category: TextGatewayErrorCategory; message: string };`

A2. `gemini.shared.ts` — pure classifier, no SDK import (structural types like `GeminiUsageMetadata`):
```ts
export const GEMINI_CONTENT_FINISH_REASONS = ['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII',
  'IMAGE_SAFETY','IMAGE_PROHIBITED_CONTENT','IMAGE_RECITATION'] as const;
export function classifyGeminiEmptyResponse(input: { blockReason?: string; finishReason?: string }):
  { category: 'content_blocked' | 'provider_error'; providerReason?: string };
```
Block reason present and not `BLOCKED_REASON_UNSPECIFIED` → `content_blocked`, `prompt_blocked:<reason>`. Else
finish reason in the list → `content_blocked`, `finish:<reason>`. Else `provider_error`, `finish:<reason>` when any.

A3. `gemini.ts` lines 86–95: when there is no text, read `response.promptFeedback?.blockReason`,
`response.promptFeedback?.blockReasonMessage`, `response.candidates?.[0]?.finishReason`; classify; throw
`TextGatewayError` with that category, `providerReason`, `usage: parseGeminiUsage(response.usageMetadata)`, and a
`detail` naming the reason (plus `blockReasonMessage` truncated to 200 chars). Keep "Empty response" wording for
`provider_error`.

A4. `openai-compatible.shared.ts`
- `ParsedChatCompletionsResponse` gains `refusalReason?: 'refusal' | 'content_filter'`, set alongside `refusal`.
- Pure `isProviderContentPolicyError(input: { status: number; code?: string; message?: string; moderationReasons?: unknown }): boolean` —
  true when `code` is `content_policy_violation` or `content_filter`; or `status === 403` and `moderationReasons` is a
  non-empty array (OpenRouter moderation); or `status === 400` and `message` matches `/(usage|content) polic|flagged/i`.

A5. `openai-compatible.ts`
- Replace `readProviderErrorMessage` with a reader returning `{ suffix, code, message, moderationReasons }` from
  `error.message`, `error.code`, `error.metadata.reasons` (still never the raw body). On `!response.ok`, if
  `isProviderContentPolicyError(...)` → category `content_blocked`, `providerReason: 'moderation'` (or the code),
  retryable false; else the existing `classifyHttpError` path.
- Refusal (92–100): category **`content_blocked`**, `providerReason: parsed.refusalReason`, `usage: parsed.usage`.

A6. `router.ts`
- Extract one attempt from `generateText` into a local `runTextAttempt(record, resolution, request, taskConfig,
  extraMetadata)` that does credentials, reasoning, timeout, call, timing log, finalize and cost recording, and
  returns `TextGenerationResult`. `generateText` resolves registry/record/taskConfig once and calls it. (Phase B
  calls it a second time.)
- On any failure inside the attempt, when `request.telemetry` is set, record a cost event with `status: 'failed'`:
  `inputTokens`/`outputTokens` from `error.usage` (or the provider result's usage when `finalizeOutputText` threw
  after a response), `latencyMs`, `estimatedCostUsdOverride: usage ? computeTextCostUsd(record, usage) ?? 0 : 0`,
  metadata `{ ...telemetryMetadata, providerModelId, errorCategory, errorDetail (≤500 chars), providerReason,
  reasoningLevel, reasoningSource, resolutionSource, requestedModelKey, ...extraMetadata }`. Wrap the recording in
  try/catch so the original error is always what propagates.
- No fallback logic in this phase.

A7. `text-model-proxy.ts` — add beside `callTextModel`:
```ts
/** Same call, but expected gateway failures come back as data: Next.js recommends returning
 * expected errors from server functions rather than relying on a thrown message reaching the browser. */
export async function callTextModelOutcome(params: TextCallParams): Promise<TextCallOutcome>
```
Catch **only** `TextGatewayError` → `{ ok: false, category, message: error.message }`; rethrow anything else.
Do not change `callTextModel`.

A8. New `lib/ai/text-gateway/outcome.shared.ts` (pure, isomorphic):
```ts
export class ReaderFacingTextError extends Error { readonly category: TextGatewayErrorCategory; }
export function unwrapTextOutcome(outcome: TextCallOutcome): string;          // throws ReaderFacingTextError
export function isContentBlockedError(error: unknown): boolean;               // ReaderFacingTextError or TextGatewayError
```

**Tests A:** `types.shared.test.ts` (content message, still no provider/model name); `gemini.shared.test.ts`
(classifier: prompt block, each content finish reason, LANGUAGE/MAX_TOKENS/none → provider_error, unspecified
block reason ignored); `openai-compatible.shared.test.ts` (`refusalReason`, `isProviderContentPolicyError` cases);
`router.test.ts` (provider failure records one failed event with category/usage; non-Gemini `malformed_output`
records failed with spent tokens; a throwing cost recorder never replaces the original error; success path
unchanged); new `outcome.shared.test.ts`.

**Commit:** `feat(text-gateway): name content-safety blocks and log failed text calls`

---

## Phase B — per-task fallback on a content block

**Files:** `supabase/migrations/121_text_task_content_block_fallback.sql` + `_rollback.sql`,
`lib/ai/model-config.ts`, `lib/ai/text-gateway/router.ts`, `app/actions/text-models.ts`,
`components/admin/TextModelRegistryStudio.tsx`, `e2e/text-models-admin.spec.ts`, tests.

B1. Migration — exactly:

`121_text_task_content_block_fallback.sql`
```sql
-- 121_text_task_content_block_fallback.sql
--
-- Per-task model the text gateway retries on, once, when a provider refuses a call on content-safety grounds.
--
-- Trap: the app reads this column in its own query with its own missing-column latch. Adding it to the existing
-- model_config select that carries reasoning_level (120) would make a database without 121 look like one without
-- 120, and every task thinking level would silently stop applying.
-- Holds a text_model_registry.model_key as plain text, like model_id: a removed model leaves a dead fallback the
-- gateway skips with a warning.
--
-- Verify: select task_key, model_id, content_block_fallback_model_id from public.model_config order by task_key;

ALTER TABLE public.model_config ADD COLUMN IF NOT EXISTS content_block_fallback_model_id TEXT NULL;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (121, '121_text_task_content_block_fallback.sql')
ON CONFLICT (migration_number) DO NOTHING;
```

`121_text_task_content_block_fallback_rollback.sql`
```sql
-- 121_text_task_content_block_fallback_rollback.sql
-- Per-task content-block fallbacks are lost; the gateway stops retrying and reports the block.

ALTER TABLE public.model_config DROP COLUMN IF EXISTS content_block_fallback_model_id;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 121;
```

B2. `model-config.ts` — new section after the reasoning-level latch. **Do not touch the existing wide selects.**
- Own latch (`contentBlockFallbackColumnUnavailable` / `…Checked`), same 42703 / PGRST204 classification, only for
  queries whose one 121 column is `content_block_fallback_model_id`.
- `getContentBlockFallbackModel(taskKey): Promise<string | null>` — selects `task_key,
  content_block_fallback_model_id` with `.maybeSingle()`; own 60s cache; never throws; null on any problem.
- `getAllContentBlockFallbacks(): Promise<Map<TaskKey, string>>` and `isContentBlockFallbackColumnAvailable()`.
- `updateTaskContentBlockFallback(taskKey, modelKey | null)` — throws `'Migration 121 is not applied.'` when the
  column is missing; upsert carrying `model_id`/`temperature` forward exactly like `updateTaskReasoningLevel`;
  clears both caches.

B3. `router.ts` `generateText`, around the first `runTextAttempt`:
- Retry only when: the error is a `TextGatewayError` with `content_blocked`; `!request.strictModel`; registry is not
  null; `getContentBlockFallbackModel(taskKey)` returns a key that differs from the blocked record's key;
  `validateTextModelSelection(taskKey, key, registry) === null`; `getMissingEnvVars(fallbackRecord)` is empty; and,
  when `request.images` is non-empty, the fallback has vision. Otherwise `console.warn('[text-gateway]
  content-block fallback skipped', { taskKey, fallbackKey, reason })` (only when a key was configured) and rethrow.
- Second attempt: `runTextAttempt(fallbackRecord, { record: fallbackRecord, source: 'registry' }, request, taskConfig,
  { contentBlockFallback: true, blockedModelKey, blockedReason: error.providerReason })`. Thinking level resolves
  to the fallback model's own default (existing rule). `console.info('[text-gateway] content-block fallback', …)`.
- Fallback succeeds → return it. Fallback blocked too → throw that error. Fallback fails any other way → throw the
  **original** content-block error (the reader-relevant cause); both attempts are already in the cost log.
- `testTextModel` unchanged.

B4. `app/actions/text-models.ts`
- `TextTaskModelStatus` += `contentBlockFallbackKey: string | null`, `contentBlockFallbackProblem: string | null`
  (`validateTextModelSelection` result for a set key). `AdminTextModelRegistryState` += `contentBlockFallbackAvailable: boolean`.
- `buildTaskStatus` reads `getAllContentBlockFallbacks()`.
- `setTaskContentBlockFallback(taskKey: TaskKey, modelKey: string | null)`: `verifyAdmin`; `isTextModelTask`; for a
  key: registry required, `validateTextModelSelection` problem → throw, equal to the task's configured key → throw
  "The fallback must be a different model from the one the task runs on."; then update; `revalidatePath`.

B5. `TextModelRegistryStudio.tsx`, each task card, after the Thinking field and its note:
- `Field label="If blocked, retry on"` with `FilterDropdown`: `{ value: '', label: 'No fallback' }` plus
  `buildTaskAssignmentOptions(task, records)` minus the configured key; keep an unknown/disabled current key
  visible the same way that helper does. `ariaLabel={`Content-block fallback for ${task.label}`}`.
- When `!contentBlockFallbackAvailable`: disabled placeholder "Needs migration 121" (mirror `TaskThinkingControl`).
- `contentBlockFallbackProblem` → `text-[11px] text-amber-300/80` line below.
- Section intro: append "If a model refuses a task on content-safety grounds, it is retried once on that task's fallback."

B6. `e2e/text-models-admin.spec.ts`: assert the button `Content-block fallback for Story Generation` is visible.

**Tests B:** model-config fallback reads (value, null row, missing column latches only this feature, other error
no latch); router: blocked → fallback succeeds (two cost events, second has `contentBlockFallback`), blocked →
fallback blocked (throws second), blocked → fallback timeout (throws original), no key / same key / disabled key /
missing env / strictModel → no second call.

**Commit:** `feat(text-models): per-task fallback model when a provider blocks content (migration 121)`

---

## Phase C — tell readers the real cause

**Files:** `lib/types/story.ts`, `lib/ai/beat-orchestration.ts`, `lib/ai/seed-authoring.ts`,
`app/actions/beat-bundle.ts`, `lib/store/story-store.ts` (beat-bundle result handling only),
`components/story/StoryScreen.tsx`, tests.

C1. `StoryboardPlan` += `/** Set only on the backup plan used because the composer was blocked on content-safety grounds. */ fallbackReason?: 'content_blocked';`

C2. `beat-orchestration.ts`
- Line 503 (story beat) and line 723 (composer): `unwrapTextOutcome(await callTextModelOutcome({...same params}))`.
- Composer catch (744): when `isContentBlockedError(error)`, set `fallback.fallbackReason = 'content_blocked'`.
  Other failures keep today's silent backup.
- Story beat: a blocked beat now surfaces `ReaderFacingTextError`, whose message the store already displays.

C3. `seed-authoring.ts` lines 144 and 235: same switch to `callTextModelOutcome` + `unwrapTextOutcome`.

C4. `beat-bundle.ts` core action (catch at 173–184): after releasing the reservation, if the error is a
`ReaderFacingTextError`, **return** `{ status: 'failed', message: error.message }` (extend the result union) instead
of rethrowing. In `story-store.ts`, next to each `core.status === 'blocked'` branch (~2623, ~4100), handle
`'failed'` by throwing `new Error(core.message)` into the existing catch so the error state shows it.

C5. `StoryScreen.tsx`: where the current beat's storyboard image renders, when
`normalizedCurrentBeat.storyboardPlan?.fallbackReason === 'content_blocked'` and an image is shown, render beneath
it: "The picture for this scene was drawn from a simpler plan, because the detailed plan ran into content safety
guidelines." (`text-xs text-neutral-400`, not dismissible, no provider/model name).

**Tests C:** if a beat-orchestration test harness exists that mocks the proxy, add: blocked composer returns a plan
with `fallbackReason`; other composer failure does not. Otherwise rely on Phase A's unwrap tests plus tsc.

**Commit:** `feat(story): tell readers when content-safety guidelines blocked a beat or its storyboard plan`

---

## Out of scope — record in PROJECT_STATE when done

- Image generation blocks (separate pipeline, `readerSafeImageError`) — no fallback or content message yet.
- Reel paths in `app/actions/story-runtime.ts` still throw across the server-action boundary.
- The published viewer (`StorylinePlayer`) does not show the storyboard notice.

## Verification

Each phase: `npx tsc --noEmit`, `npm run lint`, `npm test`. After B and C: `npm run build:verify`,
`npm run test:e2e` (report whether the authenticated admin test ran). Owner, after applying 121 on dev: set a
fallback on Visual Prompt Composer, replay the swimming story's beat 2, and check the cost log shows a failed row
with `errorCategory: content_blocked` followed by a fallback success.
