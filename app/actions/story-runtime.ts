'use client';

import { StorySession, StoryBeat, StoryboardPlan } from '@/lib/types/story';
import { compressImage } from '@/lib/utils/image';
import { callGeminiText, callGeminiImage, type InlineImagePart } from '@/app/actions/gemini-proxy';
import {
  buildPromptCharacterAnchors,
  buildValidationRepairNote,
  formatStoryBible,
  validateGeneratedBeat,
} from '@/lib/ai/story-bible';
import {
  normalizePortraitReferenceConfig,
  deriveVisualStyleSummary,
  getPreludeText,
  normalizeStoryConfig,
} from '@/lib/ai/story-config';
import {
  getDefaultPromptBody,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, IMAGE_QUALITY, PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY, STORYBOARD_MAX_WIDTH, STORYBOARD_MAX_HEIGHT, STORYBOARD_QUALITY } from '@/lib/constants/media';
import type { Character, PortraitReferenceConfig, PortraitReferenceMode } from '@/lib/types/story';

function runtimeNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function timeRuntimeStep<T>(
  scope: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = runtimeNowMs();
  try {
    const result = await fn();
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(runtimeNowMs() - startedAt),
      success: true,
      ...meta,
    });
    return result;
  } catch (error) {
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(runtimeNowMs() - startedAt),
      success: false,
      ...meta,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export interface StoryModelOverrides {
  storyModel?: string;
  storyTemperature?: number;
  // Legacy fields kept for compatibility with admin config payloads.
  composerModel?: string;
  composerTemperature?: number;
  imageModel?: string;
  portraitModel?: string;
  storyPrompt?: string;
  visualPrompt?: string;
  imagePrompt?: string;
  portraitPrompt?: string;
  enableStoryboard?: boolean;
}

interface CharacterReferenceGenerationOptions {
  mode: PortraitReferenceMode;
  quality: PortraitReferenceConfig['quality'];
}

export async function generateStoryBeat(
  userPrompt: string,
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string,
  modelOverrides?: StoryModelOverrides
): Promise<StoryBeat> {
  const beatNumber = (sessionState?.currentBeat || 0) + 1;
  const normalizedSessionState = sessionState
    ? {
        ...sessionState,
        storyConfig: normalizeStoryConfig(sessionState.storyConfig),
        visualStyle: sessionState.visualStyle || deriveVisualStyleSummary(sessionState.storyConfig?.visualSettings),
      }
    : null;

  if (userPrompt.toLowerCase() === 'mock') {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const isFirstBeat = !normalizedSessionState?.beats || normalizedSessionState.beats.length === 0;

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
        newCharacterIds: ['char_monkey', 'char_elephant'],
        changedCharacterIds: [],
      };
    }

    return {
      title: 'The Monkey and the Mountain Giant',
      beatNumber: (normalizedSessionState?.currentBeat || 1) + 1,
      isEnding: true,
      storyText: "The giant rock slowly opened one eye, then let out a deep, rumbling laugh that shook the leaves from the trees. 'Little monkey,' Bhoora the elephant chuckled, 'I am no rock, but I make an excellent climbing frame.' Miko grinned, realizing he had just made the biggest friend in the forest.",
      sceneSummary: 'The elephant wakes up and befriends the monkey.',
      options: [],
      characters: normalizedSessionState?.characters || [],
      continuityNotes: ['Miko and Bhoora are now friends.'],
      imagePrompt: "Cinematic children's storybook illustration of a small golden-brown monkey sitting happily on the head of a large soft-grey elephant, misty mountain forest path, morning light, whimsical, emotionally warm, highly detailed, consistent character design, soft painterly style.",
      clues: ['Friendship comes in all sizes.'],
      nextBeatGoal: 'Conclude the story with a heartwarming friendship.',
      endingForecast: ['friendship'],
      newCharacterIds: [],
      changedCharacterIds: [],
    };
  }

  const lang = normalizedSessionState?.storyConfig?.language || 'english';
  const storyTemplateCandidate = modelOverrides?.storyPrompt || getDefaultPromptBody('story_generation');
  const storyTemplate = validatePromptTemplate('story_generation', storyTemplateCandidate).isValid
    ? storyTemplateCandidate
    : getDefaultPromptBody('story_generation');
  const basePrompt = resolvePromptTemplate(storyTemplate, {
    language: lang,
    userPrompt,
    storyConfig: formatStoryConfig(normalizedSessionState),
    storyState: formatStoryState(normalizedSessionState, selectedOptionLabel),
    selectedOptionLabel: selectedOptionLabel || 'None yet - first beat',
  });

  try {
    const generateAttempt = async (repairNote?: string): Promise<StoryBeat> => timeRuntimeStep(
      'story_runtime.generate_story_beat.attempt',
      {
        beatNumber,
        hasRepairNote: Boolean(repairNote),
        language: lang,
      },
      async () => {
        const text = await callGeminiText({
          task: 'story_generation',
          model: modelOverrides?.storyModel || 'gemini-3.1-pro-preview',
          prompt: repairNote ? `${basePrompt}\n\nQuality Repair Note:\n${repairNote}` : basePrompt,
          temperature: modelOverrides?.storyTemperature ?? 0.7,
        });
        try {
          return JSON.parse(text) as StoryBeat;
        } catch {
          throw new Error(`Failed to parse story beat JSON: ${text.slice(0, 200)}`);
        }
      }
    );

    let beat = await generateAttempt();
    const issues = validateGeneratedBeat(beat, normalizedSessionState);

    if (issues.length > 0) {
      console.info('[timing:story_runtime.generate_story_beat.validation_retry]', {
        beatNumber,
        issueCount: issues.length,
        issues,
      });
      beat = await generateAttempt(buildValidationRepairNote(issues));
      const retryIssues = validateGeneratedBeat(beat, normalizedSessionState);
      if (retryIssues.length > 0) {
        throw new Error(`Story beat validation failed after retry: ${retryIssues.join('; ')}`);
      }
    }

    return beat;
  } catch (error) {
    console.error('Story beat generation failed:', error);
    throw error;
  }
}

