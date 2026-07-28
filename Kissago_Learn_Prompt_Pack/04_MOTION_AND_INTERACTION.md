# Motion and Interaction Direction

## Motion character

Motion should feel like storytelling: paced, intentional and connected.

It should not feel like a UI effects showcase.

## Core transition behavior

Recommended transition range:

- Micro interaction: approximately 120–220 ms
- Card or text entrance: approximately 220–420 ms
- Slide emphasis sequence: approximately 350–650 ms
- Chapter transition: approximately 500–900 ms

Use the timing and easing conventions already present in Kissago when available.

## Slide entry

A slide may use:

- Headline entering first
- Supporting copy following shortly after
- Primary visual arriving last
- Small depth or position shift
- Controlled opacity transition
- One accent glow settling behind the focal element

Do not animate every line separately.

## Narrative motion concepts

### Fragmentation slides

Tools or tasks may appear separated and slightly misaligned, then pause.

### Convergence slide

Writing, image, narration, spoken text, motion and effects can gently assemble into one Kissago story output.

### Timeline slide

The five-to-ten-minute flow may advance through a compact sequence without implying a guaranteed completion time.

### Character and world slide

A character card can remain stable while environment or episode cards expand around it, communicating continuity.

### Story world slide

Episodes can appear as connected nodes or cards extending from one central character.

### Final slide

The interface should settle rather than explode. Calls to action can arrive with a quiet emerald emphasis and a small ember response.

## Scroll and input handling

Support:

- Trackpad
- Mouse wheel
- Keyboard arrows
- Touch swipe
- Explicit previous and next controls
- Direct chapter or slide selection

Rules:

- Do not aggressively hijack the wheel
- Do not prevent the user from leaving the slider
- Avoid momentum conflicts
- Keep focus states visible
- Do not move focus unexpectedly after each slide
- Ensure the back button remains meaningful

## Reduced motion

When `prefers-reduced-motion` is enabled:

- Disable parallax
- Replace spatial entrances with simple opacity or immediate rendering
- Avoid animated glow
- Keep scroll snapping comfortable
- Do not animate progress over long durations
- Preserve all content and controls

## Hover behavior

Hover is enhancement only.

Appropriate:

- Slight media lift
- Screenshot frame depth
- Button response
- Small color gain
- Subtle accent edge
- Paused card revealing one line of detail

Do not hide essential information behind hover.

## Mobile motion

Mobile motion should be simpler:

- Prioritize swipe responsiveness
- Reduce layered parallax
- Avoid large blurred glow fields
- Keep transitions short
- Do not animate expanded details from several directions
- Respect battery and performance constraints

## Optional ambient effects

Use only if an equivalent effect already exists in Kissago.

Possible uses:

- Very faint floating story particles
- Soft grain
- Gentle light drift
- Minimal environmental movement

Ambient effects must be easy to disable and should never reduce reading comfort.
