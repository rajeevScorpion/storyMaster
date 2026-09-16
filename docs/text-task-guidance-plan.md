# Text Task Guidance — Plan

Branch `feature/text-task-guidance` off `dev` (at `a10a8fc`). One commit. No migration, no feature flag: the
guidance is fixed advisory copy shipped in code.

## Goal

Each card in **Task assignments** on `/admin/text-models` gains:
1. a plain one-line summary of what the task does;
2. two tags: whether a user is waiting on it (or it runs in the background), and how often it runs;
3. a **Suggested thinking** bar — four steps Minimal · Low · Medium · High, lit up to the suggestion, with the
   level name and a one-line reason;
4. when the assigned model does not offer the suggested level, "Closest this model offers: X";
5. under the Thinking dropdown, a soft note when the effective level is two or more steps away from the
   suggestion. Advice only — never blocks or changes a save.

Principle recorded for future edits: thinking buys planning, rule-keeping and judgment, not imagination.
Push the level up for many constraints or costly mistakes; down when a user waits on every call.

## Verified current-state facts (checked 2026-09-15)

- Task list: `TASK_DEFINITIONS` and `type TaskKey` in `lib/ai/model-config.shared.ts` (23 tasks).
- Text tasks = all tasks except `NON_TEXT_MODEL_TASKS` in `lib/ai/text-models.shared.ts` (~line 400:
  `image_generation`, `reel_image_generation`, `portrait_generation`, `tts`, `reel_tts`,
  `story_text_overlay_alignment`). `isTextModelTask` is next to it. That leaves **17** text tasks.
- `TEXT_REASONING_LEVELS = ['none','minimal','low','medium','high','xhigh','max']` and
  `TEXT_REASONING_LEVEL_LABELS` in `lib/ai/text-models.shared.ts` lines 12–23. Gemini offers
  minimal–high; 3.8 Flash's own record starts at Low.
- Card JSX: `components/admin/TextModelRegistryStudio.tsx` lines 368–412 (`data.taskStatus.map`). Section
  intro paragraph lines 372–375. `TaskThinkingControl` lines 147–200. `Field` lines 134–141. Existing chip
  style at ~line 535: `rounded px-2 py-0.5 text-xs bg-neutral-700/60 text-neutral-400`.
- `TextTaskModelStatus` (`app/actions/text-models.ts` line 37): `taskKey`, `label`, `configuredKey`,
  `problem`, `reasoningLevel` (task override or null). The card finds the model via
  `data.records.find(r => r.modelKey === task.configuredKey)`; offered levels are
  `record.capabilities.reasoningLevels ?? []`, model default is `record.defaultParams.reasoningLevel`.
- Where tasks run (basis for the tags):
  - seeded beat materialization: store, on reader advance in a seeded story (`lib/store/story-store.ts` ~2918, ~4414)
  - visual composers: once per beat (`lib/ai/beat-orchestration.ts` ~670)
  - discovery metadata: awaited inside publish/republish (`app/actions/storyline-covers.ts` ~665, `persistence.ts` ~1481)
  - story bible: inside `prepareEpisodeContinuation` (Continue as episode dialog)
  - reference analysis: direct seed load (creator waits) and the adoption job runner
  - graphic style extraction: `/admin/graphic-styles` only
  - legacy voice selection: narration voice resolution, store and batch
  - `agent_*`: `lib/agentic/*` pipeline
- Unit tests for the shared registry live in `lib/ai/text-models.shared.test.ts` (vitest).
- Authenticated e2e: `e2e/text-models-admin.spec.ts` line 55 asserts the Story Generation Thinking button.

## Edit 1 — new `lib/ai/text-task-guidance.shared.ts`

Pure and isomorphic (no `server-only`, no `'use client'`). Imports only types/constants from
`@/lib/ai/model-config.shared` and `@/lib/ai/text-models.shared`.

