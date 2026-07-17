# Master Implementation Prompt

You are implementing **Reference Personalization** in the existing Kissago codebase.

Your first responsibility is to understand the current system. Do not assume the framework, database, ORM, authentication, storage provider, queue, image-provider SDK, admin architecture, tier implementation, coin system, story schema, continuity schema, character-reference implementation, image-composer prompt format, or deployment topology.

## Product objective

Allow users to upload character and world reference images and have Kissago adopt them into the story's selected visual style while retaining identity and world continuity.

### Initial user capabilities

At the beginning of story creation:

- Upload character reference images.
- Optionally name each character.
- Upload world reference images.
- Optionally label each world.
- See eligibility, limits, expected coin cost and processing state before starting generation.
- Remove or replace a reference before story generation begins.

Later, in a separate phase:

- Attach a new character or world reference while creating a custom story option.
- Introduce that reference only from that branch point onward.

### Limits

- Platform ceiling for this implementation: 3 character references and 3 world references per story.
- Default Free entitlement: 2 character references and 1 world reference.
- Every tier limit must be configurable by an admin.
- Do not hard-code paid-tier limits into business logic.

### Character adoption

When the user uploads and optionally names a character, for example `Leo`:

1. Preserve the original private upload.
2. Validate that it has one clear primary subject.
3. Extract stable identity characteristics.
4. Separate identity traits from temporary clothing and background.
5. Apply the selected story visual style.
6. Generate and store a canonical story-specific reference using the current character-reference mechanism wherever practical.
7. Store a structured description and continuity anchors.
8. Add the adopted character to the Story Bible.
9. Route the canonical adopted reference and description only to beats where the character is relevant.

### World adoption

When the user uploads a world reference:

1. Preserve the original private upload.
2. Extract a concise structured World DNA description.
3. Identify architecture, geography, spatial layout, materials, lighting, atmosphere, distinctive objects and continuity anchors.
4. Remove irrelevant UI, watermark and photographic artefacts from the description.
5. Optionally generate one story-styled canonical world visualization when enabled and entitled.
6. Store the structured description and canonical visualization.
7. Add the world to the Story Bible.
8. Route it only to beats set in that world.

### Style rule

The selected story visual style is the source of truth. A realistic photograph uploaded into a pastel storybook story must become a pastel storybook interpretation. The upload supplies identity or world information, not a second rendering style.

### Stateful and stateless providers

Build provider-neutral behaviour.

- For providers that support persistent reference handles, send the adopted reference once where possible and store the returned provider handle.
- Continue to include concise structured descriptions as continuity reinforcement.
- For stateless providers, resend only relevant canonical adopted references.
- Never depend on provider memory as the sole source of continuity.
- Kissago's own Story Bible, structured descriptions, canonical references and usage records remain the durable source of truth.
- Provider handles may expire and must have a safe resend fallback.

## Required engineering behaviour

### Investigate first

Before changing code:

1. Create a new branch.
2. Map the existing story-creation flow.
3. Locate the current character extraction/reference generation flow.
4. Locate Story Bible, journal, continuity and episodic structures.
5. Locate custom-option creation and downstream branching.
6. Locate image-provider abstraction and prompt compiler.
7. Locate storage and image-processing paths, including current client/server mode toggles.
8. Locate tier, subscription, entitlement and coin-cost logic.
9. Locate global admin settings and feature-flag patterns.
10. Locate background jobs, retry, idempotency and notification behaviour.
11. Locate tests and deployment conventions.
12. Produce a discovery report before implementation.

Do not create parallel replacements for capabilities that already exist. Extend current abstractions wherever this can be done safely.

### Preserve working behaviour

- Do not break stories without references.
- Do not break existing generated characters.
- Do not alter existing story visuals unless a story uses this feature.
- Do not change current video export.
- Do not change publishing/private-story behaviour except where reference privacy requires enforcement.
- Do not remove the legacy client-side image-processing mode.
- Respect the existing admin-controlled image-processing mode.
- Preserve Cloudflare/storage abstractions already in use.
- Keep current stories readable even when the feature is disabled later.
- Feature toggles should normally affect new jobs, not corrupt in-progress or existing stories.

### Implementation discipline

- Work in meaningful, independently testable phases.
- Commit after every meaningful completed phase.
- Use clear progressive commit messages.
- Prefer additive migrations and backwards-compatible API changes.
- Add observability before broad rollout.
- Use idempotency for upload processing and adoption jobs.
- Do not charge coins twice for retries.
- Refund or release reserved coins when an adoption job fails permanently.
- Ask targeted questions only after investigation when a material ambiguity cannot be resolved from code, tests, configuration or established Kissago behaviour.
- Do not ask broad questions that the codebase can answer.

## Required deliverables before coding

Return:

1. Current-system map
2. Reusable existing components
3. Gaps
4. Proposed schema changes
5. Proposed API changes
6. Proposed UI changes
7. Provider capability matrix
8. Tier and coin integration plan
9. Rollback plan
10. Phase plan with files/modules likely to change
11. Material questions, if any

Wait for no speculative redesign. Recommend the smallest architecture that meets these requirements and fits the codebase.

After discovery, execute the phases in `22_PHASED_EXECUTION_PROMPTS.md`.
