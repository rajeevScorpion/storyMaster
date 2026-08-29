# Effect Catalog for First Release

This is a practical list of effect families to support. Not all need to ship at once.

## Priority tier 1 - strong value, reasonable complexity

### 1. Cinematic pan / zoom / drift
**Purpose:** Add life to still images.

Controls:
- enable
- direction
- scale start / scale end
- horizontal drift
- vertical drift
- easing
- intensity

Use cases:
- emotional slow zoom in
- reveal pan
- subtle floating camera motion

### 2. Simple parallax illusion
**Purpose:** Create depth.

Controls:
- enable
- depth amount
- foreground speed multiplier
- background speed multiplier
- motion direction
- auto drift

Implementation note:
- first release can use 2 or 3 manually defined layers if available
- fallback may use masked overlays or gentle offset simulation if true layers are unavailable

### 3. Particle effects
**Purpose:** Atmosphere and mood.

Candidate presets:
- dust motes
- snow
- rain
- floating sparkles
- embers
- magical particles
- fog specks
- pollen / fireflies

Controls:
- amount
- density
- speed
- size
- opacity
- direction
- spread
- color
- blur softness where relevant

### 4. Atmospheric overlays
**Purpose:** Non-particle ambience.

Examples:
- soft fog
- cloud drift
- light rays
- vignette glow
- floating mist
- moving grain

Controls:
- opacity
- speed
- blend mode where supported
- direction
- scale

### 5. Transition enhancements
**Purpose:** More expressive beat transitions.

Practical first-release options:
- fade through atmosphere
- blur dissolve
- directional wipe
- soft light flash
- gentle push
- ink / smoke reveal (if easy)

Controls:
- transition type
- duration
- intensity
- easing

---

## Priority tier 2 - useful after foundation is stable

### 6. Beat emphasis effects
Examples:
- pulse on emotional word
- subtle shake on impact beat
- brightness surge
- focus blur to sharpness

### 7. Filter stylization
Examples:
- warm glow
- dream blur
- noir contrast
- magical chroma shift

### 8. Overlay-driven story themes
Examples:
- fantasy preset
- winter preset
- horror mist preset
- memory / nostalgia preset

---

## Priority tier 3 - later only
- AI depth extraction
- semantic character isolation
- 2.5D camera with occlusion-aware motion
- advanced shader distortion
- object-anchored effects bound to scene semantics

---

## Recommended first-release preset list
1. Gentle Cinematic
2. Storybook Drift
3. Dust & Glow
4. Snowfall Soft
5. Rain Mood
6. Ember Night
7. Magical Sparkle
8. Dream Mist
9. Tension Pulse
10. Nostalgic Memory

Each preset should expose editable settings after application.

