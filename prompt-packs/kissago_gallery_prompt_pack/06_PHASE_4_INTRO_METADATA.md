# 06 — Phase 4: Storyline Introduction Metadata

## Objective
Every Gallery Storyline should be able to present a concise, high-quality 1–2 line introduction without requiring expensive generation or full-story processing during Gallery reads.

## First inspect
Determine:
- where Storyline text/content is finalized
- which prompt currently generates Storyline/story text and options
- whether structured metadata is already generated
- how prompt versioning is handled
- where Storyline records are persisted

## New Storylines
At the most appropriate existing generation stage, generate a concise discovery introduction as structured output.

The introduction should:
- be approximately 1–2 short sentences
- describe the premise, not spoil the story
- work as catalogue copy
- be age-appropriate in language
- not repeat the title unnecessarily
- not contain formatting markup unless the app already expects it

Prefer storing this once with the Storyline rather than generating it during Gallery load.

## Legacy fallback
For Storylines without stored intro:
1. locate the best existing opening text source,
2. derive a deterministic short fallback,
3. normalize whitespace/markup,
4. truncate at a sensible sentence/character boundary,
5. avoid a network AI call during Gallery read.

Do not mutate all legacy rows merely to make Gallery render unless a backfill is proven beneficial.

## Schema strategy
If a field is needed:
- prefer a nullable additive field such as the repository's naming convention equivalent of `short_intro`
- migration must be backwards-compatible
- Gallery must continue working while the field is null

## Optional backfill
Only add a one-time backfill script/job if:
- repository patterns support it,
- fallback quality is materially insufficient,
- and it can be run safely and idempotently.

Do not call an LLM for thousands of old rows without an explicit cost/control strategy.

## Acceptance criteria
- new Storylines persist a concise intro
- legacy Storylines display a deterministic fallback
- Gallery reads do not call an LLM
- malformed/empty story text does not break cards
- intro is not a spoiler dump

## Commit split
If schema + pipeline change is substantial, use two commits:
1. schema/read fallback
2. generation pipeline write path
