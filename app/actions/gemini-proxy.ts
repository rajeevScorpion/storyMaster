'use server';

import { GoogleGenAI } from '@google/genai';
import { beatSchema, storyboardPlanSchema } from '@/lib/ai/generation-schemas';
import { LOCKED_PROMPT_GUARDRAILS } from '@/lib/ai/prompt-config.shared';
import type { TaskKey } from '@/lib/ai/model-config.shared';
import { getFeatureFlagValue } from '@/lib/ai/model-config';

const GEMINI_TEXT_TIMEOUT_MS = 30_000;
const GEMINI_IMAGE_TIMEOUT_MS = 90_000;
const GEMINI_TTS_TIMEOUT_MS = 120_000;

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
  task: Extract<TaskKey, 'story_generation' | 'visual_prompt'>;
  model: string;
  prompt: string;
  temperature?: number;
}

export async function callGeminiText(params: TextCallParams): Promise<string> {
  const { task, model, prompt, temperature } = params;
  const ai = getAI();

  const schemaMap = {
    story_generation: beatSchema,
    visual_prompt: storyboardPlanSchema,
  } as const;

  const flagVal = await getFeatureFlagValue('gemini_text_timeout_ms');
  const timeoutMs = (flagVal ? parseInt(flagVal, 10) : 0) || GEMINI_TEXT_TIMEOUT_MS;

  const response = await withTimeout(
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
  );

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
}

export interface ImageCallResult {
  dataUrl: string | null;
  fallbackText: string | null;
}

export async function callGeminiImage(params: ImageCallParams): Promise<ImageCallResult> {
  const { task, model, prompt, referenceParts, aspectRatio, imageSize } = params;
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

  const systemInstruction =
    task === 'portrait_generation' ? LOCKED_PROMPT_GUARDRAILS.portrait_generation : undefined;

  const imgFlagVal = await getFeatureFlagValue('gemini_image_timeout_ms');
  const imgTimeoutMs = (imgFlagVal ? parseInt(imgFlagVal, 10) : 0) || GEMINI_IMAGE_TIMEOUT_MS;

  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        imageConfig: {
          aspectRatio: aspectRatio ?? '16:9',
          imageSize: imageSize ?? '1K',
        },
      },
    }),
    imgTimeoutMs,
    task
  );

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData) {
      return {
        dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        fallbackText: null,
      };
    }
  }

  return {
    dataUrl: null,
    fallbackText: (response.text ?? '').trim() || null,
  };
}
