'use server';

import { GoogleGenAI } from '@google/genai';
import { verifyAdmin } from '@/lib/supabase/admin';
import { updateModelConfig, type TaskKey } from '@/lib/ai/model-config';
import { estimateCost } from '@/lib/ai/pricing';
import {
  type PromptTaskKey,
  type PromptValidationResult,
  LOCKED_PROMPT_GUARDRAILS,
  PROMPT_TASK_DEFINITIONS,
  getDefaultPromptBody,
  isPromptTaskKey,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { beatSchema, reelDraftSchema, seedPlanSchema, storyBibleGenerationSchema, storyboardPlanSchema } from '@/lib/ai/generation-schemas';
import {
  getPromptPlaygroundState,
  getPublishedPrompt,
  publishPromptDraft,
  recordPromptTestRun,
  restorePublishedVersionToDraft,
  savePromptDraft,
  type PromptPlaygroundState,
} from '@/lib/ai/prompt-config';

const AVAILABLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

const DEFAULT_VISUAL_STYLE = 'storybook illustration with painterly textures and expressive character acting, whimsical and playful emotional tone, warm color palette with sunlit golds, ambers, and rich reds, balanced visual detail with readable characters and selective environment richness';

export interface TestResult {
  output: string;
  outputType: 'json' | 'text' | 'image' | 'audio';
  latencyMs: number;
  tokenCounts?: { input: number; output: number };
  estimatedCostUsd?: number;
  model: string;
}

export interface PlaygroundPromptState extends PromptPlaygroundState {
  validation: PromptValidationResult;
  supportsPrompt: true;
}

export interface RunPlaygroundTestInput {
  taskKey: TaskKey;
  modelId: string;
  temperature: number | null;
  inputs: Record<string, string>;
  promptBody?: string;
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
}

export async function getPromptPlaygroundStateAction(taskKey: PromptTaskKey): Promise<PlaygroundPromptState> {
  const { user } = await verifyAdmin();
  const state = await getPromptPlaygroundState(taskKey, user.id);
  const validation = validatePromptTemplate(taskKey, state.draft.promptBody);
  return {
    ...state,
    validation,
    supportsPrompt: true,
  };
}

export async function savePromptDraftAction(taskKey: PromptTaskKey, promptBody: string): Promise<PlaygroundPromptState> {
  const { user } = await verifyAdmin();
  await savePromptDraft(taskKey, user.id, promptBody);
  return getPromptPlaygroundStateAction(taskKey);
}

export async function publishPromptDraftAction(taskKey: PromptTaskKey, note?: string): Promise<PlaygroundPromptState> {
  const { user } = await verifyAdmin();
  await publishPromptDraft(taskKey, user.id, note);
  return getPromptPlaygroundStateAction(taskKey);
}

export async function restorePromptVersionToDraftAction(taskKey: PromptTaskKey, versionId: string): Promise<PlaygroundPromptState> {
  const { user } = await verifyAdmin();
  await restorePublishedVersionToDraft(taskKey, versionId, user.id);
  return getPromptPlaygroundStateAction(taskKey);
}

export async function runPlaygroundTest(input: RunPlaygroundTestInput): Promise<TestResult> {
  const { user } = await verifyAdmin();

  const promptBody = await resolveTestPromptBody(input.taskKey, input.promptBody);
  const result = await executeTaskTest(input.taskKey, input.modelId, input.temperature, input.inputs, promptBody);

  if (isPromptTaskKey(input.taskKey) && promptBody) {
    await recordPromptTestRun({
      taskKey: input.taskKey,
      createdBy: user.id,
      promptBody,
      modelId: input.modelId,
      temperature: input.temperature,
      inputs: input.inputs,
      output: result.output,
      outputType: result.outputType,
      latencyMs: result.latencyMs,
      tokenCounts: result.tokenCounts,
      estimatedCostUsd: result.estimatedCostUsd,
    });
  }

  return result;
}

export async function applyModelToProduction(
  taskKey: TaskKey,
  modelId: string,
  temperature: number | null
): Promise<void> {
  await verifyAdmin();
  await updateModelConfig(taskKey, modelId, temperature);
}

async function resolveTestPromptBody(taskKey: TaskKey, promptBody?: string): Promise<string | undefined> {
  if (!isPromptTaskKey(taskKey)) {
    return undefined;
  }

  const resolvedPrompt = promptBody || (await getPublishedPrompt(taskKey)) || getDefaultPromptBody(taskKey);
  const validation = validatePromptTemplate(taskKey, resolvedPrompt);
  if (!validation.isValid) {
    throw new Error(buildPromptValidationError(taskKey, validation));
  }
  return resolvedPrompt;
}

async function executeTaskTest(
  taskKey: TaskKey,
  modelId: string,
  temperature: number | null,
  inputs: Record<string, string>,
  promptBody?: string
): Promise<TestResult> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  switch (taskKey) {
    case 'story_generation':
      return runStoryGenerationTest(ai, modelId, temperature ?? 0.7, inputs, promptBody!);
    case 'reel_story_generation':
      return runReelStoryGenerationTest(ai, modelId, temperature ?? 0.7, inputs, promptBody!);
    case 'seed_plan_generation':
      return runSeedPlanGenerationTest(ai, modelId, temperature ?? 0.3, inputs, promptBody!);
    case 'seeded_beat_materialization':
      return runSeededBeatMaterializationTest(ai, modelId, temperature ?? 0.4, inputs, promptBody!);
    case 'story_bible_generation':
      return runStoryBibleGenerationTest(ai, modelId, temperature ?? 0.35, inputs, promptBody!);
    case 'visual_prompt':
      return runVisualPromptTest(ai, modelId, temperature ?? 0.7, inputs, promptBody!);
    case 'reel_visual_prompt':
      return runReelVisualPromptTest(ai, modelId, temperature ?? 0.5, inputs, promptBody!);
    case 'image_generation':
      return runImageGenerationTest(ai, modelId, inputs, promptBody!);
    case 'reel_image_generation':
      return runReelImageGenerationTest(ai, modelId, inputs, promptBody!);
    case 'portrait_generation':
      return runPortraitGenerationTest(ai, modelId, inputs, promptBody!);
    case 'tts':
      return runTTSTest(ai, modelId, inputs, promptBody!);
    case 'reel_tts':
      return runReelTTSTest(ai, modelId, inputs, promptBody!);
    case 'voice_selection':
      return runVoiceSelectionTest(ai, modelId, temperature ?? 0.3, inputs, promptBody!);
    default:
      throw new Error('Unknown task');
  }
}

