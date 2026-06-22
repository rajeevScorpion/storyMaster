import { describe, expect, it } from 'vitest';

import { SYSTEM_STORY_EFFECT_PRESETS, applyStoryEffectPreset } from './presets';
import {
  DEFAULT_STORY_EFFECT_CONFIG,
  copyStoryEffectConfig,
  normalizeStoryEffectConfig,
  storyEffectConfigEnabled,
} from './settings';

describe('story effect settings', () => {
  it('falls back safely for missing or corrupt values', () => {
    expect(normalizeStoryEffectConfig(null)).toEqual(DEFAULT_STORY_EFFECT_CONFIG);
    expect(storyEffectConfigEnabled({ enabled: true })).toBe(false);
  });

  it('clamps values and normalizes enums', () => {
    const config = normalizeStoryEffectConfig({
      enabled: true,
      motion: { enabled: true, zoomEnd: 9, panX: -99, easing: 'elastic' },
      particles: { enabled: true, type: 'fire', amount: 999, opacity: -2, color: 'red' },
      atmosphere: { enabled: true, type: 'fog', scale: 8 },
    });
    expect(config.motion.zoomEnd).toBe(1.3);
    expect(config.motion.panX).toBe(-20);
    expect(config.motion.easing).toBe('ease-in-out');
    expect(config.particles.type).toBe('dust');
    expect(config.particles.amount).toBe(120);
    expect(config.particles.opacity).toBe(0);
    expect(config.particles.color).toBe('#fff4cf');
    expect(config.atmosphere.type).toBe('glow');
    expect(config.atmosphere.scale).toBe(3);
  });

  it('copies presets instead of retaining mutable references', () => {
    const preset = SYSTEM_STORY_EFFECT_PRESETS[1];
    const first = applyStoryEffectPreset(preset);
    const second = applyStoryEffectPreset(preset);
    first.motion.panX = 18;
    expect(second.motion.panX).not.toBe(18);
    expect(first.sourcePresetId).toBe(preset.id);
  });

  it('drops empty source preset identifiers', () => {
    expect(copyStoryEffectConfig(DEFAULT_STORY_EFFECT_CONFIG, '').sourcePresetId).toBeUndefined();
  });
});

