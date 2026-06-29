import 'server-only';

import type { ImageProviderAdapter, ImageProviderRequest } from './types';
import { getImageModelMaxReferenceImages } from '@/lib/ai/image-models.shared';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';

function resolveXaiAspectRatio(request: ImageProviderRequest): string | undefined {
  if (request.aspectRatio === '9:16' || request.aspectRatio === '16:9' || request.aspectRatio === '1:1') {
    return request.aspectRatio;
  }
  return undefined;
}

function inlinePartToDataUrl(part: InlineImagePart): string {
  return `data:${part.mimeType};base64,${part.data}`;
}

export const xaiImageProvider: ImageProviderAdapter = {
  async generateImage(request) {
    const { postOpenAiCompatibleImageForXai } = await import('./xai-shared');
    const referenceLimit = getImageModelMaxReferenceImages(request.modelSnapshot.capabilities);
    const referenceImages = (request.referenceParts ?? [])
      .slice(0, referenceLimit)
      .map((part) => ({
        type: 'image_url',
        url: inlinePartToDataUrl(part),
      }));
    const aspectRatio = resolveXaiAspectRatio(request);
    const isReferenceEdit = referenceImages.length > 0;
    const body: Record<string, unknown> = {
      model: request.modelSnapshot.providerModelId,
      prompt: request.prompt,
      n: 1,
      response_format: 'b64_json',
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    };

    if (isReferenceEdit) {
      if (referenceImages.length === 1) {
        body.image = referenceImages[0];
      } else {
        body.images = referenceImages;
      }
    }

    const result = await postOpenAiCompatibleImageForXai({
      apiKey: process.env.XAI_API_KEY,
      path: isReferenceEdit ? '/images/edits' : '/images/generations',
      body,
    });

    return {
      dataUrl: result.dataUrl,
      fallbackText: null,
      providerUsage: result.usage,
      inputImageCount: referenceImages.length,
      metadata: {
        provider: 'xai',
        providerModelId: request.modelSnapshot.providerModelId,
        referenceMode: isReferenceEdit ? 'edit_endpoint' : 'text_to_image',
        referenceCount: referenceImages.length,
        providerUsage: result.usage,
      },
    };
  },
};
