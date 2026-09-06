# Data, State and Integration Guardrails

This defines boundaries, not a mandatory schema.

## Do not invent a parallel product model
Agent-generated stories should become normal Kisago projects/stories. Temporary objects are fine for tasks, jobs, run state, evaluation, memory metadata and reviewer assignment.

## Prefer additive data changes
Prefer new isolated tables/collections, nullable references, status metadata and audit/event data. Avoid unrelated core renames, broad normalization and destructive migrations.

## Feature isolation
Use repository-native mechanisms for concepts such as global agentic enablement, admin access, per-persona activation, scheduler enablement and reviewer workflow activation.

With the feature OFF: no scheduled agent jobs, no supervisor commissioning, no agent media calls, and no behavior change to normal creation/publishing.

## Durable state
Use existing workflow patterns. Need enough durable state for recovery but do not add unnecessary enum complexity.

## Idempotency
Protect story generation, TTS, image generation and publication from duplicate execution on retry.

## Series continuity
Store or derive durable relationships between series, episode, persona and locked production settings. Do not copy arbitrary prior runtime payloads as continuity state.

## Memory implementation
Choose the simplest architecture that satisfies semantic recall. Evaluate existing SQL/full-text/embedding/vector/application retrieval capabilities before adding new infrastructure, and document tradeoffs.

## Security
Agent jobs must use bounded services/permissions rather than broad admin capabilities. Reviewer/admin actions follow current auth boundaries. Do not expose secrets, provider credentials, private admin data or hidden persona prompts publicly.

## Prompt storage
Persona prompts are admin-editable data. Use validation, reasonable limits and existing version/audit patterns where practical; do not expose them in public story payloads.

## Observability
Be able to diagnose run, stage, persona/task, model role/model, error category, retry count and already-completed expensive operations. Avoid logging secrets or unnecessary sensitive full prompts.
