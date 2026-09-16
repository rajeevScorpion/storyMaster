# Model Routing, Cost Control and Capability Permissions

## Goal
Use strong models where creativity/reasoning matters and economical models for lightweight classification/matching. Do not hardcode model names into persona logic.

## Task-role routing
Conceptual roles:

### Economy
Metadata extraction, normalization, classification, summarization, similarity support, lightweight redundancy checks, validation and tagging.

### Standard
Story planning, evaluator reasoning, moderate editorial analysis, supervisor assignment decisions.

### Creative
Story ideation, full story writing, major creative rewrite and high-value narrative transformation.

These are capability roles, not mandatory enum names.

## Admin-configurable mapping
Preferred precedence:
`Global task-role policy -> optional task override -> optional persona override`

Most personas should inherit global routing. Admin should be able to map roles to currently supported models/providers without code changes, using existing provider abstractions.

## Fallbacks
Use repository-appropriate fallbacks for provider failure, unavailable model, timeout/rate limit and structured-output failure. Do not silently escalate cost/quality tier without telemetry.

## Cost controls
Where feasible track model, task role, token/usage data, estimated/actual cost, narration/image usage, run totals, persona totals and daily totals. Do not block V1 on perfect accounting if providers lack reliable pricing metadata.

## Capability permissions
- Image: per persona/admin, default OFF.
- Narration: independent toggle.
- Advanced Settings: admin controls defaults and what persona may change.
- Publish: agents cannot bypass human approval in V1.

## Cost-safe test mode
Persona sandbox should support text-only, no-image, optional narration and no-publication operation.
