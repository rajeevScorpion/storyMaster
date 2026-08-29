# 05 — Phase 3: Mobile-First and Capacitor-Ready Behavior

## Objective
Make the redesigned Gallery feel native and premium on mobile web while remaining suitable for future Capacitor packaging.

## Core rule
Do not create a shrunk desktop Gallery. Define intentional mobile behavior.

## Touch adaptation
The desktop Beat 1 hover preview cannot be an essential feature on touch devices.

Inspect current mobile behavior and choose the least intrusive repository-compatible solution. Preferred options, in order:
1. lightweight preview after deliberate card selection/tap without immediate navigation
2. controlled auto-preview on a focused/active card when it does not interfere with scrolling
3. preview in a bottom sheet/detail surface

Avoid auto-cycling every visible card. Avoid any interaction that makes vertical scroll feel sticky or unpredictable.

## Mobile layout
- full-width experience
- edge-aware horizontal rails if used
- preserve adequate side padding for readability/touch
- artwork ratios suited to content
- strong single-hand tap targets
- no tiny metadata
- do not rely on hover
- use bottom sheets/drawers only if the codebase already has a stable primitive or there is a clear benefit

## Capacitor readiness
Audit and fix where needed:
- `100vh` issues; prefer modern viewport units / existing project abstraction
- top/bottom safe-area insets
- fixed headers/footers colliding with OS chrome
- overscroll and nested horizontal-scroll behavior
- touch-action conflicts
- focus styles that look broken after touch
- image memory/network load
- long-lived animations draining mobile performance
- back navigation expectations
- scroll restoration

Do not introduce Capacitor itself in this phase unless it is already part of the repository and Gallery-specific adaptation is needed.

## Accessibility
- minimum practical touch target sizes
- visible focus for keyboard/external keyboard use
- meaningful image alt text where appropriate
- reduced-motion behavior using existing project conventions
- controls labeled for screen readers

## Acceptance criteria
Test at representative narrow widths and at least one tablet-ish width.
- no clipped cards
- no unreachable controls
- no hover-only actions
- no scroll traps
- no excessive image requests from preview behavior
- Explore works reliably
- Favorites work reliably

## Commit
`feat(gallery): optimize responsive and touch interactions`
Adapt to repo convention.
