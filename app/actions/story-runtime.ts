'use client';

import { StorySession, StoryBeat, StoryboardPlan, SeedBeatOutline, SeedPlan, SourceFidelity, StoryConfig, type StoryAspectRatio } from '@/lib/types/story';
import { compressImage, sanitizeStoryboardGridImage } from '@/lib/utils/image';
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
  isReelStoryConfig,
  getSeedPlan,
  getSeedSourceText,
  normalizeStoryConfig,
} from '@/lib/ai/story-config';
import {
  getDefaultPromptBody,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import {
  PORTRAIT_MAX_WIDTH,
  PORTRAIT_MAX_HEIGHT,
  PORTRAIT_QUALITY,
  STORYBOARD_MAX_WIDTH,
  STORYBOARD_MAX_HEIGHT,
  STORYBOARD_VERTICAL_MAX_WIDTH,
  STORYBOARD_VERTICAL_MAX_HEIGHT,
} from '@/lib/constants/media';
import type { Character, PortraitReferenceConfig, PortraitReferenceMode } from '@/lib/types/story';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { TaskKey } from '@/lib/ai/model-config.shared';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  findReelDefiner,
  getReelTextLengthRange,
  normalizeReelStorySettings,
  type ReelDefiner,
  type ReelStorySettings,
} from '@/lib/reel/settings';
import type { ReelVisualStyleRuntime } from '@/lib/reel/styles';
import {
  normalizeStoryboardImageQualitySettings,
  type StoryboardImageQualitySettings,
} from '@/lib/types/storyboard-settings';

const STORYBOARD_LAYOUT_HARD_REQUIREMENTS = [
  'Storyboard layout hard requirements:',
  '- Output a full-bleed 16:9 image containing exactly four equal panels in a 2x2 grid.',
  '- Panels must touch the thin dark dividers directly; no white, cream, transparent, or empty gutters.',
  '- Do not add outer padding, matting, margins, rounded frames, poster borders, page borders, or whitespace around the grid.',
  '- Use only thin dark divider lines between panels; if dividers are visible, they must be black or near-black.',
  '- Each panel artwork must fill its full quadrant edge-to-edge.',
  '- Never duplicate a named character unless the story brief explicitly requires multiple copies of that same character.',
  '- If a named character is absent from a panel, omit them instead of cloning them into the composition.',
  '- Preserve one-to-one identity for every named character across all four panels.',
].join('\n');

const STORYBOARD_LAYOUT_COMMON_REQUIREMENTS = [
  '- Panels must touch the thin dark dividers directly; no white, cream, transparent, or empty gutters.',
  '- Do not add outer padding, matting, margins, rounded frames, poster borders, page borders, or whitespace around the grid.',
  '- Use only thin dark divider lines between panels; if dividers are visible, they must be black or near-black.',
  '- Each panel artwork must fill its full quadrant edge-to-edge.',
  '- Never duplicate a named character unless the story brief explicitly requires multiple copies of that same character.',
  '- If a named character is absent from a panel, omit them instead of cloning them into the composition.',
  '- Preserve one-to-one identity for every named character across all four panels.',
].join('\n');

const VERTICAL_STORY_PROMPT_INSTRUCTION = [
  'Create the image in vertical portrait orientation, 9:16 aspect ratio, mobile-first composition, suitable for Instagram Reels, Facebook Reels, and YouTube Shorts.',
  'Keep the subject framed clearly for a phone screen.',
  'Maintain the existing storyboard-style visual composition unless otherwise specified.',
].join(' ');

interface StoryboardImagePromptOptions {
  aspectRatio?: StoryAspectRatio;
  task?: Extract<TaskKey, 'image_generation' | 'reel_image_generation'>;
  visualStyleDefiner?: string;
  noFaceRule?: string;
  textOverlayMode?: string;
}

function normalizeStoryboardAspectRatio(aspectRatio?: StoryAspectRatio | string | null): StoryAspectRatio {
  return aspectRatio === '9:16' ? '9:16' : '16:9';
}

function resolveReelVisualStyle(
  modelOverrides: StoryModelOverrides | undefined,
  settings: ReelStorySettings,
  storyConfig: StoryConfig
): ReelDefiner & { id?: string; noFaceDefault?: boolean } {
  const selectedId = storyConfig.reel.visualStyleId;
  const selectedKey = storyConfig.reel.visualStyleKey;
  const tableStyle = modelOverrides?.reelVisualStyles?.find((style) => (
    style.id === selectedId || style.slug === selectedKey
  ));
  if (tableStyle) {
    return {
      id: tableStyle.id,
      key: tableStyle.slug,
      label: tableStyle.name,
      prompt: tableStyle.promptDefiner,
      noFaceDefault: tableStyle.noFaceDefault,
    };
  }

  return {
    ...findReelDefiner(settings.visualStyles, selectedKey),
    noFaceDefault: true,
  };
}

function describeReelNoFaceRule(noFaceDefault: boolean | undefined): string {
  return noFaceDefault === false
    ? 'Faces may appear only when the beat explicitly needs them; still avoid celebrity likeness and unnecessary close-up portraits.'
    : 'Default to no visible faces: use silhouettes, back views, hands, objects, spaces, symbolic landscapes, and abstract human presence.';
}

