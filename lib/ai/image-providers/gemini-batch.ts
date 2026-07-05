import 'server-only';

import { GoogleGenAI } from '@google/genai';
import { LOCKED_PROMPT_GUARDRAILS } from '@/lib/ai/prompt-config.shared';
import type {
  ImageBatchAdapter,
  ImageBatchItemResult,
  ImageBatchPollResult,
  ImageBatchProviderState,
  ImageBatchSubmission,
  ImageBatchSubmitResult,
} from './types';

function getAI(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return new GoogleGenAI({ apiKey: key });
}

function systemInstructionForTask(task: ImageBatchSubmission['task']): string | undefined {
  if (task === 'image_generation' || task === 'reel_image_generation') {
    return LOCKED_PROMPT_GUARDRAILS[task];
  }
  if (task === 'portrait_generation') {
    return LOCKED_PROMPT_GUARDRAILS.portrait_generation;
  }
  return undefined;
}

function buildInlinedRequest(submission: ImageBatchSubmission, item: ImageBatchSubmission['items'][number]) {
  const parts: Array<Record<string, unknown>> = [{ text: item.prompt }];
  for (const ref of item.referenceParts ?? []) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }
  const systemInstruction = systemInstructionForTask(submission.task);
  return {
    contents: [{ role: 'user', parts }],
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      imageConfig: {
        aspectRatio: item.aspectRatio ?? '16:9',
        imageSize: item.imageSize ?? '1K',
      },
    },
  };
}

function mapJobState(state: unknown): ImageBatchProviderState {
  const value = typeof state === 'string' ? state : String((state as { name?: string })?.name ?? state ?? '');
  switch (value) {
    case 'JOB_STATE_SUCCEEDED':
      return 'succeeded';
    case 'JOB_STATE_FAILED':
      return 'failed';
    case 'JOB_STATE_CANCELLED':
      return 'cancelled';
    case 'JOB_STATE_EXPIRED':
      return 'expired';
    case 'JOB_STATE_RUNNING':
      return 'running';
    default:
      return 'pending';
  }
}

function extractDataUrl(response: unknown): string | null {
  const parts = (response as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  })?.candidates?.[0]?.content?.parts;
  for (const part of parts ?? []) {
    if (part.inlineData?.data) {
      return `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

export const geminiBatchAdapter: ImageBatchAdapter = {
  async submitBatch(submission: ImageBatchSubmission): Promise<ImageBatchSubmitResult> {
    if (submission.items.length === 0) {
      throw new Error('Cannot submit an empty Gemini image batch.');
    }
    const ai = getAI();
    const src = submission.items.map((item) => buildInlinedRequest(submission, item));

    const job = await (ai.batches.create as unknown as (
      body: Record<string, unknown>
    ) => Promise<Record<string, unknown>>)({
      model: submission.modelSnapshot.providerModelId,
      src,
      config: submission.displayName ? { displayName: submission.displayName } : {},
    });

    const providerBatchName = typeof job.name === 'string' ? job.name : null;
    if (!providerBatchName) {
      throw new Error('Gemini batch submission did not return a job name.');
    }
    return { providerBatchName };
  },

  async pollBatch(providerBatchName: string): Promise<ImageBatchPollResult> {
    const ai = getAI();
    const job = await (ai.batches.get as unknown as (
      body: Record<string, unknown>
    ) => Promise<Record<string, unknown>>)({ name: providerBatchName });

    const state = mapJobState(job.state);
    if (state !== 'succeeded') {
      return {
        state,
        items: [],
        error: state === 'failed' || state === 'expired'
          ? (typeof job.error === 'string' ? job.error : JSON.stringify(job.error ?? null))
          : null,
      };
    }

    // Inlined responses come back in submission order; request_key is the ordinal index.
    const dest = job.dest as { inlinedResponses?: Array<{ response?: unknown; error?: unknown }> } | undefined;
    const inlined = dest?.inlinedResponses ?? [];
    const items: ImageBatchItemResult[] = inlined.map((entry, index) => {
      if (entry.error) {
        return {
          requestKey: String(index),
          dataUrl: null,
          error: typeof entry.error === 'string' ? entry.error : JSON.stringify(entry.error),
        };
      }
      const dataUrl = extractDataUrl(entry.response);
      return {
        requestKey: String(index),
        dataUrl,
        error: dataUrl ? null : 'Gemini batch response contained no image.',
        providerUsage: (entry.response as { usageMetadata?: Record<string, unknown> })?.usageMetadata,
      };
    });

    return { state, items };
  },
};
