# 11 — Accessibility, Performance, and QA Matrix

Run this after each UI-affecting phase and fully before release.

## Accessibility
Validate:
- keyboard navigation across rails/cards
- visible focus states
- hover content also available on focus/touch
- buttons have accessible names
- images have appropriate alt treatment
- contrast meets the project's target standard
- motion respects reduced-motion preferences
- no focus trap inside preview/detail interactions
- semantic headings where appropriate

## Responsive QA
At minimum inspect:
- narrow phone
- larger phone
- tablet-ish width
- 13–14 inch laptop width
- wide desktop

Check:
- hero/rail overflow
- text truncation
- card aspect ratios
- preview positioning
- modal/sheet sizing
- horizontal rail scroll affordance
- safe areas
- browser zoom where practical

## Performance
Measure or inspect:
- initial Gallery JS bundle impact
- image requests
- largest contentful element
- layout shifts
- card preview request behavior
- duplicate data fetches
- N+1 queries
- re-render loops
- scroll jank

## Image strategy
- lazy-load below-the-fold artwork
- do not lazy-load the primary above-the-fold hero if it harms LCP and the existing framework supports priority loading
- avoid fetching Beat 1 preview sequences for every Storyline on initial page load if they can be deferred until interaction/near-viewport
- preserve image dimensions/aspect ratio to reduce CLS

## Functional matrix
Test:
- signed-in access
- Storyline feed only
- Storyline with cover
- Storyline without ideal cover/fallback
- Storyline with preview images
- Storyline with missing preview images
- Favorite/unfavorite
- Explore
- legacy intro fallback
- Kids filter
- empty genre
- Continue Watching if enabled
- watched state if enabled
- slow network/loading state
- fetch error
- no eligible content

## Security/privacy
- no cross-user Favorite/history state
- no cross-profile history/cache leakage
- Kids filter cannot be bypassed merely by changing client state when served through normal Gallery APIs
- existing authorization/RLS remains intact

## Testing approach
Use the repository's existing test stack. Do not add a new test framework solely for this feature.

Add focused unit/integration/e2e coverage where the repository already has corresponding patterns.
