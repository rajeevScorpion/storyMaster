# Data Model and Preset Design

The exact implementation must be adapted to the codebase, but the following shape is recommended conceptually.

## Core entities

### StoryEffectPreset
Represents a reusable saved preset.

Suggested fields:
- `id`
- `name`
- `description`
- `category`
- `version`
- `createdBy`
- `createdAt`
- `updatedAt`
- `isSystemPreset`
- `effectConfig`

### BeatEffectAssignment
Represents how a specific beat gets effects.

Suggested fields:
- `enabled`
- `presetId` (nullable)
- `applyMode` (`preset`, `custom`, `preset-with-overrides`)
- `overrides`

### StoryEffectDefaults
Optional story-level defaults.

Suggested fields:
- `defaultPresetId`
- `defaultEffectConfig`
- `inheritToNewBeats`

---

## Suggested normalized effect config structure

```ts
interface EffectConfig {
  motion?: {
    enabled: boolean;
    panX: number;
    panY: number;
    zoomStart: number;
    zoomEnd: number;
    driftX: number;
    driftY: number;
    easing: string;
    intensity: number;
  };
  parallax?: {
    enabled: boolean;
    depth: number;
    foregroundStrength: number;
    midgroundStrength: number;
    backgroundStrength: number;
    direction: string;
  };
  particles?: {
    enabled: boolean;
    type: string;
    amount: number;
    density: number;
    speed: number;
    size: number;
    opacity: number;
    direction: string;
    color?: string | string[];
    spread?: number;
  };
  atmosphere?: {
    enabled: boolean;
    type: string;
    opacity: number;
    speed: number;
    direction: string;
    scale: number;
  };
  filters?: {
    enabled: boolean;
    glow?: number;
    blur?: number;
    grain?: number;
    vignette?: number;
    brightness?: number;
    contrast?: number;
  };
  transitionFx?: {
    enabled: boolean;
    type: string;
    durationMs: number;
    intensity: number;
    easing: string;
  };
}
```

This is conceptual only. Adapt to the existing story schema.

---

## Apply to all beats behavior
Recommended UX:
- user edits current beat effect settings
- clicks **Apply to all beats in this story**
- system asks whether to:
  1. copy current settings to all beats, or
  2. set as story default preset/config

Recommended behavior for first release:
- assign same preset/config across all beats
- allow later per-beat modifications

---

## Preset persistence
Recommended levels:
1. **System presets** seeded by product
2. **User presets** reusable across stories
3. **Story defaults** saved within story

---

## Migration and versioning
Add a schema version to stored effect config.
This helps future migration as effect capabilities expand.

