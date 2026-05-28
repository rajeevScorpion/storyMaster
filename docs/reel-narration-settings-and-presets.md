# Kissago Reel Narration Settings And Presets

## Grounding

- Reel creation starts in `components/story/LandingScreen.tsx`, builds a `StoryConfig`, and flows through `lib/store/story-store.ts` where reel stories use `startReel`.
- Reel editing and on-demand narration live in `components/story/StoryScreen.tsx`; final video export uses `hooks/useReelVideoExport.ts` and requires beat image/audio URLs.
- Existing reel TTS lives in `app/actions/narration.ts`. Reels already prefer ElevenLabs `/v1/text-to-speech/:voice_id/with-timestamps`; Gemini TTS remains the fallback path.
- Admin reel settings already use the `reel_story_settings` feature flag JSON through `lib/reel/settings.ts` and `/admin/settings/reels`.
- Supabase migrations are paired forward/rollback files in `supabase/migrations`; this feature adds `054_reel_narration_presets.sql` and `054_reel_narration_presets_rollback.sql`.

## API Grounding

- ElevenLabs timing TTS supports request-level `model_id`, `language_code`, `voice_settings`, and `pronunciation_dictionary_locators`: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- ElevenLabs pronunciation dictionaries are passed as dictionary/version locators: https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries
- Gemini TTS uses a prebuilt voice and natural-language instructions for style, tone, accent, and pace: https://ai.google.dev/gemini-api/docs/speech-generation

## Data Model

- `narration_presets` stores seeded system presets and private user presets.
- `reel_narration_settings` stores one narration profile per reel story.
- `narration_generation_logs` records provider, fallback, voice/model, language metadata, preset, duration, error, output path, and cost metadata.
- `reel_story_settings.narration` stores admin defaults such as enabled system presets, default preset, allowed voices, preview/final models, fallback voice, max length, and feature toggles.

## Runtime Decisions

- The user-selected reel language is primary. Script detection only records detected/mixed-language metadata and does not block generation.
- Preview narration uses the configured preview ElevenLabs model; final generation uses the configured final model unless a preset/model override is selected.
- ElevenLabs receives provider-native `voice_settings`, optional `language_code`, and pronunciation locators only when admin/user settings allow them.
- Unsupported expressive tags are stripped and converted into delivery instructions. Gemini receives plain-language performance guidance with paced text.
- Changing reel narration settings clears existing beat audio locally and in persistence so final narration is regenerated with the new voice profile.

## Manual Test Checklist

- Create a reel, choose language, preset, and voice, preview narration, save a preset, generate final narration, and export video.
- Change narration settings after audio exists and confirm existing audio is cleared before regeneration.
- Force ElevenLabs failure, quota exhaustion, unsupported language, or timeout and confirm Gemini fallback generates audio and logs fallback metadata.
- Confirm system presets are visible to all users and private presets are only visible to the owner.
- Duplicate, update, delete, and set default user presets.
- Apply `054_reel_narration_presets_rollback.sql` in a disposable database and confirm it drops the new tables/settings without touching stories, beats, media, or reel publishing flags.
