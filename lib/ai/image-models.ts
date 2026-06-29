import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  IMAGE_PROVIDER_LABELS,
  type ImageModelCapabilities,
  type ImageModelOption,
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
  );
  const available = options.filter((record) => record.isAvailableToCurrentPlan);
  return sortImageModels((available.length > 0 ? available : options).map(stripAdminFields));
}

export async function resolveImageModelSnapshot(input: {
  taskKey: ImageTaskKey;
  selection?: ImageModelSelection | null;
  currentPlanKey?: PlanKey;
  allowAdminDisabled?: boolean;
}): Promise<ImageModelSnapshot> {
  const records = await listImageModelRegistry(input.currentPlanKey ?? 'free');
  const taskRecords = records.filter((record) => record.taskKey === input.taskKey);
  const ready = taskRecords.filter((record) =>
    record.isEnabled
    && record.isProviderConfigured
    && record.isAvailableToCurrentPlan
  );
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
  return {
    taskKey: resolved.taskKey,
    providerKey: resolved.providerKey,
    providerModelId: resolved.providerModelId,
    modelKey: resolved.modelKey,
    displayName: resolved.displayName,
    coinCostPerImage: resolved.coinCostPerImage,
    allowedPlanKeys: resolved.allowedPlanKeys,
    capabilities: resolved.capabilities,
    resolvedAt: new Date().toISOString(),
  };
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
