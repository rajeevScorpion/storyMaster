import { describe, expect, it } from 'vitest';

import { SYSTEM_STORY_EFFECT_PRESETS, applyStoryEffectPreset } from './presets';
import { buildStoryParticles, getStoryMotionFrame, stableStoryEffectSeed } from './renderer';

describe('story effect renderer math', () => {
  it('uses stable seeds and particle positions', () => {
    const config = applyStoryEffectPreset(SYSTEM_STORY_EFFECT_PRESETS[1]);
    expect(stableStoryEffectSeed('beat:1')).toBe(stableStoryEffectSeed('beat:1'));
    expect(buildStoryParticles(config, 800, 450, 1500, 'beat:1')).toEqual(
      buildStoryParticles(config, 800, 450, 1500, 'beat:1')
    );
  });

  it('restarts motion from the configured panel start', () => {
    const config = applyStoryEffectPreset(SYSTEM_STORY_EFFECT_PRESETS[0]);
    const start = getStoryMotionFrame(config, 0);
    const end = getStoryMotionFrame(config, 1);
    expect(end.scale).toBeGreaterThan(start.scale);
    expect(end.translateXPercent).not.toBe(start.translateXPercent);
  });
});

