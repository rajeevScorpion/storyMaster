'use client';

import { GoogleGenAI, Type } from '@google/genai';
import { StorySession, StoryBeat } from '@/lib/types/story';
import { compressImage } from '@/lib/utils/image';
import {
  LOCKED_PROMPT_GUARDRAILS,
  getDefaultPromptBody,
  resolvePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, IMAGE_QUALITY, PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY } from '@/lib/constants/media';
import type { Character } from '@/lib/types/story';

export interface StoryModelOverrides {
  storyModel?: string;
  storyTemperature?: number;
  composerModel?: string;
  composerTemperature?: number;
  imageModel?: string;
  portraitModel?: string;
  storyPrompt?: string;
  visualPrompt?: string;
  imagePrompt?: string;
  portraitPrompt?: string;
}

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
    continuityNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    imagePrompt: { type: Type.STRING },
    clues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    nextBeatGoal: { type: Type.STRING },
    endingForecast: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'title',
    'beatNumber',
    'isEnding',
    'storyText',
    'sceneSummary',
    'options',
    'characters',
    'continuityNotes',
    'imagePrompt',
    'clues',
    'nextBeatGoal',
    'endingForecast',
  ],
};

export async function generateStoryBeat(
  userPrompt: string,
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string,
  modelOverrides?: StoryModelOverrides
): Promise<StoryBeat> {
  if (userPrompt.toLowerCase() === 'mock') {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const isFirstBeat = !sessionState?.beats || sessionState.beats.length === 0;

    if (isFirstBeat) {
      return {
        title: 'The Monkey and the Mountain Giant',
        beatNumber: 1,
        isEnding: false,
        storyText: "Miko the monkey hopped from stone to stone on the misty mountain trail. Ahead of him rested what looked like an enormous grey rock, warm in the morning sun. Curious as ever, he leaned forward and whispered, 'What a strange rock to be sleeping here all alone.'",
        sceneSummary: 'A monkey mistakes a resting elephant for a giant rock on a mountain path.',
        options: [
          { id: 'opt_1', label: 'Miko jumps onto the rock', intent: 'playful action' },
          { id: 'opt_2', label: 'Miko hides behind a bush', intent: 'fearful retreat' },
          { id: 'opt_3', label: 'Miko pokes the rock with a stick', intent: 'careful curiosity' },
        ],
        characters: [
          { id: 'char_monkey', name: 'Miko', type: 'monkey', appearanceSummary: 'small golden-brown monkey with a curled tail and expressive eyes', personalitySummary: 'curious, energetic, impulsive' },
          { id: 'char_elephant', name: 'Bhoora', type: 'elephant', appearanceSummary: 'large soft-grey elephant with kind eyes and slightly dusty ears', personalitySummary: 'gentle, wise, calm' },
        ],
        continuityNotes: ['Miko has just encountered Bhoora for the first time.'],
        imagePrompt: "Cinematic children's storybook illustration of a small golden-brown monkey with a curled tail staring curiously at a huge resting grey elephant that looks like a rock on a misty mountain forest path, morning light, whimsical, emotionally warm, highly detailed, consistent character design, soft painterly style.",
        clues: ['Some rocks can breathe... if they are not rocks at all.', 'Curiosity can sometimes lead to friendship.'],
        nextBeatGoal: 'Reveal whether the giant rock is alive and deepen the encounter.',
        endingForecast: ['friendship', 'comedy', 'moral discovery'],
      };
    }

    return {
      title: 'The Monkey and the Mountain Giant',
      beatNumber: (sessionState?.currentBeat || 1) + 1,
      isEnding: true,
      storyText: "The giant rock slowly opened one eye, then let out a deep, rumbling laugh that shook the leaves from the trees. 'Little monkey,' Bhoora the elephant chuckled, 'I am no rock, but I make an excellent climbing frame.' Miko grinned, realizing he had just made the biggest friend in the forest.",
      sceneSummary: 'The elephant wakes up and befriends the monkey.',
      options: [],
      characters: sessionState?.characters || [],
      continuityNotes: ['Miko and Bhoora are now friends.'],
      imagePrompt: "Cinematic children's storybook illustration of a small golden-brown monkey sitting happily on the head of a large soft-grey elephant, misty mountain forest path, morning light, whimsical, emotionally warm, highly detailed, consistent character design, soft painterly style.",
      clues: ['Friendship comes in all sizes.'],
      nextBeatGoal: 'Conclude the story with a heartwarming friendship.',
      endingForecast: ['friendship'],
    };
  }

  const lang = sessionState?.storyConfig?.language || 'english';
  const storyTemplate = modelOverrides?.storyPrompt || getDefaultPromptBody('story_generation');
  const prompt = resolvePromptTemplate(storyTemplate, {
    language: lang,
    userPrompt,
    storyConfig: formatStoryConfig(sessionState),
    storyState: formatStoryState(sessionState),
    selectedOptionLabel: selectedOptionLabel || 'None yet - first beat',
  });

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: modelOverrides?.storyModel || 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        systemInstruction: LOCKED_PROMPT_GUARDRAILS.story_generation,
        responseMimeType: 'application/json',
        responseSchema: beatSchema,
        temperature: modelOverrides?.storyTemperature ?? 0.7,
      },
    });

    const text = response.text;
    if (!text) throw new Error('Failed to generate story beat');

    return JSON.parse(text) as StoryBeat;
  } catch (error) {
    console.error('Story beat generation failed:', error);
    throw error;
  }
}

