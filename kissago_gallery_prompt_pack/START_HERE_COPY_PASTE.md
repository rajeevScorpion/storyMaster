# START HERE — Single Prompt to Begin the Gallery Transformation

You are working inside the existing Kissago repository.

Your task is to begin the Gallery transformation using the prompt pack in this folder. Do **not** jump directly into implementation.

Read, in this order:
1. `README.md`
2. `00_MASTER_GUARDRAILS.md`
3. `01_CODEBASE_AUDIT.md`

Then perform only the mandatory codebase audit.

The product direction is already confirmed: the signed-in Gallery is evolving into a premium OTT-inspired, full-width Storyline discovery experience. It should surface Storylines rather than individual Stories, preserve Storyline covers and the existing Beat 1 hover-preview pattern, retain the existing Explore route into underlying Stories, and remain recognizably Kissago rather than imitating another brand. Mobile must be first-class and future Capacitor packaging must be considered. Richer metadata, Kids/age-aware discovery, viewer profiles, viewing progress, and profile-scoped server-side feed caching are planned in later phases.

Critical instruction: **ground every conclusion in the actual codebase.** Do not assume routes, schema, auth, APIs, components, state management, cache infrastructure, or naming.

Do not make implementation changes yet. Audit first and report findings using the format required by `01_CODEBASE_AUDIT.md`.
