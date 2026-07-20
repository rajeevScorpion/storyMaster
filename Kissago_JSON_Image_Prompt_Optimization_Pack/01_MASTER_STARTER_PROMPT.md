# Master Starter Prompt for the AI Coder

You are implementing a production feature for **Kissago**, a beat-based visual story platform that generates single images and multi-panel storyboard images using multiple image models/providers.

Your task is to build a **JSON-based image prompt optimisation and consistency engine**.

## Primary Goal

Replace the current repetitive prompt-construction approach with:

- A canonical internal scene JSON
- Runtime validation and schema versioning
- A visual relevance filter
- Semantic deduplication
- A deterministic provider-neutral prompt compiler
- Provider/model-specific adapters
- Prompt budgeting and graceful compression
- Stronger character, clothing, scene and panel continuity
- Observability, comparison and rollback tooling

The goal is not just shorter prompts. The goal is better image-generation quality, consistency and reliability.

## Creative Freedom

You are allowed and expected to improve the design beyond the suggestions in this pack when the codebase or model capabilities support a better solution.

Examples of acceptable improvements include:

- Model-specific reference-image strategies
- Better ordering of prompt sections
- Structured prompt blocks where a provider benefits from them
- Separate negative prompts where supported
- Composition references or layout-control images
- Provider-native masks, edit APIs or multi-image conditioning
- Character identity summaries generated from canonical reference records
- Rule-based scene continuity normalisation
- Prompt scoring and automatic compression
- A two-pass compile process
- Provider capability negotiation
- Better consistency evaluation

Do not add complexity without a demonstrated benefit. Explain important deviations from this pack.

## Mandatory Constraints

1. Investigate the current pipeline before changing it.
2. Do not assume technology, naming, model limits or existing schemas.
3. Keep JSON as the canonical internal representation.
4. TOON is out of scope.
5. Do not send raw internal JSON directly as the default image-model prompt.
6. Preserve the legacy prompt path behind a feature flag until the new path is proven.
7. Do not break existing story creation, beat generation, image regeneration, custom instructions, reference images, coin handling, storage or model selection.
8. Avoid mandatory LLM calls merely to compress every image prompt unless evidence justifies them.
9. Prefer deterministic compilation for reliability, latency and cost.
10. Use native provider reference-image mechanisms wherever supported.
11. Never silently discard a critical visual requirement to meet a prompt budget.
12. Add tests, metrics, logging and rollback support.
13. Commit in meaningful phases.
14. Do not expose raw sensitive or internal identifiers in prompts or user-facing logs.

## Execution Protocol

- Read `02_NON_NEGOTIABLE_RULES.md`.
- Execute the phase files in order.
- At the end of each phase, provide:
  - What was discovered or implemented
  - Files changed
  - Tests run and results
  - Risks or unresolved issues
  - The next recommended step
- Stop and ask a focused question only when a genuine blocker remains after codebase investigation.
- Do not ask generic questions that the repository can answer.

Begin with `03_PHASE_00_INVESTIGATION.md`.
