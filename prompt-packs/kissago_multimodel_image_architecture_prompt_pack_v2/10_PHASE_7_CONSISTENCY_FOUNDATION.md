# Phase 7 — Consistency Foundation Per Story

## Goal
Lay the foundation for better character, style, and scene consistency across each Kissago story/reel.

## Current constraint
Uploading character and scene references is not implemented yet.

Do not build the full upload feature unless the codebase already has support. However, design the architecture so reference upload can be added later without rewriting the provider layer.

## Implement
Based on existing story/reel schema, add or prepare support for:

### Story visual profile / visual bible
A story-level structure that can store:
- selected image model
- visual style
- color mood
- camera language
- rendering style
- character identity notes
- costume state notes
- recurring scene/environment notes
- negative/avoid instructions
- future reference asset ids
- provider-specific consistency hints

### Prompt compiler
Image prompts should be compiled from:
- beat description
- story visual profile
- character notes
- scene notes
- costume/prop continuity
- selected provider requirements
- model capability limitations

### Provider capability awareness
Each model should declare capabilities such as:
- text-to-image
- reference image support
- edit support
- batch support
- aspect ratio support
- max prompt length if relevant
- max references if relevant

## UI caution
Do not show “upload character reference” or “upload scene reference” in user UI unless it is actually implemented.

If placeholders are needed, keep them:
- hidden
- admin-only
- internal only
- clearly marked as future scope

## Acceptance criteria
- Story has a clear place for visual consistency metadata.
- Prompt generation can include shared visual invariants.
- Provider layer can later accept references.
- No fake UI feature is shown to users.
- Existing generation still works.
- Commit created.

## Commit example
`feat(image): add story visual profile foundation`

