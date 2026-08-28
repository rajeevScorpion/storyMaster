# Phased Implementation Plan

The coder should implement the route in controlled phases. Each phase must preserve a buildable application.

## Phase 0 — Codebase audit

Tasks:

- Inspect routing
- Identify the design system
- Identify emerald, ember and glow treatments
- Locate reusable components
- Locate current animation conventions
- Identify real product routes and screenshot opportunities
- Check theme behavior
- Check mobile navigation patterns
- Check likely scroll conflicts

Deliverable:

- Short audit
- Reuse map
- Risk list
- Recommended architecture

Do not write visual production code before this phase is complete.

## Phase 1 — Route and structural shell

Tasks:

- Add `/learn`
- Add `/tutorial` redirect
- Create slide data model
- Create 18 content entries
- Build basic horizontal viewport
- Add previous and next controls
- Add keyboard navigation
- Add active slide tracking
- Add chapter and slide progress
- Support direct slide access
- Use plain placeholders for visuals

Checkpoint:

- Route works without decorative assets
- Existing routes remain unaffected
- Desktop and mobile navigation are functional

## Phase 2 — Design-system integration

Tasks:

- Replace placeholders with existing Kissago surfaces and components
- Map emerald and ember semantic roles to current tokens
- Apply current typography
- Integrate current buttons and navigation
- Add presentation mode only if cleanly supportable
- Add theme compatibility
- Add chapter-specific emphasis without creating separate themes

Checkpoint:

- The route looks native to Kissago
- No unrelated colors or component styles appear
- Light/dark behavior remains correct

## Phase 3 — Content compositions

Tasks:

- Build reusable visual compositions
- Add fragmentation visual
- Add convergence visual
- Add creation timeline
- Add character continuity composition
- Add best-practice composition
- Add use-case composition
- Add episodic world composition
- Add final action panel

Checkpoint:

- Every slide has one clear focal point
- No slide depends on a future background asset
- Copy remains readable at all breakpoints

## Phase 4 — Motion and interaction polish

Tasks:

- Add restrained slide entry motion
- Add chapter transition behavior
- Add screenshot frame response
- Add subtle emerald and ember glow where meaningful
- Add wheel and trackpad behavior carefully
- Add swipe behavior
- Add reduced-motion mode
- Test exit behavior so the slider does not trap users

Checkpoint:

- Motion supports reading
- Navigation feels immediate
- Reduced-motion mode is complete
- No heavy looping animation

## Phase 5 — Authentic product screenshots

Tasks:

- Capture current Kissago screens
- Use one coherent demonstration story
- Add responsive images
- Add captions where helpful
- Add fallbacks
- Do not show future features as current

Checkpoint:

- Screens are readable
- The tutorial accurately represents the product
- No private production data appears

## Phase 6 — Responsive and accessibility pass

Tasks:

- Tune mobile portrait
- Tune mobile landscape
- Tune common laptop and projector widths
- Add expandable secondary details
- Validate keyboard behavior
- Validate focus states
- Validate headings and landmarks
- Validate contrast
- Validate alt text
- Validate safe areas
- Validate reduced motion

Checkpoint:

- The main story is fully understandable on mobile without opening every detail
- Keyboard users can navigate comfortably
- Assistive technology receives meaningful structure

## Phase 7 — Performance and final QA

Tasks:

- Lazy-load non-critical assets
- Optimize screenshots
- Remove duplicated dependencies
- Verify build
- Verify lint
- Verify type checks
- Test direct hashes
- Test theme switching
- Test refresh on a later slide
- Test browser back and forward
- Test with backgrounds missing
- Test presentation mode
- Test on a mid-range mobile profile

Deliverable:

- Final route
- Audit summary
- Reused component list
- New component list
- Known limitations
- Desktop and mobile captures
- QA checklist with results
