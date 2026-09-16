# Documentation and Working Memory

## Goal
The work may span multiple coding sessions/models. Documentation must allow safe resumption without reconstructing context from chat.

Reuse existing repository documentation conventions. If none exist, maintain a scoped location such as `docs/agentic-creator/`.

## Living documents
### WORKING_MEMORY.md
Keep short/current: current phase, branch/commit, what works, next step, blockers, important files, active flags, migrations applied, known test state.

### DECISIONS.md
Record important decisions with codebase evidence, alternatives, reason and consequences. Include route split, memory architecture, scheduler choice, role model and model routing.

### IMPLEMENTATION_LOG.md
Record completed work by phase, affected modules, migration/config impact, tests and commit.

### ARCHITECTURE.md
Maintain actual implemented architecture: module boundaries, services, state flow, data relationships, routes, jobs, memory, Supervisor/Orchestrator distinction and human review.

### TEST_STATUS.md
Track baseline, tests run, new tests, pre-existing failures, current failures and manual checks.

## Session discipline
At start: read working memory, inspect Git status/recent relevant commits, confirm phase, avoid overwriting uncommitted work.
At end: update working memory and implementation/test docs, commit if meaningful/stable, leave explicit next step.

## No private chain-of-thought storage
Store concise rationale, evidence, decisions and outcomes only; never raw/private chain-of-thought.
