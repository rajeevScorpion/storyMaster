# Kissago Pack 1 — Beat Control, Continuity Lock & Visual Regeneration: Implementation Report

Branch: `feature/kissago-beat-control-visual-regeneration` (off `dev`)
Date: 2026-07-09
Spec: `kissago_pack1_beat_control_visual_regeneration/` (repo root, untracked)

## 1. Summary

Implemented user control over generated story beats while preserving story continuity:

- Beat text editing with a computed timeline lock (a beat is locked for story-changing edits while descendant beats exist).
- Explicit "Rewrite from this beat" confirmation before any downstream wipe; cancel changes nothing.
- Downstream wipe = audit-first hard delete of the descendant subtree (beats rows + story_map patch), cancellation of in-flight image/narration jobs for wiped nodes, and removal of published storylines whose path includes a wiped node.
- Safe image regeneration with `refine` / `reimagine` modes, an overall visual suggestion, and per-panel suggestions for 4-panel storyboard beats — never touches text, narration, options, or later beats.
- Image version history stored in the existing `beats.image_gallery` JSONB (mode, suggestions, prompt snapshot, version number) with restore.
- Narration regeneration (existing per-beat pipeline, now user-facing with a confirm and server-side flag enforcement).
- Options regeneration (leaf beats freely; past beats via the timeline-rewrite confirmation) that preserves user-authored options.
- Custom options with `@name` mentions validated against the current story's named characters (autocomplete UI + backend validation).
- 8 feature flags + a version-cap value, enforced server-side, managed from a new admin settings page.

## 2. Discovery findings

- **Story/beat model:** tree (`StoryMap` of `StoryNode`s), dual-persisted: `stories.story_map` JSONB blob + normalized `public.beats` rows (`UNIQUE(story_id, node_id)`). "Downstream" = descendant subtree, not "index > N".
- **Image generation flow:** client-side prompt orchestration (`composeStoryboardPlan` → `buildFinalStoryboardImagePrompt` in `app/actions/story-runtime.ts`), provider call via `generateSelectedImage`, durable background jobs (`image_generation_jobs` + `lib/media/image-job-runner.ts`), R2 variant pipeline. Panel count is fixed: regular beats = 1 image, storyboard beats = permanent 2×2 grid (no 2-panel layout exists — per-panel controls therefore target the 4 fixed frames only, per the locked product decision).
- **Narration flow:** `generateNarrationForNode` (store) → `generateAndPersistStoryNarrationWithOverlay` / `generateAndPersistNarration`, already regeneration-capable and billed as `regenerate_narration`.
- **Options flow:** options are JSONB on beats (`{id,label,intent}`) — extending the shape needed no migration. Selection via `StoryNode.selectedOptionId` + `continueStory`.
- **Character reference handling:** per-beat `characters` + story-level registry; portraits/reference sheets flow into image generation as reference parts. `@name` validation uses the union of characters along the path to the beat.
- **Admin/feature flag handling:** `public.feature_flags` (flag_key/enabled/value) + `getFeatureFlag`/`setFeatureFlagValue` helpers in `lib/ai/model-config.ts` (60s cache); admin = `ADMIN_USER_ID` env check.

## 3. Files changed

