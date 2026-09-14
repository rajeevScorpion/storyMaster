# Kisago Agentic Creator System — AI Coder Prompt Pack

## Purpose
This pack is for implementing Kisago's Agentic Creator System in a practical, phased, recoverable way while preserving the current product.

The pack is intentionally **codebase-grounded**. It does not assume the current framework, schema, route structure, auth model, queue/scheduler implementation, model provider, TTS provider, image provider, persistence layer, or story-domain API. The AI coder must discover those from the repository before planning or changing code.

## Non-negotiable operating principles
1. **Inspect before planning.** Do not implement until the repository audit is complete.
2. **Validate the proposed admin modularization first:** preferred routes are `/admin/agents` and `/admin/authors`, but they must be confirmed against the actual codebase.
3. **No UI automation.** Agentic flows should call the same underlying domain/services used by the human creation flow wherever possible.
4. **Existing Kisago must continue to work unchanged** when all new features are disabled.
5. Prefer additive, isolated changes over rewrites.
6. Use feature flags / bounded activation where appropriate.
7. No destructive migration without explicit approval.
8. Human review remains mandatory before publication in V1.
9. Image generation is permission-gated and OFF by default for personas.
10. Narration generation is independently toggleable.
11. No model names are hardcoded into persona logic.
12. Every persona automatically receives persistent memory.
13. Global story memory and persona memory participate in novelty/redundancy checks.
14. Maintain documentation and working memory continuously.
15. Commit at meaningful stable junctures.
16. Regression control and recoverability are first-class requirements.

## How to use this pack
1. Give the coding agent the whole pack.
2. Start with `01_MASTER_STARTER_PROMPT.md`.
3. The agent must then execute `02_PHASE_0_REPO_AUDIT_AND_ROUTE_FEASIBILITY.md` and **stop before implementation**.
4. After the operator approves the grounded architecture/module plan, continue with `10_PHASED_IMPLEMENTATION_PROMPTS.md`.

## Core V1 mental model
`Editorial Supervisor -> Task Pool -> Execution Orchestrator -> Creator Persona -> Kisago Story Services -> Evaluation -> Human Review -> Optional Media Generation -> Publish`

The Supervisor decides **what should be created and by whom**.
The Orchestrator decides **how and when the job executes safely, economically and recoverably**.
Creator personas provide **creative identity and authorship**, not infrastructure decisions.
Human reviewers certify **publishability**.

## Important
Where this pack names a field, table, status, endpoint or object, treat it as a **product concept**, not a mandatory implementation identifier. Map the concept to the repository's actual conventions and document that mapping.
