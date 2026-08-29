# 02 — Codebase Discovery First

Before implementation, inspect the real Kissago codebase and document actual integration points.

## Required discovery checklist

### Current story and character architecture

Find:

- story creation entry point
- beat generation flow
- named-character extraction/definition flow
- character prompt/reference generation flow
- story continuation flow, if present
- Pack 1 custom option / `@name` parsing flow, if already present
- any current concept of series, episodes, collections, or projects

### Current storage

Find:

- story table/collection
- beat table/collection
- existing character-related table/collection
- where character reference images/assets are stored
- where user-level reusable assets/settings are stored
- whether there is already a journal, metadata, or timeline event structure
- any queue/background job layer

### Current UI

Find:

- story viewer and story dashboard
- place where named characters are displayed today
- settings / advanced settings UI patterns
- any existing asset library or picker pattern
- admin settings UI

### Current technical risks

Document:

- which files are central and fragile
- what depends on story data structure
- what depends on character data structure
- whether export/book/reel/sharing features will be affected
- which changes must be behind toggles

## Discovery report format

Create a report before implementation:

```md
# Kissago Pack 2 Discovery Report

## Current story architecture
...

## Current named-character architecture
...

## Current storage model
...

## Existing admin/feature flag system
...

## Proposed safest integration points
...

## Risks and mitigation
...

## Open questions that block implementation
...
```

If a detail is unclear, do not guess. Trace the code path or ask a focused question.
