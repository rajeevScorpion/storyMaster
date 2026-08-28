# 03 — Phase 1: Make Gallery Storyline-First

## Objective
Change Gallery discovery so it exposes published/eligible **Storylines only**. Do not show individual user Stories as Gallery feed items.

## Required behavior
- Preserve the current signed-in Gallery entry point.
- Query/display Storylines, not Stories.
- Preserve Storyline cover images.
- Preserve existing Favorites semantics where Favorites already support Storylines. If Favorites are Story-only today, inspect and propose the least disruptive Storyline-compatible adaptation; do not invent a parallel system without evidence.
- Preserve the existing Explore mechanism that takes a user from a Storyline into the underlying Story experience.
- Do not delete Story browsing routes or underlying Story features; they simply stop being directly surfaced in the Gallery feed.

## Data query requirements
The Gallery feed should request only the data necessary for discovery, ideally:
- Storyline identifier
- title
- cover image reference
- creator summary
- short intro if available
- age/genre fields if they already exist
- fields required for existing preview behavior
- fields required for Favorite state
- fields required for current visibility/publication rules

Avoid loading full Story content unless the existing architecture makes that unavoidable and a refactor would be risky in this phase.

## Preview requirement
Retain the current desktop behavior that cycles images from Beat 1 when hovering over a Storyline card, but implement this by reusing the existing preview logic rather than recreating it from scratch.

If the existing hover preview is tightly coupled to Story cards:
1. extract the smallest reusable abstraction,
2. preserve its timing and behavior unless there is an obvious bug,
3. do not refactor unrelated card code.

## Acceptance criteria
- Gallery contains no direct Story feed cards.
- Eligible Storylines appear correctly.
- Covers render correctly.
- Beat 1 hover preview works on desktop where it worked before.
- Explore still opens the correct downstream experience.
- Favorites still function according to the repository's supported Storyline behavior.
- No broken deep links to existing Story routes.
- No material query regression.

## Commit
One focused commit only after validation.
Suggested semantic shape:
`feat(gallery): switch discovery feed to storylines`
Do not use this exact text if repo conventions differ.
