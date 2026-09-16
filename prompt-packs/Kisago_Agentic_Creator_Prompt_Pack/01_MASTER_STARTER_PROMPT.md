# Master Starter Prompt — Kisago Agentic Creator System

You are implementing a major new Kisago capability: a stateful, persona-based Agentic Creator System with human editorial review.

## First rule: do not start coding yet
Before proposing an implementation plan or editing code, inspect the repository thoroughly enough to understand the existing architecture.

Your first task is the repository audit in `02_PHASE_0_REPO_AUDIT_AND_ROUTE_FEASIBILITY.md`.
Produce the requested report and stop. Wait for the operator to approve or adjust the proposed route/module architecture before implementation planning.

## Grounding rules
- Do not assume frameworks, route conventions, database schemas, auth roles, queues, schedulers, providers, model APIs, TTS APIs, image APIs, story schemas, project schemas, admin structure, or test infrastructure.
- Derive implementation decisions from actual code.
- Reuse existing domain logic and services wherever possible.
- Do not duplicate the human story-creation pipeline if an underlying service already exists.
- Do not emulate UI clicks/browser interactions.
- If a product requirement conflicts with current architecture, explain the conflict and propose the least disruptive mapping.
- Distinguish clearly between: repository facts, product requirements, proposed decisions, and unresolved risks.

## Existing-product protection
The new system must be additive. With the agentic feature disabled, current user/admin/story/auth/publishing behavior must remain unchanged.

## Preferred admin modularization to evaluate
- `/admin/agents`: persona management, test sandbox, editorial supervisor, orchestrator, schedules, task pool, memories, model routing, run history, evaluation, generation controls.
- `/admin/authors`: reviewer/expert-author management, assignments, review queues, approvals, edits and publishing workflow.

These are preferred product routes, not an instruction to force an incompatible routing architecture.

## Implementation philosophy
Practical, phased, recoverable, observable, cost-aware, migration-safe, regression-conscious, continuously documented.

## Working memory
First locate existing project documentation/handoff conventions and reuse them. If none exist, create a scoped location such as `docs/agentic-creator/` containing living equivalents of:
- `WORKING_MEMORY.md`
- `DECISIONS.md`
- `IMPLEMENTATION_LOG.md`
- `ARCHITECTURE.md`
- `TEST_STATUS.md`

Do not create duplicate documentation systems if equivalents already exist.

## Commits
Commit only at meaningful stable junctures: audit/docs checkpoint, phase completion, migration boundary, vertical slice completion, major required refactor, hardening/acceptance completion.

Before each meaningful commit, run the repository-supported build/typecheck/lint and relevant existing/new tests. Record pre-existing failures. Never hide failures merely to obtain a green build.

## Begin
Read the whole pack, then execute `02_PHASE_0_REPO_AUDIT_AND_ROUTE_FEASIBILITY.md`. Do not implement until the audit report has been reviewed.
