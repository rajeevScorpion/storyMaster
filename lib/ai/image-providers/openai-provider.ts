import 'server-only';

import type { ImageProviderAdapter, ImageProviderRequest } from './types';

function resolveOpenAiSize(request: ImageProviderRequest): string | undefined {
  if (request.aspectRatio === '9:16') return '1024x1536';
  if (request.aspectRatio === '16:9') return '1536x1024';
  if (request.aspectRatio === '1:1') return '1024x1024';
  return undefined;
}

async function postOpenAiCompatibleImage(input: {
  apiKey: string | undefined;
  baseUrl: string;
  body: Record<string, unknown>;
  providerName: string;
}): Promise<string> {
  if (!input.apiKey) {
    throw new Error(`Missing API key for ${input.providerName} image generation.`);
  }

  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`${input.providerName} image generation failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const json = await response.json() as {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
  };
  const first = json.data?.[0];
  if (first?.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }
  if (first?.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) {
      throw new Error(`${input.providerName} returned an image URL that could not be fetched.`);
    }
    const contentType = imageResponse.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  throw new Error(`${input.providerName} did not return image data.`);
}

export const openAiImageProvider: ImageProviderAdapter = {
  async generateImage(request) {
    const dataUrl = await postOpenAiCompatibleImage({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      providerName: 'OpenAI',
      body: {
        model: request.modelSnapshot.providerModelId,
        prompt: request.prompt,
        n: 1,
        ...(resolveOpenAiSize(request) ? { size: resolveOpenAiSize(request) } : {}),
      },
    });

    return {
      dataUrl,
      fallbackText: null,
      metadata: {
        provider: 'openai',
        providerModelId: request.modelSnapshot.providerModelId,
      },
    };
  },
};
