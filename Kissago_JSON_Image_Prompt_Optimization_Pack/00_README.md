# Kissago JSON Image Prompt Optimisation and Consistency Engine

## Purpose

This prompt pack guides an AI coding agent to replace Kissago's repetitive image-generation prompts with a production-safe, JSON-based scene specification and a model-aware prompt compiler.

The objective is not merely to shorten prompts. The implementation must improve:

- Character identity consistency
- Clothing and appearance continuity
- Scene and world continuity
- Multi-panel storyboard compliance
- Prompt clarity and instruction priority
- Provider portability
- Prompt-length reliability
- Regeneration behaviour
- Debugging and evaluation

## Core Decision

Kissago will use:

1. **Canonical JSON internally** for storage, validation, editing, regeneration and portability.
2. **A deterministic visual prompt compiler** to remove redundant and non-visual information.
3. **Provider/model-specific adapters** to produce the final prompt and request format.
4. **Reference images through native provider mechanisms** wherever supported.
5. **Feature flags and shadow comparison** before replacing the existing production path.

TOON is out of scope.

## How to Use This Pack

Run the prompts sequentially. Do not jump directly to implementation before completing the investigation and baseline phases.

Recommended order:

1. `01_MASTER_STARTER_PROMPT.md`
2. `02_NON_NEGOTIABLE_RULES.md`
3. `03_PHASE_00_INVESTIGATION.md`
4. `04_PHASE_01_BASELINE_AND_METRICS.md`
5. `05_PHASE_02_CANONICAL_SCENE_JSON.md`
6. `06_PHASE_03_VISUAL_RELEVANCE_FILTER.md`
7. `07_PHASE_04_SEMANTIC_DEDUPLICATION.md`
8. `08_PHASE_05_PROMPT_COMPILER.md`
9. `09_PHASE_06_MODEL_CAPABILITY_REGISTRY.md`
10. `10_PHASE_07_PROVIDER_ADAPTERS.md`
11. `11_PHASE_08_CHARACTER_REFERENCE_AND_CONSISTENCY.md`
12. `12_PHASE_09_WORLD_SCENE_CONTINUITY.md`
13. `13_PHASE_10_STORYBOARD_LAYOUT_COMPOSITION.md`
14. `14_PHASE_11_REGENERATION_USER_INSTRUCTIONS.md`
15. `15_PHASE_12_PROMPT_BUDGET_AND_FALLBACKS.md`
16. `16_PHASE_13_ADMIN_OBSERVABILITY.md`
17. `17_PHASE_14_MIGRATION_FEATURE_FLAGS_ROLLBACK.md`
18. `18_PHASE_15_TESTING_EVALUATION.md`
19. `19_PHASE_16_ROLLOUT.md`
20. `20_ACCEPTANCE_CHECKLIST.md`
21. `21_COMMIT_PLAN.md`
22. `22_HANDOVER_REPORT_TEMPLATE.md`

The `examples/` directory contains a worked scene JSON and expected compiled output. These examples are illustrative. The coder must adapt them to the actual Kissago architecture rather than copying them blindly.

## Required Working Style

- Investigate first.
- Do not assume file names, frameworks, providers, limits or database structures.
- Ground every decision in the current codebase.
- Preserve all working behaviour unless an intentional change is documented.
- Ask clarifying questions only after investigation reveals a material ambiguity that cannot be safely resolved from the codebase.
- Prefer small, testable phases and meaningful commits.
- Add feature flags and rollback paths.
- Report discovered constraints honestly.
- Be creative where model-specific prompting, reference conditioning or composition can be improved.

## Definition of Success

The feature is successful when the new path produces materially shorter, clearer prompts without losing visual requirements, and equals or improves the old path on:

- Character identity
- Character count correctness
- Clothing consistency
- Scene continuity
- Panel order and layout
- Object/action correctness
- Reference-image adherence
- User regeneration instruction adherence
- Failure rate caused by prompt length
- Provider-specific reliability
