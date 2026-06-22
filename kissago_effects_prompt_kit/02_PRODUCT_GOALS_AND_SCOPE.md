# Product Goals and Scope

## Product intent
Kissago stories are currently composed of still images with narration, synced text overlays, transitions, and beats. The goal of this feature is to create a stronger sense of life and cinematic motion without forcing creators to manually animate every frame.

## Primary goals
1. Make still images feel more alive.
2. Preserve current narration/text synchronization.
3. Give creators simple controls with meaningful visual payoff.
4. Reuse effects efficiently through presets.
5. Ensure export parity: what users preview should appear in exported video.

## User stories

### Story creator
- I want to add motion and atmosphere to a beat so it feels more cinematic.
- I want to apply the same effect style to all beats in a story with one click.
- I want to save my favorite effect setup as a preset.
- I want to tweak settings like density, speed, opacity, and depth.
- I want exported videos to match the preview.

### Story viewer
- I want visuals that feel immersive but not distracting.
- I want playback to remain smooth.
- I want synced text and transitions to stay correct.

## Scope in
- beat-level visual effects
- apply-to-all functionality within a story
- reusable presets across stories
- settings controls
- export support
- performance guardrails
- testing and documentation

## Scope out for first release
Unless already easy in the codebase, defer these to later phases:
- per-object semantic segmentation of characters from backgrounds
- AI auto-layer extraction for parallax
- advanced 3D camera reconstruction
- authoring timeline as complex as professional motion software
- full node-based effect graph
- user-uploaded shader code

## UX principle
The system should be powerful internally but simple for creators externally.

Recommended first-release UX pattern:
- select beat
- choose effect family
- choose preset or “none”
- adjust sliders
- preview
- save preset
- optionally apply current config to all beats in story