export interface ReferenceImage {
  type: 'character' | 'scene';
  dataUrl?: string;
  url?: string;
}

export async function composeStoryboardPlan(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null,
  visualStyle: string,
  modelOverrides?: StoryModelOverrides
): Promise<StoryboardPlan> {
  return timeRuntimeStep(
    'story_runtime.compose_storyboard_plan',
    {
      beatNumber: beat.beatNumber,
      characterCount: beat.characters.length,
    },
    async () => {
      const composerTemplateCandidate = modelOverrides?.visualPrompt || getDefaultPromptBody('visual_prompt');
      const composerTemplate = validatePromptTemplate('visual_prompt', composerTemplateCandidate).isValid
        ? composerTemplateCandidate
        : getDefaultPromptBody('visual_prompt');
      const previousBeat = sessionState?.beats?.[sessionState.beats.length - 1];
      const prompt = resolvePromptTemplate(composerTemplate, {
        storyText: beat.storyText,
        sceneSummary: beat.sceneSummary,
        imageIntent: beat.imagePrompt,
        characters: buildPromptCharacterAnchors(beat.characters),
        continuityNotes: JSON.stringify((beat.continuityNotes || []).slice(0, 2)),
        visualStyle,
        beatNumber: beat.beatNumber,
        storyState: formatStoryState(sessionState),
        newCharacterIds: JSON.stringify(resolveNewCharacterIds(beat, sessionState)),
        changedCharacterIds: JSON.stringify(resolveChangedCharacterIds(beat)),
        previousStoryboardContext: summarizePreviousStoryboard(previousBeat),
      });

      const text = await callGeminiText({
        task: 'visual_prompt',
        model: modelOverrides?.composerModel || 'gemini-3.1-pro-preview',
        prompt,
        temperature: modelOverrides?.composerTemperature ?? 0.5,
      });

      try {
        return JSON.parse(text) as StoryboardPlan;
      } catch {
        throw new Error(`Failed to parse storyboard plan JSON: ${text.slice(0, 200)}`);
      }
    }
  );
}

