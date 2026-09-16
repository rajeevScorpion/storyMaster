# Memory, Editorial Supervisor and Orchestration

This system must be stateful.

## Global Kisago Story Memory
Maintain or derive semantic understanding of previously created content including: story/project ID, title, short summary, language, age group, genre, themes, learning value/takeaway where relevant, plot/premise, key plot structure, major character names, setting, series/episode relationship, recurring-character identifiers if available, persona/creator, publication state, and a semantic representation suitable for similarity search if supported.

Do not add a new vector database blindly if the current stack can satisfy the requirement more simply.

## Persona Memory
Every seeded, cloned or newly created persona automatically gets memory. It should help remember recent stories/titles/characters/themes, recurring plot patterns, series ownership, settings/voice habits where relevant, and useful reviewer feedback. Memory should reduce self-repetition without erasing creative identity.

## Novelty/redundancy checks
Run at least twice:

### Before writing
Compare concept/brief against global story memory and persona memory.

### After writing
Compare generated summary/metadata against prior/recent/persona stories and title/name collisions.

Check title similarity, plot/premise similarity, character-name overuse, setting repetition, theme saturation and near-duplicate arcs. Avoid exact-string-only checks. Use economical models/embeddings/deterministic matching where appropriate.

If similarity exceeds configured tolerance, revise, regenerate, or route to human review with visible warning according to severity/configuration. Keep reasons auditable.

## Editorial Supervisor / Content Manager Agent
Keep editorial intelligence conceptually separate from execution orchestration.

The Supervisor understands catalogue coverage, age/language/genre/value balance, persona specialities and availability, recent workload, episodic continuity and repetition risk.

V1 flow:
1. inspect catalogue/memory,
2. detect content gap/editorial opportunity,
3. create story task/commission,
4. choose suitable available persona,
5. attach concise constraints/brief,
6. send task to execution pipeline.

Support both direct persona schedules and supervisor-generated assignments. Do not build likes/views/consumption-driven commissioning in V1.

## Execution Orchestrator
Own operational execution: jobs, schedules, state machine, bounded service calls, idempotency, retries, timeout/failure handling, model routing, generation permissions, usage/cost telemetry, run logs and handoff into evaluation/review.

## Recoverability
Persist enough state to distinguish logical stages such as commissioned, brief ready, novelty checked, story generated, project created, narration requested/completed, evaluation complete, review pending, revision requested, media pending/completed, approved/published, failed/cancelled. Use repository-native patterns and do not add needless states.

Retries must not duplicate stories or paid generations.

## Episodic continuity
Memory must understand series/episodes. Preserve recurring characters and locked production settings when intended, and distinguish legitimate continuity from unwanted redundancy.
