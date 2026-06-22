export const STORY_TRANSITION_TYPES = [
  'fast-cut',
  'soft-fade',
  'fade-black',
  'opacity-blend',
] as const;

export type StoryTransitionType = (typeof STORY_TRANSITION_TYPES)[number];

export interface StoryTransitionSettings {
  type: StoryTransitionType;
  durationMs: number;
}

export const STORY_TRANSITION_DURATION_MIN_MS = 100;
export const STORY_TRANSITION_DURATION_MAX_MS = 2000;

export const STORY_TRANSITION_REGISTRY: Record<
  StoryTransitionType,
  { label: string; defaultDurationMs: number }
> = {
  'fast-cut': { label: 'Fast Cut', defaultDurationMs: 0 },
  'soft-fade': { label: 'Soft Fade', defaultDurationMs: 500 },
  'fade-black': { label: 'Fade to Black', defaultDurationMs: 600 },
  'opacity-blend': { label: 'Opacity Blend', defaultDurationMs: 500 },
};

export const DEFAULT_STORY_TRANSITION_SETTINGS: StoryTransitionSettings = {
  type: 'fast-cut',
  durationMs: 0,
};

export function normalizeStoryTransitionSettings(value: unknown): StoryTransitionSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const type = STORY_TRANSITION_TYPES.includes(raw.type as StoryTransitionType)
    ? raw.type as StoryTransitionType
    : DEFAULT_STORY_TRANSITION_SETTINGS.type;
  if (type === 'fast-cut') return { type, durationMs: 0 };

  const durationMs = Number(raw.durationMs);
  return {
    type,
    durationMs: Number.isFinite(durationMs)
      ? Math.max(
          STORY_TRANSITION_DURATION_MIN_MS,
          Math.min(STORY_TRANSITION_DURATION_MAX_MS, Math.round(durationMs))
        )
      : STORY_TRANSITION_REGISTRY[type].defaultDurationMs,
  };
}

export function storyTransitionSettingsKey(value: unknown): string {
  const normalized = normalizeStoryTransitionSettings(value);
  return `${normalized.type}:${normalized.durationMs}`;
}
