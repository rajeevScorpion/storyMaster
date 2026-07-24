# Phase 07 — Provider and Model Adapters

Implement provider/model-specific adapters that consume the compiled intermediate prompt and build the final API request.

## Adapter Responsibilities

- Reorder prompt sections where beneficial
- Choose prose versus structured headings
- Move negatives into a separate field if supported
- Attach reference images using native mechanisms
- Map each reference to the correct character/world role
- Enforce provider prompt limits
- Apply aspect ratio and output settings
- Use edit/mask/composition controls where supported
- Preserve cost and retry behaviour
- Return provider-specific diagnostics

## Do Not

- Rebuild the canonical scene inside each adapter
- Repeat all character descriptions per panel
- Hide provider limits in arbitrary string utilities
- Silently drop critical instructions
- Couple provider adapters directly to UI components

## Model-Specific Creativity

Investigate the real behaviour of each enabled model. The coder is encouraged to improve prompts beyond the generic structure.

Potential strategies include:

- Concise prose for models that respond better to natural language
- Labelled sections for instruction-following models
- Dedicated negative prompt for diffusion-style models
- Layout-control reference image for weak multi-panel models
- Native image-edit mode for regeneration
- Multiple character reference images with explicit role mapping
- A provider-specific identity lock phrase
- Reduced descriptive text when reference images are strong
- More explicit spatial language for models prone to cloning

Document why each adapter differs.

## Fallbacks

When a model lacks a capability:

- Use the best text-only fallback.
- Warn in diagnostics.
- Do not claim strict consistency if the model cannot reasonably provide it.
- Consider model eligibility restrictions for advanced storyboard features.

## Tests

- Request snapshots per provider
- Limit enforcement
- Reference ordering
- Negative prompt routing
- Missing capability fallback
- Error mapping
- No double charging on fallback
