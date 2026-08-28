# Frontend UX Flows

## Beat action menu

Each beat should expose actions depending on feature flags and beat state.

Suggested actions:

- Edit story text
- Regenerate image
- Regenerate narration
- Regenerate options
- Add custom option
- View image versions

## Beat text edit flow

### Unlocked/latest beat

1. User clicks `Edit beat text`.
2. Edit dialog opens.
3. User edits text.
4. User saves.
5. Beat text updates.
6. Prompt user to optionally regenerate narration, image, and options.

### Locked/past beat with downstream beats

1. User clicks `Edit beat text`.
2. UI shows locked timeline warning before or after edit attempt.
3. User can preview affected count.
4. If user cancels, no changes happen.
5. If user confirms, downstream beats/assets are wiped and beat text is saved.
6. Story can continue from edited beat.

Warning copy:

```text
Changing this beat will rewrite the story from this point onward.

All later beats, generated images, narration, and options after this beat will be removed. You can then continue the story again from the updated version.

Do you want to continue?
```

Buttons:

- `Cancel`
- `Rewrite from this beat`

Use a destructive color/style for confirmation.

## Image regeneration flow

1. User clicks `Regenerate image`.
2. Modal opens.
3. User selects mode:
   - Refine image
   - Reimagine image
4. User optionally adds overall visual suggestion.
5. User can open `Advanced panel controls`.
6. UI shows fields based on panel count: 1, 2, or 4.
7. User submits.
8. UI shows generation status.
9. New image version appears as active.
10. Previous versions remain accessible.

Basic modal fields:

```text
What would you like to change visually?
[textarea]

Mode:
( ) Refine — keep the scene close, improve quality/composition
( ) Reimagine — allow a stronger visual reinterpretation while preserving story

[Advanced panel controls]
```

Advanced panel fields:

```text
Overall storyboard instruction
[textarea]

Panel 1 instruction
[textarea]

Panel 2 instruction
[textarea]

Panel 3 instruction
[textarea]

Panel 4 instruction
[textarea]
```

Only show panel fields that match current layout.

## Image version history flow

1. User clicks `Versions`.
2. Drawer/modal opens.
3. Show thumbnails with metadata:
   - Version number
   - Created time
   - Mode
   - Suggestion summary
   - Active badge
4. User can preview version.
5. User can click `Restore this version`.
6. Restored version becomes active.

Do not delete old versions from UI unless admin cleanup exists.

## Narration regeneration flow

1. User clicks `Regenerate narration`.
2. Confirm light message:

```text
This will regenerate narration for this beat only. Story text and image will not change.
```

3. Run job/action.
4. Update narration/audio/timestamps.

## Options regeneration flow

For latest/open beat:

1. User clicks `Regenerate options`.
2. Show message:

```text
This will replace the current generated options for this beat. Story text and image will not change.
```

3. Replace AI-generated options.
4. Keep user custom options unless product decision says otherwise.

For past beat with downstream story:

Show timeline warning if option change can alter future story.

Recommended UX:

```text
Options for this beat already shaped the later story. Regenerating or changing them may rewrite the story from this point onward.
```

## Custom option flow

1. User clicks `Add custom option`.
2. Textarea opens.
3. User types option.
4. When user types `@`, show named-character suggestions from current story.
5. User selects character.
6. Submit validates mentions.
7. Store custom option.
8. User can choose it to continue story.

Example placeholder:

```text
Write your own next choice. Use @name to reference story characters.
Example: @Milo and @Tara enter the hidden garden together.
```

## Empty/error states

### Unknown @name

```text
We could not find @Tara in this story. Choose one of the existing character names or remove the mention.
```

### Image generation failed

```text
Image regeneration failed. Your previous image is still safe. Please try again.
```

### Timeline rewrite canceled

```text
No changes were made. Your story timeline is unchanged.
```

## UX guardrails

- Make safe regeneration feel easy.
- Make destructive story edits clearly intentional.
- Never hide downstream wipe in small text.
- Never wipe future content on first click.
- Avoid exposing technical terms like database, migration, or job queue to users.