export function renderStoryboardPlan(plan: StoryboardPlan): string {
  const frameSections = [
    ['Top Left', plan.topLeft],
    ['Top Right', plan.topRight],
    ['Bottom Left', plan.bottomLeft],
    ['Bottom Right', plan.bottomRight],
  ] as const;

  return [
    'Shared visual invariants:',
    ...plan.sharedVisualInvariants.map((item) => `- ${item}`),
    ...frameSections.flatMap(([label, frame]) => [
      '',
      `${label}:`,
      `Description: ${frame.description}`,
      `Prompt: ${frame.prompt}`,
      `Camera Angle: ${frame.cameraAngle}`,
      `Visual Focus: ${frame.visualFocus.join(', ')}`,
      `Emotion: ${frame.emotion}`,
      `Continuity Anchor: ${frame.continuityAnchor}`,
    ]),
    ...(plan.negativeConstraints.length > 0
      ? ['', 'Negative constraints:', ...plan.negativeConstraints.map((item) => `- ${item}`)]
      : []),
  ].join('\n');
}

function summarizePreviousStoryboard(previousBeat: StoryBeat | undefined): string {
  if (!previousBeat) {
    return 'None yet - first beat';
  }

  return JSON.stringify({
    beatNumber: previousBeat.beatNumber,
    sceneSummary: compactPromptText(previousBeat.sceneSummary, 140),
    continuityNotes: (previousBeat.continuityNotes || []).slice(0, 2),
    imagePromptExcerpt: compactPromptText(previousBeat.imagePrompt, 140),
    storyboardFrames: previousBeat.storyboardPlan
      ? {
          topLeft: compactPromptText(previousBeat.storyboardPlan.topLeft.description, 100),
          topRight: compactPromptText(previousBeat.storyboardPlan.topRight.description, 100),
          bottomLeft: compactPromptText(previousBeat.storyboardPlan.bottomLeft.description, 100),
          bottomRight: compactPromptText(previousBeat.storyboardPlan.bottomRight.description, 100),
        }
      : null,
  });
}

