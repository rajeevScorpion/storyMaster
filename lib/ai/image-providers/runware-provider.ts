import 'server-only';

import type { ImageProviderAdapter, ImageProviderRequest } from './types';
import {
  RUNWARE_API_URL,
  parseRunwareImageResponse,
  resolveRunwareDimensions,
} from './runware-shared';
import { getImageModelMaxReferenceImages } from '@/lib/ai/image-models.shared';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';

const DEFAULT_TIMEOUT_MS = 90_000;

function inlinePartToDataUrl(part: InlineImagePart): string {
  return `data:${part.mimeType};base64,${part.data}`;
}

async function resolveTimeoutMs(): Promise<number> {
  const configured = await getFeatureFlagValue('runware_image_timeout_ms').catch(() => null);
  const numeric = Number(configured);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_TIMEOUT_MS;
}

export const runwareImageProvider: ImageProviderAdapter = {
  async generateImage(request: ImageProviderRequest) {
    const apiKey = process.env.RUNWARE_API_KEY;
    if (!apiKey) {
      throw new Error('Missing API key for Runware image generation.');
    }

    const referenceLimit = getImageModelMaxReferenceImages(request.modelSnapshot.capabilities);
    const referenceImages = (request.referenceParts ?? [])
      .slice(0, referenceLimit)
      .map(inlinePartToDataUrl);
    const { width, height } = resolveRunwareDimensions({
      task: request.task,
      aspectRatio: request.aspectRatio,
      imageSize: request.imageSize,
      capabilities: request.modelSnapshot.capabilities,
    });

    const taskUUID = crypto.randomUUID();
    const task: Record<string, unknown> = {
      taskType: 'imageInference',
      taskUUID,
      model: request.modelSnapshot.providerModelId,
      positivePrompt: request.prompt,
      width,
      height,
      numberResults: 1,
      outputType: 'dataURI',
      outputFormat: 'PNG',
      includeCost: true,
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
    };

    const response = await fetch(RUNWARE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(await resolveTimeoutMs()),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Runware image generation failed (${response.status}): ${errorText.slice(0, 300)}`);
    }

    const result = parseRunwareImageResponse(await response.json(), taskUUID);
    const requestedStrategy = request.continuity?.requestedStrategy ?? null;

    return {
      dataUrl: result.dataUrl,
      fallbackText: null,
      inputImageCount: referenceImages.length,
      providerReportedCostUsd: result.cost ?? undefined,
      resolvedContinuityStrategy: 'resend_refs' as const,
      providerUsage: {
        ...(result.cost != null ? { cost: result.cost } : {}),
        ...(result.seed != null ? { seed: result.seed } : {}),
      },
      metadata: {
        provider: 'runware',
        providerModelId: request.modelSnapshot.providerModelId,
        referenceMode: referenceImages.length > 0 ? 'reference_images' : 'text_to_image',
        referenceCount: referenceImages.length,
        width,
        height,
        continuityStrategy: requestedStrategy,
        resolvedContinuityStrategy: 'resend_refs',
        fallbackStrategy: requestedStrategy === 'provider_stateful' ? 'resend_refs' : null,
        fallbackReason: requestedStrategy === 'provider_stateful'
          ? 'runware_stateful_not_supported'
          : null,
        runwareTaskUUID: taskUUID,
        imageUUID: result.imageUUID,
        seed: result.seed,
        nsfw: result.nsfw,
        providerReportedCostUsd: result.cost,
      },
    };
  },
};
