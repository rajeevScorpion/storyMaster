# Backend API and Jobs Guide

Adapt names and route patterns to the current codebase.

## Required backend capabilities

### 1. Beat text editing

Service behavior:

```ts
editBeatText({ storyId, beatId, newText, confirmTimelineRewrite })
```

Rules:

- Verify user owns story.
- Verify beat belongs to story.
- Determine if beat has downstream active beats.
- If no downstream beats: edit beat text and create revision.
- If downstream beats exist and `confirmTimelineRewrite` is false: return warning with affected count.
- If downstream beats exist and `confirmTimelineRewrite` is true: edit beat, wipe/archive downstream content, create rewrite event.

Response shape:

```json
{
  "status": "requires_confirmation | updated | failed",
  "affectedBeatCount": 3,
  "affectedAssets": ["images", "narration", "options"],
  "message": "Changing this beat will remove all later beats and generated assets."
}
```

### 2. Downstream wipe/archive

Implement according to existing conventions.

Recommended behavior:

- Prefer soft delete/archive if current system supports it.
- If hard delete is the project standard, record `TimelineRewriteEvent` before deletion.
- Remove or deactivate downstream:
  - beats
  - options
  - selected choices
  - images/image versions
  - narration/audio/timestamps
  - export caches
  - derived story status after the edited point

Do not delete the source beat.

### 3. Image regeneration

Service behavior:

```ts
regenerateBeatImage({
  storyId,
  beatId,
  mode,
  overallSuggestion,
  panelSuggestions
})
```

Rules:

- Does not modify story text.
- Does not modify selected option.
- Does not wipe future beats.
- Preserves beat event and character identity.
- Creates `ImageRegenerationRequest`.
- Creates new `BeatImageVersion` when complete.
- Marks new version active.
- Keeps previous versions.

### 4. Restore image version

Service behavior:

```ts
restoreBeatImageVersion({ storyId, beatId, imageVersionId })
```

Rules:

- Verify ownership.
- Version must belong to beat/story.
- Set all other versions inactive.
- Set selected version active.
- Do not regenerate anything.

### 5. Narration regeneration

Service behavior:

```ts
regenerateBeatNarration({ storyId, beatId })
```

Rules:

- Uses current beat text only.
- Does not change beat text.
- Does not change image.
- Does not wipe future beats.
- Replace or version narration based on existing architecture.
- If word-level timestamps exist, regenerate them consistently.

### 6. Options regeneration

Service behavior:

```ts
regenerateBeatOptions({ storyId, beatId })
```

Rules:

- Uses current beat/story context.
- If no downstream beat depends on selected option: safe regeneration.
- If downstream beat exists because an option was selected: protect selected path. Either disallow regeneration or require timeline rewrite confirmation, depending on product decision.
- Store options as AI-generated.

Recommended default:

- Allow regeneration only for the latest/current open beat.
- For past beats with downstream content, show timeline rewrite warning if options could alter story path.

### 7. Custom option

Service behavior:

```ts
addCustomOption({ storyId, beatId, optionText })
```

Rules:

- Parse `@name` mentions.
- Validate names against existing named characters in current story context.
- Store as `source: user_custom`.
- Do not generate next beat until user selects/continues with that option.

### 8. `@name` parser

Minimum parser behavior:

- Detect `@` followed by letters, numbers, spaces if supported, hyphens/underscores if existing names allow.
- Match against named characters in the current story.
- Prefer exact match.
- Support autocomplete in UI, but backend validation remains required.
- Return useful error for unknown names.

Example validation response:

```json
{
  "valid": false,
  "unknownMentions": ["@Tara"],
  "availableCharacters": ["Milo", "Captain Barnaby", "Pip"]
}
```

## Async job guidance

If the existing app uses background jobs:

- Use queue for image/narration regeneration.
- Return request/job ID immediately.
- UI polls or subscribes to status.

If current app is synchronous:

- Keep existing synchronous pattern if practical.
- Avoid huge architecture rewrite in Pack 1.

## Security and permissions

Every route/action must check:

- User is authenticated.
- User owns story.
- Beat belongs to story.
- Image version belongs to beat/story.
- Character references belong to current story context.

## Idempotency

For regeneration requests, consider idempotency key or duplicate prevention to avoid double billing/double generation from repeated clicks.

## Cost control

Image regeneration can be expensive. Add:

- Loading/processing states.
- Duplicate-click prevention.
- Optional admin/tier controls.
- Request logging.
- Failure retry only when safe.
