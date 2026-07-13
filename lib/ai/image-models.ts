import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  IMAGE_PROVIDER_LABELS,
  isStoryboardImageTask,
  type ImageModelCapabilities,
  type ImageModelOption,
  type ImageModelPickerState,
  type ImageModelRegistryRecord,
  type ImageModelSelection,
  type ImageModelSnapshot,
  type ImageProviderKey,
  type ImageTaskKey,
} from '@/lib/ai/image-models.shared';
import type { PlanKey } from '@/lib/types/pricing';

interface ImageModelRegistryRow {
  id: string;
  task_key: ImageTaskKey;
  provider_key: ImageProviderKey;
  model_key: string;
  provider_model_id: string;
  display_name: string;
  description: string | null;
  badge: string | null;
  is_enabled: boolean;
  is_user_visible: boolean;
  is_admin_test_enabled: boolean;
  is_default: boolean;
  is_recommended: boolean;
  allowed_plan_keys: string[] | null;
  coin_cost_per_image: number | string | null;
  provider_cost_per_output_image_usd?: number | string | null;
  provider_cost_per_input_image_usd?: number | string | null;
  capabilities: Record<string, unknown> | null;
  required_env_vars: string[] | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_ALLOWED_PLANS: PlanKey[] = ['free', 'plus', 'studio'];

function normalizePlanKeys(value: string[] | null | undefined): PlanKey[] {
  const normalized = (value ?? [])
    .filter((item): item is PlanKey => item === 'free' || item === 'plus' || item === 'studio');
  return normalized.length > 0 ? normalized : DEFAULT_ALLOWED_PLANS;
}

function normalizeCapabilities(value: Record<string, unknown> | null | undefined): ImageModelCapabilities {
  return value && typeof value === 'object' ? value : {};
}

function getMissingEnvVars(requiredEnvVars: string[]): string[] {
  return requiredEnvVars.filter((key) => !process.env[key]);
}

function rowToRegistryRecord(row: ImageModelRegistryRow, currentPlanKey: PlanKey = 'free'): ImageModelRegistryRecord {
  const requiredEnvVars = Array.isArray(row.required_env_vars) ? row.required_env_vars : [];
  const missingEnvVars = getMissingEnvVars(requiredEnvVars);
  const allowedPlanKeys = normalizePlanKeys(row.allowed_plan_keys);
  return {
    id: row.id,
    taskKey: row.task_key,
    providerKey: row.provider_key,
    providerLabel: IMAGE_PROVIDER_LABELS[row.provider_key] ?? row.provider_key,
    modelKey: row.model_key,
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    description: row.description ?? '',
    badge: row.badge,
    coinCostPerImage: Number(row.coin_cost_per_image ?? 0),
    providerCostPerOutputImageUsd: Number(row.provider_cost_per_output_image_usd ?? 0),
    providerCostPerInputImageUsd: Number(row.provider_cost_per_input_image_usd ?? 0),
    allowedPlanKeys,
    capabilities: normalizeCapabilities(row.capabilities),
    isDefault: Boolean(row.is_default),
    isRecommended: Boolean(row.is_recommended),
    isEnabled: Boolean(row.is_enabled),
    isUserVisible: Boolean(row.is_user_visible),
    isAdminTestEnabled: Boolean(row.is_admin_test_enabled),
    isAvailableToCurrentPlan: allowedPlanKeys.includes(currentPlanKey),
    isProviderConfigured: missingEnvVars.length === 0,
    missingEnvVars,
    requiredEnvVars,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sortImageModels<T extends { sortOrder: number; displayName: string; providerLabel: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    left.sortOrder - right.sortOrder
    || left.providerLabel.localeCompare(right.providerLabel)
    || left.displayName.localeCompare(right.displayName)
  );
}

function isReadyForCurrentPlan(record: ImageModelRegistryRecord): boolean {
  return record.isEnabled
    && record.isProviderConfigured
    && record.isAvailableToCurrentPlan;
}

function hasProviderMatchedPortrait(records: ImageModelRegistryRecord[], record: ImageModelRegistryRecord): boolean {
  if (!isStoryboardImageTask(record.taskKey)) return true;
  return records.some((candidate) =>
    candidate.taskKey === 'portrait_generation'
    && candidate.providerKey === record.providerKey
    && isReadyForCurrentPlan(candidate)
  );
}

function toSnapshot(record: ImageModelRegistryRecord): ImageModelSnapshot {
  return {
    taskKey: record.taskKey,
    providerKey: record.providerKey,
    providerModelId: record.providerModelId,
    modelKey: record.modelKey,
    displayName: record.displayName,
    coinCostPerImage: record.coinCostPerImage,
    providerCostPerOutputImageUsd: record.providerCostPerOutputImageUsd,
    providerCostPerInputImageUsd: record.providerCostPerInputImageUsd,
    allowedPlanKeys: record.allowedPlanKeys,
    capabilities: record.capabilities,
    resolvedAt: new Date().toISOString(),
  };
}

export async function listImageModelRegistry(currentPlanKey: PlanKey = 'free'): Promise<ImageModelRegistryRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('image_model_registry')
    .select('*')
    .order('task_key', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    if (error.code === '42P01' || /image_model_registry/i.test(error.message)) {
      return getFallbackImageModelRecords(currentPlanKey);
    }
    throw new Error(`Failed to load image model registry: ${error.message}`);
  }

  return sortImageModels(((data ?? []) as ImageModelRegistryRow[]).map((row) => rowToRegistryRecord(row, currentPlanKey)));
}

export async function listUserVisibleImageModelOptions(
  taskKey: ImageTaskKey,
  currentPlanKey: PlanKey = 'free'
): Promise<ImageModelOption[]> {
  const records = await listImageModelRegistry(currentPlanKey);
  const options = records.filter((record) =>
    record.taskKey === taskKey
    && record.isEnabled
    && record.isUserVisible
    && record.isProviderConfigured
    && hasProviderMatchedPortrait(records, record)
  );
  const available = options.filter((record) => record.isAvailableToCurrentPlan);
  return sortImageModels((available.length > 0 ? available : options).map(stripAdminFields));
}

export async function buildImageModelPickerState(
  taskKey: ImageTaskKey,
  selection: ImageModelSelection | null | undefined,
  currentPlanKey: PlanKey
): Promise<ImageModelPickerState> {
  const options = await listUserVisibleImageModelOptions(taskKey, currentPlanKey);
  const defaultModelKey = options.find((option) => option.isDefault)?.modelKey ?? options[0]?.modelKey ?? '';
  const selectedModelKey = selection?.taskKey && selection.taskKey !== taskKey
    ? defaultModelKey
    : options.some((option) => option.modelKey === selection?.modelKey)
    ? selection!.modelKey
    : defaultModelKey;

  return {
    taskKey,
    options,
    defaultModelKey,
    selectedModelKey,
  };
}

export async function resolveImageModelSnapshot(input: {
  taskKey: ImageTaskKey;
  selection?: ImageModelSelection | null;
  currentPlanKey?: PlanKey;
  allowAdminDisabled?: boolean;
}): Promise<ImageModelSnapshot> {
  const records = await listImageModelRegistry(input.currentPlanKey ?? 'free');
  const taskRecords = records.filter((record) => record.taskKey === input.taskKey);
  const ready = taskRecords.filter(isReadyForCurrentPlan);
  const visibleReady = ready.filter((record) => record.isUserVisible);
  const internalReady = input.taskKey === 'portrait_generation' ? ready : visibleReady;
  const candidates = input.allowAdminDisabled
    ? taskRecords.filter((record) => record.isProviderConfigured)
    : internalReady;
  const selectedKey = input.selection?.taskKey && input.selection.taskKey !== input.taskKey
    ? null
    : input.selection?.modelKey ?? null;
  const selected = selectedKey
    ? candidates.find((record) => record.modelKey === selectedKey)
    : null;
  const fallback =
    candidates.find((record) => record.isDefault)
    ?? internalReady.find((record) => record.isDefault)
    ?? candidates[0]
    ?? internalReady[0]
    ?? getFallbackImageModelRecords(input.currentPlanKey ?? 'free').find((record) => record.taskKey === input.taskKey);

  if (!fallback) {
    throw new Error(`No image model is available for ${input.taskKey}.`);
  }

  const resolved = selected ?? fallback;
  if (!input.allowAdminDisabled && !hasProviderMatchedPortrait(records, resolved)) {
    throw new Error(`${resolved.displayName} is unavailable because no ready ${resolved.providerLabel} portrait model is configured for character continuity.`);
  }

  return toSnapshot(resolved);
}

export async function resolveLinkedPortraitImageModelSnapshot(input: {
  selection?: ImageModelSelection | null;
  currentPlanKey?: PlanKey;
  allowAdminDisabled?: boolean;
}): Promise<ImageModelSnapshot> {
  const records = await listImageModelRegistry(input.currentPlanKey ?? 'free');
  const selectedTaskKey = input.selection?.taskKey ?? 'image_generation';
  const storyboardRecords = records.filter((record) => isStoryboardImageTask(record.taskKey));
  const storyboardCandidates = input.allowAdminDisabled
    ? storyboardRecords.filter((record) => record.isProviderConfigured)
    : storyboardRecords.filter((record) =>
        isReadyForCurrentPlan(record)
        && record.isUserVisible
        && hasProviderMatchedPortrait(records, record)
      );
  const selectedStoryboard = input.selection?.modelKey && isStoryboardImageTask(selectedTaskKey)
    ? storyboardCandidates.find((record) =>
        record.taskKey === selectedTaskKey
        && record.modelKey === input.selection?.modelKey
      )
    : null;
  const fallbackStoryboard =
    selectedStoryboard
    ?? storyboardCandidates.find((record) => record.taskKey === selectedTaskKey && record.isDefault)
    ?? storyboardCandidates.find((record) => record.isDefault)
    ?? storyboardCandidates[0];

  if (!fallbackStoryboard) {
    return resolveImageModelSnapshot({
      taskKey: 'portrait_generation',
      selection: input.selection,
      currentPlanKey: input.currentPlanKey,
      allowAdminDisabled: input.allowAdminDisabled,
    });
  }

  const portraitRecords = records.filter((record) =>
    record.taskKey === 'portrait_generation'
    && record.providerKey === fallbackStoryboard.providerKey
  );
  const portraitCandidates = input.allowAdminDisabled
    ? portraitRecords.filter((record) => record.isProviderConfigured)
    : portraitRecords.filter(isReadyForCurrentPlan);
  const portrait =
    portraitCandidates.find((record) => record.isDefault)
    ?? portraitCandidates[0];

  if (!portrait) {
    throw new Error(`${fallbackStoryboard.displayName} is unavailable because no ready ${fallbackStoryboard.providerLabel} portrait model is configured for character continuity.`);
  }

  return toSnapshot(portrait);
}

export async function saveImageModelRegistryRecord(
  id: string,
  patch: {
    displayName?: string;
    description?: string;
    badge?: string | null;
    isEnabled?: boolean;
    isUserVisible?: boolean;
    isAdminTestEnabled?: boolean;
    isDefault?: boolean;
    isRecommended?: boolean;
    allowedPlanKeys?: PlanKey[];
    coinCostPerImage?: number;
    providerCostPerOutputImageUsd?: number;
    providerCostPerInputImageUsd?: number;
    capabilities?: ImageModelCapabilities;
    sortOrder?: number;
    updatedBy?: string | null;
  }
): Promise<ImageModelRegistryRecord[]> {
  const supabase = createAdminClient();
  const existing = await supabase
    .from('image_model_registry')
    .select('task_key')
    .eq('id', id)
    .single();

  if (existing.error || !existing.data) {
    throw new Error(`Image model not found: ${existing.error?.message || id}`);
  }

  if (patch.isDefault) {
    await supabase
      .from('image_model_registry')
      .update({ is_default: false })
      .eq('task_key', existing.data.task_key)
      .neq('id', id);
  }

  const update: Record<string, unknown> = {};
  if (typeof patch.displayName === 'string') update.display_name = patch.displayName.trim();
  if (typeof patch.description === 'string') update.description = patch.description.trim();
  if (patch.badge !== undefined) update.badge = patch.badge?.trim() || null;
  if (typeof patch.isEnabled === 'boolean') update.is_enabled = patch.isEnabled;
  if (typeof patch.isUserVisible === 'boolean') update.is_user_visible = patch.isUserVisible;
  if (typeof patch.isAdminTestEnabled === 'boolean') update.is_admin_test_enabled = patch.isAdminTestEnabled;
  if (typeof patch.isDefault === 'boolean') update.is_default = patch.isDefault;
  if (typeof patch.isRecommended === 'boolean') update.is_recommended = patch.isRecommended;
  if (patch.allowedPlanKeys) update.allowed_plan_keys = normalizePlanKeys(patch.allowedPlanKeys);
  if (typeof patch.coinCostPerImage === 'number' && Number.isFinite(patch.coinCostPerImage)) {
    update.coin_cost_per_image = Math.max(0, Number(patch.coinCostPerImage.toFixed(2)));
  }
  if (typeof patch.providerCostPerOutputImageUsd === 'number' && Number.isFinite(patch.providerCostPerOutputImageUsd)) {
    update.provider_cost_per_output_image_usd = Math.max(0, Number(patch.providerCostPerOutputImageUsd.toFixed(6)));
  }
  if (typeof patch.providerCostPerInputImageUsd === 'number' && Number.isFinite(patch.providerCostPerInputImageUsd)) {
    update.provider_cost_per_input_image_usd = Math.max(0, Number(patch.providerCostPerInputImageUsd.toFixed(6)));
  }
  if (patch.capabilities) update.capabilities = patch.capabilities;
  if (typeof patch.sortOrder === 'number' && Number.isFinite(patch.sortOrder)) {
    update.sort_order = Math.round(patch.sortOrder);
  }
  if (patch.updatedBy) update.updated_by = patch.updatedBy;

  const { error } = await supabase
    .from('image_model_registry')
    .update(update)
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to update image model: ${error.message}`);
  }

  return listImageModelRegistry();
}

function stripAdminFields(record: ImageModelRegistryRecord): ImageModelOption {
  const {
    isAdminTestEnabled: _isAdminTestEnabled,
    requiredEnvVars: _requiredEnvVars,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...option
  } = record;
  return option;
}

function getFallbackImageModelRecords(currentPlanKey: PlanKey): ImageModelRegistryRecord[] {
  const now = new Date().toISOString();
  return (['image_generation', 'reel_image_generation', 'portrait_generation'] as const).map((taskKey, index) => {
    const allowedPlanKeys = DEFAULT_ALLOWED_PLANS;
    const requiredEnvVars = ['GEMINI_API_KEY'];
    const missingEnvVars = getMissingEnvVars(requiredEnvVars);
    return {
      id: `fallback-${taskKey}`,
      taskKey,
      providerKey: 'gemini',
      providerLabel: 'Gemini',
      modelKey: 'gemini-3.1-flash-image',
      providerModelId: 'gemini-3.1-flash-image',
      displayName: taskKey === 'portrait_generation' ? 'Gemini Flash Portrait' : 'Gemini Flash Image',
      description: 'Code fallback used until the image model registry migration is applied.',
      badge: 'Default',
      coinCostPerImage: taskKey === 'portrait_generation' ? 0 : 5,
      providerCostPerOutputImageUsd: 0.067,
      providerCostPerInputImageUsd: 0,
      allowedPlanKeys,
      capabilities: {
        aspectRatios: taskKey === 'portrait_generation' ? ['1:1'] : ['16:9', '9:16'],
        supportsReferences: taskKey !== 'portrait_generation',
        supportsBase64: true,
      },
      isDefault: true,
      isRecommended: true,
      isEnabled: true,
      isUserVisible: taskKey !== 'portrait_generation',
      isAdminTestEnabled: true,
      isAvailableToCurrentPlan: allowedPlanKeys.includes(currentPlanKey),
      isProviderConfigured: missingEnvVars.length === 0,
      missingEnvVars,
      requiredEnvVars,
      sortOrder: 10 + index,
      createdAt: now,
      updatedAt: now,
    };
  });
}
