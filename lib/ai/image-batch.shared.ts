import type { ImageProviderKey } from '@/lib/ai/image-models.shared';

/**
 * Which beats of a (branching) story are included when a user requests batch
 * visualisation. Admin-configurable default via the `image_batch_scope` flag.
 */
export type ImageBatchScope =
  | 'path_to_completion' // beats on complete root→ending path(s) that exist (default)
  | 'all_existing' // every beat currently in the story map
  | 'expand_branches' // existing beats + eagerly generate unvisited branches (admin opt-in)
  | 'current_path'; // only the linear path from root to the current node

export const IMAGE_BATCH_SCOPES: ImageBatchScope[] = [
  'path_to_completion',
  'all_existing',
  'expand_branches',
  'current_path',
];

export const DEFAULT_IMAGE_BATCH_SCOPE: ImageBatchScope = 'path_to_completion';

/** Batch APIs (Gemini + OpenAI) bill image jobs at 50% of the interactive price. */
export const IMAGE_BATCH_DISCOUNT_MULTIPLIER = 0.5;

/** Providers that expose an async batch endpoint with the discount. */
export const BATCH_CAPABLE_PROVIDERS: ImageProviderKey[] = ['gemini', 'openai'];

export type ImageBatchJobStatus =
  | 'pending'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type ImageBatchItemStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type ImageBatchTargetKind = 'beat_image' | 'reel_image';

export interface ImageBatchScopeSettings {
  defaultScope: ImageBatchScope;
  allowExpandBranches: boolean;
}

export const DEFAULT_IMAGE_BATCH_SCOPE_SETTINGS: ImageBatchScopeSettings = {
  defaultScope: DEFAULT_IMAGE_BATCH_SCOPE,
  allowExpandBranches: false,
};

export function normalizeImageBatchScope(value?: string | null): ImageBatchScope {
  return IMAGE_BATCH_SCOPES.includes(value as ImageBatchScope)
    ? (value as ImageBatchScope)
    : DEFAULT_IMAGE_BATCH_SCOPE;
}

export function normalizeImageBatchScopeSettings(
  raw?: Partial<ImageBatchScopeSettings> | null
): ImageBatchScopeSettings {
  const defaultScope = normalizeImageBatchScope(raw?.defaultScope);
  const allowExpandBranches = raw?.allowExpandBranches === true;
  // Guard: don't let the default resolve to an expansion scope if expansion is disabled.
  return {
    defaultScope:
      defaultScope === 'expand_branches' && !allowExpandBranches
        ? DEFAULT_IMAGE_BATCH_SCOPE
        : defaultScope,
    allowExpandBranches,
  };
}

/** Batch discounted per-image estimate given the interactive provider cost. */
export function applyBatchDiscount(interactiveUsd: number): number {
  return Number((Math.max(0, interactiveUsd) * IMAGE_BATCH_DISCOUNT_MULTIPLIER).toFixed(6));
}

/** Providers must fall back to gemini if their provider has no batch endpoint. */
export function resolveBatchProvider(providerKey: ImageProviderKey): ImageProviderKey {
  return BATCH_CAPABLE_PROVIDERS.includes(providerKey) ? providerKey : 'gemini';
}