async function runSeedPlanGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    language: inputs.language || 'english',
    storyConfig: inputs.storyConfig || '{}',
    workingTitle: inputs.workingTitle || '',
    sourceFidelity: inputs.sourceFidelity || 'strictly_follow',
    guidanceText: inputs.guidanceText || '',
    sourceText: inputs.sourceText || '',
    beatCount: inputs.beatCount || '6',
    strictSourceSegments: inputs.strictSourceSegments || '',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.seed_plan_generation,
      responseMimeType: 'application/json',
      responseSchema: seedPlanSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runSeededBeatMaterializationTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    language: inputs.language || 'english',
    storyConfig: inputs.storyConfig || '{}',
    storyState: inputs.storyState || '{}',
    sourceText: inputs.sourceText || '',
    guidanceText: inputs.guidanceText || '',
    seedBeat: inputs.seedBeat || '{}',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.seeded_beat_materialization,
      responseMimeType: 'application/json',
      responseSchema: beatSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runStoryBibleGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    language: inputs.language || 'english',
    storyConfig: inputs.storyConfig || '{}',
    storyDigest: inputs.storyDigest || '',
    characters: inputs.characters || '[]',
    previousBible: inputs.previousBible || '',
    previousJournal: inputs.previousJournal || '',
    episodeNumber: inputs.episodeNumber || '1',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.story_bible_generation,
      responseMimeType: 'application/json',
      responseSchema: storyBibleGenerationSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runStoryGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    language: inputs.language || 'english',
    userPrompt: inputs.userPrompt || '',
    storyConfig: inputs.storyConfig || '{}',
    storyState: inputs.storyState || '{}',
    selectedOptionLabel: inputs.selectedOptionLabel || 'None yet - first beat',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.story_generation,
      responseMimeType: 'application/json',
      responseSchema: beatSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runReelStoryGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    language: inputs.language || 'english',
    userPrompt: inputs.userPrompt || '',
    storyConfig: inputs.storyConfig || '{}',
    storyState: inputs.storyState || '{}',
    selectedOptionLabel: inputs.selectedOptionLabel || 'None yet - first beat',
    reelLength: inputs.reelLength || 'short',
    reelBeatCount: inputs.reelBeatCount || '2',
    reelPanelCount: inputs.reelPanelCount || '4',
    textLength: inputs.textLength || 'medium',
    textLengthWordRange: inputs.textLengthWordRange || '9-14',
    textLengthWordRangePerPanel: inputs.textLengthWordRangePerPanel || inputs.textLengthWordRange || '9-14',
    textLengthWordRangePerBeat: inputs.textLengthWordRangePerBeat || '36-56',
    textOverlayMode: inputs.textOverlayMode || 'Visible overlay text is rendered by the player/export layer.',
    moodDefiner: inputs.moodDefiner || 'Playful: bright, curious, quick emotional turns',
    visualStyleDefiner: inputs.visualStyleDefiner || 'Cinematic: cinematic storybook frames with expressive lighting',
    narrationStyleDefiner: inputs.narrationStyleDefiner || 'Expressive: expressive narrator with natural pauses and energy',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.reel_story_generation,
      responseMimeType: 'application/json',
      responseSchema: reelDraftSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runVisualPromptTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    storyText: inputs.storyText || '',
    storyTextParts: inputs.storyTextParts || '[]',
    sceneSummary: inputs.sceneSummary || '',
    imageIntent: inputs.imageIntent || '',
    characters: inputs.characters || '[]',
    continuityNotes: inputs.continuityNotes || '[]',
    visualStyle: inputs.visualStyle || DEFAULT_VISUAL_STYLE,
    beatNumber: inputs.beatNumber || '2',
    storyState: inputs.storyState || '{}',
    newCharacterIds: inputs.newCharacterIds || '[]',
    changedCharacterIds: inputs.changedCharacterIds || '[]',
    previousStoryboardContext: inputs.previousStoryboardContext || 'None yet - first beat',
    seedAuthoringContext: inputs.seedAuthoringContext || '',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.visual_prompt,
      responseMimeType: 'application/json',
      responseSchema: storyboardPlanSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runReelVisualPromptTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    storyText: inputs.storyText || '',
    storyTextParts: inputs.storyTextParts || '[]',
    sceneSummary: inputs.sceneSummary || '',
    imageIntent: inputs.imageIntent || '',
    characters: inputs.characters || '[]',
    continuityNotes: inputs.continuityNotes || '[]',
    visualStyle: inputs.visualStyle || DEFAULT_VISUAL_STYLE,
    moodDefiner: inputs.moodDefiner || 'Playful: bright, curious, quick emotional turns',
    visualStyleDefiner: inputs.visualStyleDefiner || 'Cinematic: cinematic storybook frames with expressive lighting',
    noFaceRule: inputs.noFaceRule || 'Default to no visible faces: use silhouettes, back views, hands, objects, spaces, symbolic landscapes, and abstract human presence.',
    textOverlayMode: inputs.textOverlayMode || 'Visible overlay text is rendered by the player/export layer.',
    beatNumber: inputs.beatNumber || '1',
    storyState: inputs.storyState || '{}',
    newCharacterIds: inputs.newCharacterIds || '[]',
    changedCharacterIds: inputs.changedCharacterIds || '[]',
    previousStoryboardContext: inputs.previousStoryboardContext || 'None yet - first beat',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.reel_visual_prompt,
      responseMimeType: 'application/json',
      responseSchema: storyboardPlanSchema,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult(response.text || '', 'json', latencyMs, response.usageMetadata, modelId);
}

