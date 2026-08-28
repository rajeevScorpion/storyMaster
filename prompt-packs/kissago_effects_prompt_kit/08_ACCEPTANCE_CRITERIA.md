# Acceptance Criteria

## Functional
- [ ] Creator can enable/disable effects per beat.
- [ ] Creator can choose a preset for a beat.
- [ ] Creator can edit settings such as amount, visibility, density, speed, and depth/intensity where applicable.
- [ ] Creator can save a custom preset.
- [ ] Creator can reuse a preset in another story.
- [ ] Creator can apply current effect config to all beats in the same story with one click.
- [ ] Creator can still customize a single beat after bulk application.
- [ ] Existing synced text and narration continue to work correctly.
- [ ] Existing transitions continue to work or are cleanly upgraded.
- [ ] Exported videos include the same effects.

## UX
- [ ] Controls are understandable and not overloaded.
- [ ] Preview updates quickly enough for practical use.
- [ ] There are sensible defaults.
- [ ] System presets make the feature easy to adopt.

## Technical
- [ ] Effect config is schema-based and reusable.
- [ ] Export path consumes the same effect data model as preview.
- [ ] Playback remains stable and does not regress heavily.
- [ ] Code is modular and documented.
- [ ] Tests cover effect normalization and critical behavior.

## Performance
- [ ] Player remains usable on realistic target hardware.
- [ ] There are guardrails against destructive settings.
- [ ] Expensive effects are throttled, capped, or quality-scaled.

## Reliability
- [ ] Missing or corrupt effect config fails gracefully.
- [ ] Unsupported preset versions are handled safely.
- [ ] Export failures surface actionable errors.

