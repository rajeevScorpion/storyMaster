# Implementation Notes and Guardrails

## Do not assume

Before editing, inspect current code and write down:

```txt
Where export is implemented
Which library/version is used
How frames are captured
How timestamps are generated
How audio is muxed
How MP4 output is configured
Where export dialog lives
Where user tier/plan information lives
Where admin settings are stored
```

## Work in commits/phases

Suggested commits:

1. `diagnostics: add video export report and timestamp logging`
2. `fix(export): stabilize frame rate and timestamps for smooth output`
3. `fix(export): produce compatible MP4 for native players and YouTube`
4. `test(export): add validation helpers and export preset tests`
5. `admin: add video export preset settings`
6. `ui: add tiered SD/HD export dialog options`
7. `docs: add video export QA checklist`

## Practicality rules

- Do not do a full renderer rewrite in Phase 1 unless the investigation proves it is necessary.
- If increasing to 30 fps fixes the problem, ship that first.
- Keep 60 fps experimental until tested on mobile and mid-range devices.
- If browser limitations block perfect compatibility, document exactly which browsers/codecs are affected and add fallback behavior.
- If Mediabunny config is the issue, fix config before replacing the library.
- If live player stutter is caused by React re-renders, isolate high-frequency animation from React state.

## Memory/RAM guardrails

- Avoid storing all frames in arrays.
- Avoid base64 frame buffers where possible.
- Close `VideoFrame` objects after encoding.
- Reuse canvases/contexts.
- Cache decoded images.
- Avoid re-decoding images every frame.
- Avoid unnecessary high devicePixelRatio exports if output resolution is already explicit.

## Error handling

User-facing export errors should be understandable:

```txt
Export failed because this device/browser does not support the selected HD encoding settings. Try Standard export.
```

```txt
Video export completed, but compatibility validation failed. Please try Standard compatibility mode.
```

Avoid exposing raw codec jargon to normal users unless in debug/admin mode.

## Fallbacks

If selected HD preset is unsupported:

1. Try safer codec profile.
2. Try compatibility mode.
3. Offer SD export.
4. Log detailed diagnostic report.

## What not to do

- Do not lower FPS for SD to make it faster if it makes motion stuttery.
- Do not hide compatibility issues behind WhatsApp sharing.
- Do not duplicate creative effect settings in admin.
- Do not hard-code the final presets once admin settings exist.
- Do not assume YouTube will accept any `.mp4` file.
- Do not rely only on filename extension; inspect actual container/codec output.
