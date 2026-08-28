# Phase 2 — Model Registry, Admin Controls, and Tier Visibility

## Goal
Allow admins to manage image models without hardcoding every user-facing decision.

## Implement
Create a model registry mechanism that supports:
- provider key
- model key/model id
- display name
- description
- enabled/disabled
- user-visible true/false
- default model
- recommended marker
- premium/experimental labels
- supported capabilities
- supported aspect ratios/resolutions if relevant
- tier/plan availability
- coin cost per image or per operation
- sort order
- provider config reference

## Admin panel requirements
Admin should be able to:
- add/edit model entries
- enable/disable model
- include/exclude models tier-wise
- set coin cost
- mark recommended/default
- see config status
- prevent incomplete/misconfigured model activation

## Important distinction
A model can be:
- installed/configured in backend
- enabled for admin testing
- visible to users
- available only to certain tiers

These should not be treated as the same thing.

## Edge cases to handle
- Disabled model used by an existing old story
- Tier removed from a model
- Model missing API key/config
- Multiple models marked default
- No active model available for a user tier
- Admin accidentally sets zero or unrealistic cost

## Acceptance criteria
- Admin can control model visibility.
- Model list respects tiers.
- Misconfigured models do not show to users.
- Existing Gemini default continues to work.
- Commit created.

## Commit example
`feat(admin): add image model registry with tier controls`

