# Phase 1B — Smoothness Fix With Minimal Export-Time Impact

Goal: Improve smoothness of exported pan/zoom, particles, environmental effects, transitions, and word-timed text overlay without a major increase in export time.

Do not add new creative controls. Reuse the existing story/effects settings exactly as they are.

## Preferred first fix: verify and set FPS correctly

Test exports using the same story/image/audio with:

```txt
Current FPS baseline
24 fps
30 fps
60 fps experimental only
```

Recommended practical default:

```txt
SD: 720x1280, 30 fps
HD: 1080x1920, 30 fps
Experimental: 1080x1920, 60 fps, admin/dev only initially
```

Do not make 60 fps the default until mobile performance and RAM use are verified.

## Frame timing rule

Export should use deterministic frame timing:

```ts
const fps = preset.fps; // usually 30
const totalFrames = Math.ceil(durationSeconds * fps);

for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
  const tSeconds = frameIndex / fps;
  const timestampUs = Math.round(tSeconds * 1_000_000);

  // Render the existing storyline/effects state at exactly tSeconds.
  await renderFrameAtTime(tSeconds);

  // Capture/encode frame using exact timestamp.
}
```

Do not depend on real `requestAnimationFrame` timing during export. Export may use the same rendering functions as the player, but frame state must be sampled by exact timeline time.

## Avoid duplicate timestamps

Ensure each frame has a unique monotonic timestamp and correct duration.

Check:

```txt
timestamp[n] > timestamp[n-1]
timestamp step ≈ 1_000_000 / fps microseconds
frame count ≈ duration * fps
```

If Mediabunny expected frame rate metadata is configured, ensure frame timestamps match that frame rate and are not added more frequently than the configured rate.

## Keep export time reasonable

Avoid:

- Rendering more frames than needed.
- Buffering all frames in memory.
- Keeping old `VideoFrame` objects alive.
- Re-decoding/reloading images every frame.
- Recreating expensive particle assets every frame.
- Running unnecessary layout calculations.
- Flushing encoder after every frame.

Prefer:

- Preload and cache source images once per export.
- Reuse canvas/context where safe.
- Encode frame-by-frame.
- Close/dispose `VideoFrame` objects immediately after encode.
- Use hardware acceleration when supported.
- Use `latencyMode: "quality"` only if it does not create unacceptable time impact; test against current speed.
- Use `VideoEncoder.isConfigSupported()` before choosing codec/profile.

## Live player smoothness regression

Because stutter is sometimes visible during normal storyline playback, also fix obvious runtime regressions:

- Pan/zoom should use GPU-friendly transforms where DOM/CSS is involved:

```css
transform: translate3d(...) scale(...);
will-change: transform;
```

- Avoid animating layout properties:

```txt
top, left, width, height, background-size
```

- Word-by-word text overlay should not cause full player/effects re-render every word if avoidable.
- Particle updates should not cause React state updates for every particle/frame.
- Use refs/canvas/local rendering state for high-frequency animation.
- Large images should be pre-scaled/cached where practical.

## Acceptance for this phase

- Same story exported at SD 30 fps should show smooth pan/zoom and transitions.
- Particle/environment effects should not flicker or jump.
- Text overlay should remain in sync with narration.
- Export time should not increase drastically compared to current baseline.
- If 30 fps improves smoothness enough, keep 60 fps experimental/admin-only.
- If 30 fps does not fix smoothness, document why and propose the smallest next deterministic-rendering refactor.
