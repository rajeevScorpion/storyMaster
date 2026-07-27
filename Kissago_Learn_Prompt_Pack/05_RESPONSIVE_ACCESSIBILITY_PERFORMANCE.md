# Responsive, Accessibility and Performance Requirements

## Responsive behavior

The route must be designed for orientation and screen size, not merely scaled.

### Large desktop

- Two-column or asymmetric editorial compositions
- Generous negative space
- Visible chapter progress
- Screenshot frames may sit beside copy
- Subtle layered motion is acceptable
- Presentation mode should feel confident at common projector resolutions

### Laptop and tablet

- Preserve horizontal progression
- Reduce decorative layers
- Keep key screenshots readable
- Avoid text columns becoming too narrow
- Navigation controls remain visible but quiet

### Mobile portrait

- Horizontal swipe remains the main slide navigation
- Headline and primary explanation remain visible
- Secondary detail may collapse
- Screenshot and copy may stack within the slide
- Avoid tiny full-desktop screenshots; crop or provide a mobile capture where appropriate
- Maintain safe-area padding
- Keep touch targets at accessible sizes

### Mobile landscape

- Allow a compact presentation layout
- Avoid forcing the user to rotate
- Protect text height from browser chrome
- Do not place all controls along one crowded edge

## Accessibility requirements

- Semantic landmarks
- Correct heading hierarchy
- Keyboard-accessible navigation
- Visible focus states
- Button labels that describe actions
- Alt text for meaningful images
- Decorative backgrounds hidden from assistive technologies
- Contrast compliant with the existing product standard
- No information conveyed only by color
- No essential information dependent on animation
- Reduced-motion support
- Screen reader announcement for chapter changes if it can be implemented without noise
- Avoid focus traps
- Ensure expandable details expose correct ARIA state

## Content readability

- Keep one primary idea per slide
- Avoid long centered paragraphs
- Keep body line length comfortable
- Do not place text directly over busy screenshot areas
- Maintain readable contrast over future background art
- Use short supporting copy with optional detail

## Performance requirements

- Lazy-load off-screen screenshots and backgrounds
- Preload only current and near-future assets
- Use responsive image sources
- Use WebP or AVIF where supported
- Keep an accessible fallback if a decorative asset is missing
- Prevent cumulative layout shift
- Reuse installed dependencies
- Avoid duplicate animation frameworks
- Avoid expensive continuous blur animation
- Pause or remove off-screen loops
- Test on a mid-range mobile device profile
- Ensure the route still feels complete before future custom artwork is added

## Resilience

The route must not fail if:

- A screenshot is temporarily unavailable
- A background image is not added yet
- Presentation mode is disabled
- JavaScript animation is reduced
- The user enters through a direct slide hash
- The user changes theme
- The browser restores an earlier scroll position
