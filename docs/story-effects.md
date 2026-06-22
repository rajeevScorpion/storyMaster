# Story Effects

Story effects are available for storyboard stories from the sparkle button beside Story Text Overlay and Story Transitions. A single beat configuration applies to all four panels; camera motion restarts for each panel while particles and atmosphere use stable beat timing.

## Included effects

- Cinematic pan, zoom, and drift
- Dust, snow, and rain particles, with **Spread** (angular scatter) and **Randomness** (per-particle turbulence and speed variance) so the field looks organic instead of a marching line
- Glow, mist, and volumetric **Light Rays** atmosphere layers, each with a configurable color, drift **Direction**, and layered parallax depth
- Six system presets: Gentle Cinematic, Dust & Glow, Snowfall Soft, Rain Mood, Dream Mist, and Cathedral Rays
- Personal presets saved to the signed-in creator's account

Particle positions use a full-avalanche hash, so increasing Randomness scatters and animates particles naturally rather than aligning them along a diagonal.

Applying a preset copies its current settings into the beat. Later preset edits and deletion never change beats that already use it. **Apply to all** confirms before overwriting every generated node, including alternate branches.

## Transitions

The story-wide Transitions dialog retains Fast Cut, Soft Fade, Fade to Black, and Opacity Blend. It also provides Blur Dissolve, Directional Wipe, Gentle Push, Soft Light Flash, Fade Through Atmosphere, Ink Reveal, and Smoke Reveal with duration, direction, intensity, and easing controls.

## Rendering and export

Preview and fast MP4 export share normalized effect data, deterministic seeds, easing, transition masks, and Canvas 2D drawing helpers. Text overlays and narration timing remain above the effects layer. Preview canvas pixel ratio is capped on mobile; effect time remains tied to narration even if a frame is skipped.

The ffmpeg.wasm compatibility exporter samples effect-enabled scenes at a capped cadence to control browser memory. Advanced mask transitions require the modern Canvas/Mediabunny exporter; if that encoder is unavailable, export stops with an actionable message instead of producing a mismatched video.

## Persistence

Apply `supabase/migrations/061_story_effects.sql` before enabling personal presets in an environment. It adds `beats.story_effects` and the RLS-protected `story_effect_presets` table. The paired rollback removes both. Old stories normalize to effects disabled and old transition settings receive safe defaults.

