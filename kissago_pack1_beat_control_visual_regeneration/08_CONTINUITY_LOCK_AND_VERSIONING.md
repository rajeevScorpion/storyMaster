# Continuity Lock and Versioning Rules

## Continuity categories

Every user action should be classified before execution.

### Safe visual action

Does not affect story continuity.

Examples:

- Regenerate image.
- Refine image.
- Reimagine image while preserving story meaning.
- Restore old image version.
- Add visual suggestion.
- Change per-panel visual direction.

Result:

- No downstream wipe.
- No story text change.
- No selected option change.

### Safe asset action

Usually does not affect story continuity.

Examples:

- Regenerate narration from same beat text.
- Regenerate audio/timestamps.

Result:

- No downstream wipe.
- Update narration/audio only.

### Potentially timeline-changing action

May affect future story.

Examples:

- Edit beat story text.
- Change selected option.
- Select a newly added custom option on an older beat.
- Regenerate options for a beat whose option already led to downstream beats.

Result:

- If no downstream beats exist, allow.
- If downstream beats exist, require explicit confirmation.
- On confirmation, wipe/archive downstream chain from the beat after the edited beat.

## Locked beat rule

A beat is locked for story-changing edits if there are active downstream beats.

```ts
isBeatLockedForStoryEdit(beat) = activeBeats.exists(b => b.index > beat.index)
```

This lock should not block visual regeneration.

## Downstream wipe boundary

If source beat index is `N`, wipe/archive:

- Beats with index greater than `N`.
- Options attached to wiped beats.
- Narration/audio attached to wiped beats.
- Images/image versions attached to wiped beats.
- Export caches/derived artifacts after that point.
- Future path/selected option metadata after that point.

Do not wipe:

- Source beat.
- Source beat image versions unless explicitly regenerating source image.
- Source beat narration unless user regenerates it.
- Story-level settings.
- Character reference data.

## Confirmation copy

Use strong, clear text:

```text
Changing this beat will rewrite the story from this point onward.

All later beats, generated images, narration, and options after this beat will be removed. You can then continue the story again from the updated version.

Do you want to continue?
```

Buttons:

- Cancel
- Rewrite from this beat

## Image versioning rules

- Initial generated image becomes version 1.
- Every regeneration creates a new version.
- Only one active version per beat.
- Restore changes active version only.
- Version stores prompt snapshot.
- Version stores user suggestion snapshot.
- Version stores panel suggestions snapshot.
- Version stores mode: initial/refine/reimagine/restore.

## Image version display

Show:

- Version number.
- Thumbnail.
- Active badge.
- Created date/time.
- Mode.
- Suggestion summary.
- Restore action.

## Narration versioning

Preferred:

- Version narration/audio if storage cost is acceptable.

Minimum:

- Replace current narration/audio but keep timestamp/update metadata.

## Options versioning

Preferred:

- Keep option generation batch history.

Minimum:

- Replace non-selected AI-generated options only when safe.
- Keep user custom options unless user deletes them.

## Audit trail

Record:

- Who edited.
- What action happened.
- Whether downstream content was affected.
- Which beat was source.
- When it happened.

This helps debug user complaints and regeneration issues.
