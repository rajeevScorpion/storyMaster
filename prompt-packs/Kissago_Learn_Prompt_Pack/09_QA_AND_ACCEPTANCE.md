# QA and Acceptance Checklist

The route is accepted only when the following are true.

## Product narrative

- [ ] The page begins with the problem before presenting features.
- [ ] The problem is explained without alarmist or medical claims.
- [ ] The fragmented creation process is clear.
- [ ] Kissago is presented as a guided storytelling environment.
- [ ] Parents, educators, children and creators are all represented naturally.
- [ ] The five-to-ten-minute statement is presented as an approximate first-version range, not a guarantee.
- [ ] Current features and future directions are clearly distinguished.
- [ ] The page ends by leading into the actual product.

## Visual fidelity

- [ ] Existing Kissago tokens and typography are used.
- [ ] Emerald and ember have clear semantic roles.
- [ ] Glow is restrained.
- [ ] No unrelated visual theme has been introduced.
- [ ] No generic SaaS pitch-deck style dominates the route.
- [ ] Screenshots are authentic.
- [ ] The experience works without future background artwork.
- [ ] Each slide has one primary idea.
- [ ] Content remains readable over every background.

## Navigation

- [ ] Mouse wheel navigation works without trapping the page.
- [ ] Trackpad navigation feels natural.
- [ ] Left and right keyboard arrows work.
- [ ] Touch swipe works.
- [ ] Previous and next controls work.
- [ ] Chapter progress is accurate.
- [ ] Slide progress is accurate.
- [ ] Direct slide access works.
- [ ] Browser back and forward behavior is acceptable.
- [ ] No auto-advance occurs.
- [ ] Presentation mode, if included, exits cleanly.

## Mobile

- [ ] Horizontal swipe remains responsive.
- [ ] Main copy is visible without expansion.
- [ ] Secondary details can expand where needed.
- [ ] Screenshots remain understandable.
- [ ] Touch targets are comfortable.
- [ ] Safe areas are respected.
- [ ] Portrait and landscape both work.
- [ ] No desktop composition is merely scaled down into illegibility.

## Accessibility

- [ ] Semantic landmarks are present.
- [ ] Heading order is logical.
- [ ] Focus states are visible.
- [ ] Keyboard users can reach all controls.
- [ ] Expandable details expose correct state.
- [ ] Meaningful images have alt text.
- [ ] Decorative images are ignored by assistive technology.
- [ ] Color is not the only information channel.
- [ ] Contrast is sufficient.
- [ ] Reduced-motion mode is implemented.
- [ ] No focus trap occurs.
- [ ] Motion is not required to understand content.

## Performance

- [ ] Off-screen images are lazy-loaded.
- [ ] Current and next slide assets are prioritized.
- [ ] Responsive image sizes are used.
- [ ] Large raster assets are optimized.
- [ ] Layout shift is minimal.
- [ ] Off-screen loops are paused or removed.
- [ ] No duplicate animation framework is shipped.
- [ ] Route remains usable with image assets missing.
- [ ] Production build succeeds.
- [ ] Lint succeeds or all exceptions are documented.
- [ ] Type checks succeed or all exceptions are documented.

## Regression protection

- [ ] Existing global navigation still works.
- [ ] Existing themes still work.
- [ ] Existing story creation routes still work.
- [ ] Authentication state is unaffected.
- [ ] Global wheel behavior is unaffected outside `/learn`.
- [ ] No design token has been globally redefined merely for this route.
- [ ] No existing component has been changed in a way that breaks other pages.

## Final presentation quality

- [ ] The founder can open `/learn` and present it without preparation.
- [ ] The chapter sequence is understandable to a first-time viewer.
- [ ] The visual pacing feels calm and premium.
- [ ] The transition into the live product is natural.
- [ ] The page feels like Kissago, not a separate campaign.
