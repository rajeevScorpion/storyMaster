import 'server-only';

import { geminiImageProvider } from './gemini-provider';
import { openAiImageProvider } from './openai-provider';
import { runwareImageProvider } from './runware-provider';
import { xaiImageProvider } from './xai-provider';
import type {
  ImageBatchAdapter,
  ImageBatchPollResult,
  ImageBatchSubmission,
  ImageBatchSubmitResult,
  ImageProviderAdapter,
  ImageProviderRequest,
  ImageProviderResult,
} from './types';
import type { ImageProviderKey } from '@/lib/ai/image-models.shared';

const PROVIDERS: Record<ImageProviderKey, ImageProviderAdapter> = {
  gemini: geminiImageProvider,
  openai: openAiImageProvider,
  xai: xaiImageProvider,
  runware: runwareImageProvider,
};

export async function generateImageWithProvider(request: ImageProviderRequest): Promise<ImageProviderResult> {
  const provider = PROVIDERS[request.modelSnapshot.providerKey];
  if (!provider) {
    throw new Error(`Unsupported image provider: ${request.modelSnapshot.providerKey}`);
  }

  return provider.generateImage(request);
}

function resolveBatchAdapter(providerKey: ImageProviderKey): ImageBatchAdapter {
  const provider = PROVIDERS[providerKey];
  if (!provider?.batch) {
    throw new Error(`Image provider does not support batch generation: ${providerKey}`);
  }
  return provider.batch;
}

export function providerSupportsBatch(providerKey: ImageProviderKey): boolean {
  return Boolean(PROVIDERS[providerKey]?.batch);
}

export async function submitImageBatchWithProvider(
  providerKey: ImageProviderKey,
  submission: ImageBatchSubmission
): Promise<ImageBatchSubmitResult> {
  return resolveBatchAdapter(providerKey).submitBatch(submission);
}

export async function pollImageBatchWithProvider(
  providerKey: ImageProviderKey,
  providerBatchName: string
): Promise<ImageBatchPollResult> {
  return resolveBatchAdapter(providerKey).pollBatch(providerBatchName);
}
