# Phase 0 — Repository Audit and Route Feasibility

## Objective
Understand how Kisago currently works and confirm whether the proposed modular admin routes can be introduced safely.

**Do not implement the feature in this phase.**

## Inspect and document

### A. Admin architecture
Find current admin routes, route conventions, shared layout/navigation, authorization/guards, role checks, server/client boundaries, admin API conventions, and how new admin modules are registered.

### B. User/auth/role model
Find current user model, role/permission representation, whether users can have multiple roles, whether staff/editor/reviewer concepts already exist, role-change audit behavior, and safest way to add reviewer/expert-author capability.

### C. Story creation architecture
Trace the human story flow end-to-end: project/story creation, Seed Story, Prompt Story if present, advanced settings, beat count, strict/no-adaptation equivalent, voice selection, narration/TTS, forced alignment, image generation, overlay text, animation/time-remapping/post-production, save/draft/publish, episodic continuation, series continuity, evaluation/moderation.

Identify the underlying services/domain functions used by the UI.

### D. Background execution
Find jobs, queues, cron, schedules, workers, retries, idempotency, locks, run history and task status patterns.

### E. AI/model abstraction
Find model providers, model selection/config, prompt organization, structured output conventions, tracing/token/cost telemetry and fallbacks.

### F. Persistence/search/memory capabilities
Find database technology, full-text/semantic/vector support, existing memory abstractions, story summaries/tags/metadata, and reusable model-derived metadata patterns.

### G. Publishing/discovery
Find story lifecycle, provenance/author fields, labels/badges, moderation gates, publication APIs, story cards/detail views, feeds/filters.

### H. Tests/deployment
Find unit/integration/e2e setup, CI checks, migrations, env/config conventions, logging/observability and feature-flag mechanisms.

## Required feasibility report

### 1. Current architecture map
List concrete files/modules/routes/services responsible for the areas above.

### 2. Route proposal evaluation
Evaluate `/admin/agents` and `/admin/authors` against the actual router/admin/auth architecture. For each state recommended implementation shape, reuse opportunities, auth implications, navigation implications and regression risks. If repository conventions suggest a better equivalent, propose it explicitly.

### 3. Service reuse map
Identify existing services suitable for programmatic reuse. Desired principle:
`Human UI -> existing domain service`
`Agentic system -> same existing domain service`

### 4. Risk register
Rank schema, auth, scheduler, story-generation, publication, cost, concurrency and regression risks as high/medium/low.

### 5. Isolation strategy
Explain how all new functionality can be disabled while normal Kisago remains unchanged.

### 6. Migration strategy
State what can be additive tables/collections, nullable fields, isolated feature data or non-destructive role extensions. Flag any broad/destructive changes.

### 7. High-level implementation sequence
Only a grounded high-level sequence. Do not write code.

### 8. Open issues
Only include issues genuinely unresolved after repository inspection.

## STOP CONDITION
After producing the report, update working memory and stop. Do not implement, migrate or refactor until the operator approves the architecture/module plan.
