# QA and Acceptance Tests

## Build/test baseline

Before changes:

- Run existing test suite.
- Run typecheck.
- Run lint.
- Run build.
- Record existing failures.

After changes:

- Run the same commands.
- New failures must be fixed or documented if unrelated baseline failures existed.

## Functional acceptance tests

### A. Existing story generation still works

Steps:

1. Create a new story.
2. Generate beats/images/narration/options using existing flow.
3. Confirm no regression.

Expected:

- Story generation completes.
- Images render.
- Narration works.
- Options appear.

### B. Image regeneration is continuity-safe

Steps:

1. Open a story with multiple beats.
2. Regenerate image for beat 1 using suggestion: `Make the lighting warmer.`
3. Wait for completion.

Expected:

- Beat 1 text unchanged.
- Beat 2+ remain unchanged.
- Narration unchanged.
- Options unchanged.
- New image version is active.
- Old image version remains available.

### C. Advanced per-panel image regeneration

Steps:

1. Open a 4-panel beat.
2. Add overall suggestion.
3. Add different panel suggestions for panels 1-4.
4. Regenerate.

Expected:

- Output keeps 4 panels.
- Panel-level instructions are applied where possible.
- Story event and characters are preserved.
- Version history stores suggestions.

### D. Restore previous image version

Steps:

1. Regenerate an image twice.
2. Open version history.
3. Restore version 1.

Expected:

- Version 1 becomes active.
- Other versions remain saved.
- Story text/future beats unchanged.

### E. Edit latest beat text

Steps:

1. Open latest beat with no downstream beats.
2. Edit beat text.
3. Save.

Expected:

- Beat updates without destructive warning.
- Revision metadata stored.
- Optional prompt to regenerate narration/image/options appears if implemented.

### F. Edit past beat requires confirmation

Steps:

1. Open beat 1 of a multi-beat story.
2. Attempt story text edit.

Expected:

- System warns that downstream content will be removed.
- Shows affected count if available.
- No changes happen before confirmation.

### G. Cancel past edit

Steps:

1. Trigger edit warning.
2. Click cancel.

Expected:

- Beat text unchanged.
- Downstream beats unchanged.
- No wipe event created.

### H. Confirm past edit

Steps:

1. Edit beat 1.
2. Confirm rewrite.

Expected:

- Beat 1 text updated.
- Beats after beat 1 are archived/deleted according to project convention.
- Rewrite event stored.
- Story can continue from edited beat.

### I. Narration regeneration

Steps:

1. Click regenerate narration for a beat.

Expected:

- Narration/audio/timestamps update.
- Story text unchanged.
- Image unchanged.
- Future beats unchanged.

### J. Options regeneration for latest beat

Steps:

1. Open latest beat.
2. Regenerate options.

Expected:

- Options update.
- Story text/image/narration unchanged.
- No downstream wipe.

### K. Options regeneration for past beat

Steps:

1. Open a past beat with downstream content.
2. Try to regenerate options.

Expected:

- Either disabled or shows timeline rewrite warning.
- No downstream change without confirmation.

### L. Custom option with valid `@name`

Steps:

1. Add custom option: `@Milo opens the hidden door.`
2. Submit.

Expected:

- `@Milo` validates against current story characters.
- Option stored as user custom.
- Option can be selected/used.

### M. Custom option with invalid `@name`

Steps:

1. Add custom option with unknown character.

Expected:

- Useful error shown.
- Option not stored unless unknown mentions are allowed by product decision.

### N. Feature flag disabled

Steps:

1. Disable image regeneration flag.
2. Reload story UI.

Expected:

- UI action hidden/disabled.
- Backend route/action rejects direct request safely.

## Non-functional checks

- Regeneration buttons prevent duplicate clicks.
- Loading state is clear.
- Failed generation preserves previous image.
- Mobile layout remains usable.
- Accessibility labels are present for destructive dialogs.
- Storage cleanup/orphan behavior is documented.

## Acceptance summary

Pack 1 is accepted only when:

- Safe visual regeneration works.
- Timeline-changing edits require explicit confirmation.
- Version history prevents image loss.
- Existing generation remains stable.
- Admin can disable the feature.
