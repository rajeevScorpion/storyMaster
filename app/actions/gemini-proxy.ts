'use server';

import { GoogleGenAI } from '@google/genai';
import { beatSchema, seedPlanSchema, storyboardPlanSchema } from '@/lib/ai/generation-schemas';
import { LOCKED_PROMPT_GUARDRAILS } from '@/lib/ai/prompt-config.shared';
import type { TaskKey } from '@/lib/ai/model-config.shared';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { GeminiImageSize } from '@/lib/ai/pricing';

const GEMINI_TEXT_TIMEOUT_MS = 30_000;
const GEMINI_IMAGE_TIMEOUT_MS = 90_000;
const GEMINI_TTS_TIMEOUT_MS = 120_000;

function geminiNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function timeGeminiStep<T>(
  scope: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = geminiNowMs();
  try {
    const result = await fn();
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(geminiNowMs() - startedAt),
      success: true,
      ...meta,
    });
    return result;
  } catch (error) {
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(geminiNowMs() - startedAt),
      success: false,
      ...meta,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout after ${ms / 1000}s (${label})`)), ms)
    ),
  ]);
}

function getAI(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return new GoogleGenAI({ apiKey: key });
}

export interface TextCallParams {
  task: Extract<TaskKey, 'story_generation' | 'seed_plan_generation' | 'seeded_beat_materialization' | 'visual_prompt'>;
  model: string;
  prompt: string;
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

export async function callGeminiText(params: TextCallParams): Promise<string> {
  const { task, model, prompt, temperature, telemetry } = params;
  const ai = getAI();

  const schemaMap = {
    story_generation: beatSchema,
    seed_plan_generation: seedPlanSchema,
    seeded_beat_materialization: beatSchema,
    visual_prompt: storyboardPlanSchema,
  } as const;

  const flagVal = await getFeatureFlagValue('gemini_text_timeout_ms');
  const timeoutMs = (flagVal ? parseInt(flagVal, 10) : 0) || GEMINI_TEXT_TIMEOUT_MS;

  const startedAt = geminiNowMs();
  const response = await timeGeminiStep(
    `gemini_proxy.${task}`,
    {
      model,
      timeoutMs,
      promptChars: prompt.length,
    },
    () => withTimeout(
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: LOCKED_PROMPT_GUARDRAILS[task],
          responseMimeType: 'application/json',
          responseSchema: schemaMap[task],
          temperature: temperature ?? 0.7,
        },
      }),
      timeoutMs,
      task
    )
  );

  if (telemetry) {
    await recordModelCostEvent({
      context: telemetry,
      taskKey: task,
      modelId: model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: geminiNowMs() - startedAt,
      metadata: {
        promptChars: prompt.length,
        temperature: temperature ?? 0.7,
      },
    });
  }

  const text = response.text;
  if (!text) throw new Error(`Empty response from Gemini for task: ${task}`);
  return text;
}

export interface InlineImagePart {
  mimeType: string;
  data: string; // raw base64, no data: prefix
}

export interface ImageCallParams {
  task: Extract<TaskKey, 'image_generation' | 'portrait_generation'>;
  model: string;
  prompt: string;
  referenceParts?: InlineImagePart[];
  aspectRatio?: string;
  imageSize?: string;
  telemetry?: CostTelemetryContext;
}

export interface ImageCallResult {
  dataUrl: string | null;
  fallbackText: string | null;
}

export async function callGeminiImage(params: ImageCallParams): Promise<ImageCallResult> {
  const { task, model, prompt, referenceParts, aspectRatio, imageSize, telemetry } = params;
  const ai = getAI();

  const hasRefs = referenceParts && referenceParts.length > 0;
  let contents: any = prompt;

  if (hasRefs) {
    const parts: any[] = [{ text: prompt }];
    for (const ref of referenceParts) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
    }
    contents = [{ role: 'user', parts }];
  }

  const systemInstruction = task === 'image_generation'
    ? LOCKED_PROMPT_GUARDRAILS.image_generation
    : task === 'portrait_generation'
    ? LOCKED_PROMPT_GUARDRAILS.portrait_generation
    : undefined;

  const imgFlagVal = await getFeatureFlagValue('gemini_image_timeout_ms');
  const imgTimeoutMs = (imgFlagVal ? parseInt(imgFlagVal, 10) : 0) || GEMINI_IMAGE_TIMEOUT_MS;

  const resolvedImageSize = (imageSize ?? '1K') as GeminiImageSize;
  const startedAt = geminiNowMs();
  const response = await timeGeminiStep(
    `gemini_proxy.${task}`,
    {
      model,
      timeoutMs: imgTimeoutMs,
      hasReferences: Boolean(hasRefs),
      referenceCount: referenceParts?.length ?? 0,
      aspectRatio: aspectRatio ?? '16:9',
      imageSize: resolvedImageSize,
      promptChars: prompt.length,
    },
    () => withTimeout(
      ai.models.generateContent({
        model,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          imageConfig: {
            aspectRatio: aspectRatio ?? '16:9',
            imageSize: resolvedImageSize,
          },
        },
      }),
      imgTimeoutMs,
      task
    )
  );

  let generatedImageCount = 0;
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData) {
      generatedImageCount = 1;
      if (telemetry) {
        await recordModelCostEvent({
          context: telemetry,
          taskKey: task,
          modelId: model,
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          imageCount: generatedImageCount,
          imageSize: resolvedImageSize,
          latencyMs: geminiNowMs() - startedAt,
          metadata: {
            promptChars: prompt.length,
            aspectRatio: aspectRatio ?? '16:9',
            hasReferences: Boolean(hasRefs),
            referenceCount: referenceParts?.length ?? 0,
          },
        });
      }
      return {
        dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        fallbackText: null,
      };
    }
  }

  if (telemetry) {
    await recordModelCostEvent({
      context: telemetry,
      taskKey: task,
      modelId: model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      imageCount: generatedImageCount,
      imageSize: resolvedImageSize,
      latencyMs: geminiNowMs() - startedAt,
      metadata: {
        promptChars: prompt.length,
        aspectRatio: aspectRatio ?? '16:9',
        hasReferences: Boolean(hasRefs),
        referenceCount: referenceParts?.length ?? 0,
        returnedFallbackText: Boolean((response.text ?? '').trim()),
      },
    });
  }

  return {
    dataUrl: null,
    fallbackText: (response.text ?? '').trim() || null,
  };
}
