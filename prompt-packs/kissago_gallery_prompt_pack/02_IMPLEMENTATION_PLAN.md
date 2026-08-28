# 02 — Repository-Grounded Implementation Plan

Use the audit from Phase 01. Do not produce a generic plan.

## Objective
Translate the confirmed product direction into the smallest safe sequence of repository-specific changes.

## Required decisions
For each item below, state the current code path and proposed code path:
- Storyline-only feed
- Storyline cover artwork
- Beat 1 preview reuse
- Storyline metadata payload
- creator display
- 1–2 line introduction
- age classification
- genre classification
- Kids filtering
- watch/progress state
- profile-aware filtering
- feed caching

## Scope buckets
Classify every task into one of these buckets:

### Build now
Required to make the new Gallery valuable immediately.
Expected examples:
- Storyline-only feed
- premium Gallery layout
- existing cover + preview behavior
- creator + concise intro presentation
- responsive mobile/touch behavior

### Build after core Gallery is stable
Expected examples:
- age and genre rails
- Kids experience
- view/progress markers
- metadata pipeline improvements

### Future-ready architecture only
Expected examples:
- multi-profile account UX if not already present
- profile-scoped feed cache
- advanced recommendation ranking

Do not implement future-ready items merely because they appear in the product direction.

## Dependency policy
If a later feature needs a schema hook now, add only the minimum backwards-compatible hook. Example: a nullable `short_intro` field may be justified before all Storylines are backfilled. A full recommendation service is not.

## Deliverable
Return:
- ordered implementation phases
- estimated risk: low / medium / high
- migrations required
- components likely to be reused
- components likely to be introduced
- explicit list of things you will NOT touch

Wait for the next phase prompt after the plan.