export async function generateImage(
  prompt: string,
  characters: any[],
  visualStyle: string,
  modelOverrides?: StoryModelOverrides,
  referenceImages?: ReferenceImage[],
  beatNumber?: number
): Promise<string> {
  if (
    prompt.includes("Cinematic children's storybook illustration") ||
    characters.some((character) => ['Miko', 'Bhoora'].includes(character.name))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1920/1080?blur=4`;
  }

  try {
    return await timeRuntimeStep(
      'story_runtime.generate_image',
      {
        beatNumber: beatNumber ?? null,
        characterCount: characters.length,
        referenceCount: referenceImages?.length ?? 0,
      },
      async () => {
        const imageTemplateCandidate = modelOverrides?.imagePrompt || getDefaultPromptBody('image_generation');
        const imageTemplate = validatePromptTemplate('image_generation', imageTemplateCandidate).isValid
          ? imageTemplateCandidate
          : getDefaultPromptBody('image_generation');
        const finalImagePrompt = resolvePromptTemplate(imageTemplate, {
          prompt,
          characters: buildPromptCharacterAnchors(characters),
          visualStyle,
          beatNumber,
        });

        const imageModel = modelOverrides?.imageModel || 'gemini-3.1-flash-image-preview';
        const isStoryboard = true;
        const maxW = isStoryboard ? STORYBOARD_MAX_WIDTH  : IMAGE_MAX_WIDTH;
        const maxH = isStoryboard ? STORYBOARD_MAX_HEIGHT : IMAGE_MAX_HEIGHT;
        const qual = isStoryboard ? STORYBOARD_QUALITY    : IMAGE_QUALITY;

        const referenceParts = await resolveReferenceImageParts(referenceImages);
        const imageSize = isStoryboard ? '2K' : '1K';

        const result = await timeRuntimeStep(
          'story_runtime.generate_image.gemini',
          {
            beatNumber: beatNumber ?? null,
            referencePartCount: referenceParts.length,
            hasRetryFallback: false,
          },
          () => callGeminiImage({
            task: 'image_generation',
            model: imageModel,
            prompt: finalImagePrompt,
            referenceParts,
            aspectRatio: '16:9',
            imageSize,
          })
        );

        if (result.dataUrl) {
          return await timeRuntimeStep(
            'story_runtime.generate_image.compress',
            {
              beatNumber: beatNumber ?? null,
              width: maxW,
              height: maxH,
            },
            () => compressImage(result.dataUrl!, maxW, maxH, qual)
          );
        }

        if (result.fallbackText && result.fallbackText !== finalImagePrompt) {
          const retryResult = await timeRuntimeStep(
            'story_runtime.generate_image.gemini_retry',
            {
              beatNumber: beatNumber ?? null,
              referencePartCount: referenceParts.length,
              hasRetryFallback: true,
            },
            () => callGeminiImage({
              task: 'image_generation',
              model: imageModel,
              prompt: result.fallbackText!,
              referenceParts,
              aspectRatio: '16:9',
              imageSize,
            })
          );
          if (retryResult.dataUrl) {
            return await timeRuntimeStep(
              'story_runtime.generate_image.compress',
              {
                beatNumber: beatNumber ?? null,
                width: maxW,
                height: maxH,
                retry: true,
              },
              () => compressImage(retryResult.dataUrl!, maxW, maxH, qual)
            );
          }
        }

        throw new Error('No image generated');
      }
    );
  } catch (error) {
    console.error('Image generation failed:', error);
    return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1920/1080?blur=4`;
  }
}

async function resolveReferenceImageParts(referenceImages?: ReferenceImage[]): Promise<InlineImagePart[]> {
  if (!referenceImages || referenceImages.length === 0) return [];

  return timeRuntimeStep(
    'story_runtime.resolve_reference_parts',
    { referenceCount: referenceImages.length },
    async () => {
      const resolvedDataUrls = await Promise.all(
        referenceImages.map((ref) => resolveReferenceImageDataUrl(ref))
      );

      const parts: InlineImagePart[] = [];
      for (const dataUrl of resolvedDataUrls) {
        if (!dataUrl) continue;
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({ mimeType: match[1], data: match[2] });
        }
      }
      return parts;
    }
  );
}

export async function generateCharacterPortrait(
  character: Character,
  visualStyle: string,
  portraitReferenceConfig: PortraitReferenceConfig,
  modelOverrides?: StoryModelOverrides,
  promptOverride?: string
): Promise<string> {
  try {
    return await timeRuntimeStep(
      'story_runtime.generate_character_portrait',
      {
        characterId: character.id,
        characterName: character.name,
        portraitMode: portraitReferenceConfig.mode,
        portraitQuality: portraitReferenceConfig.quality,
      },
      async () => {
        const normalizedPortraitReferenceConfig = normalizePortraitReferenceConfig(portraitReferenceConfig);
        const referenceLayout = buildPortraitReferenceLayoutDescription(normalizedPortraitReferenceConfig);
        const portraitTemplateCandidate = modelOverrides?.portraitPrompt || getDefaultPromptBody('portrait_generation');
        const portraitTemplate = validatePromptTemplate('portrait_generation', portraitTemplateCandidate).isValid
          ? portraitTemplateCandidate
          : getDefaultPromptBody('portrait_generation');
        const prompt = resolvePromptTemplate(portraitTemplate, {
          characterName: character.name,
          characterAppearance: promptOverride || character.appearanceSummary,
          characterType: character.type,
          visualStyle,
          portraitMode: normalizedPortraitReferenceConfig.mode === 'character_sheet' ? 'character sheet' : 'single portrait',
          referenceQuality: normalizedPortraitReferenceConfig.quality,
          sheetLayout: referenceLayout,
        });

        const portraitModel = modelOverrides?.portraitModel || 'gemini-3.1-flash-image-preview';
        const result = await callGeminiImage({
          task: 'portrait_generation',
          model: portraitModel,
          prompt,
          aspectRatio: '1:1',
          imageSize: normalizedPortraitReferenceConfig.quality === '1K' ? '1K' : '512',
        });

        if (result.dataUrl) {
          return await timeRuntimeStep(
            'story_runtime.generate_character_portrait.compress',
            {
              characterId: character.id,
            },
            () => compressImage(result.dataUrl!, PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY)
          );
        }

        throw new Error('No portrait image generated');
      }
    );
  } catch (error) {
    console.error(`Portrait generation failed for ${character.name}:`, error);
    throw error;
  }
}

