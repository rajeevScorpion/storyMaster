# Kissago Pack 2 Implementation Report

Character Library, Story Bible, Journal & Episodic Branching — implemented 2026-07-10.

## Branch

`feature/kissago-character-universe-pack2`, branched from `feature/kissago-beat-control-visual-regeneration` (Pack 1, prerequisite, not yet merged to `dev`). Six commits: foundation → library UI → Story Bible Writer → episodes backend → episode/mixing UI → tests.

## Summary

Kissago now supports connected story worlds: named characters can be saved to a per-user library and reused in new stories (locally instanced, originals untouched); a finished story can be continued as the next episode of a series, automatically carrying all named characters, an LLM-condensed editable story bible (which embeds the origin story's full Advanced settings), and an append-only journal of episode summaries that feeds future generation context. Episode covers visualize "Episode N", and first/last beats link the series together. Everything is behind six feature flags enforced server-side, with fail-closed clients.

## Codebase discovery findings

- Characters live as JSONB in three synchronized stores (`stories.characters`, `story_map` node `data.characters`, `beats.characters`); no character table existed. Decision (user-locked): story-level characters stay JSONB with new optional link fields (`masterId`, `sourceStoryId`, `importedAt`); only library masters are normalized (`character_masters`).
- No episode/series concept existed. The continuity seam is `buildStoryBible` (lib/ai/story-bible.ts) → `formatStoryState`, which already folds `sessionState.characters` into `castRegistry`/`usedCharacterNames` — pre-seeding the roster before beat 1 flows through generation, persistence, and portrait reuse with minimal changes.
- Two beat-1 validation rules contradicted each other for a pre-seeded roster (`newCharacterIds` must not contain existing ids vs. beat 1 must flag ALL named characters); both `validateGeneratedBeat` and `resolveNewCharacterIds` needed seeding-aware fixes or episode generation would repair-loop.
- Pack 1's flag/settings/admin patterns (`lib/beat-control/settings.ts`, `getBeatControlRuntimeSettings`, `requireFeature`) and the prompt playground registration path (`TaskKey` → `PROMPT_TASK_DEFINITIONS` → `executeTaskTest` switch) were reused as templates.

## Files changed

**New**
- `supabase/migrations/075_character_universe_pack2.sql` + `_rollback.sql`
- `lib/character-universe/settings.ts` (+ test) — flag keys, runtime settings, fail-closed defaults
- `lib/types/character-library.ts`, `lib/types/episodes.ts`
- `app/actions/character-library.ts` — runtime snapshot, list/save/update/archive masters
- `lib/character-library/mapping.ts` (+ test) — `masterToCharacter`, `findCharacterNameConflicts`
- `app/actions/episodes.ts` — `prepareEpisodeContinuation`, `recordEpisodeStarted`, `getEpisodeNavigation`, `getSeriesBible`, `updateSeriesBible`, `listJournalEvents`
- `lib/episodes/continuity.ts` (+ test) — `buildEpisodeConfig`, `appendEpisodeTitleImageInstruction`, `filterCarriedPortraitTasks`
- `lib/hooks/useMentionAutocomplete.ts`, `components/ui/MentionSuggestionList.tsx` — shared @mention UX
- `components/story/CharacterMasterCard.tsx`, `CharacterMasterDialog.tsx`, `ContinueAsEpisodeDialog.tsx`, `SeriesBibleDialog.tsx`
- `components/admin/CharacterUniverseSettingsPanel.tsx`, `app/admin/settings/character-universe/page.tsx`
- `lib/ai/story-bible.test.ts`

**Modified**
- `lib/types/story.ts` — `Character` link fields; `EpisodeSessionContext`; `StorySession.episodeContext`
- `lib/types/database.ts` — episode columns on `DbStory`; 4 new Db row types. `lib/types/my-stories.ts` — `characters` tab, `episode_number`
- `lib/store/story-store.ts` — `startStory(prompt, config, seed?)`; `continueAsEpisode`; `characterUniverseSettings` + loader; name-fallback in `mergeCharacterVisualReferences`; carried-portrait filtering + "Episode N" prompt stamp in the beat-1 pipeline
- `lib/ai/story-bible.ts` — `seriesBible`/`seriesJournal`/`episodeNumber` in the story-state bundle; seeded-roster beat-1 validation fix
- `app/actions/story-runtime.ts` — seeding-aware `resolveNewCharacterIds`
- `lib/ai/prompt-config.shared.ts` — Story Bible Writer default prompt/guardrail/definition; 2 series-continuity rules added to the story-generation default
- `lib/ai/model-config.shared.ts`, `lib/ai/generation-schemas.ts`, `app/actions/prompt-playground.ts`, `app/admin/story-playground/page.tsx`, `app/admin/playground/page.tsx`, `components/admin/PlaygroundStudio.tsx` — `story_bible_generation` task
- `app/actions/persistence.ts` — episode columns in `ADDITIVE_STORY_COLUMNS` + `saveStory` (conditional) + `loadStory` episode-context rebuild + `listUserStories` episode badge (with pre-075 fallback)
- `app/actions/admin.ts`, `components/admin/GlobalSettings.tsx` — admin toggles + section
- `lib/store/my-stories-store.ts`, `components/story/MyStoriesDrawer.tsx` — Characters tab (flag-gated), "Ep N" badge
- `components/story/StoryScreen.tsx` — save-to-library affordance + conflict flow; Continue-as-Episode button; series nav links on first/last beats; settings load
- `components/story/CustomOptionInput.tsx` — rewired to the shared mention hook (behavior identical)
- `components/story/LandingScreen.tsx`, `components/story/HomeContent.tsx` — character picker + @mention mixing, seed threading

## Database/schema changes (migration 075 — **apply manually in the Supabase dashboard**)

1. `character_masters` — user-owned reusable characters; generated `normalized_name`; partial UNIQUE `(user_id, normalized_name) WHERE archived_at IS NULL`; RLS owner SELECT/INSERT/UPDATE, **no DELETE** (archive over delete).
2. `episode_branches` — series spine; RLS owner SELECT only, service-role writes.
3. `story_bibles` — one per branch (UNIQUE branch_id); `config_snapshot` JSONB holds the origin story's full StoryConfig; RLS owner SELECT + UPDATE, INSERT via service role.
4. `episode_journal_events` — append-only (identity `sequence_no`), event types `episode_created | characters_migrated | episode_summary | bible_generated | bible_edited`; RLS owner SELECT only, service-role writes.
5. `stories` + `episode_branch_id` / `episode_number` / `parent_story_id` (nullable, FK SET NULL, partial indexes).
6. Seeds 6 flags enabled=true (`ON CONFLICT DO NOTHING`).

Rollback file drops in dependency order and warns that it discards user data — prefer disabling the flags.

## Feature flags/admin settings added

`character_library_enabled`, `character_global_save_enabled`, `character_mixing_enabled`, `episodes_enabled`, `story_bible_enabled`, `episode_journal_enabled` — all enforced server-side (`requireFeature`); client snapshot fails closed. Admin toggles at `/admin/settings/character-universe` ("Characters & episodes" section).

## User-facing UI changes

- **My Stories → Characters tab** (flag-gated): card grid with portraits, Active/Archived/All filter (FilterDropdown), detail dialog to edit name/type/appearance/personality/role notes, archive/restore with ConfirmDialog.
- **Story screen → character refs panel**: per-character "Save to My Library" bookmark (owner only, never in exploration); duplicate-name conflict offers "Update the existing character" or keep both.
- **Story ending**: "Continue as Episode" button → dialog with carried-character chips, premise textarea with @name autocomplete over the carried cast, collapsible series-memory preview, "View / edit series bible" editor, one-click "Start Episode N". After generation the app navigates to the new story.
- **Series navigation**: first beat shows a banner linking the previous part and any next parts; the ending panel shows "Back to Part N-1" and a "This story continues" list of child episodes.
- **Landing screen** (flag-gated, signed-in): "Bring your characters" picker + chips, and typing `@name` in the story idea pops up the library character list — tap, keep typing to filter, arrow keys to cycle, Enter/Tab to select (selection also adds the character to the story). Same popup UX shared with the Pack 1 custom-option composer and the episode premise box.
- **Admin → Story Playground**: new "Story Bible Writer" tab with editable prompt, model/temperature switching, and JSON test runs.

## API/backend changes

See files above. Notable behaviors:
- `saveCharacterToLibrary` copies the portrait/reference-sheet asset to a stable library key (`{userId}/library/characters/{masterId}_*.{ext}`) so masters survive story deletion/pruning; falls back to referencing the original URL if the copy fails. It also stamps `masterId` back onto the story instance across all three JSONB stores (best-effort).
- `prepareEpisodeContinuation` is idempotent per finished story (skips regeneration when its `episode_summary` journal event exists), creates/attaches the branch, backfills the origin story as episode 1, and returns carried characters with **signed** asset URLs so they work as image references.
- `recordEpisodeStarted` is fire-and-forget after the episode's early save: bumps branch pointers, journals `episode_created` + `characters_migrated` (deduped).
- `getEpisodeNavigation` and bible/journal reads are intentionally **not** flag-gated so existing series data never dead-ends when flags are turned off; entry points (buttons/tabs) are hidden instead.

## Prompt/context generation changes

- New `story_bible_generation` TaskKey ("Story Bible Writer", default `gemini-3.5-flash` @ 0.35) with placeholders `language, storyConfig, storyDigest, characters, previousBible, previousJournal, episodeNumber`, structured-output schema, and locked guardrails. Runtime uses `getPublishedPrompt` + `getModelConfig`, so admins can swap models/prompts in the playground for cost/testing.
- The story-state bundle gains `seriesBible` (≤2000 chars), `seriesJournal` (≤1200), and `episodeNumber` when a session has episode context; two continuity rules were appended to the **default** story-generation prompt. **Note:** installs with a published `story_generation` prompt override the default — republish it (or merge the two rules) to give the model explicit series guidance; the JSON context flows regardless.
- Beat-1 image prompt for episodes gets an explicit "EXCEPTION … render the caption "Episode N"" instruction (stored on `storyboardPromptText` so the server pipeline, legacy path, and regenerations all include it). Best-effort: some image models may still refuse text.

## Character scope behavior implemented

- **This Story** — the existing embedded JSONB characters, unchanged.
- **This Series** — characters carried automatically into each episode via `prepareEpisodeContinuation` (union of named characters along the ending path, freshest roster visuals winning), seeded into the next episode's roster.
- **My Library** — `character_masters`; saving copies the character (and its portrait asset), reuse creates a fresh local instance (`masterToCharacter`: new id, `masterId` link) so local overrides never mutate the master, and edits to a master never rewrite existing stories.
- Duplicate names: DB partial unique index per user; save conflicts surface update-or-keep-both; mixing selections are conflict-checked before start.

## Episodic continuity behavior implemented

Carried characters skip portrait regeneration three ways (defense in depth): seeding-aware `resolveNewCharacterIds`, the beat-1 validation exemption steering the LLM to reuse ids, and `filterCarriedPortraitTasks` dropping `new_character` tasks for characters that already have a visual reference (id or name match). Their `portraitUrl`/`referenceSheetUrl` (pre-signed) feed the beat-1 image as reference images through the existing `collectBeatPortraitReferences` machinery. `mergeCharacterVisualReferences` gained a normalized-name fallback so carried visuals re-attach even when the LLM mints new ids.

## Backward compatibility notes

- All schema changes additive; episode columns are in the `ADDITIVE_STORY_COLUMNS` fallback and `listUserStories` retries without `episode_number`, so pre-075 databases keep working.
- Legacy saves never write episode columns (conditional spread on `session.episodeContext`).
- `startStory`'s new `seed` parameter is optional; all existing callers are unchanged. Legacy beat-1 validation behavior is preserved (roster is empty ⇒ old rules apply verbatim; regression-tested).
- Pack 1 flows untouched; `CustomOptionInput` is behavior-identical after the hook extraction (existing mention tests still pass).
- Exploration mode and non-owners see no owner-only controls; server actions independently verify ownership.

## Testing performed

- [x] Existing story generation — 143 baseline Vitest tests still pass; `npx tsc --noEmit` clean; `npm run lint` clean (1 pre-existing warning in AdvancedOptions.tsx); `npm run build` succeeds
- [x] New unit tests (27): episode config inheritance/reset, "Episode N" instruction idempotence, carried-portrait filtering (incl. name fallback), master→instance mapping, name-conflict detection, seeded vs legacy beat-1 validation, series-context injection/truncation, fail-closed settings
- [ ] Character library (manual — requires migration 075 applied)
- [ ] Global save (manual)
- [ ] Character mixing (manual)
- [ ] Continue as episode (manual)
- [ ] Story bible (manual)
- [ ] Journal (manual)
- [ ] Mobile/responsive behavior (manual)
- [ ] Error states (manual)

Manual QA map (spec 08): library view/save/edit/archive → Characters tab + refs panel; scope/instances → mix two saved characters into a new story, verify originals untouched and duplicate names blocked; episodes → finish a story, Continue as Episode, verify carried cast (no portrait regen), bible carried + editable, journal rows in dashboard, "Episode 2" on the cover, nav links both directions; flags → toggle each off at `/admin/settings/character-universe`, verify UI hidden and direct server calls rejected; backward compat → open a pre-Pack-2 story, exercise Pack 1 beat controls, publish/export.

## Risks

1. **LLM id drift for carried characters** — mitigated by name-fallback merge + validation steering + portrait-task filter; worst case a portrait regenerates.
2. **"Episode N" text vs image-model no-text rules** — explicit exception wording; best-effort.
3. **Published `story_generation` prompt lacks the new series rules until republished** — context still flows via storyState JSON.
4. **Bible LLM call is currently unbilled** (mirrors no precedent; one small text call per finished episode). Flag for a pricing follow-up if needed.
5. **Auto-build stories don't support character mixing** — surfaced as an inline error rather than silently dropping the selection.
6. **Client-legacy inline image path**: the episode title instruction rides `storyboardPromptText`, so it applies there too, but panel-level fidelity varies by model.

## Rollback plan

1. Preferred: disable the six flags in `/admin/settings/character-universe` — UI disappears, server actions reject, existing stories/episodes stay readable (nav reads are ungated), no data loss.
2. Full: run `075_character_universe_pack2_rollback.sql` (destructive for masters/bibles/journals; stories remain readable; header warns).
3. Code: revert the Pack 2 commits on this branch.

## What remains

- **USER: apply `supabase/migrations/075_character_universe_pack2.sql` manually in the Supabase dashboard** (features fail closed until then).
- Manual QA per the map above (requires the migration + a live session).
- Optional follow-ups: billing for the bible generation call, republishing the `story_generation` prompt with the series rules, character mixing for auto-build stories, seeding mixing selections through the signed-out pending-prompt flow.
