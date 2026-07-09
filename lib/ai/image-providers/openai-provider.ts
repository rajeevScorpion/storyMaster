import 'server-only';

import type { ImageProviderAdapter, ImageProviderRequest } from './types';
import { openAiBatchAdapter } from './openai-batch';
import { createImageContinuityState } from '@/lib/ai/image-continuity.shared';
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

function extractOpenAiResponseImageCall(json: Record<string, unknown>): {
  dataUrl: string;
  imageCallId: string | null;
  revisedPrompt: string | null;
} | null {
  const output = Array.isArray(json.output) ? json.output as Array<Record<string, unknown>> : [];
  const imageCall = output.find((item) => item.type === 'image_generation_call' && typeof item.result === 'string');
  if (!imageCall) return null;

  return {
    dataUrl: `data:image/png;base64,${imageCall.result as string}`,
    imageCallId: typeof imageCall.id === 'string' ? imageCall.id : null,
    revisedPrompt: typeof imageCall.revised_prompt === 'string' ? imageCall.revised_prompt : null,
  };
}

async function postOpenAiResponsesImage(input: {
  apiKey: string | undefined;
  request: ImageProviderRequest;
  size?: string;
}): Promise<{
  dataUrl: string;
  responseId: string | null;
  imageCallId: string | null;
  revisedPrompt: string | null;
  usage?: Record<string, unknown>;
}> {
  if (!input.apiKey) {
    throw new Error('Missing API key for OpenAI image generation.');
  }

  const runtimeModelId = input.request.continuity?.runtimeModelId || 'gpt-5.4-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: runtimeModelId,
      input: input.request.prompt,
      ...(input.request.continuity?.previousState?.stateOutputId
        ? { previous_response_id: input.request.continuity.previousState.stateOutputId }
        : {}),
      tools: [
        {
          type: 'image_generation',
          action: 'auto',
          ...(input.size ? { size: input.size } : {}),
        },
      ],
      tool_choice: { type: 'image_generation' },
      store: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI Responses image generation failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const imageCall = extractOpenAiResponseImageCall(json);
  if (!imageCall) {
    throw new Error('OpenAI Responses did not return an image generation call result.');
  }

  return {
    dataUrl: imageCall.dataUrl,
    responseId: typeof json.id === 'string' ? json.id : null,
    imageCallId: imageCall.imageCallId,
    revisedPrompt: imageCall.revisedPrompt,
    usage: json.usage && typeof json.usage === 'object'
      ? json.usage as Record<string, unknown>
      : undefined,
  };
}

export const openAiImageProvider: ImageProviderAdapter = {
  batch: openAiBatchAdapter,
  async generateImage(request) {
    const referenceLimit = getImageModelMaxReferenceImages(request.modelSnapshot.capabilities);
    const referenceParts = (request.referenceParts ?? []).slice(0, referenceLimit);
    const size = resolveOpenAiSize(request);
    if (request.continuity?.strategy === 'provider_stateful' && request.continuity.stateKind === 'openai_responses') {
      try {
        const stateful = await postOpenAiResponsesImage({
          apiKey: process.env.OPENAI_API_KEY,
          request,
          size,
        });
        const continuityState = createImageContinuityState({
          provider: 'openai',
          requestedStrategy: request.continuity.requestedStrategy,
          strategy: 'provider_stateful',
          stateKind: 'openai_responses',
          previousStateId: request.continuity.previousState?.stateOutputId ?? null,
          stateOutputId: stateful.responseId,
          imageCallId: stateful.imageCallId,
          runtimeModelId: request.continuity.runtimeModelId || 'gpt-5.4-mini',
          usage: stateful.usage ?? null,
        });

        return {
          dataUrl: stateful.dataUrl,
          fallbackText: null,
          providerUsage: stateful.usage,
          inputImageCount: 0,
          continuityState,
          resolvedContinuityStrategy: 'provider_stateful',
          metadata: {
            provider: 'openai',
            providerModelId: request.modelSnapshot.providerModelId,
            providerTelemetryMode: 'openai_responses',
            referenceMode: 'provider_stateful',
            referenceCount: 0,
            continuityStrategy: request.continuity.requestedStrategy,
            resolvedContinuityStrategy: 'provider_stateful',
            statefulProvider: 'openai',
            stateKind: 'openai_responses',
            stateInputId: request.continuity.previousState?.stateOutputId ?? null,
            stateOutputId: continuityState.stateOutputId,
            imageCallId: continuityState.imageCallId,
            runtimeModelId: continuityState.runtimeModelId,
            revisedPrompt: stateful.revisedPrompt,
            providerUsage: stateful.usage,
          },
        };
      } catch (error) {
        if (!request.continuity.allowRuntimeFallback) throw error;
      }
    }

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
      resolvedContinuityStrategy: request.continuity?.strategy === 'provider_stateful'
        ? 'resend_refs'
        : request.continuity?.strategy,
      fallbackReason: request.continuity?.strategy === 'provider_stateful'
        ? 'openai_responses_fallback'
        : null,
      metadata: {
        provider: 'openai',
        providerModelId: request.modelSnapshot.providerModelId,
        referenceMode: isReferenceEdit ? 'edit_endpoint' : 'text_to_image',
        referenceCount: referenceParts.length,
        continuityStrategy: request.continuity?.requestedStrategy ?? null,
        resolvedContinuityStrategy: request.continuity?.strategy === 'provider_stateful'
          ? 'resend_refs'
          : request.continuity?.strategy ?? null,
        fallbackStrategy: request.continuity?.strategy === 'provider_stateful' ? 'resend_refs' : null,
        fallbackReason: request.continuity?.strategy === 'provider_stateful'
          ? 'openai_responses_fallback'
          : null,
        providerUsage: result.usage,
      },
    };
  },
};
