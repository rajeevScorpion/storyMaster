# 04 — Phase 2: Premium OTT-Inspired Gallery Visual System

## Objective
Redesign the Storyline Gallery into a premium, cinematic, full-width discovery experience inspired primarily by Hotstar's hierarchy and browsing feel while remaining unmistakably Kissago.

## Important
Do not copy Hotstar branding, exact layouts, assets, or styling. Recreate the product principles: cinematic hierarchy, strong imagery, clear rails, progressive disclosure, low-friction browsing.

## Visual direction
- Full-width / edge-aware desktop layout
- Dark immersive canvas if consistent with current Kissago theme
- Existing Kissago emerald and ember glow accents used sparingly
- Large cinematic artwork where data quality supports it
- Strong typography hierarchy
- Minimal chrome
- Smooth, restrained motion
- Consistent visual rhythm across rows/rails

## Information architecture
Default browsing card should prioritize:
1. artwork
2. title
3. essential state/affordance

Richer information can appear on hover/focus/selection/detail treatment:
- creator
- concise 1–2 line introduction
- age classification
- genre(s)
- Favorite control
- watched/continue state later when available
- Explore CTA

Do not put every field permanently on every card.

## Suggested content structure
Use codebase evidence to decide exact implementation, but target a system that can support rails such as:
- Continue Watching (later phase when data exists)
- For You / Discover
- New / Fresh Storylines
- Kids
- Adventure
- Fantasy
- Mystery
- Learning & Discovery
- Other genres grounded in actual metadata

Do not hard-code genre rails that the current data cannot support. Build the rail primitive first; populate only evidence-backed groups.

## Hero / featured content
If the current Gallery already has a featured area, evolve it rather than duplicating it. If not, add a hero only if the existing content model can reliably provide suitable artwork and metadata.

A hero is not mandatory if it would require fake data or brittle assumptions.

## Interaction
Desktop:
- hover/focus card expansion or richer overlay may be used
- preserve Beat 1 image cycling
- keyboard focus must reveal equivalent controls

## Loading states
Use cinematic skeletons/placeholders consistent with final card dimensions. Avoid layout jumps.

## Acceptance criteria
- Looks intentional on common desktop widths, including laptop and large monitor.
- No boxed admin-dashboard feel.
- No horizontal page overflow.
- Cards/rails reuse common components.
- Hover/focus behavior does not cause disruptive reflow.
- Explore and Favorite remain obvious but not visually dominant.
- Existing Kissago design language remains recognizable.

## Commit
Keep this primarily presentational. Do not bundle age filtering, profile architecture, or caching into the same commit.
