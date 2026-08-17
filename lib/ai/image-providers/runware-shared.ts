import type { ImageModelCapabilities, ImageTaskKey } from '@/lib/ai/image-models.shared';

export const RUNWARE_API_URL = 'https://api.runware.ai/v1';

/** Runware rejects any dimension that is not a multiple of this, outside 128–2048. */
const DIMENSION_STEP = 64;
const MIN_DIMENSION = 128;
const MAX_DIMENSION = 2048;

export interface RunwareDimensions {
  width: number;
  height: number;
}

/**
 * Beat images are 2x2 grids, so a storyboard rendered at 2048x1152 gives each panel a full
 * 1024x576. Portraits are a single subject and do not need the extra pixels.
 */
const STORYBOARD_DIMENSIONS: Record<string, RunwareDimensions> = {
  '16:9': { width: 2048, height: 1152 },
  '9:16': { width: 1152, height: 2048 },
  '1:1': { width: 2048, height: 2048 },
};

const COMPACT_DIMENSIONS: Record<string, RunwareDimensions> = {
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  '1:1': { width: 1024, height: 1024 },
};

function snapToStep(value: number): number {
  const clamped = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value)));
  const snapped = Math.round(clamped / DIMENSION_STEP) * DIMENSION_STEP;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, snapped));
}

function readCapabilityOverride(
  capabilities: ImageModelCapabilities | undefined,
  aspectRatio: string
): RunwareDimensions | null {
  const override = capabilities?.dimensions?.[aspectRatio];
  if (!override) return null;
  const { width, height } = override;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: snapToStep(width), height: snapToStep(height) };
}

/**
 * Runware takes explicit pixels rather than an aspect-ratio string, so every other adapter's
 * ratio vocabulary has to be translated here. Admins can override per model via
 * `capabilities.dimensions` without a deploy.
 */
export function resolveRunwareDimensions(input: {
  task: ImageTaskKey;
  aspectRatio?: string;
  imageSize?: string;
  capabilities?: ImageModelCapabilities;
}): RunwareDimensions {
  const aspectRatio = input.aspectRatio === '9:16' || input.aspectRatio === '1:1' || input.aspectRatio === '16:9'
    ? input.aspectRatio
    : input.task === 'portrait_generation'
    ? '1:1'
    : '16:9';

  const override = readCapabilityOverride(input.capabilities, aspectRatio);
  if (override) return override;

  const wantsCompact = input.task === 'portrait_generation'
    || input.imageSize === '512'
    || input.imageSize === '0.5K'
    || input.imageSize === '1K';

  const table = wantsCompact ? COMPACT_DIMENSIONS : STORYBOARD_DIMENSIONS;
  return table[aspectRatio] ?? STORYBOARD_DIMENSIONS['16:9'];
}

export interface RunwareImageResult {
  dataUrl: string;
  cost: number | null;
  seed: number | null;
  imageUUID: string | null;
  nsfw: boolean | null;
}

interface RunwareResponseItem {
  taskUUID?: string;
  imageDataURI?: string;
  imageBase64Data?: string;
  imageURL?: string;
  imageUUID?: string;
  cost?: number;
  seed?: number;
  NSFWContent?: boolean;
}

interface RunwareEnvelope {
  data?: RunwareResponseItem[];
  errors?: Array<{ message?: string; code?: string; taskUUID?: string }>;
  error?: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Runware answers with an array envelope keyed by taskUUID, so a response is only ours if the
 * id comes back matching. Errors arrive in a sibling `errors` array rather than as a non-2xx.
 */
export function parseRunwareImageResponse(json: unknown, taskUUID: string): RunwareImageResult {
  const envelope = (json ?? {}) as RunwareEnvelope;

  const matchingError = envelope.errors?.find((item) => !item.taskUUID || item.taskUUID === taskUUID);
  if (matchingError) {
    throw new Error(`Runware image generation failed: ${matchingError.message ?? matchingError.code ?? 'unknown error'}`);
  }
  if (typeof envelope.error === 'string' && envelope.error) {
    throw new Error(`Runware image generation failed: ${envelope.error}`);
  }

  const item = envelope.data?.find((entry) => entry.taskUUID === taskUUID);
  if (!item) {
    throw new Error(`Runware returned no result for task ${taskUUID}.`);
  }

  const dataUrl = item.imageDataURI
    ?? (item.imageBase64Data ? `data:image/png;base64,${item.imageBase64Data}` : null);
  if (!dataUrl) {
    throw new Error('Runware returned a result without inline image data.');
  }

  return {
    dataUrl,
    cost: finiteOrNull(item.cost),
    seed: finiteOrNull(item.seed),
    imageUUID: item.imageUUID ?? null,
    nsfw: typeof item.NSFWContent === 'boolean' ? item.NSFWContent : null,
  };
}
