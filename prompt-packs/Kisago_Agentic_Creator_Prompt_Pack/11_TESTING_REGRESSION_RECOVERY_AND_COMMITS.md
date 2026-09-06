# Testing, Regression Control, Recovery and Commits

## Principle
The Agentic Creator System must be able to fail or be disabled without breaking normal Kisago.

## Baseline before implementation
Record current build/test status, known pre-existing failures and critical user journeys. Do not misattribute pre-existing failures.

## Critical existing regression journeys
Map to actual tests/manual checks: auth/sign-in, normal story creation, Seed Story, Prompt Story if supported, Advanced Settings, voice/narration, image generation, save/edit, publishing, series/episode continuation, consumption/playback, admin auth and current admin flows.

With the new feature disabled, all must behave as before.

## New feature tests
### Persona
Seed exactly 15; rerun safe; create/clone/edit/pause/archive/filter; automatic memory; image OFF default.

### Memory
Global retrieval; persona isolation; repeated title/name/premise warnings; legitimate series continuity.

### Supervisor
Creates tasks, avoids unavailable persona, respects age/language, avoids obvious saturation/repetition.

### Orchestrator
Schedule/retry/cancel/resume/idempotency; no duplicate expensive calls.

### Model routing
Economy/Standard/Creative mapping, fallbacks, override hierarchy, no hardcoded model dependency in personas.

### Review
Unauthorized access blocked; assigned reviewer can review/edit/approve/reject; publication gate enforced.

### Media
Image OFF means no image call; narration independent; forced alignment uses existing path; retries don't duplicate.

## Migration safety
Prefer additive migrations. For each migration document forward behavior and rollback limitations, test with representative existing data, avoid synchronous rewrite of all rows unless necessary. Backfills should be resumable, idempotent, observable and pausable.

## Meaningful commits
Use repository naming convention, but good boundaries include audit/docs, admin scaffolding, persona library, memory/novelty, supervisor task pool, recoverable execution, Seed Story vertical slice, review workflow, provenance/labels and hardening.

Avoid mixing unrelated cleanup, mass formatting or dependency upgrades with feature work unless required and documented.

## Recovery
At every phase know how to disable the feature, what persistent data was added, migration rollback limitations, how to resume incomplete jobs, stop schedules and avoid duplicate paid calls. Do not rely on Git rollback alone for database/state recovery.
