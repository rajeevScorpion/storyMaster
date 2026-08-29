# 00 — Master Guardrails for the AI Coder

Use this prompt at the beginning of the coding session and keep it active for every later phase.

## Your role
You are modifying an existing production-oriented Kissago codebase. Your job is not to invent a clean-room architecture. Your job is to understand the repository, preserve working behavior, and evolve the Gallery safely.

## Mandatory grounding rules
Before changing code:
- Inspect the actual Gallery route(s), page(s), layouts, components, hooks, queries, API handlers/server actions, database models, auth/session utilities, Story/Storyline structures, favorites logic, Explore behavior, image/beat data model, and existing freshness/randomization logic.
- Search for current mobile breakpoints, design tokens, theme primitives, shared cards, loaders, skeletons, image components, analytics/event tracking, and any existing progress/view-history data.
- Search for current Storyline cover-image logic and the existing Beat 1 hover-preview implementation.
- Identify whether data is fetched server-side, client-side, through API routes, server actions, RPC, direct Supabase client usage, ORM, or another mechanism.
- Identify how permissions/RLS are enforced before proposing data changes.
- Inspect package versions and existing libraries before adding dependencies.

Never assume:
- framework/router version
- database or ORM
- table/column names
- auth provider
- CSS system
- component library
- analytics provider
- cache provider
- image CDN/storage
- Story vs Storyline ownership model
- Storyline-to-Story relationship
- whether watch count/progress exists
- whether content has age or genre metadata already

If code and prompt disagree, stop and document the conflict before implementing the conflicting behavior.

## Preservation rules
Do not break or remove:
- sign-in gating already used by Gallery
- Favorites behavior
- Storyline cover usage
- Beat 1 hover preview where it already works
- Explore navigation into the underlying Story mechanism
- existing Story creation/branching behavior outside Gallery
- existing routes and deep links unless a migration is explicitly required

## Design rules
- Do not clone Hotstar visually. Use it as an interaction/information-hierarchy reference only.
- Preserve Kissago's existing visual identity and token system.
- Prefer full-width cinematic composition over boxed dashboard layouts.
- Use emerald/ember accents selectively.
- Do not overload every card with metadata.
- Progressive disclosure is preferred: browsing card -> richer hover/focus/tap state -> detail/Explore.

## Mobile/Capacitor rules
- Never make essential information hover-only.
- Avoid browser-only assumptions that will make a Capacitor shell brittle.
- Use safe viewport units and account for device safe areas if the project already has helpers/tokens.
- Preserve native-feeling vertical scroll and horizontal rail behavior.
- Avoid interactions that conflict with touch scrolling.
- Keep tap targets accessible.

## Database/schema rules
- Inspect current schema and migrations first.
- Prefer nullable/additive columns or new tables over destructive rewrites.
- Any new column/table/index must include rationale, migration, rollback consideration, and usage sites.
- Do not add denormalized fields without explaining why they are needed.
- Do not store derived data that can cheaply and reliably be computed unless it materially improves read performance.

## Performance rules
- Do not add N+1 queries.
- Avoid querying full Story payloads when the Gallery only needs Storyline summary data.
- Do not eagerly load all beat imagery for all cards if preview imagery can be fetched/lazy-loaded in a controlled way.
- Use the application's existing image optimization approach.
- Keep layout shift low.
- Preserve or improve perceived loading through skeletons/placeholders where appropriate.

## Output after each phase
Return:
1. What you inspected
2. What you changed
3. Files changed
4. Schema/migration impact
5. Existing behavior preserved
6. Tests/checks run
7. Known limitations
8. Suggested next phase
9. Exact commit message

Do not say a phase is complete if tests or critical manual checks have not been run.
