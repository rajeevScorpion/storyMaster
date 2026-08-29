# Phase 1D — Validation and Regression Tests

Create repeatable test cases. Do not rely on one casual export.

## Required sample stories

Use at least three test cases:

### Test A — Simple pan/zoom

```txt
1 image
No particles
Narration + word-by-word text overlay
Slow zoom-in and pan
Duration: 10-15 seconds
```

Purpose: isolate pan/zoom smoothness.

### Test B — Heavy visual effects

```txt
Multiple panel images
Dust/rain/snow/particles enabled
Narration + word text overlay
Panel transitions
Beat transition
Duration: 20-30 seconds
```

Purpose: check realistic story export.

### Test C — Audio edge case

```txt
Visual timeline shorter or longer than narration
Word-by-word timestamps
Transitions
```

Purpose: check duration, sync, and container metadata.

## Compare presets

For the same test story, export:

```txt
Current baseline
SD 720x1280 30 fps
HD 1080x1920 30 fps
Optional experimental 60 fps
```

Record:

```txt
Export time
File size
Playback smoothness
RAM/performance warning if any
Player compatibility
YouTube upload result
```

## Automated checks where practical

Add unit/integration checks for:

- Preset config resolution and FPS.
- Tier access logic.
- Export dialog showing/hiding options correctly.
- Timestamp generator monotonicity.
- Expected frame count from duration and FPS.
- Export report generation.

Example timestamp test:

```ts
test('generates monotonic 30fps timestamps', () => {
  const timestamps = generateFrameTimestamps({ durationSeconds: 10, fps: 30 });
  expect(timestamps).toHaveLength(300);
  for (let i = 1; i < timestamps.length; i++) {
    expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
  }
});
```

## Manual visual review checklist

Check:

- Pan/zoom has no visible jumps.
- Particles do not flicker.
- Dust/rain/snow movement is stable.
- Transition timing feels consistent.
- Text overlay does not cause visual stutter.
- Narration and words remain synced.
- First and last frames are correct.
- No black/blank frames at beginning/end unless intended.

## Performance guardrail

Phase 1 is successful only if:

```txt
Smoothness improves clearly.
Export time does not become unacceptable.
Mobile export still works for SD.
HD may be heavier but should fail gracefully if unsupported.
```

If 60 fps is too heavy, keep it hidden/admin-only.
