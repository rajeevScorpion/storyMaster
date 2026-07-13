# Data Model and Migration Guide

This guide describes desired data capabilities. Adapt to the existing stack and naming conventions after discovery.

## Core entities to support

### Beat revision metadata

Need to track edits and whether a beat has been story-modified.

Suggested fields or table:

```ts
BeatRevision {
  id: string
  storyId: string
  beatId: string
  revisionNumber: number
  previousText?: string
  newText: string
  editType: 'story_text_edit' | 'system_regeneration' | 'admin_fix'
  causedTimelineRewrite: boolean
  downstreamWipeId?: string
  createdByUserId: string
  createdAt: Date
}
```

### Beat lock state

This can be computed or stored.

Preferred computed logic:

```ts
isLocked = exists downstream beat where beat.index > currentBeat.index and downstream beat is active
```

Optional stored fields:

```ts
Beat {
  lockedAfterIndex?: number
  lastEditedAt?: Date
  lastStoryChangingEditAt?: Date
}
```

Do not over-store if computed logic is enough.

### Downstream wipe event

Track when the user confirms a past edit.

```ts
TimelineRewriteEvent {
  id: string
  storyId: string
  sourceBeatId: string
  sourceBeatIndex: number
  reason: 'beat_text_changed' | 'selected_option_changed' | 'custom_option_selected'
  confirmationTextShown: string
  affectedBeatIds: string[]
  affectedAssetIds?: string[]
  createdByUserId: string
  createdAt: Date
}
```

Depending on scale, affected IDs can be logged in a child table instead of array.

### Storyboard/image versions

Every image regeneration should create a version, not overwrite blindly.

```ts
BeatImageVersion {
  id: string
  storyId: string
  beatId: string
  versionNumber: number
  imageUrl: string
  storageKey?: string
  thumbnailUrl?: string
  promptSnapshot: Json
  regenerationMode: 'initial' | 'refine' | 'reimagine' | 'restore'
  overallSuggestion?: string
  panelSuggestions?: Json
  panelCount: 1 | 2 | 4
  sourceImageVersionId?: string
  isActive: boolean
  generatedBy: 'system' | 'user'
  createdByUserId?: string
  createdAt: Date
}
```

### Image regeneration request/job

Useful for async generation and audit.

```ts
ImageRegenerationRequest {
  id: string
  storyId: string
  beatId: string
  requestedByUserId: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  mode: 'refine' | 'reimagine'
  overallSuggestion?: string
  panelSuggestions?: Json
  preserveCharacterIdentity: boolean
  preserveStoryMeaning: boolean
  outputImageVersionId?: string
  errorMessage?: string
  createdAt: Date
  updatedAt: Date
}
```

### Options

Existing options may already exist. Add fields if missing:

```ts
Option {
  source: 'ai_generated' | 'user_custom'
  rawText: string
  normalizedText?: string
  characterMentions?: Json
  isSelected?: boolean
  createdByUserId?: string
}
```

### Character mentions in custom option

Do not implement global character library. Use only existing story-level named characters.

```ts
CharacterMention {
  displayText: string // '@Milo'
  characterName: string // 'Milo'
  characterId?: string // if current story has ID
  startIndex: number
  endIndex: number
  valid: boolean
}
```

## Migration principles

- Additive only.
- Avoid required non-null fields on existing populated tables unless defaults are safe.
- Preserve existing image URL fields while introducing version table.
- Backfill current active images into version `1` if needed.
- Store prompt snapshots for reproducibility.
- Ensure ownership and story ID constraints.
- Add indexes for story ID, beat ID, active version, and created date.

## Suggested migration steps

1. Add image version table.
2. Backfill active image into version table, if existing images exist.
3. Add regeneration request table.
4. Add beat revision/timeline rewrite table.
5. Add option metadata fields if needed.
6. Add indexes.
7. Verify existing stories still read active images correctly.

## Rollback considerations

Rollback should not delete generated images immediately. Prefer:

- Disable feature flags.
- Keep new tables unused.
- Re-point beat image display to legacy field if needed.
- Archive orphaned regenerated image versions later.
