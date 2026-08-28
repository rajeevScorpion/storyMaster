# Phase 11 — Regeneration and User Image-Change Instructions

Integrate the new compiler with Kissago's image regeneration workflow.

## Preserve Story Continuity

Image regeneration should not change canonical story text or character identity unless the user explicitly edits those elements through the appropriate feature.

## Supported Instruction Scopes

- Overall visual instruction for the beat/storyboard
- Per-panel instruction in advanced mode

These are visual deltas layered over the canonical scene.

## Merge Order

Use a clear precedence model, adapted to the current codebase:

1. Mandatory layout and safety constraints
2. Canonical character identity
3. Canonical scene and panel action
4. Story continuity state
5. User overall visual delta
6. User panel-specific delta
7. Optional decorative details

A user instruction may change pose, lighting, expression, environment density or object placement, but should not silently create extra characters, alter identity or replace the required layout unless the product explicitly allows it.

## Conflict Handling

Examples:

- User says `remove Leo` from a panel where the story requires Leo.
- User says `make four separate posters` while the beat requires a 2×2 storyboard.
- User asks for modern clothing in a medieval continuity scene.

Follow current product rules. Where a request is disallowed, preserve canonical requirements and return a clear user-facing explanation or warning through the existing regeneration UI.

## Prompt History

Store enough metadata to reproduce a generation:

- Canonical scene version/snapshot
- User delta
- Compiler version
- Adapter version
- Model
- Reference asset versions
- Final prompt hash

Avoid storing secrets or unnecessary provider payloads.

## Tests

- Overall instruction retained
- Per-panel instruction scoped correctly
- Unchanged panels remain stable
- Identity cannot be accidentally overwritten
- Legacy regeneration remains available during rollout
