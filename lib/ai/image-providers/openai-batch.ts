import 'server-only';

import type {
  ImageBatchAdapter,
  ImageBatchItemResult,
  ImageBatchPollResult,
  ImageBatchProviderState,
  ImageBatchSubmission,
  ImageBatchSubmitResult,
} from './types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Missing OPENAI_API_KEY for OpenAI image batch.');
  return key;
}

function resolveOpenAiSize(aspectRatio?: string): string {
  if (aspectRatio === '9:16') return '1024x1536';
  if (aspectRatio === '16:9') return '1536x1024';
  return '1024x1024';
}

function mapBatchStatus(status: unknown): ImageBatchProviderState {
  switch (status) {
    case 'completed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'cancelled':
    case 'cancelling':
      return 'cancelled';
    case 'in_progress':
    case 'finalizing':
      return 'running';
    default:
      return 'pending';
  }
}

export const openAiBatchAdapter: ImageBatchAdapter = {
  async submitBatch(submission: ImageBatchSubmission): Promise<ImageBatchSubmitResult> {
    if (submission.items.length === 0) {
      throw new Error('Cannot submit an empty OpenAI image batch.');
    }
    const apiKey = requireApiKey();

    // OpenAI batch input is a JSONL file. custom_id is the ordinal index so the
    // reconcile worker can join results back to stored items by request_key.
    // Note: /v1/images/generations does not accept reference images, so batched
    // OpenAI beats rely on prompt detail rather than portrait-reference continuity.
    const jsonl = submission.items
      .map((item, index) =>
        JSON.stringify({
          custom_id: String(index),
          method: 'POST',
          url: '/v1/images/generations',
          body: {
            model: submission.modelSnapshot.providerModelId,
            prompt: item.prompt,
            size: resolveOpenAiSize(item.aspectRatio),
            n: 1,
          },
        })
      )
      .join('\n');

    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'image-batch.jsonl');

    const fileResponse = await fetch(`${OPENAI_BASE_URL}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!fileResponse.ok) {
      const text = await fileResponse.text().catch(() => '');
      throw new Error(`OpenAI batch file upload failed (${fileResponse.status}): ${text.slice(0, 300)}`);
    }
    const fileJson = (await fileResponse.json()) as { id?: string };
    if (!fileJson.id) throw new Error('OpenAI batch file upload did not return a file id.');

    const batchResponse = await fetch(`${OPENAI_BASE_URL}/batches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_file_id: fileJson.id,
        endpoint: '/v1/images/generations',
        completion_window: '24h',
        ...(submission.displayName ? { metadata: { display_name: submission.displayName } } : {}),
      }),
    });
    if (!batchResponse.ok) {
      const text = await batchResponse.text().catch(() => '');
      throw new Error(`OpenAI batch creation failed (${batchResponse.status}): ${text.slice(0, 300)}`);
    }
    const batchJson = (await batchResponse.json()) as { id?: string };
    if (!batchJson.id) throw new Error('OpenAI batch creation did not return a batch id.');

    return { providerBatchName: batchJson.id };
  },

  async pollBatch(providerBatchName: string): Promise<ImageBatchPollResult> {
    const apiKey = requireApiKey();
    const response = await fetch(`${OPENAI_BASE_URL}/batches/${providerBatchName}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI batch poll failed (${response.status}): ${text.slice(0, 300)}`);
    }
    const batch = (await response.json()) as {
      status?: string;
      output_file_id?: string;
      error_file_id?: string;
      errors?: unknown;
    };

    const state = mapBatchStatus(batch.status);
    if (state !== 'succeeded' || !batch.output_file_id) {
      return {
        state,
        items: [],
        error: state === 'failed' || state === 'expired' ? JSON.stringify(batch.errors ?? null) : null,
      };
    }

    const contentResponse = await fetch(`${OPENAI_BASE_URL}/files/${batch.output_file_id}/content`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!contentResponse.ok) {
      const text = await contentResponse.text().catch(() => '');
      throw new Error(`OpenAI batch output download failed (${contentResponse.status}): ${text.slice(0, 300)}`);
    }
    const jsonl = await contentResponse.text();
    const items: ImageBatchItemResult[] = jsonl
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as {
          custom_id?: string;
          response?: { status_code?: number; body?: { data?: Array<{ b64_json?: string; url?: string }>; usage?: Record<string, unknown> } };
          error?: unknown;
        };
        const requestKey = parsed.custom_id ?? '';
        if (parsed.error) {
          return { requestKey, dataUrl: null, error: JSON.stringify(parsed.error) };
        }
        const first = parsed.response?.body?.data?.[0];
        if (first?.b64_json) {
          return {
            requestKey,
            dataUrl: `data:image/png;base64,${first.b64_json}`,
            error: null,
            providerUsage: parsed.response?.body?.usage,
          };
        }
        return { requestKey, dataUrl: null, error: 'OpenAI batch line contained no image data.' };
      });

    return { state, items };
  },
};