function formatStoryConfig(sessionState: Partial<StorySession> | null): string {
  const cfg = normalizeStoryConfig(sessionState?.storyConfig);
  const prelude = getPreludeText(cfg);
  return [
    `- Language: ${cfg.language || 'english'}`,
    `- Age Group: ${cfg.ageGroup}`,
    `- Setting/Country: ${cfg.settingCountry}`,
    `- Maximum Beats: ${cfg.maxBeats}`,
    `- Current Beat: ${((sessionState?.currentBeat || 0) + 1)} of ${cfg.maxBeats}`,
    `- Style Preset: ${cfg.visualSettings.preset}`,
    `- Theme: ${cfg.visualSettings.theme}`,
    `- Palette: ${cfg.visualSettings.palette}`,
    `- Detail: ${cfg.visualSettings.detail}`,
    `- Authoring Mode: ${cfg.authoring.mode}`,
    `- Authored Prelude: ${prelude ? 'present' : 'absent'}`,
    `- Character References: ${cfg.portraitReferences.mode === 'character_sheet' ? 'character sheet' : 'single portrait'}`,
    `- Character Reference Quality: ${cfg.portraitReferences.quality}`,
  ].join('\n');
}

function formatStoryState(
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string
): string {
  return formatStoryBible(sessionState, selectedOptionLabel);
}

function resolveNewCharacterIds(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null
): string[] {
  if ((beat.newCharacterIds || []).length > 0) {
    return beat.newCharacterIds || [];
  }

  if (!sessionState?.beats || sessionState.beats.length === 0) {
    return beat.characters.map((character) => character.id);
  }

  const existingIds = new Set((sessionState.characters || []).map((character) => character.id));
  return beat.characters
    .filter((character) => !existingIds.has(character.id))
    .map((character) => character.id);
}

function resolveChangedCharacterIds(beat: StoryBeat): string[] {
  return beat.changedCharacterIds || [];
}

function compactPromptText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

async function resolveReferenceImageDataUrl(ref: ReferenceImage): Promise<string | null> {
  const candidate = ref.dataUrl || ref.url;
  if (!candidate) return null;
  if (candidate.startsWith('data:')) return candidate;

  const response = await fetch(candidate);
  if (!response.ok) {
    return null;
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function buildPortraitReferenceLayoutDescription(
  portraitReferenceConfig: CharacterReferenceGenerationOptions
): string {
  if (portraitReferenceConfig.mode === 'single_portrait') {
    return 'one clean full-body reference portrait with a clear face, either front-facing or 3/4 view';
  }

  if (portraitReferenceConfig.quality === '1K') {
    return 'a single square character sheet showing the same character in four views: close-up face, front full body, 3/4 full body, and back full body';
  }

  return 'a single square character sheet showing the same character in three views: close-up face, front full body, and 3/4 full body';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read reference image'));
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Reference image reader returned an unexpected result'));
      }
    };
    reader.readAsDataURL(blob);
  });
}