### New files
| File | Purpose |
| --- | --- |
| `supabase/migrations/074_beat_control_pack1.sql` (+ `_rollback.sql`) | Tables, flag seeds, prune-function protection |
| `lib/beat-control/settings.ts` | Flag keys, runtime settings types, cap normalization (shared client/server) |
| `app/actions/beat-control.ts` | All Pack 1 server actions (snapshot, edit, wipe, options, custom options, version list/restore) |
| `lib/utils/character-mentions.ts` (+ `.test.ts`) | `@name` parser + autocomplete cursor helper |
| `lib/media/image-versions.ts` (+ `.test.ts`) | Version entry field mapping (single snake↔camel pair), backfill, cap eviction, URL matching |
| `lib/ai/image-regeneration.shared.ts` (+ `.test.ts`) | Refine/reimagine instruction block + panel labels + option cleaning |
| `lib/utils/story-map.test.ts` | Tests for new tree helpers |
| `components/story/BeatActionsMenu.tsx` | Per-beat kebab menu (flag-gated items) |
| `components/story/EditBeatTextDialog.tsx` | Edit dialog + timeline-rewrite confirmation |
| `components/story/RegenerateImageDialog.tsx` | Mode radios, overall suggestion, advanced panel accordion |
| `components/story/ImageVersionHistoryDialog.tsx` | Version grid + restore |
| `components/story/CustomOptionInput.tsx` | Custom option composer with `@` autocomplete |
| `components/admin/BeatControlSettingsPanel.tsx` + `app/admin/settings/beat-control/page.tsx` | Admin toggles page |

### Modified files
| File | Change |
| --- | --- |
| `lib/types/story.ts` | `Option` gains `source`/`characterMentions`/`createdByUserId`; `BeatImageGalleryEntry` gains version metadata; new `BeatImageVersionMode` |
| `lib/utils/story-map.ts` | `getDescendantNodeIds`, `hasActiveDescendants`, `isBeatLockedForStoryEdit`, `removeSubtree`, `collectNamedCharactersForNode` |
| `lib/types/image-jobs.ts` | `BeatImageRegenerationMeta`; payload gains `regeneration` |
| `app/actions/image-jobs.ts` | Server-side flag enforcement on regeneration enqueue; panel suggestions stripped when their flag is off |
| `lib/media/image-job-runner.ts` | Worker appends a gallery version on every completed generation (backfills pre-existing active image as v1); story_map patch carries the gallery |
| `app/actions/persistence.ts` | All four gallery (de)serialization points now use the shared helpers so version fields survive every writer (`stripBase64`, `nodeToBeatRow`, `beatRowToNode`, `updateBeatMediaState` row + blob patch) |
| `app/actions/narration.ts` | Interactive re-narration of a beat that already has audio requires `beat_narration_regen_enabled` (worker/first-time generation unaffected) |
| `lib/ai/generation-schemas.ts` | `optionsRegenerationSchema` |
| `lib/ai/prompts.ts` | `OPTIONS_REGENERATION_PROMPT` |
| `lib/store/story-store.ts` | `regenerateImageForNode(nodeId, regenOptions?)` (prompt block injection, refine scene-ref, payload meta), `beatControlSettings` + loader, `applyTimelineRewrite`, thin actions `editBeatTextForNode` / `regenerateOptionsForNode` / `addCustomOptionForNode` / `restoreImageVersionForNode` |
| `components/story/StoryScreen.tsx` | Menu + dialogs + custom option input mounted; "Yours" badge on custom options; flags loaded on mount |
| `app/actions/admin.ts` | `getBeatControlAdminSettings`, `setBeatControlFlag`, `setBeatImageMaxVersionsPerBeat` |
| `components/admin/GlobalSettings.tsx` | `beat-control` section registered in settings nav/overview |

## 4. Migrations added

- `074_beat_control_pack1.sql` —
  1. `public.timeline_rewrite_events` (audit written BEFORE any wipe: source node, reason, affected node ids, full JSONB snapshot of wiped beats rows, removed storyline ids, cancelled job ids). RLS: owner SELECT; writes via service role only.
  2. `public.beat_revisions` (append-only text edit history, links to rewrite event). RLS: owner SELECT + INSERT. Chosen as a table (not JSONB on beats) because beats rows are wholesale-upserted by multiple writers — an embedded column would be clobbered by the dual-write race.
  3. Seeds 9 `feature_flags` rows (all enabled per rollout decision).
  4. Replaces `prune_orphaned_beat_images()` (from 035) so only entries with no `mode` or `mode='upload'` are prunable — regenerated versions are never GC'd by the nightly cron.
- `074_beat_control_pack1_rollback.sql` — drops both tables, deletes the flag rows, restores the 035 prune function verbatim.

