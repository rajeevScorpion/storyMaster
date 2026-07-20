# Phase 06 — Model Capability Registry

Extend or create the model registry so prompt compilation is driven by actual model capabilities rather than scattered conditionals.

## Capability Fields

Investigate and represent only fields relevant to enabled providers, such as:

- Provider
- Model identifier
- Adapter version
- Maximum prompt characters/tokens
- Recommended prompt range
- Negative prompt support
- Separate system/instruction field support
- Reference image support
- Maximum references
- Reference role/name mapping
- Image edit support
- Mask support
- Seed support
- Prompt weighting support
- Aspect-ratio support
- Native storyboard/layout strength
- Multi-image conditioning
- Provider-specific safety limitations
- Fallback model
- Enabled tiers
- Coin cost configuration

## Admin Integration

Reuse the existing admin model-management system if present.

Allow administrators to control at least:

- Compiler enabled/disabled per model
- Adapter version
- Prompt budget
- Negative prompt handling
- Reference image strategy
- Legacy fallback
- Shadow logging/sample percentage

Do not expose unsafe low-level settings to ordinary users.

## Versioning

A generation record should identify:

- Scene schema version
- Compiler version
- Adapter version
- Model registry version/config snapshot where practical

This supports reproducibility and debugging.

## Deliverables

- Capability type/schema
- Registry integration
- Admin defaults
- Validation
- Tests
- Documentation for adding a new provider
