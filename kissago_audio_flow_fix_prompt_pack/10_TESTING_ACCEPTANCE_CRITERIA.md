# 10 — Testing and Acceptance Criteria

## Test case 1 — ElevenLabs success with timestamps

Expected:

- Audio generated.
- Preview shows ElevenLabs provider/model.
- Word timestamps saved.
- Text highlight enabled.
- Applying preview preserves timestamps.
- Export includes text highlighting.

## Test case 2 — ElevenLabs success without timestamps

Expected:

- Audio generated.
- Preview shows ElevenLabs provider/model.
- Text highlight disabled.
- UI explains timestamps were not returned.
- Export works without highlight.

## Test case 3 — ElevenLabs failure to Gemini fallback

Expected:

- Gemini audio generated.
- Preview shows Gemini provider/model.
- Fallback used is visible.
- Text highlight disabled.
- UI explains Gemini does not support word timestamps.
- Export works without highlight.

## Test case 4 — Gemini selected/fallback for Bangla

Expected:

- Audio generated.
- Full preview works.
- Text highlight disabled.
- Panel and beat transitions follow audio duration.
- Export works.

## Test case 5 — Sample preview only

Expected:

- User can test sample preview.
- User cannot export final reel with only sample preview.
- UI asks user to generate and apply full preview.

## Test case 6 — Multi-beat reel

Expected:

- Audio generated per beat/panel where needed.
- Each panel duration comes from its audio clip.
- Beat transitions are aligned.
- ElevenLabs timestamps are offset correctly if available.
- Gemini uses clip duration only.

## Test case 7 — Apply preview does not lose metadata

Expected:

- Provider preserved.
- Model preserved.
- Voice name preserved.
- Audio URL preserved.
- Duration preserved.
- Word timestamps preserved if available.
- Highlight availability preserved.

## Test case 8 — Export safety

Expected:

- Export uses active full narration.
- Export blocks when no full narration is applied.
- Export continues when highlight is unavailable.
- Export does not crash because timestamps are missing.

## Acceptance criteria

The implementation is successful when:

1. User can generate sample preview.
2. User can generate full preview.
3. Preview list clearly shows provider, model, scope, and highlight availability.
4. ElevenLabs preview with timestamps enables text highlight.
5. Gemini preview disables text highlight and shows a clear note.
6. Applying full preview updates reel audio and transition timing.
7. Applying preview does not discard timestamp data.
8. Export uses the applied full preview audio.
9. Export does not fail only because text highlight is unavailable.
10. Multi-beat reels generate usable narration timing per beat/panel.
11. Gemini fallback works without breaking reel playback.
12. ElevenLabs failure does not silently break the flow.
13. Admin can configure voices by language, provider, and tier.
14. User only sees voices available for selected language and tier.
15. Logs clearly show which provider/model generated each preview.
16. Raw API errors are not exposed to users.
17. Text highlight controls are hidden or disabled whenever timestamps are unavailable.

## Do not do

Do not allow Gemini-generated narration to pretend that text highlight is supported.

Do not enable text highlight controls when word timestamps are missing.

Do not discard timestamps after preview generation.

Do not use sample preview audio for final export.

Do not fail final export only because word highlight is unavailable.

Do not expose raw API errors to normal users.

Do not hardcode voice options only in frontend components.

Do not send raw beat text directly to TTS if a prepared narration script is available.