function describeReelTextOverlayMode(storyConfig: StoryConfig): string {
  return storyConfig.reel.textOverlayEnabled
    ? 'Visible overlay text is rendered by the player/export layer; reserve clean space and do not place text inside the generated image.'
    : 'Overlay text is hidden for this reel; narration still runs, and generated images must still contain no text.';
}

function getStoryboardLayoutHardRequirements(aspectRatio?: StoryAspectRatio | string | null): string {
  const resolvedAspectRatio = normalizeStoryboardAspectRatio(aspectRatio);
  if (resolvedAspectRatio === '16:9') {
    return STORYBOARD_LAYOUT_HARD_REQUIREMENTS;
  }

  return [
    'Storyboard layout hard requirements:',
    '- Output a full-bleed 9:16 vertical portrait image containing exactly four equal panels in a 2x2 storyboard grid.',
    STORYBOARD_LAYOUT_COMMON_REQUIREMENTS,
  ].join('\n');
}

function getStoryboardMaxDimensions(aspectRatio?: StoryAspectRatio | string | null): { width: number; height: number } {
  return normalizeStoryboardAspectRatio(aspectRatio) === '9:16'
    ? { width: STORYBOARD_VERTICAL_MAX_WIDTH, height: STORYBOARD_VERTICAL_MAX_HEIGHT }
    : { width: STORYBOARD_MAX_WIDTH, height: STORYBOARD_MAX_HEIGHT };
}

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
  reelStoryModel?: string;
  reelStoryTemperature?: number;
  seedPlanModel?: string;
  seedPlanTemperature?: number;
  seededBeatModel?: string;
  seededBeatTemperature?: number;
  // Legacy fields kept for compatibility with admin config payloads.
  composerModel?: string;
  composerTemperature?: number;
  reelComposerModel?: string;
  reelComposerTemperature?: number;
  imageModel?: string;
  reelImageModel?: string;
  portraitModel?: string;
  storyPrompt?: string;
  reelStoryPrompt?: string;
  seedPlanPrompt?: string;
  seededBeatPrompt?: string;
  visualPrompt?: string;
  reelVisualPrompt?: string;
  imagePrompt?: string;
  reelImagePrompt?: string;
  portraitPrompt?: string;
  reelSettings?: ReelStorySettings;
  reelVisualStyles?: ReelVisualStyleRuntime[];
  storyboardImageSettings?: StoryboardImageQualitySettings;
  // Storyboard is now always on. Keep the field as a no-op for older payload shapes.
  enableStoryboard?: boolean;
}

export interface SeedPlanPreviewInput {
  storyConfig: StoryConfig;
  sourceText: string;
  beatCount: number;
  workingTitle?: string;
  guidanceText?: string;
  sourceFidelity?: SourceFidelity;
  modelOverrides?: StoryModelOverrides;
  costTelemetry?: CostTelemetryContext;
}

export async function generateSeedPlanPreview(input: SeedPlanPreviewInput): Promise<SeedPlan> {
  const storyConfig = normalizeStoryConfig({
    ...input.storyConfig,
    authoring: {
      mode: 'seeded',
      workingTitle: input.workingTitle,
      sourceText: input.sourceText,
      guidanceText: input.guidanceText,
      sourceFidelity: input.sourceFidelity,
    },
  });
  const seedPlanTemplateCandidate = input.modelOverrides?.seedPlanPrompt || getDefaultPromptBody('seed_plan_generation');
  const seedPlanTemplate = validatePromptTemplate('seed_plan_generation', seedPlanTemplateCandidate).isValid
    ? seedPlanTemplateCandidate
    : getDefaultPromptBody('seed_plan_generation');
  const prompt = resolvePromptTemplate(seedPlanTemplate, {
    language: storyConfig.language,
    storyConfig: formatStoryConfig({ storyConfig, currentBeat: 0 }),
    workingTitle: storyConfig.authoring.workingTitle || '',
    sourceFidelity: storyConfig.authoring.sourceFidelity || 'balanced_adaptation',
    guidanceText: storyConfig.authoring.guidanceText || '',
    sourceText: storyConfig.authoring.sourceText || '',
    beatCount: input.beatCount,
  });

  const text = await callGeminiText({
    task: 'seed_plan_generation',
    model: input.modelOverrides?.seedPlanModel || 'gemini-3.1-pro-preview',
    prompt,
    temperature: input.modelOverrides?.seedPlanTemperature ?? 0.3,
    telemetry: input.costTelemetry,
  });

  let parsed: SeedPlan;
  try {
    parsed = JSON.parse(text) as SeedPlan;
  } catch {
    throw new Error(`Failed to parse seed plan JSON: ${text.slice(0, 200)}`);
  }

  const normalizedPlan = normalizeSeedPlanResult(parsed, storyConfig);
  if (normalizedPlan.beats.length !== input.beatCount) {
    throw new Error(`Seed plan returned ${normalizedPlan.beats.length} beats, expected ${input.beatCount}.`);
  }

  return normalizedPlan;
}

