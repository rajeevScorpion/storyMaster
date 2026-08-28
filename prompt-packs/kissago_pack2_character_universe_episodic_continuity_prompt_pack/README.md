# Kissago Pack 2 Prompt Pack
## Character Library, Story Bible, Journal & Episodic Branching

Created: 2026-07-09

This prompt pack is only for **Pack 2** of the Kissago Story Worlds roadmap.

**Important dependency:** This pack should be implemented only after **Pack 1 — Beat Control, Continuity Lock & Visual Regeneration** is already stable in the codebase.

## Pack 2 goal

Transform Kissago from one-off stories into connected story worlds.

Users should be able to:

- save named characters as reusable entities
- keep characters scoped to a story, an episodic branch, or the whole account
- create connected episodes from an existing storyline
- automatically carry forward all named characters into the next episode branch
- maintain a story bible for stable world rules
- maintain a journal across the episodic chain
- mix characters from different stories by bringing selected characters into a new story locally

## Core philosophy

- Stories are timelines.
- Characters are reusable identities.
- Episodes are branches.
- Journals preserve memory.
- Story bibles preserve world consistency.
- Global characters can be reused anywhere, but each story should create local instances when needed.

## Product rules

1. Do not assume architecture. Inspect the actual repository first.
2. Preserve all working flows from Pack 1 and the existing Kissago experience.
3. Named characters already exist as prompt-defined entities used for character reference generation. Reuse that as the seed for the character system.
4. When a new episode is created from a storyline, all named characters in that storyline must automatically migrate into the episode branch.
5. Users must be able to save characters globally to their account.
6. Users must be able to mix characters from different stories by selecting them into a new local story context.
7. Keep the UI simple. Advanced continuity systems should stay mostly behind the scenes.
8. Add migrations carefully and with rollback paths.
9. Keep new features behind feature flags/admin toggles where practical.
10. Use the name **Kissago** consistently.

## Recommended folder usage

Give the AI coder these files in this order:

1. `00_MASTER_STARTER_PROMPT.md`
2. `01_IMPLEMENTATION_ORDER.md`
3. `02_CODEBASE_DISCOVERY_FIRST.md`
4. `03_DATA_MODEL_AND_SCOPE_LOGIC.md`
5. `04_UX_AND_USER_FLOWS.md`
6. `05_API_AND_BACKGROUND_JOB_GUIDE.md`
7. `06_FEATURE_FLAGS_ADMIN_TOGGLES.md`
8. `07_MIGRATION_ROLLBACK_GUIDE.md`
9. `08_TEST_PLAN_ACCEPTANCE_CRITERIA.md`
10. `09_CODER_REPORT_TEMPLATE.md`

