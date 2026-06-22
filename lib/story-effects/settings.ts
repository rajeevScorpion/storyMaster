export const STORY_EFFECT_SCHEMA_VERSION = 1 as const;

export const STORY_EFFECT_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type StoryEffectEasing = (typeof STORY_EFFECT_EASINGS)[number];

export const STORY_PARTICLE_TYPES = ['dust', 'snow', 'rain'] as const;
export type StoryParticleType = (typeof STORY_PARTICLE_TYPES)[number];

export const STORY_ATMOSPHERE_TYPES = ['glow', 'mist', 'rays'] as const;
export type StoryAtmosphereType = (typeof STORY_ATMOSPHERE_TYPES)[number];

export interface StoryMotionEffect {
  enabled: boolean;
  panX: number;
  panY: number;
  zoomStart: number;
  zoomEnd: number;
  driftX: number;
  driftY: number;
  intensity: number;
  easing: StoryEffectEasing;
}

export interface StoryParticleEffect {
  enabled: boolean;
  type: StoryParticleType;
  amount: number;
  density: number;
  opacity: number;
  speed: number;
  size: number;
  direction: number;
  spread: number;
  randomness: number;
  color: string;
}

export interface StoryAtmosphereEffect {
  enabled: boolean;
  type: StoryAtmosphereType;
  opacity: number;
  speed: number;
  direction: number;
  scale: number;
  intensity: number;
  color: string;
}

export interface StoryEffectConfig {
  schemaVersion: typeof STORY_EFFECT_SCHEMA_VERSION;
  enabled: boolean;
  sourcePresetId?: string;
  motion: StoryMotionEffect;
  particles: StoryParticleEffect;
  atmosphere: StoryAtmosphereEffect;
}

export const DEFAULT_STORY_EFFECT_CONFIG: StoryEffectConfig = {
  schemaVersion: STORY_EFFECT_SCHEMA_VERSION,
  enabled: false,
  motion: {
    enabled: false,
    panX: 0,
    panY: 0,
    zoomStart: 1,
    zoomEnd: 1.06,
    driftX: 0,
    driftY: 0,
    intensity: 50,
    easing: 'ease-in-out',
  },
  particles: {
    enabled: false,
    type: 'dust',
    amount: 35,
    density: 50,
    opacity: 0.55,
    speed: 0.65,
    size: 1,
    direction: -90,
    spread: 35,
    randomness: 35,
    color: '#fff4cf',
  },
  atmosphere: {
    enabled: false,
    type: 'glow',
    opacity: 0.24,
    speed: 0.3,
    direction: 0,
    scale: 1,
    intensity: 45,
    color: '#ffe5aa',
  },
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : fallback;
}

function colorValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function normalizeStoryEffectConfig(value: unknown): StoryEffectConfig {
  const raw = objectValue(value);
  const motion = objectValue(raw.motion);
  const particles = objectValue(raw.particles);
  const atmosphere = objectValue(raw.atmosphere);
  const sourcePresetId = typeof raw.sourcePresetId === 'string' && raw.sourcePresetId.trim()
    ? raw.sourcePresetId.trim().slice(0, 120)
    : undefined;

  return {
    schemaVersion: STORY_EFFECT_SCHEMA_VERSION,
    enabled: booleanValue(raw.enabled, DEFAULT_STORY_EFFECT_CONFIG.enabled),
    ...(sourcePresetId ? { sourcePresetId } : {}),
    motion: {
      enabled: booleanValue(motion.enabled, DEFAULT_STORY_EFFECT_CONFIG.motion.enabled),
      panX: clamp(motion.panX, DEFAULT_STORY_EFFECT_CONFIG.motion.panX, -20, 20),
      panY: clamp(motion.panY, DEFAULT_STORY_EFFECT_CONFIG.motion.panY, -20, 20),
      zoomStart: clamp(motion.zoomStart, DEFAULT_STORY_EFFECT_CONFIG.motion.zoomStart, 1, 1.3),
      zoomEnd: clamp(motion.zoomEnd, DEFAULT_STORY_EFFECT_CONFIG.motion.zoomEnd, 1, 1.3),
      driftX: clamp(motion.driftX, DEFAULT_STORY_EFFECT_CONFIG.motion.driftX, -20, 20),
      driftY: clamp(motion.driftY, DEFAULT_STORY_EFFECT_CONFIG.motion.driftY, -20, 20),
      intensity: clamp(motion.intensity, DEFAULT_STORY_EFFECT_CONFIG.motion.intensity, 0, 100),
      easing: enumValue(motion.easing, STORY_EFFECT_EASINGS, DEFAULT_STORY_EFFECT_CONFIG.motion.easing),
    },
    particles: {
      enabled: booleanValue(particles.enabled, DEFAULT_STORY_EFFECT_CONFIG.particles.enabled),
      type: enumValue(particles.type, STORY_PARTICLE_TYPES, DEFAULT_STORY_EFFECT_CONFIG.particles.type),
      amount: Math.round(clamp(particles.amount, DEFAULT_STORY_EFFECT_CONFIG.particles.amount, 0, 120)),
      density: clamp(particles.density, DEFAULT_STORY_EFFECT_CONFIG.particles.density, 0, 100),
      opacity: clamp(particles.opacity, DEFAULT_STORY_EFFECT_CONFIG.particles.opacity, 0, 1),
      speed: clamp(particles.speed, DEFAULT_STORY_EFFECT_CONFIG.particles.speed, 0, 3),
      size: clamp(particles.size, DEFAULT_STORY_EFFECT_CONFIG.particles.size, 0.25, 3),
      direction: clamp(particles.direction, DEFAULT_STORY_EFFECT_CONFIG.particles.direction, -180, 180),
      spread: clamp(particles.spread, DEFAULT_STORY_EFFECT_CONFIG.particles.spread, 0, 180),
      randomness: clamp(particles.randomness, DEFAULT_STORY_EFFECT_CONFIG.particles.randomness, 0, 100),
      color: colorValue(particles.color, DEFAULT_STORY_EFFECT_CONFIG.particles.color),
    },
    atmosphere: {
      enabled: booleanValue(atmosphere.enabled, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.enabled),
      type: enumValue(atmosphere.type, STORY_ATMOSPHERE_TYPES, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.type),
      opacity: clamp(atmosphere.opacity, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.opacity, 0, 1),
      speed: clamp(atmosphere.speed, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.speed, 0, 3),
      direction: clamp(atmosphere.direction, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.direction, -180, 180),
      scale: clamp(atmosphere.scale, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.scale, 0.5, 3),
      intensity: clamp(atmosphere.intensity, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.intensity, 0, 100),
      color: colorValue(atmosphere.color, DEFAULT_STORY_EFFECT_CONFIG.atmosphere.color),
    },
  };
}

export function storyEffectConfigEnabled(value: unknown): boolean {
  const config = normalizeStoryEffectConfig(value);
  return config.enabled && (config.motion.enabled || config.particles.enabled || config.atmosphere.enabled);
}

export function copyStoryEffectConfig(value: unknown, sourcePresetId?: string): StoryEffectConfig {
  return normalizeStoryEffectConfig({
    ...normalizeStoryEffectConfig(value),
    sourcePresetId,
  });
}

export function applyStoryEffectEasing(value: number, easing: StoryEffectEasing): number {
  const progress = Math.max(0, Math.min(1, value));
  if (easing === 'ease-in') return progress * progress;
  if (easing === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (easing === 'ease-in-out') {
    return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }
  return progress;
}

