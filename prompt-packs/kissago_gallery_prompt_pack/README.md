# Kissago Gallery Transformation — AI Coder Prompt Pack

This pack is designed to be given to an AI coding agent working inside the existing Kissago repository.

## Purpose
Transform the existing signed-in Gallery from a functional browser into a premium, OTT-inspired, Storyline-first content discovery experience while preserving existing working behavior and grounding every implementation decision in the actual codebase.

The intended feel is closer to Hotstar than Netflix or Prime, but the result must remain recognizably Kissago: immersive, full-width, cinematic, intuitive, and consistent with the product's existing emerald/ember visual language.

## Non-negotiable implementation philosophy
1. Inspect first. Do not assume architecture, routes, tables, component names, auth patterns, state management, API style, storage strategy, or existing Gallery logic.
2. Reuse working code wherever practical. Refactor only when required for correctness, performance, maintainability, or the new product behavior.
3. Preserve existing behavior unless the prompt explicitly changes it.
4. Work phase by phase. Each phase must be independently testable and committable.
5. Do not silently introduce schema changes. Explain and isolate migrations.
6. Do not combine cosmetic redesign, data migration, recommendation logic, profile architecture, and caching into one large change.
7. Prefer additive, reversible changes before destructive changes.
8. Never fabricate missing product rules. When the codebase does not answer a material question, expose the uncertainty in the implementation report and choose the safest minimal path.

## Product decisions already confirmed
- Gallery is for signed-in users.
- Gallery should expose **Storylines only**, not individual user Stories.
- Existing Storyline cover images should be used as primary artwork.
- Existing desktop hover behavior that cycles imagery from Beat 1 should remain where technically appropriate.
- Mobile/touch must receive an equivalent preview strategy that does not depend on hover.
- Existing Explore behavior should remain the route from a Storyline into the underlying Story experience.
- Gallery should show richer context: Storyline title, creator, a concise 1–2 line introduction, relevant content classification, and personal viewing state where practical.
- New Storylines should eventually store a purpose-built short introduction as structured metadata generated in the content pipeline.
- Existing Storylines should fall back to a safe derived introduction from their opening story text/content.
- Age-appropriate discovery is core.
- Dedicated Kids experience is required, initially centered on approximately ages 3–8.
- A second older-child band around 8–12 should exist in the content model, with naming refined from the current product language rather than blindly calling it "teen".
- General older/teen/adult discovery can sit beyond those child-oriented bands.
- Genre and age classification should both influence discovery.
- Separate profiles are a planned product direction, including child profiles restricted to age-appropriate content.
- Future feed architecture should move away from expensive per-request random recomputation toward server-side, profile-scoped cached feeds using viewing/history signals.
- Desktop and mobile are first-class targets.
- The implementation must anticipate later Capacitor packaging: touch behavior, safe-area compatibility, scroll behavior, performance, and avoidance of desktop-only interaction assumptions.

## Recommended execution order
Use the numbered prompts in order. Do not start a later phase until the earlier phase has been validated unless a dependency discovered in the repository requires a small prerequisite change.

## Files
- `00_MASTER_GUARDRAILS.md` — rules the coding agent must follow throughout
- `01_CODEBASE_AUDIT.md` — mandatory discovery phase
- `02_IMPLEMENTATION_PLAN.md` — repository-grounded plan before coding
- `03_PHASE_1_STORYLINE_ONLY.md` — make Gallery Storyline-first while preserving existing navigation
- `04_PHASE_2_OTT_VISUAL_SYSTEM.md` — premium full-width desktop redesign
- `05_PHASE_3_MOBILE_CAPACITOR.md` — mobile/touch responsive behavior
- `06_PHASE_4_INTRO_METADATA.md` — Storyline intro generation, storage, and legacy fallback
- `07_PHASE_5_AGE_GENRE_KIDS.md` — age/genre classification and Kids experience
- `08_PHASE_6_VIEWING_STATE.md` — watched / continue watching / progress markers
- `09_PHASE_7_PROFILE_FOUNDATION.md` — profile architecture without premature overbuild
- `10_PHASE_8_FEED_CACHE.md` — server-side cached feed strategy and rollout
- `11_ACCESSIBILITY_PERFORMANCE_QA.md` — cross-cutting validation
- `12_MIGRATION_ROLLOUT.md` — safe migration and release strategy
- `13_COMMIT_AND_REPORTING_RULES.md` — commit discipline and phase reporting

## Important scope distinction
The visual and Storyline-first transformation should land before deep personalization architecture. Profiles and cached feeds are important, but they must not block the first useful Gallery release unless the repository already contains those primitives and reuse is straightforward.
