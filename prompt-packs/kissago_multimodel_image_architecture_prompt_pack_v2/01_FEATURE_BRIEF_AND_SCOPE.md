# Feature Brief and Scope

## Feature name
Kissago Multi-Model Image Generation Architecture

## Why this feature matters
Kissago should not depend on a single image model/provider. The current dependency on Gemini creates product, quality, pricing, and availability risks.

The product should allow admins to configure image models and allow users to select an available model while creating stories/reels.

## Immediate goals
1. Preserve current Gemini image generation.
2. Introduce provider-based architecture.
3. Add model registry/configuration.
4. Add admin tier-wise model inclusion/exclusion.
5. Add user-side model selection at story/reel creation.
6. Add visible coin-cost estimation before model selection/generation.
7. Add OpenAI image provider after verifying current official API details.
8. Add xAI/Grok image provider after verifying current official API details.
9. Create architecture foundation for consistency and future reference uploads.

## Out of current implementation scope
These should not be fully implemented unless the codebase already supports them:
- character reference upload UI
- scene reference upload UI
- full visual consistency scoring
- automatic face/character verification
- per-beat model switching for regular users
- provider marketplace
- live provider-cost sync

## Future-scoped but architecturally important
Keep the architecture ready for:
- uploaded character reference images
- uploaded scene reference images
- generated character sheets as story-level references
- visual bible per story
- model capability matrix
- batch generation
- edit/regenerate workflows
- provider-specific prompt optimization
- consistency evaluation using a vision model

## Strong product recommendation
Use story-level model selection as default.

A story/reel should remember the chosen image model and use it consistently across generated assets unless the user/admin intentionally changes it.

This is necessary because character, visual style, and scene consistency are central to Kissago.

