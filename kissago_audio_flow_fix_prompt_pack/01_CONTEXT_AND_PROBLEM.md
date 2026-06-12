# 01 — Context and Current Problem

## Product context

Kissago Reels generates beat-based visual stories and reels.

Narration audio is generated after the beat text is finalized.

The generated audio directly affects:

- Panel duration
- Beat transition timing
- Reel preview playback
- Final video export
- Text highlighting during narration

Current TTS providers:

- ElevenLabs
- Gemini TTS

## Important limitation

Gemini TTS does not provide word-by-word timestamps.

Because of this, Gemini-generated narration cannot support word-level text highlighting.

ElevenLabs can provide word-level timestamps. Text highlighting should only be enabled when ElevenLabs successfully returns usable word timestamps.

## Current intended flow

1. Beat text is generated.
2. User configures voice settings.
3. User generates voice preview.
4. User tests the preview.
5. User applies the preview.
6. Applied preview becomes the active reel narration.
7. User exports the video.

For multi-beat reels:

1. User can generate narration for all beats.
2. Each beat/panel should have usable timing.
3. Final export should use the applied full narration audio.

## Current observed issue

A test was done in Bangla.

Observed behavior:

- Sample preview in Bangla worked.
- Full preview in Bangla failed with unexpected error.
- Changing model from multilingual v2 to v3 made full preview work.
- Full preview audio played after applying.
- Text highlight did not work.

Likely causes:

- Full preview is not returning timestamp JSON.
- Timestamp JSON is returned but not stored.
- Timestamp JSON is stored but lost during Apply.
- Active narration does not preserve preview metadata.
- Gemini fallback is being used but UI still expects text highlight.
- Text highlight settings remain visible even when unsupported.
- Preview UI does not clearly show provider/model/timestamp status.

## Desired outcome

The narration system should clearly separate these cases:

### ElevenLabs with timestamps

Audio works and text highlight works.

### ElevenLabs without timestamps

Audio works, text highlight disabled with explanation.

### Gemini TTS

Audio works, text highlight disabled with explanation.

### Provider fallback

If ElevenLabs fails, Gemini is used, and the user sees that fallback happened.
