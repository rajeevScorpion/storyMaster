# Phase 14 — Migration, Feature Flags and Rollback

Introduce the new system without disrupting existing stories or generation jobs.

## Feature Modes

Use names appropriate to the codebase, conceptually:

- `legacy`: existing prompt generation only
- `shadow`: generate the new compiled prompt for comparison, but send the legacy request
- `new`: send the new provider-adapted request
- `new_with_legacy_fallback`: use new path, then legacy on eligible failure

## Rollout Controls

Support rollout by:

- Environment
- Model/provider
- Admin setting
- User tier if justified
- Percentage cohort
- Story/beat fixture or internal account

## Migration

- Add schema version fields safely.
- Convert legacy scenes at read/compile time where possible before bulk migration.
- Avoid rewriting every historical story unless necessary.
- Preserve old generation records.
- Ensure active queued jobs use a stable compiler/adapter version.

## Rollback

Rollback must be possible without data loss.

Document:

- How to disable the new compiler
- How to return to legacy request building
- How new scene JSON remains readable
- How to handle jobs created under a newer version
- Database migration rollback limitations
- Cache invalidation

## Coin and Job Integrity

Verify:

- One user action creates one billable generation intent.
- Shadow mode never calls a paid image API twice.
- Fallback does not deduct coins twice.
- Retry and cancellation remain correct.

## Deliverables

- Feature flags
- Cohort selection
- Migration path
- Rollback runbook
- Job-version compatibility tests
- Coin integrity tests
