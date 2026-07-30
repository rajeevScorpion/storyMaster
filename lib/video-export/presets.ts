import { PLAN_KEYS, type PlanKey } from '@/lib/types/pricing';

// Feature-flag key whose `value` column stores the preset list as JSON.
export const VIDEO_EXPORT_PRESETS_FLAG_KEY = 'video_export_presets_json';

export const EXPORT_PRESET_FPS_VALUES = [24, 30, 60] as const;
export type ExportPresetFps = (typeof EXPORT_PRESET_FPS_VALUES)[number];

export const EXPORT_PRESET_SAMPLE_RATES = [44100, 48000] as const;

const MIN_DIMENSION = 144;
const MAX_DIMENSION = 2160;
const MIN_VIDEO_BITRATE = 500_000;
const MAX_VIDEO_BITRATE = 30_000_000;
const MIN_AUDIO_BITRATE = 64_000;
const MAX_AUDIO_BITRATE = 320_000;

export interface ExportPresetDefinition {
  id: string;
  label: string;
  description: string;
  /** Portrait (9:16) dimensions; landscape exports swap width/height. */
  width: number;
  height: number;
  fps: ExportPresetFps;
  videoBitrate: number;
  audioBitrate: number;
  audioSampleRate: number;
  enabled: boolean;
  allowedTiers: PlanKey[];
  adminOnly: boolean;
  isExperimental: boolean;
  sortOrder: number;
  upgradePromptText: string;
}

export const DEFAULT_EXPORT_PRESETS: ExportPresetDefinition[] = [
  {
    id: 'sd',
    label: 'Standard',
    description: 'Fast, mobile-friendly export',
    width: 720,
    height: 1280,
    fps: 30,
    videoBitrate: 4_000_000,
    audioBitrate: 128_000,
    audioSampleRate: 48_000,
    enabled: true,
    allowedTiers: ['free', 'plus', 'studio'],
    adminOnly: false,
    isExperimental: false,
    sortOrder: 10,
    upgradePromptText: '',
  },
  {
    id: 'hd',
    label: 'HD',
    description: 'Sharper export for sharing and publishing',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: 10_000_000,
    audioBitrate: 192_000,
    audioSampleRate: 48_000,
    enabled: true,
    allowedTiers: ['plus', 'studio'],
    adminOnly: false,
    isExperimental: false,
    sortOrder: 20,
    upgradePromptText: 'HD export is available on Plus and above',
  },
  {
    id: 'ultra-smooth',
    label: 'Ultra Smooth',
    description: 'Experimental 60 fps export for capable devices',
    width: 1080,
    height: 1920,
    fps: 60,
    videoBitrate: 14_000_000,
    audioBitrate: 192_000,
    audioSampleRate: 48_000,
    enabled: false,
    allowedTiers: ['studio'],
    adminOnly: true,
    isExperimental: true,
    sortOrder: 30,
    upgradePromptText: '',
  },
];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

// H.264 with 4:2:0 chroma requires even dimensions.
function evenDimension(value: unknown, fallback: number): number {
  const clamped = Math.round(clampNumber(value, fallback, MIN_DIMENSION, MAX_DIMENSION));
  return clamped - (clamped % 2);
}

function fpsValue(value: unknown, fallback: ExportPresetFps): ExportPresetFps {
  const parsed = Number(value);
  return (EXPORT_PRESET_FPS_VALUES as readonly number[]).includes(parsed)
    ? parsed as ExportPresetFps
    : fallback;
}

function allowedTiersValue(value: unknown, fallback: PlanKey[]): PlanKey[] {
  if (!Array.isArray(value)) return [...fallback];
  const tiers = value.filter((tier): tier is PlanKey => (
    typeof tier === 'string' && (PLAN_KEYS as readonly string[]).includes(tier)
  ));
  return [...new Set(tiers)];
}

