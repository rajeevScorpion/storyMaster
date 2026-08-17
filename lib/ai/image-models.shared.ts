import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { PlanKey } from '@/lib/types/pricing';

export type ImageTaskKey = Extract<TaskKey, 'image_generation' | 'reel_image_generation' | 'portrait_generation'>;

export type ImageProviderKey = 'gemini' | 'openai' | 'xai' | 'runware';

/** Admin-facing only. Never send these to the browser — see toPublicImageModelOption. */
export const IMAGE_PROVIDER_LABELS: Record<ImageProviderKey, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  xai: 'xAI',
  runware: 'Runware',
};

export interface ImageModelSelection {
  taskKey?: ImageTaskKey;
  modelKey: string;
}

export interface ImageModelCapabilities {
  aspectRatios?: string[];
  supportsReferences?: boolean;
  supportsBase64?: boolean;
  outputFormats?: string[];
  /**
   * Groups models that share a visual identity, so a storyboard model is paired with a
   * portrait model that renders faces the same way. Matters when one provider key fronts
   * several unrelated model families (an aggregator); providers with a single family leave
   * this unset and fall back to provider-level matching.
   */
  continuityFamily?: string;
  /** Explicit pixel dimensions per aspect ratio, for providers that take pixels not ratios. */
  dimensions?: Record<string, { width: number; height: number }>;
  // Image prompt compiler settings (Kissago JSON image prompt optimization).
  // Stored in the image_model_registry `capabilities` JSONB; read by
  // normalizePromptCompilerCapability. All fields optional and fail-closed.
  promptCompiler?: {
    enabled?: boolean;
    promptBudgetChars?: number;
    supportsNegativePrompt?: boolean;
    adapterVersion?: string;
  };
  [key: string]: unknown;
}

export interface ImageModelSnapshot {
  taskKey: ImageTaskKey;
  providerKey: ImageProviderKey;
  providerModelId: string;
  modelKey: string;
  displayName: string;
  coinCostPerImage: number;
  providerCostPerOutputImageUsd: number;
  providerCostPerInputImageUsd: number;
  allowedPlanKeys: PlanKey[];
  capabilities: ImageModelCapabilities;
  resolvedAt: string;
}

/**
 * What the browser is allowed to know about a model. Deliberately the plainly-named type:
 * anything that reaches the client should be this, so a new internal field is private by
 * default rather than leaking until someone notices. Built by toPublicImageModelOption.
 */
export interface ImageModelOption {
  id: string;
  taskKey: ImageTaskKey;
  modelKey: string;
  displayName: string;
  description: string;
  badge: string | null;
  coinCostPerImage: number;
  isDefault: boolean;
  isRecommended: boolean;
  isAvailableToCurrentPlan: boolean;
  sortOrder: number;
  /** Derived server-side so the client never needs providerKey to reason about continuity. */
  supportsStatefulContinuity: boolean;
}

/** Server-side view. Carries provider identity and our per-image cost of goods. */
export interface ImageModelInternalOption extends ImageModelOption {
  providerKey: ImageProviderKey;
  providerLabel: string;
  providerModelId: string;
  providerCostPerOutputImageUsd: number;
  providerCostPerInputImageUsd: number;
  allowedPlanKeys: PlanKey[];
  capabilities: ImageModelCapabilities;
  isEnabled: boolean;
  isUserVisible: boolean;
  isProviderConfigured: boolean;
  missingEnvVars: string[];
}

export interface ImageModelRegistryRecord extends ImageModelInternalOption {
  isAdminTestEnabled: boolean;
  requiredEnvVars: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ImageModelPickerState {
  taskKey: ImageTaskKey;
  options: ImageModelOption[];
  selectedModelKey: string;
  defaultModelKey: string;
}

export function imageTaskForStoryKind(storyKind: 'story' | 'reel'): Extract<ImageTaskKey, 'image_generation' | 'reel_image_generation'> {
  return storyKind === 'reel' ? 'reel_image_generation' : 'image_generation';
}

export function coinsToBeatCost(coins: number): number {
  return Number((Math.max(0, coins) / 10).toFixed(2));
}

export function beatCostToCoins(beatCost: number): number {
  return Number((Math.max(0, beatCost) * 10).toFixed(2));
}

export function isStoryboardImageTask(
  taskKey: ImageTaskKey
): taskKey is Extract<ImageTaskKey, 'image_generation' | 'reel_image_generation'> {
  return taskKey === 'image_generation' || taskKey === 'reel_image_generation';
}

export function getImageModelMaxReferenceImages(capabilities: ImageModelCapabilities): number {
  const value = capabilities.maxReferenceImages;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : capabilities.supportsReferences
    ? 3
    : 0;
}

export function estimateImageProviderCostUsd(input: {
  snapshot: Pick<ImageModelSnapshot, 'providerCostPerOutputImageUsd' | 'providerCostPerInputImageUsd'>;
  outputImageCount?: number;
  inputImageCount?: number;
}): number {
  const outputImageCount = Math.max(0, Math.round(input.outputImageCount ?? 1));
  const inputImageCount = Math.max(0, Math.round(input.inputImageCount ?? 0));
  const outputCost = Math.max(0, input.snapshot.providerCostPerOutputImageUsd) * outputImageCount;
  const inputCost = Math.max(0, input.snapshot.providerCostPerInputImageUsd) * inputImageCount;
  return Number((outputCost + inputCost).toFixed(6));
}
