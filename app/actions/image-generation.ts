'use server';

import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import { getImageContinuitySettings } from '@/lib/ai/image-continuity-settings';
import { generateImageWithProvider } from '@/lib/ai/image-providers/router';
import {
  resolveImageModelSnapshot,
  resolveLinkedPortraitImageModelSnapshot,
} from '@/lib/ai/image-models';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import {
  extractStatefulUsageTokenCounts,
  estimateStatefulRuntimeCostUsd,
  getStatefulRuntimePricing,
} from '@/lib/ai/image-continuity-settings.shared';
import {
  resolveImageContinuityStrategy,
  type ImageContinuityProviderState,
  type ImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
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
  continuity?: {
    requestedStrategy: ImageContinuityStrategy;
    previousState?: ImageContinuityProviderState | null;
    allowRuntimeFallback?: boolean;
  } | null;
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
  const continuitySettings = input.continuity
    ? await getImageContinuitySettings().catch(() => null)
    : null;
  const runtimePricing = continuitySettings
    ? getStatefulRuntimePricing(continuitySettings, modelSnapshot.providerKey)
    : null;
  const continuityResolution = input.continuity
    ? resolveImageContinuityStrategy({
        requestedStrategy: input.continuity.requestedStrategy,
        providerKey: modelSnapshot.providerKey,
        providerStatefulEnabled: runtimePricing?.enabled ?? false,
      })
    : null;

  const startedAt = Date.now();
  const result = await generateImageWithProvider({
    task: input.task,
    prompt: input.prompt,
    referenceParts: input.referenceParts,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    telemetry: input.telemetry,
    modelSnapshot,
    continuity: continuityResolution
      ? {
          requestedStrategy: continuityResolution.requestedStrategy,
          strategy: continuityResolution.strategy,
          stateKind: continuityResolution.stateKind,
          previousState: input.continuity?.previousState ?? null,
          runtimeModelId: runtimePricing?.runtimeModelId ?? null,
          allowRuntimeFallback: input.continuity?.allowRuntimeFallback !== false,
        }
      : null,
  });

  const metadata: Record<string, unknown> = {
    ...result.metadata,
    ...(continuityResolution?.fallbackReason ? { fallbackReason: continuityResolution.fallbackReason } : {}),
    ...(result.continuityState ? { statefulContinuity: result.continuityState } : {}),
  };
  const shouldRecordProviderCost = Boolean(
    input.telemetry
    && result.dataUrl
    && (
      modelSnapshot.providerKey !== 'gemini'
      || metadata.providerTelemetryMode === 'gemini_interactions'
    )
  );

  if (shouldRecordProviderCost && input.telemetry) {
    const inputImageCount = result.inputImageCount ?? input.referenceParts?.length ?? 0;
    const hasReportedCost = typeof result.providerReportedCostUsd === 'number'
      && Number.isFinite(result.providerReportedCostUsd);
    const imageProviderCostUsd = hasReportedCost
      ? Number(result.providerReportedCostUsd!.toFixed(6))
      : estimateImageProviderCostUsd({
          snapshot: modelSnapshot,
          outputImageCount: 1,
          inputImageCount,
        });
    const statefulEstimate = metadata.resolvedContinuityStrategy === 'provider_stateful' && runtimePricing && result.providerUsage
      ? estimateStatefulRuntimeCostUsd({
          pricing: runtimePricing,
          usage: result.providerUsage,
        })
      : null;
    const usageCounts = statefulEstimate ?? extractStatefulUsageTokenCounts(result.providerUsage);
    const estimatedCostUsd = Number((imageProviderCostUsd + (statefulEstimate?.runtimeCostUsd ?? 0)).toFixed(6));
    await recordModelCostEvent({
      context: input.telemetry,
      taskKey: input.task,
      provider: modelSnapshot.providerKey,
      modelId: modelSnapshot.providerModelId,
      imageCount: 1,
      inputImageCount,
      inputTokens: usageCounts.inputTokens,
      outputTokens: usageCounts.outputTokens,
      imageSize: toTelemetryImageSize(input.imageSize),
      latencyMs: Date.now() - startedAt,
      estimatedCostUsdOverride: estimatedCostUsd,
      providerUsage: result.providerUsage,
      metadata: {
        imageTask: input.task,
        imageModelSnapshot: modelSnapshot,
        referenceCount: input.referenceParts?.length ?? 0,
        billableReferenceCount: inputImageCount,
        aspectRatio: input.aspectRatio ?? null,
        continuityStrategy: metadata.continuityStrategy ?? continuityResolution?.requestedStrategy ?? null,
        statefulProvider: metadata.statefulProvider ?? null,
        runtimeModelId: metadata.runtimeModelId ?? null,
        stateInputId: metadata.stateInputId ?? null,
        stateOutputId: metadata.stateOutputId ?? null,
        cachedTokens: usageCounts.cachedTokens,
        inputTokensByModality: usageCounts.inputTokensByModality ?? null,
        outputTokensByModality: usageCounts.outputTokensByModality ?? null,
        cachedTokensByModality: usageCounts.cachedTokensByModality ?? null,
        imageCallId: metadata.imageCallId ?? null,
        fallbackStrategy: metadata.fallbackStrategy ?? null,
        fallbackReason: metadata.fallbackReason ?? result.fallbackReason ?? null,
        statefulRuntimeCostUsd: statefulEstimate?.runtimeCostUsd ?? 0,
        imageProviderCostUsd,
        costSource: hasReportedCost ? 'provider_reported' : 'estimated',
        providerMetadata: metadata,
      },
    });
  }

  return {
    ...result,
    metadata,
    modelSnapshot,
  };
}
