'use server';

import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import { generateImageWithProvider } from '@/lib/ai/image-providers/router';
import {
  resolveImageModelSnapshot,
  resolveLinkedPortraitImageModelSnapshot,
} from '@/lib/ai/image-models';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import {
  estimateImageProviderCostUsd,
  isStoryboardImageTask,
  type ImageModelSelection,
  type ImageModelSnapshot,
  type ImageTaskKey,
} from '@/lib/ai/image-models.shared';
import type { PlanKey } from '@/lib/types/pricing';

export interface GenerateSelectedImageInput {
  task: ImageTaskKey;
  prompt: string;
  referenceParts?: InlineImagePart[];
  aspectRatio?: string;
  imageSize?: string;
  telemetry?: CostTelemetryContext;
  selection?: ImageModelSelection | null;
  currentPlanKey?: PlanKey;
}

export interface GenerateSelectedImageResult {
  dataUrl: string | null;
  fallbackText: string | null;
  modelSnapshot: ImageModelSnapshot;
  metadata: Record<string, unknown>;
}

function toTelemetryImageSize(value: string | undefined): '512' | '0.5K' | '1K' | '2K' | '4K' | null {
  return value === '512' || value === '0.5K' || value === '1K' || value === '2K' || value === '4K'
    ? value
    : null;
}

export async function generateSelectedImage(input: GenerateSelectedImageInput): Promise<GenerateSelectedImageResult> {
  const pricing = await getPricingRuntimeContext().catch(() => null);
  const currentPlanKey = input.currentPlanKey ?? pricing?.snapshot.planKey ?? 'free';
  const shouldLinkPortraitToStoryboard =
    input.task === 'portrait_generation'
    && input.selection?.taskKey
    && isStoryboardImageTask(input.selection.taskKey);
  const modelSnapshot = shouldLinkPortraitToStoryboard
    ? await resolveLinkedPortraitImageModelSnapshot({
        selection: input.selection ?? null,
        currentPlanKey,
      })
    : await resolveImageModelSnapshot({
        taskKey: input.task,
        selection: input.selection ?? null,
        currentPlanKey,
      });

  const startedAt = Date.now();
  const result = await generateImageWithProvider({
    task: input.task,
    prompt: input.prompt,
    referenceParts: input.referenceParts,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    telemetry: input.telemetry,
    modelSnapshot,
  });

  if (input.telemetry && result.dataUrl && modelSnapshot.providerKey !== 'gemini') {
    const inputImageCount = result.inputImageCount ?? input.referenceParts?.length ?? 0;
    await recordModelCostEvent({
      context: input.telemetry,
      taskKey: input.task,
      provider: modelSnapshot.providerKey,
      modelId: modelSnapshot.providerModelId,
      imageCount: 1,
      inputImageCount,
      imageSize: toTelemetryImageSize(input.imageSize),
      latencyMs: Date.now() - startedAt,
      estimatedCostUsdOverride: estimateImageProviderCostUsd({
        snapshot: modelSnapshot,
        outputImageCount: 1,
        inputImageCount,
      }),
      providerUsage: result.providerUsage,
      metadata: {
        imageTask: input.task,
        imageModelSnapshot: modelSnapshot,
        referenceCount: input.referenceParts?.length ?? 0,
        billableReferenceCount: inputImageCount,
        aspectRatio: input.aspectRatio ?? null,
        providerMetadata: result.metadata,
      },
    });
  }

  return {
    ...result,
    modelSnapshot,
  };
}
