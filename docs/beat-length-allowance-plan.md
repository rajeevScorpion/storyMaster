# Beat length: proportional allowance, never fail on word count

Branch `feature/beat-length-allowance`, cut from `feature/content-block-fallback` (which changed the same
call sites in `beat-orchestration.ts` and `seed-authoring.ts`). No migration, no flag.

## Owner decisions (2026-09-15)

- Word allowance scales **proportionally** with the target. No fixed word cap.
- **Word count never retries and never fails a call.** A longer beat is better than no beat and a paid,
  failed call. Even 1.5x the target is accepted.
- Structural problems (missing fields, wrong option count, storyTextParts that don't match storyText,
  character id problems, novelty) keep today's behaviour: one retry, then fail.

## Verified current-state facts

- `lib/ai/story-audience.ts:148-165` `resolveStoryBeatLength`: tolerance `max(4, round(target*0.12))`, band
  clamped to the audience's level-1 and level-5 targets (`hardMinWords`/`hardMaxWords`). The clamp halves
  the band on one side at Brief and Immersive (Teens Immersive 134-152, Adults Immersive 155-176).
- `story-audience.ts:190` contract tells the model the band **and** "an absolute audience range of
  hardMin-hardMax". The validator enforces only the band. Luna's 149-word Teens/Detailed beat was inside the
  "absolute" range, failed the 114-146 band, retried, and threw.
- `lib/ai/story-bible.ts:169-176` `validateGeneratedBeat` pushes `storyText has N words; ... must use min-max
  words` (skipped when `strictCanonicalSource`, lines 154-156). That is the only word-count check in it.
- `lib/ai/story-bible.ts:287-295` `buildValidationRepairNote(issues)` just lists issues.
- `lib/ai/beat-orchestration.ts:533-547` `generateStoryBeat`: validate → one retry with repair note → throw
  `Story beat validation failed after retry`.
- `lib/ai/seed-authoring.ts:161-185` `validatePlan` returns a per-beat word-count issue for non-strict plans;
  one retry, then throws `Seed plan validation failed after retry`. Beat-count mismatch is the only
  structural check there.
- `lib/ai/seed-authoring.ts:258-266` `materializeSeededBeat`: same validate → retry → throw pattern using
  `validateGeneratedBeat`.
- `lib/ai/beat-orchestration.ts:867` `formatNarrativeStoryConfig` prints `Beat Length: label (min-max words;
  target N)` from the same resolver. No edit needed; it follows the resolver.
- `components/story/AdvancedOptions.tsx:570` shows `targetMin-targetMax words per beat`. Same resolver; no
  edit needed.
- `components/admin/GlobalSettings.tsx:2004-2008` default Beat length hint shows only the All Ages target.
- `lib/ai/prompt-config.shared.ts:80` `STORY_GENERATION_PROMPT_DEFAULT` rule 2: "Each beat must contain a
  short paragraph of story text, not the whole story." Line 75 "short in total length" is about the whole
  story and stays.
- dev `prompt_configs` has no rows for `story_generation`, `seeded_beat_materialization`,
  `seed_plan_generation`. **Production not checked** (read denied). The contract in
  `formatAudienceNarrativeContract` is appended at runtime after the template, so the length wording applies
  even if a production override exists; only the rule-2 wording would be bypassed.
- `lib/agentic/evaluation.shared.ts:284-297` judges against `hardMinWords`/`hardMaxWords`. The agentic
  pipeline always runs `strictly_follow`, which exempts the check (`beat_length_unenforced`). Fixtures in
  `evaluation.shared.test.ts` pin the hard range. **Left unchanged on purpose.**
- `lib/ai/prompts.ts` `STORY_MASTER_SYSTEM_PROMPT` (playground only) carries the same "short paragraph"
  line. Out of scope.
- No unit test exercises the retry flow of `generateStoryBeat` / `materializeSeededBeat` /
  `generateSeedPlanPreview`.

## Numbers (pin these in tests)

`tolerance = max(4, round(target * 0.12))`, band `max(1, target - tolerance)` .. `target + tolerance`, no clamp.
`grace = max(4, round(target * 0.15))`, allowance `max(1, bandMin - grace)` .. `bandMax + grace`.

