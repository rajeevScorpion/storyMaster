# Phase 2 — Admin Export Engine Settings

Goal: Move hard-coded export engine settings into admin-configurable presets without duplicating creative effect controls.

Admin settings should control technical export behavior, not story/effects creativity.

## Do NOT add these admin controls

Do not duplicate existing creative controls:

```txt
Pan intensity
Zoom intensity
Particle type
Particle density as a story effect
Dust/rain/snowfall creative settings
Volumetric/environment creative settings
Scene transition creative choices
Text overlay style/timing if already controlled elsewhere
Narration timing generation
```

These already belong to the story/effects system.

## Add admin controls for export presets

Admin should be able to configure:

```txt
Preset name: SD / HD / Experimental etc.
Enabled/disabled
Available to tiers
Width
Height
FPS
Video bitrate
Audio bitrate
Audio sample rate
Codec preference/profile candidates
Hardware acceleration preference
Latency mode
Fast Start enabled
Fragmented MP4 enabled/disabled
Compatibility mode enabled
Keyframe interval / GOP if supported
Max duration or max export size if needed
Sort order in export dialog
User-facing label
User-facing description
Upgrade prompt text if tier locked
```

## Suggested default presets

```json
{
  "sd": {
    "label": "Standard",
    "description": "Fast, mobile-friendly export",
    "width": 720,
    "height": 1280,
    "fps": 30,
    "videoBitrate": 4000000,
    "audioBitrate": 128000,
    "audioSampleRate": 48000,
    "codecPreference": ["avc1.42E01E", "avc1.4D401F"],
    "fastStart": true,
    "fragmentedMp4": false,
    "compatibilityMode": true,
    "enabled": true,
    "sortOrder": 10
  },
  "hd": {
    "label": "HD",
    "description": "Sharper video export",
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "videoBitrate": 10000000,
    "audioBitrate": 192000,
    "audioSampleRate": 48000,
    "codecPreference": ["avc1.4D401F", "avc1.640028", "avc1.42E01E"],
    "fastStart": true,
    "fragmentedMp4": false,
    "compatibilityMode": true,
    "enabled": true,
    "sortOrder": 20
  },
  "ultraSmoothExperimental": {
    "label": "Ultra Smooth",
    "description": "Experimental 60 fps export for capable devices",
    "width": 1080,
    "height": 1920,
    "fps": 60,
    "videoBitrate": 14000000,
    "audioBitrate": 192000,
    "audioSampleRate": 48000,
    "codecPreference": ["avc1.4D401F", "avc1.640028"],
    "fastStart": true,
    "fragmentedMp4": false,
    "compatibilityMode": true,
    "enabled": false,
    "adminOnly": true,
    "sortOrder": 30
  }
}
```

Treat these as starting values, not final values. Confirm what the current code and browser support can actually handle.

## Admin UI requirements

Create an admin section such as:

```txt
Admin > Video Export Settings
```

Admin can:

- View presets.
- Add/edit/disable presets if architecture allows.
- Set SD/HD availability by tier.
- Change resolution/FPS/bitrate within safe bounds.
- Toggle compatibility mode.
- Toggle experimental presets.
- See warning when selecting high FPS/high resolution.
- Reset to recommended defaults.

## Guardrails

Add validation:

```txt
FPS allowed: 24, 30, 60 initially
SD recommended: 720x1280
HD recommended: 1080x1920
Video bitrate must be positive and within practical limits
Audio sample rate default 48000
FastStart should default true
Fragmented MP4 should default false for downloads
Compatibility mode should default true
```

If admin enters risky settings, show warning but avoid app-breaking config.

## Backend/config architecture

Use the project’s existing backend/admin configuration pattern. Do not invent a new architecture if the app already has one.

Possible approaches depending on current app:

1. Database table/collection for export presets.
2. Existing admin settings table with JSON config.
3. Feature flag/config service.
4. Environment/default config + admin override.

Do not hard-code final values once admin settings are implemented.

## Config fallback

If admin config fails to load, export should fall back to safe defaults:

```txt
SD 720x1280 30fps H.264/AAC compatible MP4
HD 1080x1920 30fps H.264/AAC compatible MP4
```
