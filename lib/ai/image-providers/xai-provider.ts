import 'server-only';

import type { ImageProviderAdapter, ImageProviderRequest } from './types';

function resolveXaiAspectRatio(request: ImageProviderRequest): string | undefined {
  if (request.aspectRatio === '9:16' || request.aspectRatio === '16:9' || request.aspectRatio === '1:1') {
    return request.aspectRatio;
  }
  return undefined;
}

export const xaiImageProvider: ImageProviderAdapter = {
  async generateImage(request) {
    const { postOpenAiCompatibleImageForXai } = await import('./xai-shared');
    const dataUrl = await postOpenAiCompatibleImageForXai({
      apiKey: process.env.XAI_API_KEY,
      body: {
        model: request.modelSnapshot.providerModelId,
        prompt: request.prompt,
        n: 1,
        response_format: 'b64_json',
        ...(resolveXaiAspectRatio(request) ? { aspect_ratio: resolveXaiAspectRatio(request) } : {}),
      },
    });

    return {
      dataUrl,
      fallbackText: null,
      metadata: {
        provider: 'xai',
        providerModelId: request.modelSnapshot.providerModelId,
      },
    };
  },
};
