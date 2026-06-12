# 02 — Audio Pipeline Specification

## Pipeline overview

The Kissago Reels narration flow should follow this pipeline:

```text
Beat text generated
→ User configures voice settings
→ TTS script writer prepares narration scripts
→ User generates sample/full preview
→ System attempts ElevenLabs first where available
→ System falls back to Gemini if needed
→ Preview metadata is saved
→ User tests preview
→ User applies full preview
→ Active narration is updated
→ Reel timing and transitions are updated
→ User exports video
```

## Preview scopes

There are two preview scopes:

### Sample preview

Used for testing a voice quickly.

A sample preview should not be used for final export.

### Full preview

Used as the final narration candidate for the reel.

Only a full preview can be applied for final export.

## Generation rules

When generating narration:

1. Use the selected language.
2. Use the selected voice preset if available.
3. Prefer ElevenLabs when supported.
4. Fall back to Gemini when ElevenLabs fails or is unavailable.
5. Store all generation metadata.
6. Store word timestamps only if returned.
7. Determine highlight support from actual timestamps.

## Active narration rule

The applied full preview becomes the source of truth.

Active narration must include:

- Preview ID
- Provider
- Model
- Voice ID
- Voice name
- Language
- Audio URL
- Duration
- Word timestamps if available
- Text highlight support boolean
- Timestamp source
- Scope

## Transition timing rule

Audio duration should drive panel/beat transitions.

For ElevenLabs:

- If word timestamps exist, they can be used for word highlight and finer transition logic.
- Panel transitions may use the last word timestamp plus transition delay.

For Gemini:

- No word timestamps exist.
- Use generated audio clip duration only.
- For multi-beat reels, prefer generating separate audio per beat/panel to get reliable timing.

## Failure behavior

If a provider fails:

- Capture the error internally.
- Show user-friendly message.
- Attempt fallback when possible.
- Do not leave UI stuck in loading state.
- Do not expose raw API stack traces.
