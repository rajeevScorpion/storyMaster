# Phase 4 — User Model Selection Flow

## Goal
Allow users to select an image model during story/reel creation.

## Product rule
Default to story-level model selection.

The selected model should be stored on the story/reel and used for all generated images unless a later advanced override is intentionally added.

## UI should show
For each available model:
- display name
- short description
- coin cost
- allowed/unavailable state based on tier
- recommended/default label
- premium/experimental label if applicable
- simple quality/speed/consistency hint if admin configured

## Avoid
- exposing raw API model ids to normal users
- allowing unsupported models to appear
- allowing misconfigured models to be selected
- changing models silently during a story

## Model change behavior
If a user changes model before generation:
- update estimate immediately

If a user tries to change model after assets are generated:
- warn that character/style consistency may change
- decide based on product policy whether this is allowed
- default recommendation: lock model after generation starts, or require explicit confirmation

## Backend
- Persist selected model/provider on the story/reel.
- Validate selected model against user tier and active status.
- Validate coin estimate before generation.
- Use provider router to call selected provider.

## Acceptance criteria
- User can select allowed model.
- User sees cost before generation.
- Selection is persisted.
- Backend validates tier/cost/model availability.
- Gemini remains default if no model is selected for legacy flows.
- Commit created.

## Commit example
`feat(story): allow image model selection with coin preview`