```ts
export type SuggestedThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
export const SUGGESTED_THINKING_STEPS: readonly SuggestedThinkingLevel[] = ['minimal', 'low', 'medium', 'high'];

/** Every TaskKey a text model can run. Must equal the set isTextModelTask accepts (unit-tested). */
export type TextTaskKey = Exclude<TaskKey,
  'image_generation' | 'reel_image_generation' | 'portrait_generation' | 'tts' | 'reel_tts' | 'story_text_overlay_alignment'>;

export interface TextTaskGuidance {
  summary: string;
  /** A person is on screen waiting for this result. */
  userWaiting: boolean;
  cadence: string;
  suggested: SuggestedThinkingLevel;
  why: string;
}

export const TEXT_TASK_GUIDANCE: Record<TextTaskKey, TextTaskGuidance> = { /* table below, verbatim */ };

export function getTextTaskGuidance(taskKey: TaskKey): TextTaskGuidance | null;

/** Closest level the model offers to `target`, by position in TEXT_REASONING_LEVELS. Exact match wins;
 * on a tie the lower (cheaper) level wins; null when `offered` is empty. */
export function nearestOfferedLevel(target: TextReasoningLevel, offered: readonly TextReasoningLevel[]): TextReasoningLevel | null;

/** 'above' / 'below' when `effective` sits two or more positions (TEXT_REASONING_LEVELS index) from the
 * nearest offered level to `suggested`; otherwise null. Also null when `effective` is null (provider
 * default — unknown) or `offered` is empty (no thinking control). */
export function compareToSuggestion(
  effective: TextReasoningLevel | null,
  suggested: SuggestedThinkingLevel,
  offered: readonly TextReasoningLevel[],
): 'above' | 'below' | null;
```

Guidance table — use this copy exactly:

| key | summary | userWaiting | cadence | suggested | why |
|---|---|---|---|---|---|
| story_generation | Writes each beat: the scene, the choices, the characters and what must stay consistent. | true | Every beat | medium | Holds the most rules at once, but a reader waits on every beat, so High costs time. |
| reel_story_generation | Writes a short reel of one to three beats. | true | Per reel | low | Short and self-contained, with little continuity to track. |
| seed_plan_generation | Turns a creator's own material into a beat-by-beat plan they review. | true | Once per seeded story | high | Shapes the whole story in one pass, and runs only once. |
| seeded_beat_materialization | Expands one approved plan beat into the full beat a reader sees. | true | Every beat of a seeded story | low | The plan already decided what happens, and a reader waits on every beat. |
| story_bible_generation | Condenses a finished episode into the series bible the next episode builds on. | true | Once per episode | medium | Mistakes here carry into every later episode. |
| storyline_discovery_metadata | Writes the short gallery blurb, genre and audience fit when a storyline is published. | true | Once per publish | low | A few sentences about a finished story; low stakes. |
| visual_prompt | Turns a finished beat into the 4-panel storyboard plan and portrait tasks for its image. | true | Every beat | low | Translates decisions the beat already made into image instructions. |
| reel_visual_prompt | Turns a reel beat into a 4-panel storyboard plan paced for vertical video. | true | Every reel beat | low | Translates decisions the reel already made into image instructions. |
| graphic_style_extraction | Describes a reference image's art style in 150 words or fewer. | true | On demand, admin tool | minimal | Describes what is in the image; nothing to plan. |
| reference_character_analysis | Reads an uploaded character image and separates fixed identity from details that can change. | true | Once per reference image | low | Careful reading, not invention. |
| reference_world_analysis | Reads an uploaded place image and records its layout, materials and lighting. | true | Once per reference image | low | Careful reading, not invention. |
| voice_selection | Picks a narrator voice. Only used when user-led voice choice is off. | true | Once per story, legacy | minimal | A simple choice from a short list. |
| agent_novelty_assessment | Breaks ties on whether an agent's story idea is too close to existing ones. | false | Only in unclear cases | minimal | A second opinion after scoring has already done most of the work. |
| agent_supervisor_planning | Turns gaps in the catalogue into story commissions for agent personas. | false | Per supervisor run | high | Sets direction for many stories, and runs rarely. |
| agent_story_brief | Turns a commission into a title, premise, themes and characters. | false | Per agent story | medium | Everything the story writer produces builds on this. |
| agent_seed_story_writing | Writes the full source prose for an agent story, in the persona's language. | false | Per agent story | medium | Long writing that must follow the brief; more thinking does not add imagination. |
| agent_story_evaluation | Checks coherence, age fit, persona fidelity, pacing and safety before human review. | false | Per agent story | high | The quality and safety gate; a miss reaches human review. |

