'use server';

import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { generateImageWithProvider } from '@/lib/ai/image-providers/router';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { ImageModelSelection, ImageModelSnapshot, ImageTaskKey } from '@/lib/ai/image-models.shared';
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

export async function generateSelectedImage(input: GenerateSelectedImageInput): Promise<GenerateSelectedImageResult> {
  const pricing = await getPricingRuntimeContext().catch(() => null);
  const modelSnapshot = await resolveImageModelSnapshot({
    taskKey: input.task,
    selection: input.selection ?? null,
    currentPlanKey: input.currentPlanKey ?? pricing?.snapshot.planKey ?? 'free',
  });

  const result = await generateImageWithProvider({
    task: input.task,
    prompt: input.prompt,
    referenceParts: input.referenceParts,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    telemetry: input.telemetry,
    modelSnapshot,
  });

  return {
    ...result,
    modelSnapshot,
  };
}
