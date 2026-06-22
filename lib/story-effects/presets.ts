import {
  copyStoryEffectConfig,
  normalizeStoryEffectConfig,
  type StoryEffectConfig,
} from './settings';

export interface StoryEffectPreset {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  config: StoryEffectConfig;
  createdAt?: string;
  updatedAt?: string;
}

function systemPreset(id: string, name: string, description: string, config: Record<string, unknown>): StoryEffectPreset {
  return {
    id: `system:${id}`,
    name,
    description,
    isSystem: true,
    config: normalizeStoryEffectConfig({ enabled: true, ...config }),
  };
}

export const SYSTEM_STORY_EFFECT_PRESETS: StoryEffectPreset[] = [
  systemPreset('gentle-cinematic', 'Gentle Cinematic', 'A restrained pan and slow zoom for still panels.', {
    motion: { enabled: true, panX: -2, panY: 1, zoomStart: 1.01, zoomEnd: 1.09, driftX: 2, driftY: -1, intensity: 55 },
  }),
  systemPreset('dust-and-glow', 'Dust & Glow', 'Warm floating dust with a soft storybook glow.', {
    motion: { enabled: true, panX: -1, panY: 0, zoomStart: 1.02, zoomEnd: 1.08, driftX: 2, driftY: -1, intensity: 45 },
    particles: { enabled: true, type: 'dust', amount: 45, density: 55, opacity: 0.52, speed: 0.45, size: 1.15, direction: -82, spread: 55, color: '#ffe7a8' },
    atmosphere: { enabled: true, type: 'glow', opacity: 0.22, speed: 0.25, direction: 15, scale: 1.25, intensity: 48 },
  }),
  systemPreset('snowfall-soft', 'Snowfall Soft', 'Calm layered snow with subtle camera drift.', {
    motion: { enabled: true, panX: 1, panY: -1, zoomStart: 1.03, zoomEnd: 1.08, driftX: -1, driftY: 1, intensity: 35 },
    particles: { enabled: true, type: 'snow', amount: 70, density: 65, opacity: 0.72, speed: 0.55, size: 1.2, direction: 88, spread: 25, color: '#ffffff' },
  }),
  systemPreset('rain-mood', 'Rain Mood', 'Directional rain with a cool, slow push-in.', {
    motion: { enabled: true, panX: 0, panY: 1, zoomStart: 1.01, zoomEnd: 1.07, driftX: 1, driftY: 1, intensity: 50 },
    particles: { enabled: true, type: 'rain', amount: 90, density: 80, opacity: 0.48, speed: 1.7, size: 0.7, direction: 104, spread: 10, color: '#b9ddff' },
    atmosphere: { enabled: true, type: 'mist', opacity: 0.12, speed: 0.35, direction: 5, scale: 1.35, intensity: 30 },
  }),
  systemPreset('dream-mist', 'Dream Mist', 'Slow drifting mist and a gentle luminous zoom.', {
    motion: { enabled: true, panX: -1, panY: 0, zoomStart: 1.02, zoomEnd: 1.1, driftX: 2, driftY: 0, intensity: 42 },
    atmosphere: { enabled: true, type: 'mist', opacity: 0.34, speed: 0.3, direction: -8, scale: 1.7, intensity: 58 },
  }),
];

export function applyStoryEffectPreset(preset: StoryEffectPreset): StoryEffectConfig {
  return copyStoryEffectConfig(preset.config, preset.id);
}
