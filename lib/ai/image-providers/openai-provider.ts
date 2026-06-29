import 'server-only';

import type { ImageProviderAdapter, ImageProviderRequest } from './types';
import { getImageModelMaxReferenceImages } from '@/lib/ai/image-models.shared';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';

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
}): Promise<{ dataUrl: string; usage?: Record<string, unknown> }> {
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
    usage?: Record<string, unknown>;
  };
  return extractOpenAiImageDataUrl(json, input.providerName);
}

async function postOpenAiImageEdit(input: {
  apiKey: string | undefined;
  baseUrl: string;
  formData: FormData;
  providerName: string;
}): Promise<{ dataUrl: string; usage?: Record<string, unknown> }> {
  if (!input.apiKey) {
    throw new Error(`Missing API key for ${input.providerName} image generation.`);
  }

  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: input.formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`${input.providerName} image edit failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const json = await response.json() as {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
    usage?: Record<string, unknown>;
  };
  return extractOpenAiImageDataUrl(json, input.providerName);
}

async function extractOpenAiImageDataUrl(
  json: {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
    usage?: Record<string, unknown>;
  },
  providerName: string
): Promise<{ dataUrl: string; usage?: Record<string, unknown> }> {
  const first = json.data?.[0];
  if (first?.b64_json) {
    return {
      dataUrl: `data:image/png;base64,${first.b64_json}`,
      usage: json.usage,
    };
  }
  if (first?.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) {
      throw new Error(`${providerName} returned an image URL that could not be fetched.`);
    }
    const contentType = imageResponse.headers.get('content-type') || 'image/png';
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return {
      dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      usage: json.usage,
    };
  }

  throw new Error(`${providerName} did not return image data.`);
}

function inlinePartToBlob(part: InlineImagePart): Blob {
  const bytes = Buffer.from(part.data, 'base64');
  return new Blob([bytes], { type: part.mimeType || 'image/png' });
}

function extensionForMimeType(mimeType: string | undefined): string {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

export const openAiImageProvider: ImageProviderAdapter = {
  async generateImage(request) {
    const referenceLimit = getImageModelMaxReferenceImages(request.modelSnapshot.capabilities);
    const referenceParts = (request.referenceParts ?? []).slice(0, referenceLimit);
    const size = resolveOpenAiSize(request);
    const isReferenceEdit = referenceParts.length > 0;
    const result = isReferenceEdit
      ? await (() => {
          const formData = new FormData();
          formData.set('model', request.modelSnapshot.providerModelId);
          formData.set('prompt', request.prompt);
          if (size) formData.set('size', size);
          referenceParts.forEach((part, index) => {
            formData.append(
              'image[]',
              inlinePartToBlob(part),
              `reference-${index + 1}.${extensionForMimeType(part.mimeType)}`
            );
          });
          return postOpenAiImageEdit({
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: 'https://api.openai.com/v1',
            providerName: 'OpenAI',
            formData,
          });
        })()
      : await postOpenAiCompatibleImage({
          apiKey: process.env.OPENAI_API_KEY,
          baseUrl: 'https://api.openai.com/v1',
          providerName: 'OpenAI',
          body: {
            model: request.modelSnapshot.providerModelId,
            prompt: request.prompt,
            n: 1,
            ...(size ? { size } : {}),
          },
        });

    return {
      dataUrl: result.dataUrl,
      fallbackText: null,
      providerUsage: result.usage,
      inputImageCount: referenceParts.length,
      metadata: {
        provider: 'openai',
        providerModelId: request.modelSnapshot.providerModelId,
        referenceMode: isReferenceEdit ? 'edit_endpoint' : 'text_to_image',
        referenceCount: referenceParts.length,
        providerUsage: result.usage,
      },
    };
  },
};
