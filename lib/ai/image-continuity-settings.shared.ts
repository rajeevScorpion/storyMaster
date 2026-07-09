import {
  normalizeImageContinuityStrategy,
  type ImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
import type { ImageProviderKey } from '@/lib/ai/image-models.shared';

export interface StatefulRuntimePricing {
  enabled: boolean;
  runtimeModelId: string;
  inputUsdPer1MTokens: number;
  cachedInputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
}

export interface ImageContinuitySettings {
  defaultStrategy: ImageContinuityStrategy;
  openai: StatefulRuntimePricing;
  gemini: StatefulRuntimePricing;
  xai: {
    enabled: false;
  };
}

export interface StatefulUsageTokenCounts {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  inputTokensByModality?: unknown;
  outputTokensByModality?: unknown;
  cachedTokensByModality?: unknown;
}

export interface StatefulRuntimeCostEstimate extends StatefulUsageTokenCounts {
  runtimeCostUsd: number;
}

export const DEFAULT_IMAGE_CONTINUITY_SETTINGS: ImageContinuitySettings = {
  defaultStrategy: 'auto',
  openai: {
    enabled: true,
    runtimeModelId: 'gpt-5.4-mini',
    inputUsdPer1MTokens: 0.75,
    cachedInputUsdPer1MTokens: 0.075,
    outputUsdPer1MTokens: 4.5,
  },
  gemini: {
    enabled: true,
    runtimeModelId: 'gemini-3.1-flash-image',
    inputUsdPer1MTokens: 0.5,
    cachedInputUsdPer1MTokens: 0.125,
    outputUsdPer1MTokens: 3,
  },
  xai: {
    enabled: false,
  },
};

function cleanString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanCost(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number(value)
    : NaN;
  return Number.isFinite(numeric)
    ? Math.max(0, Number(numeric.toFixed(6)))
    : fallback;
}

function cleanRuntimePricing(value: unknown, fallback: StatefulRuntimePricing): StatefulRuntimePricing {
  const raw = value && typeof value === 'object'
    ? value as Partial<StatefulRuntimePricing>
    : {};
  return {
    enabled: raw.enabled !== false,
    runtimeModelId: cleanString(raw.runtimeModelId, fallback.runtimeModelId),
    inputUsdPer1MTokens: cleanCost(raw.inputUsdPer1MTokens, fallback.inputUsdPer1MTokens),
    cachedInputUsdPer1MTokens: cleanCost(raw.cachedInputUsdPer1MTokens, fallback.cachedInputUsdPer1MTokens),
    outputUsdPer1MTokens: cleanCost(raw.outputUsdPer1MTokens, fallback.outputUsdPer1MTokens),
  };
}

export function normalizeImageContinuitySettings(value: unknown): ImageContinuitySettings {
  const raw = value && typeof value === 'object'
    ? value as Partial<ImageContinuitySettings>
    : {};
  return {
    defaultStrategy: normalizeImageContinuityStrategy(raw.defaultStrategy),
    openai: cleanRuntimePricing(raw.openai, DEFAULT_IMAGE_CONTINUITY_SETTINGS.openai),
    gemini: cleanRuntimePricing(raw.gemini, DEFAULT_IMAGE_CONTINUITY_SETTINGS.gemini),
    xai: { enabled: false },
  };
}

export function serializeImageContinuitySettings(settings: ImageContinuitySettings): string {
  return JSON.stringify(normalizeImageContinuitySettings(settings));
}

export function getStatefulRuntimePricing(
  settings: ImageContinuitySettings,
  providerKey: ImageProviderKey
): StatefulRuntimePricing | null {
  if (providerKey === 'openai') return settings.openai;
  if (providerKey === 'gemini') return settings.gemini;
  return null;
}

function finiteTokenCount(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number(value)
    : NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function getNestedNumber(record: Record<string, unknown>, path: string[]): number {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== 'object') return 0;
    current = (current as Record<string, unknown>)[key];
  }
  return finiteTokenCount(current);
}

export function extractStatefulUsageTokenCounts(usage: unknown): StatefulUsageTokenCounts {
  const record = usage && typeof usage === 'object'
    ? usage as Record<string, unknown>
    : {};
  const inputTokens = finiteTokenCount(record.input_tokens)
    || finiteTokenCount(record.total_input_tokens)
    || finiteTokenCount(record.prompt_tokens)
    || finiteTokenCount(record.promptTokenCount);
  const outputTokens = finiteTokenCount(record.output_tokens)
    || finiteTokenCount(record.total_output_tokens)
    || finiteTokenCount(record.completion_tokens)
    || finiteTokenCount(record.candidatesTokenCount);
  const cachedTokens = getNestedNumber(record, ['input_tokens_details', 'cached_tokens'])
    || finiteTokenCount(record.cached_tokens)
    || finiteTokenCount(record.total_cached_tokens);

  return {
    inputTokens,
    cachedTokens,
    outputTokens,
    inputTokensByModality: record.input_tokens_by_modality,
    outputTokensByModality: record.output_tokens_by_modality,
    cachedTokensByModality: record.cached_tokens_by_modality,
  };
}

export function estimateStatefulRuntimeCostUsd(input: {
  pricing: StatefulRuntimePricing;
  usage: unknown;
}): StatefulRuntimeCostEstimate {
  const counts = extractStatefulUsageTokenCounts(input.usage);
  const cachedTokens = Math.min(counts.cachedTokens, counts.inputTokens);
  const uncachedInputTokens = Math.max(0, counts.inputTokens - cachedTokens);
  const inputCost = (uncachedInputTokens / 1_000_000) * input.pricing.inputUsdPer1MTokens;
  const cachedCost = (cachedTokens / 1_000_000) * input.pricing.cachedInputUsdPer1MTokens;
  const outputCost = (counts.outputTokens / 1_000_000) * input.pricing.outputUsdPer1MTokens;
  return {
    ...counts,
    cachedTokens,
    runtimeCostUsd: Number((inputCost + cachedCost + outputCost).toFixed(6)),
  };
}