| Audience, level | Target | Band (told to model) | Allowance (no warning) |
|---|---|---|---|
| kids_3_5, 1 | 28 | 24-32 | 20-36 |
| all_ages, 3 | 84 | 74-94 | 61-107 |
| teens, 1 | 64 | 56-72 | 46-82 |
| teens, 3 | 108 | 95-121 | 79-137 |
| teens, 4 | 130 | 114-146 | 94-166 |
| teens, 5 | 152 | 134-170 | 111-193 |
| adults, 5 | 176 | 155-197 | 129-223 |

Outside the allowance only logs. Nothing retries or fails on length.

---

## Phase A — length rules (one commit, Sonnet)

Files: `lib/ai/story-audience.ts`, `lib/ai/story-audience.test.ts`, `lib/ai/story-bible.ts`,
`lib/ai/story-bible.test.ts`, `lib/ai/beat-orchestration.ts`, `lib/ai/seed-authoring.ts`,
`docs/agent-context/GOTCHAS.md`.

1. **`story-audience.ts` `ResolvedStoryBeatLength` (27-35)**: add `allowanceMinWords: number;
   allowanceMaxWords: number;`. Keep `hardMinWords`/`hardMaxWords` (evaluation uses them).
2. **`resolveStoryBeatLength` (148-165)**: remove both clamps (`targetMinWords: Math.max(1, targetWords -
   tolerance)`, `targetMaxWords: targetWords + tolerance`), add `grace` and the two allowance fields per the
   formulas above.
3. **New export in `story-audience.ts`**:
   ```ts
   export interface StoryBeatLengthAssessment {
     wordCount: number;
     targetWords: number;
     allowanceMinWords: number;
     allowanceMaxWords: number;
     withinAllowance: boolean;
     /** Directional instruction for a repair note; null when within the allowance. */
     note: string | null;
   }
   export function assessStoryBeatLength(text: string, length: ResolvedStoryBeatLength): StoryBeatLengthAssessment
   ```
   Note wording when over: `storyText has ${wordCount} words; cut about ${wordCount - targetWords} words to
   reach about ${targetWords} (${targetMinWords}-${targetMaxWords}).` When under: `... add about
   ${targetWords - wordCount} words ...`.
4. **`formatAudienceNarrativeContract` line 190** becomes:
   ```ts
   `- Beat length: ${length.label}. storyText must be ${length.targetMinWords}-${length.targetMaxWords} words (aim for about ${length.targetWords}), about ${Math.round(length.targetWords / 4)} words for each of the four narrative movements. This range is the only length limit.`,
   ```
   The "absolute audience range" text is gone.
5. **`story-bible.ts`**: delete the word-count block (169-176) from `validateGeneratedBeat` and the now
   unused `strictCanonicalSource` / `beatLength` locals. Add:
   ```ts
   /** Length is advisory: callers log it and may add it to a retry that structural issues already forced. Null when there is no text or the beat is verbatim strict source. */
   export function assessGeneratedBeatLength(beat: StoryBeat, sessionState: Partial<StorySession> | null): StoryBeatLengthAssessment | null
   ```
   It moves the `strictCanonicalSource` condition (originKind `seeded_canonical` + authoring mode `seeded` +
   `strictly_follow`) and the `resolveStoryBeatLength(storyConfig.ageGroup, storyConfig.beatLength?.level)`
   call into it. Remove imports that become unused.
6. **`beat-orchestration.ts` `generateStoryBeat` (533-547)**:
   - First attempt → `validateAttempt`. If structural issues exist, compute
     `assessGeneratedBeatLength(normalizeStoryBeatTextParts(beat), normalizedSessionState)`; if its `note` is
     non-null, append it to the issues passed to `buildValidationRepairNote` (and to the
     `validation_retry` log). Retry and throw on structural `retryIssues` exactly as today.
   - Length alone never triggers the retry.
   - After the final beat is chosen, if the assessment is outside the allowance:
     `console.warn('[story_runtime.beat_length_outside_allowance]', { task: 'story_generation', beatNumber,
     wordCount, targetWords, allowanceMinWords, allowanceMaxWords })`.
