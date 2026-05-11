# 05 Admin Settings and Prompt Definers

Admin configuration is central to this feature. Users should get simple creative controls. Admins should get experiment controls.

## Admin settings to add

Add or extend settings for:

- Reel Story enabled/disabled
- Default orientation, default `9:16`
- Default input mode, default `without_image`
- Default mood preset
- Default narration style
- Default visual style
- Default script length option
- Short word range min/max
- Medium word range min/max
- Long word range min/max
- Storyboard image count per beat, e.g. 4, 6, 8
- Safe min/max storyboard image count
- Default image duration seconds, e.g. 2.5
- Min/max image duration seconds
- Branding enabled by default
- Whether paid users may disable branding
- Cleanup enabled/disabled
- Cleanup dry-run mode
- Cleanup batch size
- Retention days by plan and visibility

## User simplicity rule

The following are admin-only and must not be shown to normal users:

- storyboard image count per beat
- grid/panel resolution
- prompt definer raw text
- cleanup batch size
- cleanup dry-run
- plan retention internals, except user-facing expiry notice

## Prompt definer categories

Support or seed definers for:

- `mood_preset`
- `narration_style`
- `visual_style`
- `script_length`
- `storyboard_rhythm`
- `subtitle_style`
- `export_branding`

## Prompt definer fields

Each definer should support:

- name
- slug/key
- category
- prompt text
- active/inactive
- default flag
- sort order
- metadata JSON if useful

## Prompt playground

If there is an existing prompt playground, integrate definers there.

If there is no existing playground, implement a minimal admin-only preview:

- sample user idea text area
- selectable mood/narration/visual/script options
- generated combined effective prompt preview
- no actual model call required unless the codebase already supports prompt testing safely

## Fallback behavior

If admin misconfigures definers:

- use safe system defaults
- do not block story creation unless Reel Story is disabled
- log or surface admin warning where appropriate

## Documentation

Document:

- where settings are stored
- where definers are stored
- how to add/edit presets
- what defaults are seeded
- how fallback behavior works

