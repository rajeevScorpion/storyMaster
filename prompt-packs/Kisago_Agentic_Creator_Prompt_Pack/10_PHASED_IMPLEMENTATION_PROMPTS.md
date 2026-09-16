# Phased Implementation Prompts

Use these sequentially **after Phase 0 route/module architecture is approved**.

Each phase must:
1. read current working memory,
2. inspect code relevant to the phase,
3. restate the codebase-grounded plan,
4. implement only approved scope,
5. run regression checks,
6. update documentation,
7. commit if the phase is stable and meaningful,
8. leave the repository recoverable.

Do not skip ahead merely because later code seems easy.

---

# Phase 1 — Safe scaffolding and feature isolation
Implement minimum safe scaffolding for the approved architecture. Follow approved route/module structure; introduce repository-native feature isolation; create route shells/navigation only if approved; introduce no autonomous generation yet; preserve all existing behavior; establish/reuse working-memory docs; add only required configuration. Before coding show files to touch, regression surface and rollback approach. After coding run tests/build/lint/typecheck, verify feature OFF means no behavior change, document, commit.

# Phase 2 — Persona Library + 15 seeded personas
Implement database-backed personas. Support edit/clone/status changes and filters by age, language, genre, status and search. Every persona automatically has memory identity. Support editable prompt, creative defaults, real voice references, Advanced Settings defaults and permissions. Image permission defaults OFF; narration independent; no provider model hardcoding in persona logic.

Before seeding, map conceptual blueprint to actual Kisago age IDs, settings enums and voice IDs and show the final 15-persona mapping. Seed exactly 15 unless operator changes it. Test seed idempotency, clone/edit/filter/status, image OFF, new persona memory. Document and commit.

# Phase 3 — Global + persona memory and novelty checks
Implement persistent global story memory, automatic persona memory and redundancy prevention using the simplest supported architecture. Cover titles, briefs, plots, themes, character names, series/episodes and relevant semantic metadata. Run novelty checks before and after generation. Distinguish series continuity from duplication. Use economical routing where possible. Make warnings auditable. Backfill existing content only if safe/necessary and make backfills resumable/idempotent. Test and commit.

# Phase 4 — Editorial Supervisor + task pool
Implement V1 catalogue-aware Editorial Supervisor/Content Manager. It should identify content/value gaps, consider age/language/genre balance and repetition, know persona availability/specialities, create task pool/commissions and assign suitable personas. Keep it separate from operational orchestrator where architecture supports it. Do not add likes/views/consumption analytics yet. Expose concise structured rationale, never private chain-of-thought. Test and commit.

# Phase 5 — Execution Orchestrator + scheduler + model routing
Implement schedules, queued/stateful execution, retries, idempotency, run history, safe resume, model task-role routing, admin-configurable model mappings through existing abstractions, fallbacks and basic cost/usage telemetry. Support direct scheduled persona jobs and supervisor assignments. No image call unless explicit permission ON. Test retries, duplicate prevention, feature disabled, paused persona, fallback and interrupted recovery. Document and commit.

# Phase 6 — Seed Story vertical slice: text-first
Connect orchestrator to existing Seed Story/domain services. No UI automation. Persona creates brief, passes pre-generation novelty check, writes full Seed Story, selects only allowed Advanced Settings, uses existing strict/no-adaptation equivalent if appropriate, chooses beat count via existing controls, creates a normal editable Kisago draft, then post-generation novelty check. No publish. Images remain OFF by default. Start text-only. Verify human can open/edit the result through normal product flow. Test and commit.

# Phase 7 — Independent evaluation
Implement automated evaluation using deterministic and economical model checks where practical. Evaluate coherence, age fit, language, originality/repetition, persona fidelity, pacing, learning value where relevant, entertainment value, safety and review readiness. Evaluation cannot auto-publish. Store concise structured results/warnings. Test obvious duplicates, age mismatch, broken story, good story and legitimate series continuation. Commit.

# Phase 8 — Optional narration + forced alignment
Add narration control independent of image permission. Reuse existing TTS/voice/domain services. Persona uses allowed voice configuration. Existing forced alignment follows existing pipeline. Narration may be deferred until human approval. Retry/idempotency must avoid duplicate paid TTS. Text-only remains functional. Do not invent universal narration default. Test and commit.

# Phase 9 — Human reviewer / expert author workflow
Implement the approved Authors module. Promote existing users to the minimum necessary reviewer/expert-author role, preserving ordinary-user auth. Add review queue/assignment, story reading, narration playback, edit/refine via existing editor where possible, approve/reject/request rewrite, deferred narration trigger, image trigger subject to permissions, audit actions and enforce no autonomous publication. Test RBAC carefully. Commit.

# Phase 10 — Image permission and post-review media control
Integrate image generation safely. Persona/admin `Allow Image Generation` defaults OFF. OFF must technically prevent autonomous image calls. Reviewer/admin may initiate images through existing services if authorized. Even if persona image permission is ON, V1 human publication gate remains. Make retries avoid duplicate paid calls. Surface generation status/cost where feasible. Do not add autonomous advanced post-production. Commit.

# Phase 11 — Provenance, editorial labels and publishing
Implement creator provenance separately from editorial classification. Support From Kisago Creators, Kisago Original and Premium Story. Default official agent content according to approved behavior; reviewer/admin can promote. Future human creators remain compatible with Original/Premium. Reuse existing badge/tag UI if available. Do not conflate Premium Story with paid subscription unless existing product requires it. Publication remains human-authorized in V1. Test existing cards/detail pages. Commit.

# Phase 12 — Hardening and acceptance
Focused hardening only; no unrelated refactors. Validate feature-disabled behavior, existing creation/admin/auth flows, scheduler/recovery/idempotency, cost gates, image OFF, narration toggle, memories, supervisor assignment, human review gate, labels/provenance, series continuity, 15 persona seeds and clone/new-persona memory. Add missing tests where they materially protect the product. Update all living docs and create final stable commit.
