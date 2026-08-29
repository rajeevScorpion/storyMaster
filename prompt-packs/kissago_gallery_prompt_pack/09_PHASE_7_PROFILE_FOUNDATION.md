# 09 — Phase 7: Profile Foundation

## Objective
Prepare Kissago for account-level profiles, including child profiles, without prematurely rebuilding authentication or account management.

## Important scope rule
Profiles are a confirmed product direction, but do not implement a full Netflix-style profile management system unless the repository already has an account/profile abstraction that makes this straightforward.

## First inspect
Determine whether the current model already distinguishes:
- authenticated account/user
- public creator profile
- viewer settings/preferences
- child/household members
- organization/school roles

Do not confuse creator/public profiles with household viewing profiles.

## Target concept
Future feed identity should conceptually support:
`Account -> Viewer Profile -> Age eligibility -> History/preferences -> Gallery feed`

## Minimal foundation
If no viewer-profile system exists, propose the smallest clean abstraction that can later support:
- adult/default profile
- child profile
- profile display name/avatar
- age band or age eligibility setting
- profile-specific Favorites/history/feed

Do not migrate all current user-owned data immediately unless required.

A reasonable backwards-compatible strategy may be:
- every existing account implicitly maps to a default viewer profile
- new child profiles can be added later
- Gallery APIs accept/resolve an active profile context

But only implement this if it aligns with the repository's schema/auth model.

## Child profile rules
A child profile must constrain catalogue eligibility at the trusted query layer, not merely hide UI elements.

Profile switching UX can be a later phase if needed; the data model should not make it difficult.

## Acceptance criteria for a foundation-only phase
- repository has a documented viewer-profile strategy
- any introduced schema is additive
- existing users continue to work without manual migration steps
- current Gallery behavior remains unchanged for default profile
- child eligibility can be enforced server-side when child profiles are activated

## Stop condition
Do not build PIN systems, parental dashboards, subscription entitlements, or elaborate avatars unless separately requested.
