'use server';

import { GoogleGenAI } from '@google/genai';
import { beatSchema, reelDraftSchema, seedPlanSchema, storyboardPlanSchema } from '@/lib/ai/generation-schemas';
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
  task: Extract<TaskKey, 'story_generation' | 'reel_story_generation' | 'seed_plan_generation' | 'seeded_beat_materialization' | 'visual_prompt' | 'reel_visual_prompt'>;
  model: string;
  prompt: string;
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

export interface VisionTextCallParams {
  task: Extract<TaskKey, 'graphic_style_extraction'>;
  model: string;
  prompt: string;
  referenceParts: InlineImagePart[];
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

export async function callGeminiText(params: TextCallParams): Promise<string> {
  const { task, model, prompt, temperature, telemetry } = params;
  const ai = getAI();

  const schemaMap = {
    story_generation: beatSchema,
    reel_story_generation: reelDraftSchema,
    seed_plan_generation: seedPlanSchema,
    seeded_beat_materialization: beatSchema,
    visual_prompt: storyboardPlanSchema,
    reel_visual_prompt: storyboardPlanSchema,
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

export async function callGeminiVisionText(params: VisionTextCallParams): Promise<string> {
  const { task, model, prompt, referenceParts, temperature, telemetry } = params;
  const ai = getAI();

  const parts: any[] = [{ text: prompt }];
  for (const ref of referenceParts) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }
  const contents = [{ role: 'user', parts }];

  const flagVal = await getFeatureFlagValue('gemini_text_timeout_ms');
  const timeoutMs = (flagVal ? parseInt(flagVal, 10) : 0) || GEMINI_TEXT_TIMEOUT_MS;

  const startedAt = geminiNowMs();
  const response = await timeGeminiStep(
    `gemini_proxy.${task}`,
    { model, timeoutMs, referenceCount: referenceParts.length, promptChars: prompt.length },
    () => withTimeout(
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: LOCKED_PROMPT_GUARDRAILS[task],
          responseMimeType: 'text/plain',
          temperature: temperature ?? 0.4,
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
      metadata: { promptChars: prompt.length, referenceCount: referenceParts.length },
    });
  }

  const text = response.text;
  if (!text) throw new Error(`Empty response from Gemini for task: ${task}`);
  return text.trim();
}

export interface InlineImagePart {
  mimeType: string;
  data: string; // raw base64, no data: prefix
}

export interface ReferenceAnalysisCallParams {
  task: Extract<TaskKey, 'reference_character_analysis' | 'reference_world_analysis'>;
  model: string;
  /** Full instruction prompt (built inline in lib/ai/reference-analysis.ts). */
  prompt: string;
  referenceParts: InlineImagePart[];
  temperature?: number;
  telemetry?: CostTelemetryContext;
}

/**
 * Multimodal identity / World DNA extraction: sends the uploaded reference image
 * plus a JSON-instruction prompt and returns the raw JSON text for the caller to
 * parse. Separate from callGeminiVisionText because these tasks are not part of
 * the admin prompt playground (no LOCKED_PROMPT_GUARDRAILS entry) and require
 * JSON output.
 */
export async function callGeminiReferenceAnalysis(params: ReferenceAnalysisCallParams): Promise<string> {
  const { task, model, prompt, referenceParts, temperature, telemetry } = params;
  const ai = getAI();

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];
  for (const ref of referenceParts) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }

  const flagVal = await getFeatureFlagValue('gemini_text_timeout_ms');
  const timeoutMs = (flagVal ? parseInt(flagVal, 10) : 0) || GEMINI_TEXT_TIMEOUT_MS;

  const startedAt = geminiNowMs();
  const response = await timeGeminiStep(
    `gemini_proxy.${task}`,
    { model, timeoutMs, referenceCount: referenceParts.length, promptChars: prompt.length },
    () =>
      withTimeout(
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            responseMimeType: 'application/json',
            temperature: temperature ?? 0.2,
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
      metadata: { promptChars: prompt.length, referenceCount: referenceParts.length },
    });
  }

  const text = response.text;
  if (!text) throw new Error(`Empty response from Gemini for task: ${task}`);
  return text.trim();
}

export interface ImageCallParams {
  task: Extract<TaskKey, 'image_generation' | 'reel_image_generation' | 'portrait_generation'>;
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

export interface GeminiInteractionImageCallParams extends ImageCallParams {
  previousInteractionId?: string | null;
}

export interface GeminiInteractionImageCallResult extends ImageCallResult {
  interactionId: string | null;
  providerUsage?: Record<string, unknown>;
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

