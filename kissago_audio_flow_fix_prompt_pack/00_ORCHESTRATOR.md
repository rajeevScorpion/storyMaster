# 00 — Orchestrator: Kissago Reels Audio Pipeline Fix

## Purpose

This folder is the implementation brief for fixing and improving the Kissago Reels audio/narration pipeline.

Use the attached screenshots as the source of the product planning and use this folder as the structured engineering prompt.

The final system should be:

- Provider-aware
- Language-aware
- Timestamp-aware
- Preview-safe
- Export-safe
- Admin-configurable
- Clear for users

## Main implementation order

Follow this order. Do not skip ahead unless the existing codebase already has that part solved.

### Phase 1 — Audit current implementation

Find the existing code for:

- Beat text generation
- Voice settings UI
- Voice preview generation
- ElevenLabs calls
- Gemini TTS calls
- Preview list UI
- Apply preview action
- Active narration state
- Text highlight settings
- Reel playback preview
- Export pipeline
- Storage/database tables for audio/previews

Create a short map of current files before editing.

### Phase 2 — Add shared types and metadata

Implement or update shared types for:

- NarrationPreview
- ActiveNarration
- BeatNarration
- WordTimestamp
- TTSProvider
- TimestampSource
- PreviewScope

The key idea is that every generated preview must store provider, model, voice, language, audio URL, duration, timestamp status, fallback status, and highlight support.

### Phase 3 — Fix provider fallback logic

Implement the provider priority:

1. ElevenLabs
2. Gemini TTS

ElevenLabs should be tried first when available.

Gemini should be used when ElevenLabs fails, times out, is unavailable for the language, or selected voice/model is unavailable.

### Phase 4 — Fix timestamp and text highlight logic

Text highlighting must not be inferred loosely.

Final rule:

```ts
textHighlightSupported = provider === "elevenlabs" && wordTimestamps?.length > 0;
```

Gemini should always set:

```ts
textHighlightSupported = false;
timestampSource = "none";
```

### Phase 5 — Fix preview, apply, and export

Preview generation must save complete metadata.

Apply preview must preserve metadata and make the applied preview the source of truth.

Export must use the applied full preview audio.

Export must not fail only because word highlighting is unavailable.

### Phase 6 — Add multi-beat/panel narration support

For Gemini, do not send the whole reel narration as one block when timing matters.

Generate audio per beat/panel and use each clip duration to drive transitions.

For ElevenLabs, use word timestamps if available and offset them across the timeline.

### Phase 7 — Add TTS script writer layer

Before sending text to TTS providers, create clean provider-ready narration scripts.

Do not send raw beat text directly when a prepared script is available.

The script writer should remove visual instructions and create natural spoken narration.

### Phase 8 — Add admin voice/language presets

Voice options should not be hardcoded only in the frontend.

Create admin/database-driven voice presets and language availability controls.

User-side voice choices must be filtered by language, tier, and active status.

### Phase 9 — UI cleanup

The user must clearly see:

- Which provider generated the preview
- Which model was used
- Whether fallback was used
- Whether text highlight is supported
- Why highlight is unavailable when disabled

### Phase 10 — Testing

Run through all scenarios in `10_TESTING_ACCEPTANCE_CRITERIA.md`.

## Non-negotiable rules

Do not allow Gemini-generated audio to pretend that text highlight is supported.

Do not show enabled highlight controls when word timestamps are missing.

Do not discard timestamps after preview generation.

Do not use sample preview audio for final export.

Do not fail final export only because word highlight is unavailable.

Do not expose raw API errors to normal users.

Do not hardcode all voice options only in frontend components.

Do not send raw beat text directly to TTS if a prepared narration script exists.