async function runImageGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const wrappedPrompt = resolvePromptTemplate(promptBody, {
    prompt: inputs.prompt || '',
    characters: inputs.characters || '[]',
    visualStyle: inputs.visualStyle || DEFAULT_VISUAL_STYLE,
    beatNumber: inputs.beatNumber || '2',
  });

  const start = Date.now();
  const response = await requestImageResponse(ai, modelId, wrappedPrompt);
  const initialImage = extractInlineImage(response);
  if (initialImage) {
    return buildImageTestResult(initialImage, Date.now() - start, modelId, response.usageMetadata);
  }

  const fallbackPrompt = (response.text || '').trim();
  if (fallbackPrompt && fallbackPrompt !== wrappedPrompt) {
    const retryResponse = await requestImageResponse(ai, modelId, fallbackPrompt);
    const retryImage = extractInlineImage(retryResponse);
    if (retryImage) {
      return buildImageTestResult(
        retryImage,
        Date.now() - start,
        modelId,
        mergeUsageMetadata(response.usageMetadata, retryResponse.usageMetadata)
      );
    }
  }

  throw new Error('No image generated');
}

async function runReelImageGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const wrappedPrompt = resolvePromptTemplate(promptBody, {
    prompt: inputs.prompt || '',
    visualStyle: inputs.visualStyle || DEFAULT_VISUAL_STYLE,
    visualStyleDefiner: inputs.visualStyleDefiner || 'Risograph dream: grainy ink layers, symbolic landscapes, bold negative space',
    noFaceRule: inputs.noFaceRule || 'Default to no visible faces: use silhouettes, back views, hands, objects, spaces, symbolic landscapes, and abstract human presence.',
    textOverlayMode: inputs.textOverlayMode || 'Visible overlay text is rendered later by the player/export layer; reserve clean space and do not place text inside the generated image.',
    beatNumber: inputs.beatNumber || '1',
  });

  const start = Date.now();
  const response = await requestImageResponse(ai, modelId, wrappedPrompt, '9:16');
  const initialImage = extractInlineImage(response);
  if (initialImage) {
    return buildImageTestResult(initialImage, Date.now() - start, modelId, response.usageMetadata);
  }

  const fallbackPrompt = (response.text || '').trim();
  if (fallbackPrompt && fallbackPrompt !== wrappedPrompt) {
    const retryResponse = await requestImageResponse(ai, modelId, fallbackPrompt, '9:16');
    const retryImage = extractInlineImage(retryResponse);
    if (retryImage) {
      return buildImageTestResult(
        retryImage,
        Date.now() - start,
        modelId,
        mergeUsageMetadata(response.usageMetadata, retryResponse.usageMetadata)
      );
    }
  }

  throw new Error('No reel image generated');
}