export async function materializeSeededBeat(
  seedBeat: SeedBeatOutline,
  sessionState: Partial<StorySession> | null,
  modelOverrides?: StoryModelOverrides,
  costTelemetry?: CostTelemetryContext
): Promise<StoryBeat> {
  const normalizedSessionState = sessionState
    ? {
        ...sessionState,
        storyConfig: normalizeStoryConfig(sessionState.storyConfig),
        visualStyle: sessionState.visualStyle || deriveVisualStyleSummary(sessionState.storyConfig?.visualSettings),
      }
    : null;
  const storyConfig = normalizeStoryConfig(normalizedSessionState?.storyConfig);
  const materializationTemplateCandidate = modelOverrides?.seededBeatPrompt || getDefaultPromptBody('seeded_beat_materialization');
  const materializationTemplate = validatePromptTemplate('seeded_beat_materialization', materializationTemplateCandidate).isValid
    ? materializationTemplateCandidate
    : getDefaultPromptBody('seeded_beat_materialization');
  const basePrompt = resolvePromptTemplate(materializationTemplate, {
    language: storyConfig.language,
    storyConfig: formatStoryConfig(normalizedSessionState),
    storyState: formatStoryState(normalizedSessionState),
    sourceText: getSeedSourceText(storyConfig),
    guidanceText: storyConfig.authoring.guidanceText || '',
    seedBeat: JSON.stringify(reorderCanonicalOptions(seedBeat)),
  });

  const generateAttempt = async (repairNote?: string): Promise<StoryBeat> => {
    const text = await callGeminiText({
      task: 'seeded_beat_materialization',
      model: modelOverrides?.seededBeatModel || 'gemini-3.1-pro-preview',
      prompt: repairNote ? `${basePrompt}\n\nQuality Repair Note:\n${repairNote}` : basePrompt,
      temperature: modelOverrides?.seededBeatTemperature ?? 0.4,
      telemetry: costTelemetry,
    });

    try {
      return mergeSeededBeatWithGeneratedFields(seedBeat, JSON.parse(text) as StoryBeat);
    } catch {
      throw new Error(`Failed to parse seeded beat JSON: ${text.slice(0, 200)}`);
    }
  };

  let beat = await generateAttempt();
  const issues = validateGeneratedBeat(beat, normalizedSessionState);
  if (issues.length > 0) {
    beat = await generateAttempt(buildValidationRepairNote(issues));
    const retryIssues = validateGeneratedBeat(beat, normalizedSessionState);
    if (retryIssues.length > 0) {
      throw new Error(`Seeded beat validation failed after retry: ${retryIssues.join('; ')}`);
    }
  }

  return beat;
}

interface CharacterReferenceGenerationOptions {
  mode: PortraitReferenceMode;
  quality: PortraitReferenceConfig['quality'];
}