export interface ReferenceImage {
  type: 'character' | 'scene';
  base64: string;
}

export async function generateImage(
  prompt: string,
  characters: any[],
  visualStyle: string,
  modelOverrides?: StoryModelOverrides,
  referenceImages?: ReferenceImage[],
  beatNumber?: number
): Promise<string> {
  if (prompt.includes("Cinematic children's storybook illustration")) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1920/1080?blur=4`;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const composerTemplate = modelOverrides?.visualPrompt || getDefaultPromptBody('visual_prompt');
    const composerPrompt = resolvePromptTemplate(composerTemplate, {
      sceneDescription: prompt,
      characters: JSON.stringify(characters, null, 2),
      visualStyle,
      beatNumber,
    });

    const composerResponse = await ai.models.generateContent({
      model: modelOverrides?.composerModel || 'gemini-3.1-pro-preview',
      contents: composerPrompt,
      config: {
        systemInstruction: LOCKED_PROMPT_GUARDRAILS.visual_prompt,
        temperature: modelOverrides?.composerTemperature ?? 0.7,
      },
    });

    const baseImagePrompt = composerResponse.text || prompt;
    const imageTemplate = modelOverrides?.imagePrompt || getDefaultPromptBody('image_generation');
    const finalImagePrompt = resolvePromptTemplate(imageTemplate, {
      prompt: baseImagePrompt,
    });

    const imageModel = modelOverrides?.imageModel || 'gemini-3.1-flash-image-preview';
    const response = await requestImageResponse(ai, imageModel, finalImagePrompt, referenceImages);
    const initialImage = extractInlineImage(response);
    if (initialImage) {
      return await compressImage(initialImage, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, IMAGE_QUALITY);
    }

    const fallbackPrompt = (response.text || '').trim();
    if (fallbackPrompt && fallbackPrompt !== finalImagePrompt) {
      const retryResponse = await requestImageResponse(ai, imageModel, fallbackPrompt, referenceImages);
      const retryImage = extractInlineImage(retryResponse);
      if (retryImage) {
        return await compressImage(retryImage, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, IMAGE_QUALITY);
      }
    }

    throw new Error('No image generated');
  } catch (error) {
    console.error('Image generation failed:', error);
    return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1920/1080?blur=4`;
  }
}

async function requestImageResponse(
  ai: GoogleGenAI,
  modelId: string,
  prompt: string,
  referenceImages?: ReferenceImage[]
) {
  // Build contents: text prompt + optional reference image parts
  const hasRefs = referenceImages && referenceImages.length > 0;
  let contents: any = prompt;

  if (hasRefs) {
    const parts: any[] = [{ text: prompt }];
    for (const ref of referenceImages) {
      const match = ref.base64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
    contents = [{ role: 'user', parts }];
  }

  return ai.models.generateContent({
    model: modelId,
    contents,
    config: {
      imageConfig: {
        aspectRatio: '16:9',
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

export async function generateCharacterPortrait(
  character: Character,
  visualStyle: string,
  modelOverrides?: StoryModelOverrides
): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const portraitTemplate = modelOverrides?.portraitPrompt || getDefaultPromptBody('portrait_generation');
    const prompt = resolvePromptTemplate(portraitTemplate, {
      characterName: character.name,
      characterAppearance: character.appearanceSummary,
      characterType: character.type,
      visualStyle,
    });

    const portraitModel = modelOverrides?.portraitModel || 'gemini-3.1-flash-image-preview';
    const response = await ai.models.generateContent({
      model: portraitModel,
      contents: prompt,
      config: {
        systemInstruction: LOCKED_PROMPT_GUARDRAILS.portrait_generation,
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
      },
    });

    const image = extractInlineImage(response);
    if (image) {
      return await compressImage(image, PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY);
    }

    throw new Error('No portrait image generated');
  } catch (error) {
    console.error(`Portrait generation failed for ${character.name}:`, error);
    throw error;
  }
}

function formatStoryConfig(sessionState: Partial<StorySession> | null): string {
  if (!sessionState?.storyConfig) {
    return [
      '- Language: english',
      '- Age Group: all_ages',
      '- Setting/Country: generic',
      '- Maximum Beats: 6',
      '- Current Beat: 1 of 6',
    ].join('\n');
  }

  const cfg = sessionState.storyConfig;
  return [
    `- Language: ${cfg.language || 'english'}`,
    `- Age Group: ${cfg.ageGroup}`,
    `- Setting/Country: ${cfg.settingCountry}`,
    `- Maximum Beats: ${cfg.maxBeats}`,
    `- Current Beat: ${(sessionState.currentBeat || 0) + 1} of ${cfg.maxBeats}`,
  ].join('\n');
}

function formatStoryState(sessionState: Partial<StorySession> | null): string {
  if (!sessionState) {
    return JSON.stringify({}, null, 2);
  }

  const { storyMap, storyConfig, ...safeState } = sessionState as any;
  if (safeState.beats) {
    safeState.beats = safeState.beats.map((beat: any) => {
      const { imageUrl, audioUrl, ...rest } = beat;
      return rest;
    });
  }

  return JSON.stringify(safeState, null, 2);
}
