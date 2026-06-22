# Recommended Architecture

## Architectural principle
Use a **single source of truth** for effect configuration so the same beat data can drive:
- editor UI
- interactive preview / playback
- exported video render path

If preview and export use different implementation details, they must still consume the same normalized effect schema.

---

## Core concept
Each beat should optionally contain an `effects` payload, or reference a preset plus local overrides.

### Conceptual layers per beat
1. **Base image layer**
2. **Optional depth/parallax sublayers**
3. **Camera motion layer** (pan / zoom / drift)
4. **Atmosphere / particle layer**
5. **Filter / stylization layer**
6. **Text overlay layer** (already existing; preserve sync)
7. **Transition behavior** to next beat

---

## Recommended system modules

### A. Effect schema normalizer
Converts raw beat config / preset / defaults into one normalized runtime shape.

Responsibilities:
- merge story defaults + beat overrides + preset values
- validate ranges
- provide defaults
- version schema for future migrations

### B. Effect runtime renderer
Responsible for actually rendering effects during preview/playback.

Possible implementations:
- PixiJS scene layer
- DOM + canvas hybrid

Responsibilities:
- deterministic render based on beat time
- pause/resume compatibility
- integration with narration/beat timeline
- low-latency preview

### C. Preset manager
Handles saved presets.

Responsibilities:
- create preset
- update preset
- clone preset
- delete preset
- apply preset to one beat
- apply preset to all beats in a story
- global/user-level persistence

### D. Effect inspector UI
Controls for users.

Suggested sections:
- Motion
- Particles
- Atmosphere
- Filters
- Transition extras
- Preset actions

### E. Export renderer adapter
Responsible for ensuring exported video matches preview.

Responsibilities:
- load normalized beat effects
- render deterministically frame-by-frame or via render engine
- preserve timing and transition alignment
- integrate narration audio
- pass final frames/video to encoder

---

## Important design rule
Do **not** let export invent its own interpretation of effect data.

Instead:
- define one normalized effect schema
- use shared easing/math helpers
- use shared defaults
- reuse scene timing utilities where possible

---

## Suggested implementation strategy

### Option A - Preferred open-source practical route
If codebase structure permits:
- keep current player orchestration
- add a **canvas/WebGL effect layer**
- use PixiJS for render-time visual layers
- export using deterministic browser rendering + FFmpeg encoding

This is highly practical because it keeps the existing story model while giving control over effects.

### Option B - DOM-first fallback
If current code is strongly DOM based and rewrite risk is high:
- keep panels as DOM images
- use CSS transforms for camera motion and parallax
- use tsParticles or canvas overlays for atmosphere
- build export via browser automation + FFmpeg

This is easier initially but may be harder to maintain perfect export parity.

---

## Story-level default + beat-level override pattern
Recommended precedence order:
1. hardcoded engine defaults
2. global preset values
3. story-level default effect settings
4. beat-specific effect settings
5. one-off runtime preview changes before save

This enables “apply to all beats” naturally.

---

## Save model concept
Two useful models:

### Model 1 - materialized copy
“Apply to all beats” writes a copy of the effect config into every beat.
- pros: simple
- cons: hard to maintain when preset later changes

### Model 2 - preset reference + override
Beat stores:
- presetId
- override object
- enabled flags

Recommended approach:
- use **preset reference + override** where possible
- allow “detach from preset” when user wants manual customization

---

## Export parity rules
The export result must include:
- camera motion
- particles
- overlays
- transitions
- synced text
- narration alignment

Absolute requirement:
Any effect visible during preview must either:
1. be supported in export, or
2. be explicitly blocked with clear UX messaging.

Preferred outcome: full parity.

