# STARTER PROMPT — COPY THIS FIRST INTO THE AI CODER

You are working on the Kissago codebase.

We need to move Kissago’s image generation away from single-model dependency. The current system appears to depend only on Gemini API for image generation. The requested feature is a multi-model image generation architecture where admins can configure and enable image models, and users can choose an allowed image model while creating stories/reels.

## Important: do not start coding yet

First, investigate the existing codebase and integration possibilities. Do not assume anything.

You must first understand:
- how the current Gemini image generation is implemented
- how story/reel generation works
- how prompts are created
- how images are stored
- how failures/retries are handled
- how the coin system works
- how admin panel settings are structured
- how user tiers/plans are represented
- how story/reel creation UI is implemented
- whether the project already has queues/workers
- whether the project already has provider/config abstractions
- how secrets/API keys are managed
- what tests exist

## Feature objective

Build a model-agnostic image generation architecture for Kissago.

Initial target providers:
- existing Gemini provider
- OpenAI image provider, initially intended for GPT Image 2 or the currently recommended OpenAI image model after checking official docs
- xAI/Grok image provider, initially intended for Grok Imagine or the currently recommended xAI image model after checking official docs

Do not hardcode assumptions about exact model IDs or API payloads without verifying official docs and the existing app architecture.

## Non-negotiable rules

1. Nothing already working should break.
2. Existing Gemini flow must continue working.
3. Work in meaningful feature phases.
4. Commit after every meaningful phase.
5. Ask clarifying questions only after codebase investigation, unless blocked immediately.
6. Make practical recommendations after investigation.
7. Think through edge cases before implementation.
8. Suggest the safest workaround where full implementation is risky.
9. Coin cost must work realistically with the existing coin system.
10. Users must see coin cost before choosing/generating with a model.
11. Admin panel must allow easy inclusion/exclusion of models tier-wise.
12. Character and scene reference upload is not implemented yet, but the architecture must keep this future scope in mind.
13. Preserve character, visual style, and scene consistency per story as a core design principle.

## Expected first response from you

Before writing code, produce an investigation report with:

### 1. Current architecture map
Explain the current flow:
User story/reel creation → prompt generation → image generation → image storage → beat/story output → coin deduction.

### 2. Existing files/modules involved
List actual files/modules discovered in the codebase.

### 3. Integration feasibility
Explain whether the app can safely support:
- provider abstraction
- admin model registry
- tier-wise model visibility
- per-model coin pricing
- user model selection
- OpenAI image provider
- xAI/Grok provider
- future reference-image support

### 4. Risks
List concrete risks found in the existing codebase.

### 5. Clarifying questions
Ask only the questions needed to proceed safely. Avoid generic questions. Questions must be based on what you discovered.

### 6. Recommended phased plan
Propose a practical phase-by-phase plan with commits.

After I approve the plan, implement phase by phase.

## Product logic direction

Prefer story-level model selection by default.

Reason: changing image models beat-by-beat can damage character consistency, visual style, lighting, and environment continuity.

Per-beat model override should be treated as advanced/admin/future scope unless the existing product already supports a safe override pattern.

## Coin-cost expectation

The system must show model cost clearly to the user before generation.

The cost system should support:
- model-wise coin cost
- tier-wise availability
- estimated cost before generation
- safe deduction
- refund/reversal or no-charge behavior on provider failure
- logs/audit trail for generation and coin events

## Admin expectation

Admin should be able to:
- enable or disable models
- hide/show models to users
- assign models to tiers/plans
- configure coin cost per model
- mark model as default/recommended/premium/experimental
- include future models without code changes where practical
- prevent misconfigured models from appearing to users

## Consistency expectation

Even before reference upload is implemented, prepare the architecture for:
- story visual bible / visual profile
- selected image model per story
- shared style prompt
- character identity notes
- scene/environment invariants
- future character reference uploads
- future scene reference uploads
- provider capability flags for reference support

Start by investigating. Do not code yet.

