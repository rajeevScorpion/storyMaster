# Story Bible, Continuity and Episodic Integration

## Story Bible

Extend the existing Story Bible rather than creating a separate competing continuity store.

Each adopted reference should add a versioned entry containing:

- stable ID
- display name
- type
- concise description
- canonical asset
- style lock
- first introduction
- story/episode/branch scope
- stable anchors
- changeable attributes
- aliases
- provider state
- status

## Beat-level reference resolution

Before compiling an image prompt:

1. Determine named characters present in the beat.
2. Resolve by stable ID, not text name alone.
3. Determine world/location for the beat.
4. Resolve relevant story/branch scope.
5. Select canonical references within provider input limits.
6. Include concise anchors.
7. Record actual usage.

Do not attach unused references.

## Episodes

Follow existing Kissago episodic decisions:

- Named characters can migrate into an episode branch.
- Story Bible and journal carry forward.
- Character continuity remains explicit.
- User may mix characters from different stories only through the existing character-library/local-character rules.
- A world reference should carry forward only when intentionally part of the episode context.
- Cross-story reuse should create a new story-specific adoption when the selected visual style differs.

## Regeneration

Image regeneration should preserve:

- story/branch
- character adoption IDs
- world adoption IDs
- style lock
- continuity anchors

Overall and panel-level change instructions must not replace identity/world anchors unless the user explicitly changes the reference through a supported flow.

## Versioning

When an adoption is superseded:

- old beats retain their historical usage record
- new beats use the new version
- do not mutate historical generation metadata