  const systemInstruction = task === 'image_generation' || task === 'reel_image_generation'
    ? LOCKED_PROMPT_GUARDRAILS[task]
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

function buildGeminiInteractionInput(prompt: string, referenceParts?: InlineImagePart[]): unknown {
  if (!referenceParts?.length) return prompt;

  return [
    { type: 'text', text: prompt },
    ...referenceParts.map((ref) => ({
      type: 'image',
      data: ref.data,
      mime_type: ref.mimeType,
    })),
  ];
}

// Depth cap for the interaction-response walkers below. The SDK returns rich
// objects whose accessors can synthesize fresh sub-objects on each read, which
// defeats the identity-based `seen` guard and lets a naive walk recurse without
// bound ("Maximum call stack size exceeded"). A hard depth limit keeps the walk
// bounded regardless of the response shape — worst case we simply don't find an
// image and fall back to text.
const GEMINI_INTERACTION_WALK_MAX_DEPTH = 12;

function findGeminiInteractionImage(value: unknown, seen = new Set<unknown>(), depth = 0): { data: string; mimeType: string } | null {
  if (!value || typeof value !== 'object') return null;
  if (depth > GEMINI_INTERACTION_WALK_MAX_DEPTH) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGeminiInteractionImage(item, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const inlineData = record.inlineData && typeof record.inlineData === 'object'
    ? record.inlineData as Record<string, unknown>
    : null;
  if (typeof inlineData?.data === 'string') {
    return {
      data: inlineData.data,
      mimeType: typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png',
    };
  }

  if (record.type === 'image' && typeof record.data === 'string') {
    return {
      data: record.data,
      mimeType: typeof record.mime_type === 'string'
        ? record.mime_type
        : typeof record.mimeType === 'string'
        ? record.mimeType
        : 'image/png',
    };
  }

  for (const nested of Object.values(record)) {
    const found = findGeminiInteractionImage(nested, seen, depth + 1);
    if (found) return found;
  }

  return null;
}

function collectGeminiInteractionText(value: unknown, texts: string[] = [], seen = new Set<unknown>(), depth = 0): string {
  if (!value || typeof value !== 'object') return texts.join('\n').trim();
  if (depth > GEMINI_INTERACTION_WALK_MAX_DEPTH) return texts.join('\n').trim();
  if (seen.has(value)) return texts.join('\n').trim();
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGeminiInteractionText(item, texts, seen, depth + 1);
    }
    return texts.join('\n').trim();
  }

  const record = value as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') {
    texts.push(record.text);
  }
  for (const nested of Object.values(record)) {
    collectGeminiInteractionText(nested, texts, seen, depth + 1);
  }
  return texts.join('\n').trim();
}

export async function callGeminiInteractionsImage(
  params: GeminiInteractionImageCallParams
): Promise<GeminiInteractionImageCallResult> {
  const { task, model, prompt, referenceParts, aspectRatio, imageSize, previousInteractionId } = params;
  const ai = getAI();
  const resolvedImageSize = (imageSize ?? '1K') as GeminiImageSize;
  const systemInstruction = task === 'image_generation' || task === 'reel_image_generation'
    ? LOCKED_PROMPT_GUARDRAILS[task]
    : task === 'portrait_generation'
    ? LOCKED_PROMPT_GUARDRAILS.portrait_generation
    : undefined;

  const imgFlagVal = await getFeatureFlagValue('gemini_image_timeout_ms');
  const imgTimeoutMs = (imgFlagVal ? parseInt(imgFlagVal, 10) : 0) || GEMINI_IMAGE_TIMEOUT_MS;

  const interaction = await timeGeminiStep(
    `gemini_proxy.${task}.interactions`,
    {
      model,
      timeoutMs: imgTimeoutMs,
      hasReferences: Boolean(referenceParts?.length),
      referenceCount: referenceParts?.length ?? 0,
      previousInteractionId: previousInteractionId ?? null,
      aspectRatio: aspectRatio ?? '16:9',
      imageSize: resolvedImageSize,
      promptChars: prompt.length,
    },
    () => withTimeout(
      (ai.interactions.create as unknown as (body: Record<string, unknown>) => Promise<Record<string, unknown>>)({
        model,
        input: buildGeminiInteractionInput(prompt, referenceParts),
        ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
        ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
        response_modalities: ['image'],
        response_mime_type: 'image/png',
        response_format: {
          type: 'image',
          aspect_ratio: aspectRatio ?? '16:9',
          image_size: resolvedImageSize,
        },
        store: true,
      }),
      imgTimeoutMs,
      `${task}.interactions`
    )
  );

  // Prefer the response's declared output payload; only if that yields nothing do
  // we fall back to walking the whole interaction object. Both walks are bounded
  // by GEMINI_INTERACTION_WALK_MAX_DEPTH, so neither can blow the stack even when
  // the SDK object's accessors synthesize fresh sub-objects on access.
  const interactionOutput =
    interaction.outputs
    ?? (interaction as Record<string, unknown>).output
    ?? (interaction as Record<string, unknown>).content
    ?? (interaction as Record<string, unknown>).response
    ?? null;

  const image =
    findGeminiInteractionImage(interactionOutput)
    ?? findGeminiInteractionImage(interaction);
  if (image) {
    return {
      dataUrl: `data:${image.mimeType};base64,${image.data}`,
      fallbackText: null,
      interactionId: typeof interaction.id === 'string' ? interaction.id : null,
      providerUsage: interaction.usage && typeof interaction.usage === 'object'
        ? interaction.usage as Record<string, unknown>
        : undefined,
    };
  }

  return {
    dataUrl: null,
    fallbackText: collectGeminiInteractionText(interactionOutput ?? interaction) || null,
    interactionId: typeof interaction.id === 'string' ? interaction.id : null,
    providerUsage: interaction.usage && typeof interaction.usage === 'object'
      ? interaction.usage as Record<string, unknown>
      : undefined,
  };
}