7. **`seed-authoring.ts` `materializeSeededBeat` (258-266)**: same shape as step 6, task
   `seeded_beat_materialization`, `beatNumber: beat.beatNumber`.
8. **`seed-authoring.ts` `generateSeedPlanPreview` `validatePlan` (161-175)**: keep only the beat-count
   issue. After the final plan (non-strict only), for each beat whose
   `assessStoryBeatLength(beat.storyText, length)` is outside the allowance, `console.warn` the same tag with
   `task: 'seed_plan_generation', beatIndex: beat.beatIndex`. Drop the now unused `getStoryAudienceProfile`
   / `countStoryWords` imports if nothing else uses them.
9. **Tests**
   - `story-audience.test.ts`: every row of the numbers table (band and allowance); contract for teens level
     4 contains `114-146`, `about 130`, `about 33 words`, and does not contain `absolute`;
     `assessStoryBeatLength` within / over (note says `cut about`) / under (note says `add about`) with a
     generated N-word string.
   - `story-bible.test.ts` (`validateGeneratedBeat - audience contracts`): a Teens level 4 beat of 200 words
     with correct parts has no issue containing `storyText has`; `assessGeneratedBeatLength` returns an
     outside-allowance assessment for it; returns `null` for the existing strict canonical fixture.
   - Do not build a harness for the generate/retry flow. If an existing test already mocks
     `callTextModelForReader` for these functions, add "length-only miss makes exactly one call"; otherwise
     leave it (recorded as a gap).
10. **`docs/agent-context/GOTCHAS.md`**: one entry: word count is advisory. `validateGeneratedBeat` no longer
    checks it; the band is what the model is told, the allowance only decides whether a warning is logged,
    and a length miss must never be made to retry or fail (it cost a full beat and two paid calls).

Commit: `git commit --only -- <the paths above>` with message
`fix(story): word count never retries or fails a beat; proportional length allowance`.

### Phase A verification
`npx tsc --noEmit`, `npm run lint`, `npm test` green. Grep confirms no `validation failed after retry` path
can be reached by a length-only issue (read the three call sites after the edit).

## Phase B — prompt wording and admin hint (one commit, Sonnet, parallel with A)

Files: `lib/ai/prompt-config.shared.ts`, `components/admin/GlobalSettings.tsx`.

1. `prompt-config.shared.ts:80` rule 2 becomes:
   `2. Each beat must contain one paragraph of story text, not the whole story. Its length is set by the audience and beat-length contract that follows these instructions.`
   Nothing else in the prompt changes.
2. `GlobalSettings.tsx:2004-2008`: keep `{label} / ` then list every audience's target for the selected
   default level, e.g. `Balanced / words per beat: All ages 84 · Preschool 3–5: 44 · Early readers 6–8: 64 ·
   Middle grade 9–12: 88 · Teens 13–17: 108 · Adults 18+: 124`. Build it from `STORY_AUDIENCE_OPTIONS` +
   `getStoryAudienceProfile(value).shortLabel` + `resolveStoryBeatLength(value, level).targetWords`, all
   imported from `@/lib/ai/story-audience`. Let the line wrap; no new component.

Commit: `git commit --only -- lib/ai/prompt-config.shared.ts components/admin/GlobalSettings.tsx` with message
`fix(story): story prompt defers beat length to the contract; admin default shows every audience`.

### Phase B verification
`npx tsc --noEmit`, `npm run lint`, `npm test` green.

## After both phases (Opus)

Review both diffs. Run `npm run build:verify` and `npm run test:e2e`. Owner check on dev: a Teens / Detailed
story on Luna produces a beat in one call even when it runs long, and the terminal shows
`[story_runtime.beat_length_outside_allowance]` only when it is far off.

## Known gaps

- The length warning is a console line. When `generateStoryBeat` runs in the browser it lands in the browser
  console, not server logs.
- Production prompt overrides for the three tasks were not verified.
- No unit test covers the retry flow of the three generators.
