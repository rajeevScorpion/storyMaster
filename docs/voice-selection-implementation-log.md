# Voice Selection Implementation Log

## 2026-04-22

### Initial architecture inspection

- Admin global settings are stored in `public.feature_flags`, with reads/writes centralized in `lib/ai/model-config.ts` and admin-facing actions in `app/actions/admin.ts`.
- The Global Settings UI is `components/admin/GlobalSettings.tsx`, mounted by `app/admin/settings/page.tsx`.
- Current narration voice persistence is `stories.narrator_voice`, represented in app state as `StorySession.narratorVoice`.
- Gemini TTS is invoked in `app/actions/narration.ts` through `callGeminiTTS()`, then exposed as `generateNarrationOnly()` and `generateAndPersistNarration()`.
- Beat audio generation is orchestrated in `lib/store/story-store.ts`. Persisted audio is uploaded to `story-assets/{userId}/{storyId}/{nodeId}/audio.wav`, written to `beats.audio_url`, and reloaded through signed URLs in `app/actions/persistence.ts` / `lib/supabase/storage.ts`.
- The requested "second column, second row" user UI maps to `components/story/AdvancedOptions.tsx`, where the second column currently starts with Visual Preset and then the visual detail row. The narration voice selector is inserted between those two controls.

### Branch note

- Requested branch: `feature/user-led-narration-voice-selection`.
- Creating the branch inside the sandbox initially failed on `.git/refs/heads/feature` permissions. Retried with approved escalation and created the requested branch successfully.

### Implementation decisions

- Global narration voice settings remain feature-flag backed for consistency with existing Global Settings.
- Story-level source of truth is explicit DB columns added to `stories`, while `stories.narrator_voice` remains the voice ID for backward compatibility.
- Voice sample files use a new public Supabase Storage bucket, `narration-voice-samples`, and a `narration_voice_samples` table for per-voice/per-language status.
- Sample text changes are handled by versioning samples with `sample_text_hash`; old sample rows are preserved and the active UI only reads rows matching the current text hash.
- Existing legacy stories keep `legacy_auto` mode. If a legacy story already has `narrator_voice`, that locked voice is reused instead of re-running AI selection.
- Sample generation is quota-aware: the default admin action skips already-ready samples for the active text hash, an explicit Regenerate All action overwrites ready samples, and TTS calls are paced in groups of 6 per 65 seconds with retry handling for Gemini `429 RESOURCE_EXHAUSTED`.
- Raw Gemini/sample errors are sanitized into one-line admin messages before display and before storing new failed sample rows.

### Files expected to change

- `supabase/migrations/030_user_led_narration_voice_selection.sql`
- `supabase/migrations/030_user_led_narration_voice_selection_rollback.sql`
- `lib/ai/narration-voices.ts`
- `lib/ai/narration-voice-settings.ts`
- `lib/ai/narration-voice-resolver.ts`
- `lib/types/story.ts`
- `lib/types/database.ts`
- `app/actions/admin.ts`
- `app/actions/narration.ts`
- `app/actions/persistence.ts`
- `app/actions/exploration.ts`
- `lib/store/story-store.ts`
- `components/admin/GlobalSettings.tsx`
- `components/story/LandingScreen.tsx`
- `components/story/AdvancedOptions.tsx`
