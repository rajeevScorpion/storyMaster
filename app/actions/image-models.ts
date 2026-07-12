'use server';

import { revalidatePath } from 'next/cache';
import { verifyAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { generateImageWithProvider } from '@/lib/ai/image-providers/router';
import {
  getElevenLabsCostSettings,
  saveElevenLabsCostSettings,
} from '@/lib/ai/provider-costs';
import {
  getImageContinuitySettings,
  saveImageContinuitySettings,
} from '@/lib/ai/image-continuity-settings';
import {
  buildImageModelPickerState,
  listImageModelRegistry,
  resolveImageModelSnapshot,
  saveImageModelRegistryRecord,
} from '@/lib/ai/image-models';
import type {
  ImageModelCapabilities,
  ImageModelPickerState,
  ImageModelRegistryRecord,
  ImageModelSelection,
  ImageTaskKey,
} from '@/lib/ai/image-models.shared';
import type { ElevenLabsCostSettings } from '@/lib/ai/provider-costs.shared';
import type { ImageContinuitySettings } from '@/lib/ai/image-continuity-settings.shared';
import type { PlanKey } from '@/lib/types/pricing';

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

export async function getImageModelPickerState(
  taskKey: ImageTaskKey,
  selection?: ImageModelSelection | null
): Promise<ImageModelPickerState> {
  const pricing = await getPricingRuntimeContext().catch(() => null);
  const planKey = pricing?.snapshot.planKey ?? 'free';
  return buildImageModelPickerState(taskKey, selection ?? null, planKey);
}

export async function getAdminImageModelRegistry(): Promise<ImageModelRegistryRecord[]> {
  await verifyAdmin();
  return listImageModelRegistry('studio');
}

export async function saveAdminImageModelRegistryRecord(input: {
  id: string;
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
}): Promise<ImageModelRegistryRecord[]> {
  await verifyAdmin();
  const updatedBy = await getCurrentUserId();
  const records = await saveImageModelRegistryRecord(input.id, {
    ...input,
    updatedBy,
  });
  revalidatePath('/admin/image-models');
  return records;
}

export async function getAdminElevenLabsCostSettings(): Promise<ElevenLabsCostSettings> {
  await verifyAdmin();
  return getElevenLabsCostSettings();
}

export async function saveAdminElevenLabsCostSettings(
  settings: ElevenLabsCostSettings
): Promise<ElevenLabsCostSettings> {
  await verifyAdmin();
  const saved = await saveElevenLabsCostSettings(settings);
  revalidatePath('/admin/image-models');
  return saved;
}

export async function getAdminImageContinuitySettings(): Promise<ImageContinuitySettings> {
  await verifyAdmin();
  return getImageContinuitySettings();
}

export async function saveAdminImageContinuitySettings(
  settings: ImageContinuitySettings
): Promise<ImageContinuitySettings> {
  await verifyAdmin();
  const saved = await saveImageContinuitySettings(settings);
  revalidatePath('/admin/image-models');
  return saved;
}

export async function testAdminImageModel(input: {
  taskKey: ImageTaskKey;
  modelKey: string;
  prompt: string;
  aspectRatio?: string;
}): Promise<{
  dataUrl: string | null;
  metadata: Record<string, unknown>;
}> {
  await verifyAdmin();
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  const snapshot = await resolveImageModelSnapshot({
    taskKey: input.taskKey,
    selection: {
      taskKey: input.taskKey,
      modelKey: input.modelKey,
    },
    currentPlanKey: 'studio',
    allowAdminDisabled: true,
  });
  const result = await generateImageWithProvider({
    task: input.taskKey,
    prompt,
    aspectRatio: input.aspectRatio ?? (input.taskKey === 'reel_image_generation' ? '9:16' : '16:9'),
    modelSnapshot: snapshot,
  });

  return {
    dataUrl: result.dataUrl,
    metadata: {
      ...result.metadata,
      imageModelSnapshot: snapshot,
      fallbackText: result.fallbackText,
    },
  };
}