export async function generateStoryBeat(
  userPrompt: string,
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string,
  modelOverrides?: StoryModelOverrides,
  costTelemetry?: CostTelemetryContext
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
  const storyConfig = normalizeStoryConfig(normalizedSessionState?.storyConfig);
  if (isReelStoryConfig(storyConfig)) {
    throw new Error('generateStoryBeat must not be called for reel sessions; use generateReelDraft instead.');
  }
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
          telemetry: costTelemetry,
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

export interface ReelDraftBeatOutput {
  beatIndex: number;
  title: string;
  storyText: string;
  sceneSummary: string;
  imagePrompt: string;
}

export interface ReelDraftResponse {
  beatCount: number;
  beats: ReelDraftBeatOutput[];
}

export async function generateReelDraft(
  userPrompt: string,
  storyConfig: StoryConfig,
  modelOverrides?: StoryModelOverrides,
  costTelemetry?: CostTelemetryContext
): Promise<StoryBeat[]> {
  const normalizedConfig = normalizeStoryConfig(storyConfig);
  if (!isReelStoryConfig(normalizedConfig)) {
    throw new Error('generateReelDraft requires a reel storyConfig.');
  }

  const lang = normalizedConfig.language || 'english';
  const reelSettings = normalizeReelStorySettings(modelOverrides?.reelSettings ?? DEFAULT_REEL_STORY_SETTINGS);
  const reelMood = findReelDefiner(reelSettings.moods, normalizedConfig.reel.moodKey);
  const reelVisualStyle = resolveReelVisualStyle(modelOverrides, reelSettings, normalizedConfig);
  const reelNarrationStyle = findReelDefiner(reelSettings.narrationStyles, normalizedConfig.reel.narrationStyleKey);
  const textLengthRange = getReelTextLengthRange(reelSettings, normalizedConfig.reel.textLength);
  const beatCount = normalizedConfig.reel.beatCount;

  const templateCandidate = modelOverrides?.reelStoryPrompt || getDefaultPromptBody('reel_story_generation');
  const template = validatePromptTemplate('reel_story_generation', templateCandidate).isValid
    ? templateCandidate
    : getDefaultPromptBody('reel_story_generation');

  const prompt = resolvePromptTemplate(template, {
    language: lang,
    userPrompt,
    reelBeatCount: beatCount,
    textLength: normalizedConfig.reel.textLength,
    textLengthWordRange: `${textLengthRange.min}-${textLengthRange.max}`,
    textOverlayMode: describeReelTextOverlayMode(normalizedConfig),
    moodDefiner: `${reelMood.label}: ${reelMood.prompt}`,
    visualStyleDefiner: `${reelVisualStyle.label}: ${reelVisualStyle.prompt}`,
    narrationStyleDefiner: `${reelNarrationStyle.label}: ${reelNarrationStyle.prompt}`,
  });

  const text = await timeRuntimeStep(
    'story_runtime.generate_reel_draft',
    { beatCount, language: lang },
    () => callGeminiText({
      task: 'reel_story_generation',
      model: modelOverrides?.reelStoryModel || modelOverrides?.storyModel || 'gemini-3.1-pro-preview',
      prompt,
      temperature: modelOverrides?.reelStoryTemperature ?? modelOverrides?.storyTemperature ?? 0.7,
      telemetry: costTelemetry,
    })
  );

  let parsed: ReelDraftResponse;
  try {
    parsed = JSON.parse(text) as ReelDraftResponse;
  } catch {
    throw new Error(`Failed to parse reel draft JSON: ${text.slice(0, 200)}`);
  }

  const draftBeats = Array.isArray(parsed?.beats) ? parsed.beats : [];
  if (draftBeats.length !== beatCount) {
    throw new Error(`Reel draft returned ${draftBeats.length} beats; expected ${beatCount}.`);
  }

  return draftBeats.map((draft, index) => {
    const beatNumber = Number.isFinite(draft?.beatIndex) ? Number(draft.beatIndex) : index + 1;
    return {
      title: (draft?.title || `Beat ${beatNumber}`).trim(),
      beatNumber,
      isEnding: beatNumber === beatCount,
      storyText: (draft?.storyText || '').trim(),
      sceneSummary: (draft?.sceneSummary || '').trim(),
      options: [],
      characters: [],
      continuityNotes: [],
      imagePrompt: (draft?.imagePrompt || '').trim(),
      clues: [],
      nextBeatGoal: '',
      endingForecast: [],
      newCharacterIds: [],
      changedCharacterIds: [],
    };
  });
}

export interface ReferenceImage {
  type: 'character' | 'scene';
  dataUrl?: string;
  url?: string;
}

export interface GeneratedImageResult {
  imageUrl: string;
  finalPromptText: string;
}

export interface GeneratedPortraitResult {
  imageUrl: string;
  finalPromptText: string;
}

function buildFallbackStoryboardPlan(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null,
  visualStyle: string
): StoryboardPlan {
  const scene = compactPromptText(beat.sceneSummary || beat.imagePrompt || beat.storyText, 220);
  const imageIntent = compactPromptText(beat.imagePrompt || beat.sceneSummary || beat.storyText, 260);
  const characterAnchors = compactPromptText(buildPromptCharacterAnchors(beat.characters), 700);
  const sharedPrompt = [
    imageIntent,
    `Scene: ${scene}`,
    `Characters: ${characterAnchors}`,
    `Visual style: ${visualStyle}`,
    'No text, captions, speech bubbles, logos, or watermarks.',
  ].join('\n');

  const makeFrame = (
    description: string,
    cameraAngle: string,
    emotion: string,
    focus: string[]
  ) => ({
    description,
    prompt: `${sharedPrompt}\nPanel moment: ${description}\nCamera: ${cameraAngle}.`,
    cameraAngle,
    visualFocus: focus,
    emotion,
    continuityAnchor: scene,
  });

  const newCharacterIds = new Set(resolveNewCharacterIds(beat, sessionState));
  const changedCharacterIds = new Set(resolveChangedCharacterIds(beat));

  return {
    sharedVisualInvariants: [
      scene,
      'Maintain the same character identities, clothing, proportions, colors, and visual style across all four panels.',
      'Use a full-bleed four-panel 2x2 storyboard composition in reading order with no outer padding or white gutters.',
    ],
    portraitTasks: beat.characters
      .filter((character) => newCharacterIds.has(character.id) || changedCharacterIds.has(character.id))
      .map((character) => ({
        characterId: character.id,
        characterName: character.name,
        reason: changedCharacterIds.has(character.id) ? 'visual_change' as const : 'new_character' as const,
        prompt: [
          `${character.name}, ${character.type}.`,
          character.appearanceSummary,
          `Personality: ${character.personalitySummary}.`,
          `Reference style: ${visualStyle}.`,
          'Single-character reference, clean background, no text.',
        ].join(' '),
      })),
    topLeft: makeFrame(
      `Opening establishing moment for the beat: ${scene}`,
      'wide establishing shot',
      'anticipation',
      ['setting', 'main characters', 'opening action']
    ),
    topRight: makeFrame(
      `The characters notice or react to the central situation: ${scene}`,
      'medium character shot',
      'discovery',
      ['character reaction', 'relationship', 'story tension']
    ),
    bottomLeft: makeFrame(
      `The main action or choice in the beat becomes clear: ${scene}`,
      'dynamic close-up',
      'focus',
      ['key action', 'hands or faces', 'turning point']
    ),
    bottomRight: makeFrame(
      `The emotional result or reveal of the beat lands: ${scene}`,
      'cinematic payoff shot',
      'resolution',
      ['emotional payoff', 'consequence', 'next-story hook']
    ),
    negativeConstraints: [
      'no captions',
      'no text overlays',
      'no speech bubbles',
      'no logos',
      'no watermarks',
      'no character redesign',
      'no white gutters, cream gutters, empty gaps, outer margins, matting, or page-like borders between or around panels',
    ],
  };
}

async function maybeProcessStoryboardImage(
  dataUrl: string,
  settings: StoryboardImageQualitySettings,
  meta: Record<string, unknown>,
  aspectRatio: StoryAspectRatio = '16:9'
): Promise<string> {
  const dimensions = getStoryboardMaxDimensions(aspectRatio);
  const sanitizedDataUrl = await timeRuntimeStep(
    'story_runtime.generate_image.sanitize_storyboard_grid',
    meta,
    () => sanitizeStoryboardGridImage(dataUrl)
  ).catch((error) => {
    console.warn('Storyboard grid cleanup failed; using original image:', error);
    return dataUrl;
  });

  if (!settings.clientProcessingEnabled || !settings.webpCompressionEnabled) {
    console.info('[timing:story_runtime.generate_image.process]', {
      ...meta,
      skipped: true,
      reason: !settings.clientProcessingEnabled ? 'client_processing_disabled' : 'webp_compression_disabled',
      aspectRatio,
    });
    return sanitizedDataUrl;
  }

  return timeRuntimeStep(
    'story_runtime.generate_image.compress',
    {
      ...meta,
      width: dimensions.width,
      height: dimensions.height,
      webpQualityPercent: settings.webpQualityPercent,
      aspectRatio,
    },
    () => compressImage(
      sanitizedDataUrl,
      dimensions.width,
      dimensions.height,
      settings.webpQualityPercent / 100
    )
  );
}

export async function composeStoryboardPlan(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null,
  visualStyle: string,
  modelOverrides?: StoryModelOverrides,
  costTelemetry?: CostTelemetryContext
): Promise<StoryboardPlan> {
  return timeRuntimeStep(
    'story_runtime.compose_storyboard_plan',
    {
      beatNumber: beat.beatNumber,
      characterCount: beat.characters.length,
    },
    async () => {
      const storyConfig = normalizeStoryConfig(sessionState?.storyConfig);
      const isReel = isReelStoryConfig(storyConfig);
      const promptTask = isReel ? 'reel_visual_prompt' : 'visual_prompt';
      const reelSettings = normalizeReelStorySettings(modelOverrides?.reelSettings ?? DEFAULT_REEL_STORY_SETTINGS);
      const reelMood = findReelDefiner(reelSettings.moods, storyConfig.reel.moodKey);
      const reelVisualStyle = resolveReelVisualStyle(modelOverrides, reelSettings, storyConfig);
      const composerTemplateCandidate = isReel
        ? modelOverrides?.reelVisualPrompt || getDefaultPromptBody('reel_visual_prompt')
        : modelOverrides?.visualPrompt || getDefaultPromptBody('visual_prompt');
      const composerTemplate = validatePromptTemplate(promptTask, composerTemplateCandidate).isValid
        ? composerTemplateCandidate
        : getDefaultPromptBody(promptTask);
      const previousBeat = sessionState?.beats?.[sessionState.beats.length - 1];
      const prompt = resolvePromptTemplate(composerTemplate, {
        storyText: beat.storyText,
        sceneSummary: beat.sceneSummary,
        imageIntent: beat.imagePrompt,
        characters: buildPromptCharacterAnchors(beat.characters),
        continuityNotes: JSON.stringify((beat.continuityNotes || []).slice(0, 2)),
        visualStyle,
        moodDefiner: `${reelMood.label}: ${reelMood.prompt}`,
        visualStyleDefiner: `${reelVisualStyle.label}: ${reelVisualStyle.prompt}`,
        noFaceRule: describeReelNoFaceRule(reelVisualStyle.noFaceDefault),
        textOverlayMode: describeReelTextOverlayMode(storyConfig),
        beatNumber: beat.beatNumber,
        storyState: formatStoryState(sessionState),
        newCharacterIds: JSON.stringify(resolveNewCharacterIds(beat, sessionState)),
        changedCharacterIds: JSON.stringify(resolveChangedCharacterIds(beat)),
        previousStoryboardContext: summarizePreviousStoryboard(previousBeat),
      });

      let text = '';
      try {
        text = await callGeminiText({
          task: promptTask,
          model: isReel
            ? modelOverrides?.reelComposerModel || modelOverrides?.composerModel || 'gemini-3.1-pro-preview'
            : modelOverrides?.composerModel || 'gemini-3.1-pro-preview',
          prompt,
          temperature: isReel
            ? modelOverrides?.reelComposerTemperature ?? modelOverrides?.composerTemperature ?? 0.5
            : modelOverrides?.composerTemperature ?? 0.5,
          telemetry: costTelemetry,
        });
        const parsedPlan = JSON.parse(text) as StoryboardPlan;
        if (isReel) {
          parsedPlan.portraitTasks = [];
        }
        return parsedPlan;
      } catch (error) {
        console.error('Storyboard plan composition failed; using fallback storyboard plan:', {
          message: error instanceof Error ? error.message : 'Unknown storyboard plan error',
          responsePreview: text ? text.slice(0, 200) : null,
        });
        const fallback = buildFallbackStoryboardPlan(beat, sessionState, visualStyle);
        if (isReel) {
          fallback.portraitTasks = [];
        }
        return fallback;
      }
    }
  );
}

function mergeSeededBeatWithGeneratedFields(seedBeat: SeedBeatOutline, generatedBeat: StoryBeat): StoryBeat {
  const normalizedSeedBeat = reorderCanonicalOptions(seedBeat);
  const canonicalOptionId = normalizedSeedBeat.isEnding
    ? undefined
    : normalizedSeedBeat.options.find((option) => option.isCanonical)?.id ?? normalizedSeedBeat.options[0]?.id;

  return {
    ...generatedBeat,
    title: normalizedSeedBeat.title,
    beatNumber: normalizedSeedBeat.beatIndex,
    isEnding: normalizedSeedBeat.isEnding,
    storyText: normalizedSeedBeat.storyText,
    sceneSummary: normalizedSeedBeat.sceneSummary,
    options: normalizedSeedBeat.isEnding
      ? []
      : normalizedSeedBeat.options.map((option) => ({
          id: option.id,
          label: option.label,
          intent: option.intent,
        })),
    originKind: 'seeded_canonical',
    seedPlanBeatIndex: normalizedSeedBeat.beatIndex,
    canonicalOptionId,
  };
}

function normalizeSeedPlanResult(plan: SeedPlan, storyConfig: StoryConfig): SeedPlan {
  const normalizedConfig = normalizeStoryConfig({
    ...storyConfig,
    authoring: {
      ...storyConfig.authoring,
      mode: 'seeded',
      seedPlan: plan,
    },
  });
  const normalizedPlan = getSeedPlan(normalizedConfig);
  if (!normalizedPlan) {
    throw new Error('Seed plan generation returned an invalid plan.');
  }

  const beats = normalizedPlan.beats.map(reorderCanonicalOptions);
  if (beats.some((beat) => !beat.isEnding && beat.options.length !== 3)) {
    throw new Error('Seed plan generation must return exactly 3 options for each non-ending beat.');
  }
  if (beats.some((beat, index) => beat.beatIndex !== index + 1)) {
    throw new Error('Seed plan beat indexes must be sequential starting from 1.');
  }
  if (!beats[beats.length - 1]?.isEnding) {
    throw new Error('The final seed-plan beat must be marked as an ending.');
  }

  return {
    beatCount: beats.length,
    beats,
  };
}

function reorderCanonicalOptions(seedBeat: SeedBeatOutline): SeedBeatOutline {
  if (seedBeat.isEnding) {
    return {
      ...seedBeat,
      options: [],
    };
  }

  const canonicalIndex = seedBeat.options.findIndex((option) => option.isCanonical);
  const resolvedCanonicalIndex = canonicalIndex === -1 ? 0 : canonicalIndex;
  const canonical = seedBeat.options[resolvedCanonicalIndex];
  const alternates = seedBeat.options.filter((_, index) => index !== resolvedCanonicalIndex);

  return {
    ...seedBeat,
    options: [canonical, ...alternates].slice(0, 3).map((option, index) => ({
      ...option,
      isCanonical: index === 0,
    })),
  };
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

export function buildReelPanelCaptions(
  beat: StoryBeat,
  plan: StoryboardPlan,
  options: {
    textLength?: StoryConfig['reel']['textLength'];
    reelSettings?: ReelStorySettings;
  } = {}
): StoryBeat['reelCaptions'] {
  const frameDescriptions = [
    plan.topLeft.description,
    plan.topRight.description,
    plan.bottomLeft.description,
    plan.bottomRight.description,
  ];
  const settings = normalizeReelStorySettings(options.reelSettings ?? DEFAULT_REEL_STORY_SETTINGS);
  const range = getReelTextLengthRange(settings, options.textLength ?? settings.defaultTextLength);
  const storyChunks = splitCaptionText(beat.storyText, 4, range.max);

  return frameDescriptions.map((description, panelIndex) => ({
    panelIndex,
    text: cleanCaptionText(storyChunks[panelIndex] || description || beat.sceneSummary || beat.title),
  }));
}

function splitCaptionText(value: string, count: number, maxWordsPerChunk?: number): string[] {
  const sentences = value
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentences.length >= count) {
    return sentences.slice(0, count - 1)
      .concat(sentences.slice(count - 1).join(' '))
      .map((chunk) => capWords(chunk, maxWordsPerChunk));
  }

  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const idealChunkSize = Math.max(1, Math.ceil(words.length / count));
  const chunkSize = maxWordsPerChunk ? Math.min(idealChunkSize, maxWordsPerChunk) : idealChunkSize;
  const chunks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = words.slice(index * chunkSize, (index + 1) * chunkSize).join(' ');
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function capWords(value: string, maxWords?: number): string {
  if (!maxWords) return value;
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(' ')}...`;
}

function cleanCaptionText(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117).trimEnd()}...`;
}

export function buildFinalStoryboardImagePrompt(
  prompt: string,
  characters: Character[],
  visualStyle: string,
  beatNumber: number | undefined,
  modelOverrides?: StoryModelOverrides,
  options?: StoryboardImagePromptOptions
): string {
  const aspectRatio = normalizeStoryboardAspectRatio(options?.aspectRatio);
  const imageTask = options?.task ?? 'image_generation';
  const imageTemplateCandidate = imageTask === 'reel_image_generation'
    ? modelOverrides?.reelImagePrompt || getDefaultPromptBody('reel_image_generation')
    : modelOverrides?.imagePrompt || getDefaultPromptBody('image_generation');
  const imageTemplate = validatePromptTemplate(imageTask, imageTemplateCandidate).isValid
    ? imageTemplateCandidate
    : getDefaultPromptBody(imageTask);

  const promptParts = [
    resolvePromptTemplate(imageTemplate, {
      prompt,
      characters: buildPromptCharacterAnchors(characters),
      visualStyle,
      visualStyleDefiner: options?.visualStyleDefiner || visualStyle,
      noFaceRule: options?.noFaceRule || 'No extra no-face rule supplied.',
      textOverlayMode: options?.textOverlayMode || 'Do not generate any text inside the image.',
      beatNumber,
    }),
  ];

  if (aspectRatio === '9:16') {
    promptParts.push(VERTICAL_STORY_PROMPT_INSTRUCTION);
  }

  promptParts.push(getStoryboardLayoutHardRequirements(aspectRatio));
  return promptParts.join('\n\n');
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
  characters: Character[],
  visualStyle: string,
  modelOverrides?: StoryModelOverrides,
  referenceImages?: ReferenceImage[],
  beatNumber?: number,
  costTelemetry?: CostTelemetryContext,
  aspectRatio: StoryAspectRatio = '16:9',
  imageTask: Extract<TaskKey, 'image_generation' | 'reel_image_generation'> = 'image_generation',
  imagePromptOptions: Omit<StoryboardImagePromptOptions, 'aspectRatio' | 'task'> = {}
): Promise<GeneratedImageResult> {
  const resolvedAspectRatio = normalizeStoryboardAspectRatio(aspectRatio);
  const finalImagePrompt = buildFinalStoryboardImagePrompt(
    prompt,
    characters,
    visualStyle,
    beatNumber,
    modelOverrides,
    { aspectRatio: resolvedAspectRatio, task: imageTask, ...imagePromptOptions }
  );
  const fallbackSize = resolvedAspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };

  if (
    prompt.includes("Cinematic children's storybook illustration") ||
    characters.some((character) => ['Miko', 'Bhoora'].includes(character.name))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return {
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/${fallbackSize.width}/${fallbackSize.height}?blur=4`,
      finalPromptText: finalImagePrompt,
    };
  }

  try {
    return await timeRuntimeStep(
      'story_runtime.generate_image',
      {
        beatNumber: beatNumber ?? null,
        characterCount: characters.length,
        referenceCount: referenceImages?.length ?? 0,
        aspectRatio: resolvedAspectRatio,
      },
      async () => {
        const imageModel = imageTask === 'reel_image_generation'
          ? modelOverrides?.reelImageModel || modelOverrides?.imageModel || 'gemini-3.1-flash-image-preview'
          : modelOverrides?.imageModel || 'gemini-3.1-flash-image-preview';
        const referenceParts = await resolveReferenceImageParts(referenceImages);
        const storyboardImageSettings = normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings);
        const imageSize = storyboardImageSettings.imageSize;

        const result = await timeRuntimeStep(
          'story_runtime.generate_image.gemini',
          {
            beatNumber: beatNumber ?? null,
            referencePartCount: referenceParts.length,
            hasRetryFallback: false,
            aspectRatio: resolvedAspectRatio,
          },
          () => callGeminiImage({
            task: imageTask,
            model: imageModel,
            prompt: finalImagePrompt,
            referenceParts,
            aspectRatio: resolvedAspectRatio,
            imageSize,
            telemetry: costTelemetry,
          })
        );

        if (result.dataUrl) {
          const imageUrl = await maybeProcessStoryboardImage(
            result.dataUrl,
            storyboardImageSettings,
            {
              beatNumber: beatNumber ?? null,
              imageSize,
              aspectRatio: resolvedAspectRatio,
            },
            resolvedAspectRatio
          );
          return {
            imageUrl,
            finalPromptText: finalImagePrompt,
          };
        }

        if (result.fallbackText && result.fallbackText !== finalImagePrompt) {
          const retryPrompt = [
            result.fallbackText,
            ...(resolvedAspectRatio === '9:16' ? [VERTICAL_STORY_PROMPT_INSTRUCTION] : []),
            getStoryboardLayoutHardRequirements(resolvedAspectRatio),
          ].join('\n\n');
          const retryResult = await timeRuntimeStep(
            'story_runtime.generate_image.gemini_retry',
            {
              beatNumber: beatNumber ?? null,
              referencePartCount: referenceParts.length,
              hasRetryFallback: true,
              aspectRatio: resolvedAspectRatio,
            },
            () => callGeminiImage({
              task: imageTask,
              model: imageModel,
              prompt: retryPrompt,
              referenceParts,
              aspectRatio: resolvedAspectRatio,
              imageSize,
              telemetry: costTelemetry,
            })
          );
          if (retryResult.dataUrl) {
            const imageUrl = await maybeProcessStoryboardImage(
              retryResult.dataUrl,
              storyboardImageSettings,
              {
                beatNumber: beatNumber ?? null,
                imageSize,
                retry: true,
                aspectRatio: resolvedAspectRatio,
              },
              resolvedAspectRatio
            );
            return {
              imageUrl,
              finalPromptText: retryPrompt,
            };
          }
        }

        throw new Error('No image generated');
      }
    );
  } catch (error) {
    console.error('Image generation failed:', error);
    return {
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/${fallbackSize.width}/${fallbackSize.height}?blur=4`,
      finalPromptText: finalImagePrompt,
    };
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
  promptOverride?: string,
  costTelemetry?: CostTelemetryContext
): Promise<GeneratedPortraitResult> {
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
        const prompt = buildFinalPortraitPrompt(
          character,
          visualStyle,
          normalizedPortraitReferenceConfig,
          modelOverrides,
          promptOverride
        );

        const portraitModel = modelOverrides?.portraitModel || 'gemini-3.1-flash-image-preview';
        const result = await callGeminiImage({
          task: 'portrait_generation',
          model: portraitModel,
          prompt,
          aspectRatio: '1:1',
          imageSize: normalizedPortraitReferenceConfig.quality === '1K' ? '1K' : '512',
          telemetry: costTelemetry,
        });

        if (result.dataUrl) {
          const imageUrl = await timeRuntimeStep(
            'story_runtime.generate_character_portrait.compress',
            {
              characterId: character.id,
            },
            () => compressImage(result.dataUrl!, PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY)
          );
          return {
            imageUrl,
            finalPromptText: prompt,
          };
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
  const seedSourceText = getSeedSourceText(cfg);
  const seedPlan = getSeedPlan(cfg);
  return [
    `- Story Kind: ${cfg.storyKind}`,
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
    `- Source Text: ${seedSourceText ? 'present' : 'absent'}`,
    `- Source Guidance: ${cfg.authoring.guidanceText?.trim() ? 'present' : 'absent'}`,
    `- Source Fidelity: ${cfg.authoring.sourceFidelity || 'balanced_adaptation'}`,
    `- Canonical Seed Plan: ${seedPlan ? 'present' : 'absent'}`,
    `- Authored Prelude: ${prelude ? 'present' : 'absent'}`,
    `- Character References: ${cfg.portraitReferences.mode === 'character_sheet' ? 'character sheet' : 'single portrait'}`,
    `- Character Reference Quality: ${cfg.portraitReferences.quality}`,
    ...(cfg.storyKind === 'reel'
      ? [
          `- Reel Length: ${cfg.reel.length}`,
          `- Reel Beat Count: ${cfg.reel.beatCount}`,
          `- Reel Text Length: ${cfg.reel.textLength}`,
          `- Reel Text Overlay: ${cfg.reel.textOverlayEnabled ? 'on' : 'off'}`,
          `- Reel Mood Key: ${cfg.reel.moodKey}`,
          `- Reel Visual Style Key: ${cfg.reel.visualStyleKey}`,
          `- Reel Visual Style Id: ${cfg.reel.visualStyleId || 'none'}`,
          `- Reel Narration Style Key: ${cfg.reel.narrationStyleKey}`,
          '- Reel Orientation: 9:16',
          '- Reel Storyboard Panels Per Beat: 4',
        ]
      : []),
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

export function buildFinalPortraitPrompt(
  character: Character,
  visualStyle: string,
  portraitReferenceConfig: PortraitReferenceConfig,
  modelOverrides?: StoryModelOverrides,
  promptOverride?: string
): string {
  const normalizedPortraitReferenceConfig = normalizePortraitReferenceConfig(portraitReferenceConfig);
  const referenceLayout = buildPortraitReferenceLayoutDescription(normalizedPortraitReferenceConfig);
  const portraitTemplateCandidate = modelOverrides?.portraitPrompt || getDefaultPromptBody('portrait_generation');
  const portraitTemplate = validatePromptTemplate('portrait_generation', portraitTemplateCandidate).isValid
    ? portraitTemplateCandidate
    : getDefaultPromptBody('portrait_generation');

  return resolvePromptTemplate(portraitTemplate, {
    characterName: character.name,
    characterAppearance: promptOverride || character.appearanceSummary,
    characterType: character.type,
    visualStyle,
    portraitMode: normalizedPortraitReferenceConfig.mode === 'character_sheet' ? 'character sheet' : 'single portrait',
    referenceQuality: normalizedPortraitReferenceConfig.quality,
    sheetLayout: referenceLayout,
  });
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
