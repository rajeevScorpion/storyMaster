export const STORY_TRANSITION_TYPES = [
  'fast-cut',
  'soft-fade',
  'fade-black',
  'opacity-blend',
  'blur-dissolve',
  'directional-wipe',
  'gentle-push',
  'soft-light-flash',
  'atmosphere-fade',
  'ink-reveal',
  'smoke-reveal',
] as const;

export type StoryTransitionType = (typeof STORY_TRANSITION_TYPES)[number];

export interface StoryTransitionSettings {
  type: StoryTransitionType;
  durationMs: number;
  direction?: StoryTransitionDirection;
  intensity?: number;
  easing?: StoryTransitionEasing;
}

export const STORY_TRANSITION_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type StoryTransitionDirection = (typeof STORY_TRANSITION_DIRECTIONS)[number];
export const STORY_TRANSITION_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type StoryTransitionEasing = (typeof STORY_TRANSITION_EASINGS)[number];

export const STORY_TRANSITION_DURATION_MIN_MS = 100;
export const STORY_TRANSITION_DURATION_MAX_MS = 3000;

export const STORY_TRANSITION_REGISTRY: Record<
  StoryTransitionType,
  { label: string; defaultDurationMs: number }
> = {
  'fast-cut': { label: 'Fast Cut', defaultDurationMs: 0 },
  'soft-fade': { label: 'Soft Fade', defaultDurationMs: 500 },
  'fade-black': { label: 'Fade to Black', defaultDurationMs: 600 },
  'opacity-blend': { label: 'Opacity Blend', defaultDurationMs: 500 },
  'blur-dissolve': { label: 'Blur Dissolve', defaultDurationMs: 700 },
  'directional-wipe': { label: 'Directional Wipe', defaultDurationMs: 650 },
  'gentle-push': { label: 'Gentle Push', defaultDurationMs: 700 },
  'soft-light-flash': { label: 'Soft Light Flash', defaultDurationMs: 500 },
  'atmosphere-fade': { label: 'Fade Through Atmosphere', defaultDurationMs: 900 },
  'ink-reveal': { label: 'Ink Reveal', defaultDurationMs: 900 },
  'smoke-reveal': { label: 'Smoke Reveal', defaultDurationMs: 1100 },
};

export const DEFAULT_STORY_TRANSITION_SETTINGS: StoryTransitionSettings = {
  type: 'fast-cut',
  durationMs: 0,
  direction: 'left',
  intensity: 50,
  easing: 'ease-in-out',
};

function normalizeEnum<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : fallback;
}

export function normalizeStoryTransitionSettings(value: unknown): StoryTransitionSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const type = STORY_TRANSITION_TYPES.includes(raw.type as StoryTransitionType)
    ? raw.type as StoryTransitionType
    : DEFAULT_STORY_TRANSITION_SETTINGS.type;
  const direction = normalizeEnum(raw.direction, STORY_TRANSITION_DIRECTIONS, 'left');
  const easing = normalizeEnum(raw.easing, STORY_TRANSITION_EASINGS, 'ease-in-out');
  const rawIntensity = Number(raw.intensity);
  const intensity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(100, rawIntensity)) : 50;
  if (type === 'fast-cut') return { type, durationMs: 0, direction, intensity, easing };

  const durationMs = Number(raw.durationMs);
  return {
    type,
    durationMs: Number.isFinite(durationMs)
      ? Math.max(
          STORY_TRANSITION_DURATION_MIN_MS,
          Math.min(STORY_TRANSITION_DURATION_MAX_MS, Math.round(durationMs))
        )
      : STORY_TRANSITION_REGISTRY[type].defaultDurationMs,
    direction,
    intensity,
    easing,
  };
}

export function applyStoryTransitionEasing(value: number, easing: StoryTransitionEasing | undefined): number {
  const progress = Math.max(0, Math.min(1, value));
  if (easing === 'ease-in') return progress * progress;
  if (easing === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (easing === 'ease-in-out') return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  return progress;
}

export function storyTransitionSettingsKey(value: unknown): string {
  const normalized = normalizeStoryTransitionSettings(value);
  return `${normalized.type}:${normalized.durationMs}:${normalized.direction}:${normalized.intensity}:${normalized.easing}`;
}
