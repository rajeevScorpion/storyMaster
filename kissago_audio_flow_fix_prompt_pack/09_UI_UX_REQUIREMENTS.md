# 09 — UI and UX Requirements

## Main principle

The UI must be honest about what the generated narration supports.

Users should never think text highlight is available when the generated audio does not have word timestamps.

## Preview list UI

Each preview row should show:

- Preview number/name
- Voice name
- Scope: sample/full
- Provider
- Model
- Highlight status
- Fallback status if fallback was used

Examples:

```text
Preview 01
Alice · Sample · ElevenLabs v3
Highlight supported
```

```text
Preview 02
Bangla Voice · Full · Gemini TTS
Highlight unavailable · Fallback used
```

## Disabled text highlight state

If Gemini generated the final applied narration:

- Disable text highlight toggle.
- Show a small info note.

Message:

```text
Text highlight is unavailable for this narration because Gemini TTS does not provide word-level timestamps.
```

If ElevenLabs generated audio but timestamps are missing:

```text
Text highlight is unavailable because this preview did not return word-level timestamps.
```

## Fallback message

If ElevenLabs fails and Gemini is used:

```text
ElevenLabs could not generate this narration, so Gemini TTS was used instead. Text highlight is unavailable for this preview.
```

## Export validation UX

If no full preview is applied:

```text
Please generate and apply a full narration preview before export.
```

If only sample preview is applied:

```text
Sample preview is only for testing. Please generate and apply full narration before export.
```

If text highlight is enabled but unavailable:

```text
Text highlight was disabled because word timestamps are unavailable. Export will continue with narration audio.
```

## Voice settings UI

Voice list should be filtered by:

- Selected language
- User tier
- Active voices
- Provider availability

Each voice should show a short description:

```text
Alice — Warm, calm storytelling voice
Bella — Expressive emotional narration
Hindi Voice 01 — Natural Hindi narration
Bangla Voice 01 — Soft emotional Bangla narration
```

## Do not show raw errors

Do not show stack traces or raw API errors to regular users.

Show friendly messages and keep detailed errors in logs.