async function runPortraitGenerationTest(
  ai: GoogleGenAI,
  modelId: string,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const wrappedPrompt = resolvePromptTemplate(promptBody, {
    characterName: inputs.characterName || 'Unknown',
    characterAppearance: inputs.characterAppearance || '',
    characterType: inputs.characterType || 'character',
    visualStyle: inputs.visualStyle || DEFAULT_VISUAL_STYLE,
    portraitMode: inputs.portraitMode || 'single portrait',
    referenceQuality: inputs.referenceQuality || '0.5K',
    sheetLayout: inputs.sheetLayout || 'one clean full-body reference portrait with a clear face, either front-facing or 3/4 view',
  });
  const imageSize = inputs.referenceQuality === '1K' ? '1K' : '512';

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: wrappedPrompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.portrait_generation,
      imageConfig: {
        aspectRatio: '1:1',
        imageSize,
      },
    },
  });

  const image = extractInlineImage(response);
  if (image) {
    return buildImageTestResult(image, Date.now() - start, modelId, response.usageMetadata, imageSize);
  }

  throw new Error('No portrait generated');
}

async function requestImageResponse(ai: GoogleGenAI, modelId: string, prompt: string, aspectRatio: '16:9' | '9:16' = '16:9') {
  return ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      imageConfig: {
        aspectRatio,
        imageSize: '1K',
      },
    },
  });
}