## Edit 2 — `components/admin/TextModelRegistryStudio.tsx`

1. Import `SUGGESTED_THINKING_STEPS`, `getTextTaskGuidance`, `nearestOfferedLevel`, `compareToSuggestion`,
   `type TextTaskGuidance` from `@/lib/ai/text-task-guidance.shared`.
2. Section intro (lines 372–375): append one sentence — "Each card suggests a thinking level from what the
   task does. It is a starting point, not a measurement."
3. New local component `SuggestedThinking({ guidance, record })`, defined next to `TaskThinkingControl`:
   - Row: `Suggested thinking` (text-xs text-neutral-400), then four segments (`h-1.5 w-5 rounded-sm`, lit
     `bg-emerald-400/80` up to and including the suggested step, others `bg-white/10`, wrapper
     `aria-hidden="true"`), then the level label (`TEXT_REASONING_LEVEL_LABELS`, text-xs text-emerald-300).
     The visible text carries the meaning; the segments are decoration.
   - Below: `guidance.why` in `text-[11px] leading-snug text-neutral-500`.
   - If the record offers levels and `nearestOfferedLevel(suggested, offered)` differs from `suggested`:
     "Closest this model offers: {label}" in the same muted style.
4. In the card (lines 381–407):
   - Under the label `<p>`, add `guidance.summary` (text-xs text-neutral-400, mt-1), then a tag row
     (`mt-2 flex flex-wrap gap-1`): tag 1 "User waiting" (`bg-indigo-500/15 text-indigo-300`) or
     "Background" (`bg-neutral-700/60 text-neutral-400`); tag 2 the cadence (`bg-neutral-700/60
     text-neutral-400`). Tag base: `rounded px-2 py-0.5 text-[11px]`. Keep `task.problem` after the tags.
   - Render `<SuggestedThinking>` after that header block.
   - Add `mt-auto` to the Model field wrapper so dropdowns align across a row of uneven cards.
   - Under the Thinking field, when `compareToSuggestion(task.reasoningLevel ?? record?.defaultParams.reasoningLevel ?? null, guidance.suggested, offered)`
     is `'above'`: "Well above the suggestion: slower and costlier on every call." — `'below'`: "Well below
     the suggestion: may miss rules this task has to keep." Style `text-[11px] text-amber-300/80`. Do not
     show it when `reasoningOverridesAvailable` is false.
   - If `getTextTaskGuidance` returns null (unknown task), render the card exactly as today.
5. No change to save paths, server actions, or `TaskThinkingControl`'s behaviour.

## Edit 3 — new `lib/ai/text-task-guidance.shared.test.ts`

- The keys of `TEXT_TASK_GUIDANCE` equal exactly `TASK_DEFINITIONS.filter(t => isTextModelTask(t.key))` keys
  (so a new text task cannot ship without guidance, and no non-text task has any).
- Every entry has non-empty `summary`, `cadence`, `why`, and `suggested` ∈ `SUGGESTED_THINKING_STEPS`.
- `nearestOfferedLevel`: exact match; `'minimal'` against `['low','medium','high']` → `'low'`; tie
  `'low'` against `['minimal','medium']` → `'minimal'`; empty → null.
- `compareToSuggestion`: high vs low → `'above'`; high vs medium → null; none vs medium → `'below'`;
  null effective → null; empty offered → null; minimal-suggested on a Low-floor model with effective Low → null.

## Edit 4 — `e2e/text-models-admin.spec.ts`

After line 55 add: `await expect(page.getByText('Suggested thinking').first()).toBeVisible();`

## Verification

`npx tsc --noEmit`, `npm run lint`, `npm test` (full), `npm run build:verify`, `npm run test:e2e`. The
authenticated e2e skips without `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`; report whether it ran or skipped.
