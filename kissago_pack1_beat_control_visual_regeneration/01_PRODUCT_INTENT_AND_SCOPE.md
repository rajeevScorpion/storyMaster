# Product Intent and Scope

## Product direction

Kissago currently generates story beats with images, narration, and options. Pack 1 gives users controlled post-generation editing and regeneration.

This is not a full “story world” system yet. It is the foundation that must exist before episodic continuity is introduced later.

## Core user needs

Users should be able to:

- Correct or improve a beat.
- Improve an image without changing the story.
- Ask for visual changes in simple language.
- Control individual storyboard panels in advanced mode.
- Regenerate narration when beat text changes.
- Regenerate options when they want better choices.
- Add their own custom option.
- Mention named characters using `@name`.
- Avoid accidentally breaking the story timeline.

## Product principle

Kissago should behave like a timeline:

> The past cannot be casually edited.  
> If the past changes, the future changes.

This means:

- Visual regeneration is safe.
- Narration regeneration is usually safe when based on unchanged text.
- Option regeneration is safe before a future path depends on the option.
- Editing beat text or selected choice is story-changing.
- Story-changing edits to older beats require explicit downstream wipe confirmation.

## In scope

### Beat story text edit

Allow users to edit beat text. If the beat has downstream beats, require confirmation before deleting/wiping everything after that beat.

### Image/storyboard regeneration

Allow users to regenerate images for any beat without changing story continuity.

Modes:

- `refine`: improve composition, clarity, consistency, quality.
- `reimagine`: allow stronger visual variation while preserving story meaning.

### Basic visual suggestion

A single instruction applies to the entire storyboard.

Examples:

- Make the lighting warmer.
- Make it more cinematic.
- Keep characters the same but add more forest detail.
- Make the mood more mysterious.

### Advanced per-panel visual suggestion

For storyboard layouts with 1, 2, or 4 panels, allow optional panel-level instructions.

Example:

- Overall: Keep the same characters and story, make it warmer.
- Panel 1: Show Tara looking surprised.
- Panel 2: Add more detail to the monument.
- Panel 3: Show Milo pointing upward.
- Panel 4: Show both friends smiling at sunset.

### Narration regeneration

Allow narration to be regenerated from the current beat text. This should not change image or future beats.

### Options regeneration

Allow options to be regenerated from the current beat context. If options have already been used to create downstream beats, protect the current path using the continuity rules.

### Custom option

Allow user to add a custom option. The custom option can contain `@name` references to named characters already available in that story.

### Image version history

Every image/storyboard regeneration should create a new version and preserve older versions. User can restore a previous version.

## Out of scope

Do not implement in this pack:

- Global character library.
- Saving characters globally.
- Character scope management.
- Character mixing across stories.
- Episode chains.
- Story bible.
- Episode journal.
- Educational travel series templates.

## Success criteria

This feature is successful when:

- Users can improve beat visuals without fear of breaking the story.
- Users understand when a story edit will wipe future content.
- The system prevents accidental timeline corruption.
- Images, narration, and options can be regenerated independently.
- The current generation flow remains stable.