function extractInlineImage(response: Awaited<ReturnType<typeof requestImageResponse>>) {
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  return null;
}

function mergeUsageMetadata(
  first: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined,
  second: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined
) {
  return {
    promptTokenCount: (first?.promptTokenCount || 0) + (second?.promptTokenCount || 0),
    candidatesTokenCount: (first?.candidatesTokenCount || 0) + (second?.candidatesTokenCount || 0),
  };
}

function buildImageTestResult(
  output: string,
  latencyMs: number,
  modelId: string,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined,
  imageSize: '512' | '0.5K' | '1K' | '2K' | '4K' = '1K'
): TestResult {
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;
  return {
    output,
    outputType: 'image',
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(modelId, inputTokens, outputTokens, 1, imageSize),
    model: modelId,
  };
}

async function runTTSTest(
  ai: GoogleGenAI,
  modelId: string,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const resolvedPrompt = resolvePromptTemplate(promptBody, {
    storyText: inputs.storyText || '',
    tone: inputs.tone || 'playful',
    genre: inputs.genre || 'adventure',
    language: inputs.language || 'english',
    narrationStyle: inputs.narrationStyle || 'Expressive: expressive narrator with natural pauses and energy',
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ parts: [{ text: resolvedPrompt }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: inputs.voice || 'Sulafat' },
        },
      },
    },
  });
  const latencyMs = Date.now() - start;

  const audioPart = response.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
  if (!audioPart?.inlineData?.data) {
    throw new Error('No audio generated');
  }

  const pcmBytes = Buffer.from(audioPart.inlineData.data, 'base64');
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
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  return {
    output: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
    outputType: 'audio',
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(modelId, inputTokens, outputTokens),
    model: modelId,
  };
}

async function runReelTTSTest(
  ai: GoogleGenAI,
  modelId: string,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  return runTTSTest(ai, modelId, inputs, promptBody);
}

async function runVoiceSelectionTest(
  ai: GoogleGenAI,
  modelId: string,
  temperature: number,
  inputs: Record<string, string>,
  promptBody: string
): Promise<TestResult> {
  const prompt = resolvePromptTemplate(promptBody, {
    genre: inputs.genre || '',
    tone: inputs.tone || '',
    targetAge: inputs.targetAge || 'all_ages',
    language: inputs.language || 'english',
    availableVoices: AVAILABLE_VOICES.join(', '),
  });

  const start = Date.now();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: LOCKED_PROMPT_GUARDRAILS.voice_selection,
      temperature,
    },
  });
  const latencyMs = Date.now() - start;
  return buildResult((response.text || '').trim(), 'text', latencyMs, response.usageMetadata, modelId);
}

function buildResult(
  output: string,
  outputType: TestResult['outputType'],
  latencyMs: number,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined,
  modelId: string
): TestResult {
  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;
  return {
    output,
    outputType,
    latencyMs,
    tokenCounts: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateCost(modelId, inputTokens, outputTokens),
    model: modelId,
  };
}

function buildPromptValidationError(taskKey: PromptTaskKey, validation: PromptValidationResult): string {
  const label = PROMPT_TASK_DEFINITIONS[taskKey].label;
  const parts = [`${label} template is invalid.`];
  if (validation.unknownPlaceholders.length > 0) {
    parts.push(`Unknown placeholders: ${validation.unknownPlaceholders.join(', ')}.`);
  }
  if (validation.missingRequiredPlaceholders.length > 0) {
    parts.push(`Missing required placeholders: ${validation.missingRequiredPlaceholders.join(', ')}.`);
  }
  return parts.join(' ');
}
