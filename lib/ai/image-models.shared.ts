import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { PlanKey } from '@/lib/types/pricing';

export type ImageTaskKey = Extract<TaskKey, 'image_generation' | 'reel_image_generation' | 'portrait_generation'>;

export type ImageProviderKey = 'gemini' | 'openai' | 'xai';

export const IMAGE_PROVIDER_LABELS: Record<ImageProviderKey, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  xai: 'xAI',
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
  [key: string]: unknown;
}

export interface ImageModelSnapshot {
  taskKey: ImageTaskKey;
  providerKey: ImageProviderKey;
  providerModelId: string;
  modelKey: string;
  displayName: string;
  coinCostPerImage: number;
  allowedPlanKeys: PlanKey[];
  capabilities: ImageModelCapabilities;
  resolvedAt: string;
}

export interface ImageModelOption {
  id: string;
  taskKey: ImageTaskKey;
  providerKey: ImageProviderKey;
  providerLabel: string;
  modelKey: string;
  providerModelId: string;
  displayName: string;
  description: string;
  badge: string | null;
  coinCostPerImage: number;
  allowedPlanKeys: PlanKey[];
  capabilities: ImageModelCapabilities;
  isDefault: boolean;
  isRecommended: boolean;
  isEnabled: boolean;
  isUserVisible: boolean;
  isAvailableToCurrentPlan: boolean;
  isProviderConfigured: boolean;
  missingEnvVars: string[];
  sortOrder: number;
}

export interface ImageModelRegistryRecord extends ImageModelOption {
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
