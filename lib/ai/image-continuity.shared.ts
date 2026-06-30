import type { ImageProviderKey } from '@/lib/ai/image-models.shared';

export const IMAGE_CONTINUITY_STRATEGIES = ['auto', 'provider_stateful', 'resend_refs'] as const;

export type ImageContinuityStrategy = (typeof IMAGE_CONTINUITY_STRATEGIES)[number];
export type ResolvedImageContinuityStrategy = 'provider_stateful' | 'resend_refs';
export type ImageContinuityStateKind = 'openai_responses' | 'gemini_interactions';

export interface ImageContinuityProviderState {
  provider: ImageProviderKey;
  requestedStrategy: ImageContinuityStrategy;
  strategy: ResolvedImageContinuityStrategy;
  stateKind: ImageContinuityStateKind;
  previousStateId?: string | null;
  stateOutputId?: string | null;
  imageCallId?: string | null;
  runtimeModelId?: string | null;
  usage?: Record<string, unknown> | null;
  fallbackReason?: string | null;
  createdAt: string;
}

export interface ImageContinuityResolution {
  requestedStrategy: ImageContinuityStrategy;
  strategy: ResolvedImageContinuityStrategy;
  stateKind: ImageContinuityStateKind | null;
  statefulProvider: ImageProviderKey | null;
  fallbackReason?: string;
}

export interface ImageContinuityRequest {
  requestedStrategy: ImageContinuityStrategy;
  strategy: ResolvedImageContinuityStrategy;
  stateKind: ImageContinuityStateKind | null;
  previousState?: ImageContinuityProviderState | null;
  runtimeModelId?: string | null;
  allowRuntimeFallback?: boolean;
}

export function normalizeImageContinuityStrategy(value: unknown): ImageContinuityStrategy {
  return IMAGE_CONTINUITY_STRATEGIES.includes(value as ImageContinuityStrategy)
    ? value as ImageContinuityStrategy
    : 'auto';
}

export function getImageContinuityStateKind(providerKey: ImageProviderKey): ImageContinuityStateKind | null {
  if (providerKey === 'openai') return 'openai_responses';
  if (providerKey === 'gemini') return 'gemini_interactions';
  return null;
}

export function imageProviderSupportsStatefulContinuity(providerKey: ImageProviderKey): boolean {
  return getImageContinuityStateKind(providerKey) !== null;
}

export function resolveImageContinuityStrategy(input: {
  requestedStrategy?: ImageContinuityStrategy | null;
  providerKey: ImageProviderKey;
  providerStatefulEnabled?: boolean;
}): ImageContinuityResolution {
  const requestedStrategy = normalizeImageContinuityStrategy(input.requestedStrategy);
  const stateKind = getImageContinuityStateKind(input.providerKey);
  const statefulEnabled = input.providerStatefulEnabled !== false && Boolean(stateKind);

  if (requestedStrategy === 'resend_refs') {
    return {
      requestedStrategy,
      strategy: 'resend_refs',
      stateKind: null,
      statefulProvider: null,
    };
  }

  if (statefulEnabled) {
    return {
      requestedStrategy,
      strategy: 'provider_stateful',
      stateKind,
      statefulProvider: input.providerKey,
    };
  }

  return {
    requestedStrategy,
    strategy: 'resend_refs',
    stateKind: null,
    statefulProvider: null,
    fallbackReason: stateKind
      ? 'stateful_disabled'
      : `${input.providerKey}_stateful_not_supported`,
  };
}

export function createImageContinuityState(input: {
  provider: ImageProviderKey;
  requestedStrategy: ImageContinuityStrategy;
  strategy: ResolvedImageContinuityStrategy;
  stateKind: ImageContinuityStateKind;
  previousStateId?: string | null;
  stateOutputId?: string | null;
  imageCallId?: string | null;
  runtimeModelId?: string | null;
  usage?: Record<string, unknown> | null;
  fallbackReason?: string | null;
  createdAt?: string;
}): ImageContinuityProviderState {
  return {
    provider: input.provider,
    requestedStrategy: normalizeImageContinuityStrategy(input.requestedStrategy),
    strategy: input.strategy,
    stateKind: input.stateKind,
    previousStateId: input.previousStateId ?? null,
    stateOutputId: input.stateOutputId ?? null,
    imageCallId: input.imageCallId ?? null,
    runtimeModelId: input.runtimeModelId ?? null,
    usage: input.usage ?? null,
    fallbackReason: input.fallbackReason ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function isContinuityState(value: unknown): value is ImageContinuityProviderState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ImageContinuityProviderState>;
  return Boolean(
    record.provider
    && record.strategy === 'provider_stateful'
    && record.stateKind
    && record.stateOutputId
  );
}

export function extractImageContinuityState(metadata: unknown): ImageContinuityProviderState | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  const direct = record.statefulContinuity ?? record.imageContinuityState;
  if (isContinuityState(direct)) return direct;

  const storyboard = record.storyboardGeneration;
  if (storyboard && typeof storyboard === 'object') {
    const nested = (storyboard as Record<string, unknown>).statefulContinuity;
    if (isContinuityState(nested)) return nested;
  }

  const portrait = record.portraitGeneration;
  if (portrait && typeof portrait === 'object') {
    const latest = (portrait as Record<string, unknown>).latestState;
    if (isContinuityState(latest)) return latest;
  }

  return null;
}

export function summarizeImageContinuityState(state: ImageContinuityProviderState | null | undefined): Record<string, unknown> | null {
  if (!state) return null;
  return {
    provider: state.provider,
    requestedStrategy: state.requestedStrategy,
    strategy: state.strategy,
    stateKind: state.stateKind,
    stateOutputId: state.stateOutputId ?? null,
    imageCallId: state.imageCallId ?? null,
    runtimeModelId: state.runtimeModelId ?? null,
    fallbackReason: state.fallbackReason ?? null,
    createdAt: state.createdAt,
  };
}
