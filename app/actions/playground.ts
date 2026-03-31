'use server';

import { GoogleGenAI, Type } from '@google/genai';
import { verifyAdmin } from '@/lib/supabase/admin';
import { updateModelConfig, type TaskKey } from '@/lib/ai/model-config';
import { estimateCost } from '@/lib/ai/pricing';
import { STORY_MASTER_SYSTEM_PROMPT, VISUAL_PROMPT_COMPOSER_PROMPT } from '@/lib/ai/prompts';

const AVAILABLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
}

// Beat schema (same as story.ts)
const beatSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    beatNumber: { type: Type.INTEGER },
    isEnding: { type: Type.BOOLEAN },
    storyText: { type: Type.STRING },
    sceneSummary: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          intent: { type: Type.STRING },
        },
        required: ['id', 'label', 'intent'],
      },
    },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          type: { type: Type.STRING },
          appearanceSummary: { type: Type.STRING },
          personalitySummary: { type: Type.STRING },
        },
        required: ['id', 'name', 'type', 'appearanceSummary', 'personalitySummary'],
      },
    },
    continuityNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    imagePrompt: { type: Type.STRING },
    clues: { type: Type.ARRAY, items: { type: Type.STRING } },
    nextBeatGoal: { type: Type.STRING },
    endingForecast: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'title', 'beatNumber', 'isEnding', 'storyText', 'sceneSummary',
    'options', 'characters', 'continuityNotes', 'imagePrompt', 'clues',
    'nextBeatGoal', 'endingForecast',
  ],
};

export interface TestResult {
  output: string;
  outputType: 'json' | 'text' | 'image' | 'audio';
  latencyMs: number;
  tokenCounts?: { input: number; output: number };
  estimatedCostUsd?: number;
  model: string;
}

// ── Test Functions ─────────────────────────────────────────────

export async function testStoryGeneration(
  model: string,
  temperature: number,
  testPrompt: string
): Promise<TestResult> {
  await verifyAdmin();
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `[LANGUAGE: english] — Generate ALL story content in this language.\n\nUser Request: ${testPrompt}\n\nStory Configuration:\n- Language: english\n- Age Group: all_ages\n- Setting/Country: generic\n- Maximum Beats: 6\n- Current Beat: 1 of 6\n\nGenerate the next story beat.`;

  const start = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: STORY_MASTER_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: beatSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;

  const text = response.text || '';
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  return {
    output: text,
    outputType: 'json',
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    model,
  };
}

export async function testVisualPrompt(
  model: string,
  temperature: number,
  sceneDescription: string
): Promise<TestResult> {
  await verifyAdmin();
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `${VISUAL_PROMPT_COMPOSER_PROMPT}\n\nStory Beat Image Prompt: ${sceneDescription}\nCharacters: []\nVisual Style: cinematic storybook illustration\n\nGenerate the final image prompt based on the above.`;

  const start = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { temperature },
  });
  const latencyMs = Date.now() - start;

  const text = response.text || '';
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  return {
    output: text,
    outputType: 'text',
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    model,
  };
}

export async function testImageGeneration(
  model: string,
  imagePrompt: string
): Promise<TestResult> {
  await verifyAdmin();
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: imagePrompt,
    config: {
      imageConfig: {
        aspectRatio: '16:9',
        imageSize: '1K',
      },
    },
  });
  const latencyMs = Date.now() - start;

  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return {
        output: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        outputType: 'image',
        latencyMs,
        tokenCounts: { input: inputTokens, output: outputTokens },
        estimatedCostUsd: estimateCost(model, inputTokens, outputTokens, 1),
        model,
      };
    }
  }

  throw new Error('No image generated');
}

export async function testTTS(
  model: string,
  text: string,
  voiceName: string
): Promise<TestResult> {
  await verifyAdmin();
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const ttsPrompt = `You are a master storyteller narrating an adventure tale with a playful tone in english. Read this passage aloud with natural pacing, dramatic pauses, and emotional expression that matches the scene:\n\n${text}`;

  const start = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: ttsPrompt }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });
  const latencyMs = Date.now() - start;

  const audioPart = response.candidates?.[0]?.content?.parts?.find(
    (p: any) => p.inlineData
  );

  if (!audioPart?.inlineData?.data) {
    throw new Error('No audio generated');
  }

  // Convert PCM to WAV for browser playback
  const pcmBase64 = audioPart.inlineData.data;
  const pcmBytes = Buffer.from(pcmBase64, 'base64');
  const sampleRate = 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = pcmBytes.length;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  const wavBuffer = Buffer.concat([header, pcmBytes]);
  const wavBase64 = wavBuffer.toString('base64');

  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  return {
    output: `data:audio/wav;base64,${wavBase64}`,
    outputType: 'audio',
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    model,
  };
}

export async function testVoiceSelection(
  model: string,
  temperature: number,
  genre: string,
  tone: string
): Promise<TestResult> {
  await verifyAdmin();
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `Pick the single best narrator voice for a ${genre} story with a ${tone} tone, aimed at a all_ages audience. The story will be narrated in english.\n\nAvailable voices: ${AVAILABLE_VOICES.join(', ')}\n\nRespond with ONLY the voice name, nothing else.`;

  const start = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { temperature },
  });
  const latencyMs = Date.now() - start;

  const text = response.text?.trim() || '';
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  return {
    output: text,
    outputType: 'text',
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    model,
  };
}

// ── Apply to Production ────────────────────────────────────────

export async function applyModelToProduction(
  taskKey: TaskKey,
  modelId: string,
  temperature: number | null
): Promise<void> {
  await verifyAdmin();
  await updateModelConfig(taskKey, modelId, temperature);
}
