# Kissago Prompt Pack 1 — Beat Control, Continuity Lock & Visual Regeneration

This ZIP contains the complete AI-coder prompt pack for implementing **Pack 1 only**.

## Scope

Implement user control over generated story beats without introducing the larger episodic/character-library system yet.

This pack covers:

1. Beat-level story text editing with timeline/continuity lock.
2. Safe regeneration of images without changing story continuity.
3. Regeneration of narration and options.
4. User-created custom option support.
5. `@name` references for already-named characters available in the current story context.
6. Basic image-regeneration suggestions.
7. Advanced per-panel image-regeneration suggestions.
8. Storyboard/image versioning and restore.
9. Downstream wipe confirmation when an earlier story-changing edit is made.
10. Admin/feature-flag controls and rollback-safe implementation.

## Not in this pack

Do not implement the following in Pack 1:

- Global character library.
- Episodic branching.
- Story bible and journal system.
- Cross-story character mixing.
- Global character save flows.
- Episode-chain migration.

Those belong to Pack 2 and should be implemented later.

## Recommended file reading order for the AI coder

1. `00_SINGLE_COPY_PASTE_PROMPT.md`
2. `01_PRODUCT_INTENT_AND_SCOPE.md`
3. `02_DISCOVERY_FIRST_INSTRUCTIONS.md`
4. `03_IMPLEMENTATION_SEQUENCE.md`
5. `04_DATA_MODEL_AND_MIGRATIONS.md`
6. `05_BACKEND_API_AND_JOBS.md`
7. `06_FRONTEND_UX_FLOWS.md`
8. `07_PROMPT_CONTRACTS.md`
9. `08_CONTINUITY_LOCK_AND_VERSIONING.md`
10. `09_FEATURE_FLAGS_ADMIN_TOGGLES.md`
11. `10_QA_ACCEPTANCE_TESTS.md`
12. `11_ROLLOUT_ROLLBACK.md`
13. `12_CODER_REPORT_TEMPLATE.md`

## Core product principle

> Users can freely improve visualization.  
> Users cannot casually edit the past.  
> If the past changes, the future from that point onward must be wiped or regenerated.

## Implementation philosophy

- Be practical.
- Do not assume current schema, route names, storage layout, or job architecture.
- Discover the existing codebase first.
- Preserve the current working generation flow.
- Add feature flags so the functionality can be tested safely.
- Prefer additive schema changes.
- Add rollback paths.
- Maintain compatibility with current story, beat, image, narration, and option generation.
