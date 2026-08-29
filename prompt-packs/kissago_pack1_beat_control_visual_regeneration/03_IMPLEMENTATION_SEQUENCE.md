# Implementation Sequence

Implement in this order so the system remains stable.

## Phase 0 — Branch and backup

- Create a feature branch.
- Confirm latest main/dev branch.
- Run existing tests/build.
- Note baseline failures before changes.
- Do not modify unrelated areas.

Suggested branch name:

```bash
git checkout -b feature/kissago-beat-control-visual-regeneration
```

## Phase 1 — Feature flags and admin controls

Add feature flags first so incomplete UI can stay hidden.

Minimum flags:

- `enableBeatTextEditing`
- `enableTimelineLock`
- `enableImageRegeneration`
- `enableAdvancedPanelImageRegeneration`
- `enableNarrationRegeneration`
- `enableOptionsRegeneration`
- `enableCustomOptions`
- `enableImageVersionHistory`

If an admin settings system already exists, integrate there. Otherwise implement a minimal config/env fallback and document it.

## Phase 2 — Data model and migrations

Add versioning and regeneration metadata.

Do not remove existing columns or data.

Create only additive migrations.

## Phase 3 — Backend services

Implement service-level functions before UI:

- `editBeatText`
- `confirmTimelineRewriteFromBeat`
- `regenerateBeatImage`
- `restoreBeatImageVersion`
- `regenerateBeatNarration`
- `regenerateBeatOptions`
- `addCustomOption`
- `parseCharacterMentions`
- `validateCharacterMentions`

Use project naming conventions instead of these exact names if the codebase has a different pattern.

## Phase 4 — Prompt contracts

Implement/refactor prompt-building logic so every regeneration call has a predictable payload.

For image regeneration, the prompt builder must include:

- Story title/context.
- Beat text.
- Beat index.
- Previous/next beat summaries where safe.
- Named character prompts/references.
- Existing visual style.
- Panel count/layout.
- Overall visual suggestion.
- Per-panel visual suggestions.
- Regeneration mode.
- Negative constraints: do not change story event, do not change character identity.

## Phase 5 — Frontend UI

Add UI behind feature flags:

- Beat actions menu.
- Edit beat dialog.
- Locked timeline warning dialog.
- Image regeneration dialog.
- Advanced panel controls.
- Narration regeneration action.
- Options regeneration action.
- Custom option input with `@name` suggestions/validation.
- Image version history drawer/modal.

## Phase 6 — QA

Run:

- Unit tests.
- Integration tests.
- Build/lint/typecheck.
- Manual QA scenarios.
- Migration up/down test if possible.

## Phase 7 — Implementation report

Use `12_CODER_REPORT_TEMPLATE.md`.

Include:

- What changed.
- Files changed.
- Migrations added.
- Flags added.
- Tests run.
- Known limitations.
- Rollback steps.