export function normalizeExportPreset(
  value: unknown,
  fallback: ExportPresetDefinition
): ExportPresetDefinition {
  const raw = objectValue(value);
  return {
    id: textValue(raw.id, fallback.id, 60) || fallback.id,
    label: textValue(raw.label, fallback.label, 60) || fallback.label,
    description: textValue(raw.description, fallback.description, 200),
    width: evenDimension(raw.width, fallback.width),
    height: evenDimension(raw.height, fallback.height),
    fps: fpsValue(raw.fps, fallback.fps),
    videoBitrate: Math.round(clampNumber(raw.videoBitrate, fallback.videoBitrate, MIN_VIDEO_BITRATE, MAX_VIDEO_BITRATE)),
    audioBitrate: Math.round(clampNumber(raw.audioBitrate, fallback.audioBitrate, MIN_AUDIO_BITRATE, MAX_AUDIO_BITRATE)),
    audioSampleRate: (EXPORT_PRESET_SAMPLE_RATES as readonly number[]).includes(Number(raw.audioSampleRate))
      ? Number(raw.audioSampleRate)
      : fallback.audioSampleRate,
    enabled: booleanValue(raw.enabled, fallback.enabled),
    allowedTiers: allowedTiersValue(raw.allowedTiers, fallback.allowedTiers),
    adminOnly: booleanValue(raw.adminOnly, fallback.adminOnly),
    isExperimental: booleanValue(raw.isExperimental, fallback.isExperimental),
    sortOrder: Math.round(clampNumber(raw.sortOrder, fallback.sortOrder, 0, 1000)),
    upgradePromptText: textValue(raw.upgradePromptText, fallback.upgradePromptText, 200),
  };
}

// Accepts the stored JSON (string or parsed). Anything malformed falls back to
// the recommended defaults so export never breaks on bad admin config.
export function normalizeExportPresets(value: unknown): ExportPresetDefinition[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return DEFAULT_EXPORT_PRESETS.map((preset) => ({ ...preset, allowedTiers: [...preset.allowedTiers] }));
  }

  const seen = new Set<string>();
  const presets: ExportPresetDefinition[] = [];
  parsed.forEach((entry, index) => {
    const raw = objectValue(entry);
    const fallback = DEFAULT_EXPORT_PRESETS.find((preset) => preset.id === raw.id)
      ?? DEFAULT_EXPORT_PRESETS[Math.min(index, DEFAULT_EXPORT_PRESETS.length - 1)];
    const preset = normalizeExportPreset(entry, fallback);
    if (seen.has(preset.id)) return;
    seen.add(preset.id);
    presets.push(preset);
  });
  return presets.length > 0
    ? presets.sort((left, right) => left.sortOrder - right.sortOrder)
    : DEFAULT_EXPORT_PRESETS.map((preset) => ({ ...preset, allowedTiers: [...preset.allowedTiers] }));
}

export function serializeExportPresets(presets: ExportPresetDefinition[]): string {
  return JSON.stringify(presets);
}

export type ExportPresetAvailability = 'available' | 'locked';

export interface ResolvedExportPreset extends ExportPresetDefinition {
  availability: ExportPresetAvailability;
  coinCost?: number;
}

// Tier authority: enabled presets visible to the plan, with tier-locked ones
// kept visible (as upsell) but marked locked. Admin-only presets are hidden
// from non-admins entirely.
export function resolveExportPresetsForPlan(
  presets: ExportPresetDefinition[],
  planKey: PlanKey,
  isAdmin: boolean
): ResolvedExportPreset[] {
  return presets
    .filter((preset) => preset.enabled && (isAdmin || !preset.adminOnly))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((preset) => ({
      ...preset,
      availability: isAdmin || preset.allowedTiers.includes(planKey) ? 'available' : 'locked',
    }));
}

export function getDefaultAvailablePreset(presets: ResolvedExportPreset[]): ResolvedExportPreset | null {
  return presets.find((preset) => preset.availability === 'available') ?? null;
}