**Apply manually in the Supabase dashboard (SQL editor) — nothing here runs the CLI.**

## 5. Feature flags / admin settings added

| Flag | Seeded | Meaning |
| --- | --- | --- |
| `beat_text_edit_enabled` | true | Edit beat text UI + backend |
| `beat_timeline_rewrite_enabled` | true | Confirmed downstream wipes; off = past beats hard-locked |
| `beat_image_regen_enabled` | true | Regenerate-image dialog + enqueue enforcement |
| `beat_panel_suggestions_enabled` | true | Advanced per-panel controls (UI + stripped server-side when off) |
| `beat_image_version_history_enabled` | true | Version drawer/restore (versions still recorded while off) |
| `beat_narration_regen_enabled` | true | User-facing narration regeneration |
| `beat_options_regen_enabled` | true | Options regeneration |
| `beat_custom_options_enabled` | true | Custom option input + storage |
| `beat_image_max_versions_per_beat` | `'10'` | Version cap (3–50); uploads and the active image are never evicted |

Code defaults are **false** (fail closed) — the seeds turn everything on. Admin page: `/admin/settings/beat-control`.

## 6. Server actions added or changed

- `getBeatControlRuntimeSettings()` — user-facing flag snapshot.
- `editBeatText({storyId, nodeId, newText, confirmTimelineRewrite?})` — two-phase: no descendants → save + `beat_revisions` row; descendants without confirm → `requires_confirmation` with impact counts (beats/images/narration/published storylines); descendants + confirm → wipe then save. Clears derived text artifacts (4-part split, overlay captions/alignment); keeps the beat's image/audio.
- Internal `wipeDownstreamSubtree` — strict order: snapshot → audit row → cancel image jobs (+ release reservations) and overlapping narration batch jobs → delete affected storylines (`node_path && wiped`) → delete beats rows → patch `story_map`/`current_node_id` → backfill audit bookkeeping.
- `regenerateBeatOptions(...)` — leaf beats regenerate directly (Gemini options-only call, `story_generation` model config); past beats route through the same confirmation + wipe; `source:'user_custom'` options preserved.
- `addCustomOption(...)` — validates `@name` mentions server-side; stores option with `source:'user_custom'`.
- `listBeatImageVersions` / `restoreBeatImageVersion` — signed listing with active detection; restore repoints `beats.image_url` + story_map only (no regeneration, no new entry).
- `enqueueBeatImageJob` — rejects regeneration payloads when the flag is off; strips panel suggestions when their flag is off.
- `generateAndPersistNarration` — interactive regeneration flag check.

## 7. UI changes

- **Beat actions menu** (kebab, left control column, story mode only): Edit story text · Regenerate image… · Regenerate narration · Regenerate options · Image versions…. Hidden entirely in exploration mode, for non-owners, for unsaved stories, for reels/prompt-only stories, and when all flags are off.
- **Edit dialog** with destructive rewrite confirmation (`ConfirmDialog`, danger tone, affected counts, "Rewrite from this beat").
- **Regenerate image dialog**: Refine (default) / Reimagine radios, overall suggestion (500 chars), advanced accordion with 4 labeled panel fields (300 chars each) on storyboard beats when the flag is on; duplicate-click prevention via job/`isRegeneratingImage` state.
- **Version history dialog**: thumbnails, version number, timestamp, mode chip, suggestion summary, Active badge, restore.
- **Custom option composer** under the options list with `@` autocomplete (keyboard navigation), backend validation errors surfaced inline; custom options get a "Yours" badge.
- Light confirms for narration ("narration only") and options ("replaces generated options; yours are kept") regeneration.

## 8. Prompt changes

- `lib/ai/image-regeneration.shared.ts` — regeneration instruction block appended to the storyboard prompt on both the server-pipeline and legacy paths: mode paragraph (spec 07 refine/reimagine wording), overall + per-panel suggestion sections, and strict rules (preserve story event, character identity, panel count; suggestions are visual direction only). Refine mode additionally sends the current image as a scene reference.
- `lib/ai/prompts.ts` — `OPTIONS_REGENERATION_PROMPT` (options-only contract from spec 07).
- No published-template TaskKey changes; existing generation prompts untouched.

