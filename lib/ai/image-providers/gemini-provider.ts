import 'server-only';

import { callGeminiImage } from '@/app/actions/gemini-proxy';
import type { ImageProviderAdapter } from './types';

export const geminiImageProvider: ImageProviderAdapter = {
  async generateImage(request) {
    const result = await callGeminiImage({
      task: request.task,
      model: request.modelSnapshot.providerModelId,
      prompt: request.prompt,
      referenceParts: request.referenceParts,
      aspectRatio: request.aspectRatio,
      imageSize: request.imageSize,
      telemetry: request.telemetry,
    });

    return {
      dataUrl: result.dataUrl,
      fallbackText: result.fallbackText,
      metadata: {
        provider: 'gemini',
        providerModelId: request.modelSnapshot.providerModelId,
      },
    };
  },
};
