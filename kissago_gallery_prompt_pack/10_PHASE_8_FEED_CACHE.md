# 10 — Phase 8: Profile-Scoped Server-Side Gallery Feed Cache

## Objective
Replace or reduce expensive per-request random/freshness computation with a scalable cached feed strategy while preserving freshness and personalization.

## Do not start here
This phase must be driven by measurements from the current implementation and should happen after the Storyline feed contract is stable.

## First measure
Using the codebase and available observability, determine:
- current feed query latency
- database calls
- random/order strategy
- payload size
- cache hit opportunities
- how frequently Storylines are published/updated
- how much viewer history exists

Do not introduce Redis or another external cache purely by assumption. Use existing infrastructure if appropriate.

## Desired conceptual model
A feed should be resolvable for an active viewer profile using inputs such as:
- age eligibility
- publication/visibility/moderation eligibility
- recent viewing history
- recently shown items
- Favorites/preferences if appropriate
- freshness/newness
- controlled randomness/diversity

The result should be cached server-side for a bounded period or until meaningful invalidation.

## Key design principle
Do not cache sensitive user data into a globally shared key. Cache scope must include the appropriate user/profile identity and relevant audience context.

## Strategy options to evaluate against the repo
Choose only after inspecting infrastructure:
- application/server memory cache for single-instance/dev only
- framework data cache
- database-backed precomputed feed table
- Supabase/Postgres function + materialized/precomputed candidate pools
- existing Redis/KV if already available

## Recommended separation
Separate:
1. **candidate pool generation** — eligible Storylines by age/genre/publication
2. **profile ranking/rotation** — history-aware ordering
3. **cached response** — bounded Storyline IDs + lightweight metadata or IDs resolved through a batch query

This avoids recomputing every expensive rule on every request.

## Freshness
Preserve discovery freshness through one or more of:
- TTL
- explicit invalidation after meaningful user activity
- rotating buckets/seeds
- recently-served exclusion
- refresh after publication events

Avoid `ORDER BY RANDOM()`-style full-table work at scale if current code uses an equivalent expensive operation.

## Graceful fallback
If cache is empty/unavailable:
- serve from the trusted base query
- do not break Gallery
- optionally populate cache opportunistically using existing request-safe patterns

Do not create blocking background promises from request handlers unless the platform/runtime supports them correctly.

## Instrumentation
Measure before/after:
- p50/p95 feed latency if tooling exists
- DB query count
- cache hit rate
- payload size
- repeat-item rate over a reasonable sample

## Acceptance criteria
- user/profile isolation is correct
- Kids eligibility is applied before ranking/caching
- cache failure does not take Gallery down
- feed remains fresh enough to avoid obvious repetition
- no per-card N+1 queries introduced
- measurable read-path improvement or a documented reason the change is not yet justified

## Commit strategy
Caching architecture may require multiple commits:
1. instrumentation/feed contract
2. cache implementation
3. invalidation/history integration
Do not hide all of this inside one opaque commit.
