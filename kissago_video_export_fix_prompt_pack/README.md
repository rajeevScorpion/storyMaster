# Kissago / Kissago Video Export Fix + Admin Settings Prompt Pack

This prompt pack is for an AI coding agent working on Kissago/Kissago video export using Mediabunny/WebCodecs in the browser.

Primary goals:

1. Phase 1: Get smooth downloadable video output without a major export-time penalty.
2. Phase 1: Fix MP4 compatibility so downloaded files open in native players/VLC and upload directly to YouTube/Instagram/other platforms.
3. Phase 2: Add admin-configurable export engine settings and tiered SD/HD export options in the export dialog.

Critical instruction:

Do not assume the current implementation details. Investigate the existing code first. Preserve working features. Be practical. Make minimal, testable changes in Phase 1 before attempting a bigger render architecture refactor.

Suggested use order:

1. `00_START_HERE_MASTER_PROMPT.md`
2. `01_PROJECT_CONTEXT.md`
3. `02_PHASE_1_INVESTIGATE_AND_DIAGNOSE.md`
4. `03_PHASE_1_SMOOTHNESS_FIX.md`
5. `04_PHASE_1_MP4_COMPATIBILITY_FIX.md`
6. `05_PHASE_1_VALIDATION_AND_TESTS.md`
7. `06_PHASE_2_ADMIN_SETTINGS.md`
8. `07_EXPORT_DIALOG_TIERING.md`
9. `08_ACCEPTANCE_CRITERIA.md`
10. `09_IMPLEMENTATION_NOTES_AND_GUARDRAILS.md`
11. `10_REFERENCE_CHECKLIST.md`

Reference docs included in this pack:

- Mediabunny introduction: https://mediabunny.dev/guide/introduction
- Mediabunny writing media files: https://mediabunny.dev/guide/writing-media-files
- Mediabunny output formats: https://mediabunny.dev/guide/output-formats
- MDN WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- MDN VideoEncoder.configure: https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/configure
- YouTube recommended upload encoding settings: https://support.google.com/youtube/answer/1722171
