# 08 — Phase 6: Watched, Continue Watching, and Progress State

## Objective
Add useful personal consumption state without building a complex analytics platform.

## First inspect
Search for existing:
- story playback session
- current beat / current scene
- last viewed timestamp
- completion flag
- view count
- user activity/history
- analytics events that already capture progress

Reuse existing canonical state rather than creating duplicate watch tables.

## Product behaviors
Where data supports it, Gallery should be able to display:
- unwatched
- watched/completed
- continue watching / left midway
- optional progress indicator
- optional number of times watched

## Prioritization
Implement in this order:
1. Continue Watching / incomplete state
2. Watched/completed state
3. progress indicator
4. watch count only if meaningful and cheap

Do not add watch count merely because it was mentioned as a possibility. If it adds clutter or requires unreliable aggregation, omit it and document the choice.

## Definition rules
Ground definitions in the Storyline/Story playback architecture.
Examples to resolve from code:
- What counts as "started"?
- What counts as "complete"?
- Is progress measured by beat, page, timestamp, or Story branch?
- If multiple Stories exist under one Storyline, how should Storyline-level progress be summarized?

Do not guess. Propose the simplest consistent rule based on existing navigation and persistence.

## Continue Watching rail
If reliable incomplete state exists, add a high-priority Continue Watching rail for the active profile/user.

It should not be populated by content merely opened and immediately abandoned unless the existing product defines that as progress.

## Performance
Do not run per-card progress queries. Fetch progress in the feed query or batch it.

## Acceptance criteria
- state is user/profile-specific
- no leakage between users
- progress survives reload where the product already persists it
- Gallery does not perform N+1 progress reads
- completion rules are documented

## Commit
Keep analytics instrumentation changes separate from UI if they are substantial.
