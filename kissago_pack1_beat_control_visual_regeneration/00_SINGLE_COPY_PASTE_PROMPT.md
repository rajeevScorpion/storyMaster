# Single Copy-Paste Prompt for AI Coder

You are implementing **Kissago Pack 1: Beat Control, Continuity Lock & Visual Regeneration**.

Kissago is the correct project name. Do not rename it or refer to it as anything else.

## Your task

Implement a production-safe feature set that allows users to control generated story beats after initial generation while preserving story continuity.

The implementation must include:

1. Beat-level story text editing.
2. Timeline lock for completed beats.
3. Downstream wipe confirmation when an earlier beat is edited in a story-changing way.
4. Safe image regeneration that does not change story text, narration, selected option, or future beats.
5. Optional user suggestions for image regeneration.
6. Advanced per-panel image suggestions for storyboard layouts with 1, 2, or 4 panels/scenes per beat.
7. Regeneration of narration from the current beat text.
8. Regeneration of options from the current beat context.
9. User-created custom option support.
10. `@name` reference support in custom options using already-existing named characters in the current story context.
11. Image/storyboard version history and restore.
12. Feature flags/admin toggles.
13. Migration and rollback safety.
14. Acceptance tests for core continuity and regeneration cases.

## Must follow these rules

- First inspect the codebase. Do not assume table names, API routes, auth pattern, job queue, storage bucket, or image-generation architecture.
- Identify existing story, beat, option, narration, image, character-reference, and generation-pipeline code before changing anything.
- Preserve the existing story generation flow.
- Make changes additive wherever possible.
- Do not implement global character library, episodic branching, story bible, or journal in this pack.
- Do not break existing stories.
- If an edit affects story meaning, lock the future and require explicit confirmation before wiping downstream beats.
- If the edit is visual only, do not wipe future beats.
- If a user regenerates an image, reuse the same story event, same named characters, same character prompts/references, same visual style, and same storyboard layout unless the user explicitly asks for visual changes.
- For image regeneration, user suggestions are visual directions only and must not rewrite the plot.
- In advanced mode, per-panel suggestions should modify only the corresponding panel while preserving full storyboard continuity.
- Implement image version history before destructive replacement.
- Add feature flags so the admin can enable/disable these controls.
- Include tests and a final implementation report.

## Required implementation sequence

### Phase 0 — Discovery and implementation plan

Before coding, produce a short discovery report:

- Current story data model.
- Current beat data model.
- Current image/storyboard generation flow.
- Current narration generation flow.
- Current option generation flow.
- Current named-character/reference prompt handling.
- Current storage strategy for generated images.
- Current admin settings/feature-flag pattern.
- Current job queue/server action/API route pattern.
- Risks and exact files that will be touched.

Do not proceed with implementation until this discovery is complete.

### Phase 1 — Data model and versioning

Add storage support for:

- Beat revision metadata.
- Beat lock status.
- Downstream invalidation/wipe event metadata.
- Image regeneration requests.
- Storyboard image versions.
- Overall visual suggestion.
- Per-panel visual suggestions.
- Regeneration mode: `refine` or `reimagine`.
- Source version tracking.

Prefer additive migrations. Do not destructively alter existing data.

### Phase 2 — Continuity lock and downstream wipe logic

Implement timeline behavior:

- Past beats are locked once downstream beats exist.
- Story-changing edit to a locked beat requires explicit confirmation.
- On confirmation, delete/soft-delete/archive downstream beats, options, images, narration, and dependent generated assets from that beat onward according to existing project conventions.
- Preserve an audit/revision event so the user/system can know why the downstream chain was wiped.
- Allow the story to continue from the edited beat.

### Phase 3 — Safe regeneration controls

Implement visual-only regeneration:

- Regenerate image/storyboard for a beat without changing text, narration, selected option, or future beats.
- Support basic overall suggestion.
- Support advanced per-panel suggestions.
- Preserve panel count/layout.
- Preserve named characters and character reference prompts/images.
- Save every regeneration as a version.
- Allow restore to previous version.

### Phase 4 — Narration and options regeneration

Implement:

- Regenerate narration from current beat text.
- Regenerate options from current story context.
- Add custom option.
- Parse and validate `@name` references against available named characters in the current story.
- Store custom options separately enough to distinguish them from AI-generated options.

### Phase 5 — Frontend UX

Add UI for:

- Edit beat text.
- Locked beat warning.
- Downstream wipe confirmation.
- Regenerate image modal.
- Basic image suggestion input.
- Advanced per-panel controls.
- Regenerate narration.
- Regenerate options.
- Add custom option with `@name` autocomplete/suggestions.
- Image version history and restore.
- Clear status/error messages.

### Phase 6 — QA and report

Test at minimum:

- New story generation still works.
- Image regeneration does not change story text or future beats.
- Advanced per-panel suggestions preserve panel count.
- Story-changing edit wipes downstream beats only after explicit confirmation.
- Canceling the warning does not wipe anything.
- Narration regeneration updates narration only.
- Options regeneration updates options only.
- Custom option with valid `@name` works.
- Custom option with unknown `@name` gives useful validation.
- Feature flags can disable the new UI/flows.

At completion, provide a report using `12_CODER_REPORT_TEMPLATE.md`.
