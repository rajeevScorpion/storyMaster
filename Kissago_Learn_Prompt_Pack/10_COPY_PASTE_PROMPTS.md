# Copy-Paste Prompt Sequence for the AI Coder

Use these prompts one at a time. They are designed to keep implementation controlled and prevent visual drift.

---

## Prompt 1 — Audit

Inspect the Kissago codebase before implementing `/learn`.

Identify the routing system, design tokens, typography, emerald and ember color usage, glow treatments, current cards and buttons, motion library, theme behavior, responsive breakpoints, screenshot-worthy routes and any likely horizontal-scroll conflicts.

Return:

1. A concise audit
2. A component reuse map
3. A route architecture recommendation
4. Risks and mitigation
5. The exact files you expect to create or modify

Do not introduce a new visual system. Do not begin production styling yet.

---

## Prompt 2 — Structural route

Implement Phase 1 from the supplied prompt pack.

Create `/learn`, redirect `/tutorial` to `/learn`, add the data-driven 18-slide structure, create the three chapters, add horizontal navigation, previous and next controls, keyboard support, active slide tracking, direct slide access and progress indicators.

Use simple placeholders for visuals. Keep the application buildable. Do not add decorative backgrounds or complex animation yet.

After implementation, report changed files and validation results.

---

## Prompt 3 — Kissago design integration

Integrate the `/learn` route with the existing Kissago design system.

Map the semantic roles of emerald, ember and restrained glow to current tokens. Reuse the existing typography, cards, buttons, spacing, navigation and theme behavior.

Do not create a generic pitch-deck appearance. Do not introduce unrelated gradients, excessive glassmorphism or constant neon outlines.

Show which components were reused, extended or newly created.

---

## Prompt 4 — Slide compositions

Build reusable visual compositions for the 18 slides using the supplied narrative.

Prioritize:

- Fragmented creation
- Learning curve
- Calm attention
- Story component convergence
- Five-to-ten-minute journey
- Character continuity
- Playback layers
- User control
- Best practices
- Use cases
- Episodic story world
- Final invitation

Each slide should have one focal idea. The route must remain complete without future custom background images.

---

## Prompt 5 — Motion system

Add restrained, premium motion to `/learn` using the animation conventions already present in Kissago.

Motion should support narrative progression through small depth shifts, grouped text entry, subtle media movement, chapter transitions and controlled emerald or ember glow.

Implement touch, wheel, trackpad and keyboard behavior carefully. Do not trap the user inside the slider.

Implement `prefers-reduced-motion` fully.

---

## Prompt 6 — Authentic screenshots

Audit the currently implemented Kissago product screens and capture or reuse authentic screenshots for the relevant slides.

Use one coherent demonstration story where possible.

Do not fabricate unavailable features. Clearly label future directions. Remove private or production-sensitive information.

Add responsive image behavior, fallbacks and captions where helpful.

---

## Prompt 7 — Mobile and accessibility

Complete the mobile, responsive and accessibility pass.

The primary narrative must remain visible on mobile. Collapse only secondary details. Preserve horizontal swipe. Tune portrait and landscape. Ensure comfortable touch targets, safe areas, readable screenshots, visible focus, correct heading order, alt text, ARIA state and reduced motion.

Test common mobile, laptop and projector widths.

---

## Prompt 8 — Final QA

Run the full checklist in `09_QA_AND_ACCEPTANCE.md`.

Verify build, lint, type checks, theme behavior, direct slide access, browser history, presentation mode, missing asset fallbacks, keyboard navigation, touch navigation and regression safety.

Return:

1. Test results
2. Remaining limitations
3. Reused components
4. New components
5. Final changed-file list
6. Desktop and mobile captures
