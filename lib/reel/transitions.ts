export const REEL_TRANSITION_TYPES = [
  'fade-black',
  'fade-white',
  'blend',
  'fast-cut',
  'slide-left',
  'slide-right',
] as const;

export type ReelTransitionType = (typeof REEL_TRANSITION_TYPES)[number];

export interface ReelTransitionSettings {
  type: ReelTransitionType;
  durationMs: number;
  pauseMs: number;
}

export const REEL_TRANSITION_DURATION_MIN_MS = 50;
export const REEL_TRANSITION_DURATION_MAX_MS = 4000;
export const REEL_TRANSITION_PAUSE_MIN_MS = 0;
export const REEL_TRANSITION_PAUSE_MAX_MS = 3000;

export const REEL_TRANSITION_REGISTRY: Record<
  ReelTransitionType,
  { label: string; defaultDurationMs: number }
> = {
  'fade-black': { label: 'Fade to Black', defaultDurationMs: 700 },
  'fade-white': { label: 'Fade to White', defaultDurationMs: 700 },
  blend: { label: 'Blend / Crossfade', defaultDurationMs: 600 },
  'fast-cut': { label: 'Fast Cut', defaultDurationMs: 50 },
  'slide-left': { label: 'Slide Left', defaultDurationMs: 600 },
  'slide-right': { label: 'Slide Right', defaultDurationMs: 600 },
};

export const DEFAULT_REEL_TRANSITION_SETTINGS: ReelTransitionSettings = {
  type: 'blend',
  durationMs: REEL_TRANSITION_REGISTRY.blend.defaultDurationMs,
  pauseMs: 0,
};

export function normalizeReelTransitionSettings(value: unknown): ReelTransitionSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const type = REEL_TRANSITION_TYPES.includes(raw.type as ReelTransitionType)
    ? raw.type as ReelTransitionType
    : DEFAULT_REEL_TRANSITION_SETTINGS.type;
  const durationMs = Number(raw.durationMs);
  const pauseMs = Number(raw.pauseMs);

  return {
    type,
    durationMs: Number.isFinite(durationMs)
      ? Math.max(REEL_TRANSITION_DURATION_MIN_MS, Math.min(REEL_TRANSITION_DURATION_MAX_MS, Math.round(durationMs)))
      : REEL_TRANSITION_REGISTRY[type].defaultDurationMs,
    pauseMs: Number.isFinite(pauseMs)
      ? Math.max(REEL_TRANSITION_PAUSE_MIN_MS, Math.min(REEL_TRANSITION_PAUSE_MAX_MS, Math.round(pauseMs)))
      : DEFAULT_REEL_TRANSITION_SETTINGS.pauseMs,
  };
}

export function reelTransitionSettingsKey(value: unknown): string {
  const normalized = normalizeReelTransitionSettings(value);
  return `${normalized.type}:${normalized.durationMs}:${normalized.pauseMs}`;
}
