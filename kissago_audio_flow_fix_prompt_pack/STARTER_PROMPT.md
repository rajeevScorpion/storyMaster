# Starter Prompt for AI Coder

You are working on the Kissago Reels codebase.

I have attached two planning screenshots about the Kissago Reels audio pipeline. I have also provided a folder named:

`kissago_audio_flow_fix_prompt_pack`

Start by reading the files in this order:

1. `00_ORCHESTRATOR.md`
2. `01_CONTEXT_AND_PROBLEM.md`
3. `02_AUDIO_PIPELINE_SPEC.md`
4. `03_PROVIDER_FALLBACK_AND_TIMESTAMPS.md`
5. `04_PREVIEW_APPLY_EXPORT_SPEC.md`
6. `05_MULTI_BEAT_PANEL_NARRATION.md`
7. `06_TTS_SCRIPT_WRITER.md`
8. `07_ADMIN_VOICE_LANGUAGE_PRESETS.md`
9. `08_DATABASE_SCHEMA_AND_TYPES.md`
10. `09_UI_UX_REQUIREMENTS.md`
11. `10_TESTING_ACCEPTANCE_CRITERIA.md`

Use the screenshots as the visual planning reference and use these markdown files as the implementation brief.

Your task is to fix and improve the Kissago Reels narration/audio flow so that it is provider-aware, language-aware, timestamp-aware, preview-safe, and export-safe.

Core rule:

- ElevenLabs should be attempted first where available.
- ElevenLabs text highlighting is allowed only when word-level timestamps are actually returned.
- Gemini TTS is a fallback or alternate provider for narration, but Gemini does not provide word-level timestamps, so text highlighting must be disabled when Gemini audio is used.
- Preview, Apply, and Export must preserve the same narration metadata.
- Multi-beat reels should use beat/panel-level audio timing, especially for Gemini.

Do not implement blindly. First inspect the current codebase, identify existing files/components/API routes/tables involved in narration generation, previews, applying previews, text highlighting, and export. Then produce a short implementation plan mapped against the files in this folder. After that, implement the changes in small safe steps.
