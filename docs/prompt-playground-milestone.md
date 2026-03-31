# Prompt + Model Playground Milestone

Date: 2026-03-31

## Summary
- The admin playground now supports both model iteration and prompt iteration in one workspace.
- Prompt drafts, published prompts, publish history, and shared test runs are persisted in Supabase.
- Publishing a prompt makes it live immediately for production use without a deploy.
- Model configs can be applied to production directly from the playground without running a test first.

## Supported Prompt Tasks
- `story_generation`
- `visual_prompt`
- `image_generation`
- `tts`
- `voice_selection`

## Production Wiring
- Story generation reads published prompt templates at runtime.
- Visual prompt composition reads published prompt templates at runtime.
- Image generation uses a second prompt layer after the visual composer:
  - the visual composer generates the base image prompt
  - the image wrapper prompt refines the final text sent to the image model
- TTS and voice selection now read from the prompt-config system.

## Data Model
- `prompt_configs`: live published prompt per task
- `prompt_drafts`: per-admin prompt drafts
- `prompt_history`: immutable published prompt history
- `prompt_test_runs`: shared saved prompt test runs

## Important Notes
- Gemini TTS should not receive a separate `systemInstruction`.
- The TTS guidance must stay inside the prompt body; adding a separate `systemInstruction` caused `500 INTERNAL` failures.
- Voice selection can still use a `systemInstruction`.
- The image wrapper prompt must remain plain prompt text. If written like a meta-instruction block, Gemini Image may return text instead of image data.

## Main Files
- `app/actions/prompt-playground.ts`
- `app/actions/story-runtime.ts`
- `components/admin/PlaygroundStudio.tsx`
- `lib/ai/prompt-config.shared.ts`
- `lib/ai/prompt-config.ts`
- `supabase/migrations/009_prompt_playground.sql`
- `supabase/migrations/009_prompt_playground_rollback.sql`
