import 'server-only';

import { geminiImageProvider } from './gemini-provider';
import { openAiImageProvider } from './openai-provider';
import { xaiImageProvider } from './xai-provider';
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResult } from './types';
import type { ImageProviderKey } from '@/lib/ai/image-models.shared';

const PROVIDERS: Record<ImageProviderKey, ImageProviderAdapter> = {
  gemini: geminiImageProvider,
  openai: openAiImageProvider,
  xai: xaiImageProvider,
};

export async function generateImageWithProvider(request: ImageProviderRequest): Promise<ImageProviderResult> {
  const provider = PROVIDERS[request.modelSnapshot.providerKey];
  if (!provider) {
    throw new Error(`Unsupported image provider: ${request.modelSnapshot.providerKey}`);
  }

  return provider.generateImage(request);
}
