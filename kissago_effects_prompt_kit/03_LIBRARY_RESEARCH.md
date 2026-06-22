# Library Research and Recommendations

This document lists practical libraries worth considering. The coder must still validate fit against the existing codebase.

---

## 1) PixiJS
### Why consider it
Strong candidate for high-performance 2D rendering, layered compositing, filters, sprites, and WebGL/WebGPU-backed visual effects.

### Best use in Kissago
- layered image rendering
- parallax layers
- atmosphere overlays
- filters
- controlled camera motion
- deterministic canvas-based rendering for export pipeline support

### Pros
- high-performance 2D renderer
- supports filters, masking, blend modes
- well suited for visual effects on still-image scenes
- practical for custom render layers

### Cons
- adds renderer complexity
- may require an adapter layer if current player is DOM/CSS based

### Suggested role
Primary rendering/effects engine if codebase can absorb it without heavy rewrite.

---

## 2) @pixi/particle-emitter
### Why consider it
Practical particle emitter library built for PixiJS.

### Best use in Kissago
- dust
- snow
- sparkles
- embers
- rain
- fog particles
- magical floating particles

### Pros
- tightly aligned with PixiJS
- configurable emitter model
- reusable effect presets possible

### Cons
- older ecosystem feel in places
- must validate compatibility with chosen PixiJS version in repo

### Suggested role
Preferred particle system if PixiJS becomes the main effects engine.

---

## 3) pixi-filters
### Why consider it
Practical filter pack for visual treatments.

### Best use in Kissago
- glow
- blur
- RGB split
- vignette-like stylization
- transitions using filter-based reveals/distortions

### Pros
- many ready-made filters
- integrates with PixiJS

### Cons
- must avoid overusing effects that look gimmicky

### Suggested role
Optional enhancement layer for selected effects and transitions.

---

## 4) tsParticles
### Why consider it
Fast to integrate, framework-friendly, and highly configurable for particle overlays.

### Best use in Kissago
- quick overlay particle backgrounds
- simpler atmospheric effects in a DOM/canvas layer
- fallback option if current codebase is heavily DOM-based and PixiJS adoption is too costly

### Pros
- quick setup
- many presets and configuration options
- React and vanilla friendly

### Cons
- less tightly integrated than Pixi particle renderer if advanced scene compositing is needed
- may complicate exact parity with export if not architected carefully

### Suggested role
Good fallback or quick-win option. Best if current player remains mostly DOM-based.

---

## 5) Puppeteer
### Why consider it
Useful for headless rendering, regression testing, and potentially driving a browser-based export render path.

### Best use in Kissago
- render testing
- screenshot baselines
- possible server-side frame capture from the same HTML/canvas scene

### Pros
- open-source and widely used
- practical for deterministic browser automation

### Cons
- not an effects library by itself
- export pipeline needs orchestration with encoder

### Suggested role
Testing + possible export helper.

---

## 6) FFmpeg
### Why consider it
Mature encoder for final video composition.

### Best use in Kissago
- combine rendered frames and narration audio
- mux subtitles/text if needed
- final MP4 generation

### Pros
- reliable and industry standard
- useful even if actual scene rendering happens elsewhere

### Cons
- licensing/build choices must be handled carefully
- not a visual scene engine

### Suggested role
Final encode stage for exported videos.

---

## 7) ffmpeg.wasm
### Why consider it
Can be explored for local/browser-side export experiments.

### Best use in Kissago
- limited client-side export experiments
- utility processing, not primary production export unless clearly justified

### Pros
- browser-capable

### Cons
- memory heavy
- weaker fit for long or complex exports
- probably not ideal as primary production export route

### Suggested role
Optional experiment only.

---

## Recommended practical stack

### Preferred stack (open-source practical path)
- **PixiJS** for 2D render/effects layer
- **@pixi/particle-emitter** for particles
- **pixi-filters** for selected filter effects
- **Puppeteer** for automated render/testing and possibly controlled frame capture
- **FFmpeg** for final video encoding

### Fallback stack (if current app is heavily DOM/CSS based)
- current DOM player retained
- **tsParticles** for overlay effects
- custom CSS/canvas parallax and pan/zoom
- Puppeteer + FFmpeg for export pipeline

## Recommendation summary
The safest strategic direction is:
1. Introduce a **shared effect schema**.
2. Build a dedicated effect layer that can be rendered deterministically.
3. Ensure the export path consumes the same effect schema.
4. Avoid adding effect libraries that only solve preview but cannot support export parity.