## 9. Tests performed

```
npm test           → 29 files, 143 tests passed (baseline was 25 files / 96 tests; +47 new)
npx tsc --noEmit   → clean (baseline clean)
npm run lint       → 0 errors, 1 pre-existing warning (AdvancedOptions.tsx — untouched baseline)
npm run build      → production build succeeds; /admin/settings/beat-control compiled
```

New unit coverage: tree descendants/lock/removeSubtree/character union; `@name` parser (incl. spec example, multi-word names, unknown mentions); version numbering/backfill/cap eviction/upload+active protection/snake↔camel round-trip; regeneration instruction block (modes, panel mapping, strict rules).

## 10. Manual QA results

Manual QA requires migration 074 applied — see the checklist mapping below (spec tests A–N in `10_QA_ACCEPTANCE_TESTS.md`). **Pending: run after applying migration 074 in the Supabase dashboard.**

- A regression: create a story end-to-end (no beat controls touched).
- B: regen beat-1 image with "Make the lighting warmer." → beats 2+ rows unchanged; new version active; old kept.
- C: storyboard beat, overall + 4 panel suggestions → 4 panels preserved; suggestions on the version entry.
- D: regen twice → restore v1 → active switches; all versions kept.
- E: edit leaf beat → no warning; row in `beat_revisions`.
- F/G: edit beat 1 of multi-beat story → warning with counts; cancel → zero changes, no audit row.
- H: confirm → text updated; descendant rows deleted; audit row with snapshot; overlapping storylines removed; in-flight jobs cancelled; story continues from beat 1.
- I: narration regen only touches audio/timestamps.
- J: options regen on leaf → options replaced, custom kept.
- K: options regen on past beat → rewrite warning (or hard block when rewrite flag is off).
- L/M: `@Milo` valid; unknown `@Tara` → error copy with available characters.
- N: each flag off in `/admin/settings/beat-control` → UI hidden after reload AND direct server call rejected.

## 11. Known limitations

1. **Version entries are recorded by the server-pipeline (durable job) path.** In `client_legacy` image processing mode the regenerated image returns as a data URL and is uploaded later by the client save flow, so no version entry is written there (same as pre-Pack-1 behavior). The durable pipeline is the production default.
2. Panel suggestions apply to the fixed 2×2 storyboard layout (4 frames) and single-image beats get the overall suggestion only — a 2-panel layout doesn't exist in the product (locked decision).
3. Downstream wipe hard-deletes beats rows (project convention); recovery is manual from the `timeline_rewrite_events.wiped_beats_snapshot` JSONB. R2 media of wiped beats is not deleted immediately (retention/GC owns cleanup).
4. Options regeneration is uncosted (no pricing catalog entry was added, per plan); image/narration regeneration keep their existing billing.
5. Reels and prompt-only stories don't get the beat actions menu (reels have their own editor; prompt-only keeps its upload gallery flow).
6. `beats.image_gallery` grows with prompt snapshots (≤4000 chars each, capped by `beat_image_max_versions_per_beat`).

## 12. Rollback steps

1. **Fast:** turn all `beat_*` flags off at `/admin/settings/beat-control` (or set `enabled=false` in `feature_flags`). UI disappears; every server action/enqueue rejects; existing stories keep rendering (version metadata on gallery entries is ignored by old readers).
2. **Code:** revert the branch. Old gallery serialization simply drops the extra fields — no data breakage.
3. **Data:** run `074_beat_control_pack1_rollback.sql` only if fully reverting — it drops the audit/revision tables (history loss) and restores the 035 prune function.

## 13. Next recommended pack

Pack 2 — Character Library, Story Bible, Journal & Episodic Branching. Do not start until Pack 1 is stable in production.
