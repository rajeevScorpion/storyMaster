# Phase 00 — Investigate the Existing Image Pipeline

Do not implement the new architecture yet.

## Trace the Complete Flow

Trace from the user's action to the final provider request and stored image:

- Story creation
- Beat generation
- Panel planning
- Character extraction and naming
- Character reference generation/upload/storage
- World reference processing
- Style selection
- Prompt-template assembly
- Model/provider selection
- Queue or background job creation
- Image API request
- Retry/fallback behaviour
- Response handling
- Image storage and derivatives
- Coin deduction or refund
- Regeneration
- Overall and per-panel image-change instructions
- Episodic continuation
- Backward beat editing
- Admin configuration

## Find All Prompt Mutation Points

Locate every function, hook, service, queue consumer, API route or database template that creates, appends, rewrites or truncates image prompts.

For each, document:

- Input type
- Output type
- Caller
- Provider/model affected
- Whether it is shared or provider-specific
- Whether it adds duplicated information
- Whether user text enters unsafely
- Whether the final prompt is logged

## Collect Real Samples

Collect representative final prompts from development data or safe fixtures for:

- One-panel image
- Four-panel storyboard
- Story with no named character
- One named character
- Multiple named characters
- Character reference portrait
- Uploaded character reference
- World reference
- Regeneration with overall instruction
- Regeneration with per-panel instructions
- Different image providers/models

Do not expose private user data in the report. Redact or use fixtures.

## Quantify Prompt Bloat

For each sample, calculate:

- Character count
- Estimated tokens if available
- Repeated phrases
- Repeated visual concepts
- Internal/non-visual metadata included
- Number of times each character is described
- Number of times layout rules are repeated
- Number of negative constraints repeated

Classify fields as:

- Critical visual
- Important visual
- Optional visual
- Structural
- Internal only
- Redundant

## Provider Audit

For every enabled image model/provider, determine from code/configuration and current official provider docs already used by the project:

- Prompt length limit
- Negative prompt support
- Reference image support
- Number of reference images
- Image-role mapping capability
- Edit/mask support
- Seed support
- Prompt weighting support
- Aspect-ratio support
- Multi-panel reliability
- Request cost fields
- Error format

Do not hardcode undocumented assumptions.

## Deliverable

Create an investigation report containing:

1. Current architecture map
2. Relevant files and functions
3. Current data model
4. Provider matrix
5. Prompt samples and measurements
6. Duplication analysis
7. Risks
8. Safe integration points
9. Recommended phased plan
10. Clarifying questions, only if genuine blockers remain

No production behaviour should change in this phase.
