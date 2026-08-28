# 01 — Mandatory Codebase Audit

Do not implement UI changes yet.

## Objective
Build a repository-grounded map of how the current Gallery works, specifically enough that later phases can modify it without assumptions.

## Audit tasks
Find and document:

### A. Entry points
- Gallery route/path
- relevant layout(s)
- auth gating
- server/client boundary
- desktop and mobile-specific components if separate

### B. Core domain objects
- Storyline model/schema/type
- Story model/schema/type
- Storyline -> Story relationship
- creator/author relationship
- cover image field/source
- beat and Beat 1 image structure
- Storyline publication/visibility fields
- favorites model
- any watch/view/progress/history model
- age/content-rating fields if any
- genre/category/tag fields if any

### C. Current Gallery feed selection
Trace the full request path:
1. page render
2. feed query / API call
3. randomization/freshness algorithm
4. history exclusions or deduplication
5. ordering
6. pagination / infinite scroll / batching
7. cache behavior if any

Estimate, using code evidence rather than guesswork:
- number of database calls per Gallery load
- whether selection is recalculated on every request
- any expensive joins/sorts/random ordering
- whether payloads contain unnecessary Story/Beat data
- likely scaling hotspots

### D. Current card behavior
Document:
- cover rendering
- hover preview implementation
- how Beat 1 images are selected/cycled
- image loading strategy
- card click behavior
- Explore button behavior
- Favorites interaction
- loading/error/empty states

### E. Design system
Identify reusable:
- typography
- spacing/tokens
- card primitives
- gradients/glows
- emerald/ember tokens
- animation library
- motion conventions
- breakpoints
- sheet/modal/drawer primitives
- carousel/rail components

### F. Mobile readiness
Document:
- current Gallery behavior on narrow screens
- touch handling
- horizontal scroll implementation
- any safe-area support
- viewport unit handling
- issues likely to matter under Capacitor

## Deliverable
Create a concise `GALLERY_AUDIT.md` inside the repo or provide the same content in your response if project conventions discourage implementation docs.

End with a table:
- Requirement
- Already exists
- Reusable as-is
- Needs modification
- Needs new implementation
- Evidence/file reference

## Stop condition
Do not begin implementation until this audit is complete.
