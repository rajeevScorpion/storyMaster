'use client';

import { StorySession, StoryBeat, StoryboardPlan, SeedBeatOutline, SeedPlan, SourceFidelity, StoryConfig } from '@/lib/types/story';
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
  getSeedPlan,
  getSeedSourceText,
  normalizeStoryConfig,
} from '@/lib/ai/story-config';
import {
  getDefaultPromptBody,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY, STORYBOARD_MAX_WIDTH, STORYBOARD_MAX_HEIGHT } from '@/lib/constants/media';
import type { Character, PortraitReferenceConfig, PortraitReferenceMode } from '@/lib/types/story';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
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
].join('\n');

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
  seedPlanModel?: string;
  seedPlanTemperature?: number;
  seededBeatModel?: string;
  seededBeatTemperature?: number;
  // Legacy fields kept for compatibility with admin config payloads.
  composerModel?: string;
  composerTemperature?: number;
  imageModel?: string;
  portraitModel?: string;
  storyPrompt?: string;
  seedPlanPrompt?: string;
  seededBeatPrompt?: string;
  visualPrompt?: string;
  imagePrompt?: string;
  portraitPrompt?: string;
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

export interface ReferenceImage {
  type: 'character' | 'scene';
  dataUrl?: string;
  url?: string;
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
  meta: Record<string, unknown>
): Promise<string> {
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
    });
    return sanitizedDataUrl;
  }

  return timeRuntimeStep(
    'story_runtime.generate_image.compress',
    {
      ...meta,
      width: STORYBOARD_MAX_WIDTH,
      height: STORYBOARD_MAX_HEIGHT,
      webpQualityPercent: settings.webpQualityPercent,
    },
    () => compressImage(
      sanitizedDataUrl,
      STORYBOARD_MAX_WIDTH,
      STORYBOARD_MAX_HEIGHT,
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

      let text = '';
      try {
        text = await callGeminiText({
          task: 'visual_prompt',
          model: modelOverrides?.composerModel || 'gemini-3.1-pro-preview',
          prompt,
          temperature: modelOverrides?.composerTemperature ?? 0.5,
          telemetry: costTelemetry,
        });
        return JSON.parse(text) as StoryboardPlan;
      } catch (error) {
        console.error('Storyboard plan composition failed; using fallback storyboard plan:', {
          message: error instanceof Error ? error.message : 'Unknown storyboard plan error',
          responsePreview: text ? text.slice(0, 200) : null,
        });
        return buildFallbackStoryboardPlan(beat, sessionState, visualStyle);
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
  beatNumber?: number,
  costTelemetry?: CostTelemetryContext
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
        const finalImagePrompt = [
          resolvePromptTemplate(imageTemplate, {
            prompt,
            characters: buildPromptCharacterAnchors(characters),
            visualStyle,
            beatNumber,
          }),
          STORYBOARD_LAYOUT_HARD_REQUIREMENTS,
        ].join('\n\n');

        const imageModel = modelOverrides?.imageModel || 'gemini-3.1-flash-image-preview';
        const referenceParts = await resolveReferenceImageParts(referenceImages);
        const storyboardImageSettings = normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings);
        const imageSize = storyboardImageSettings.imageSize;

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
            telemetry: costTelemetry,
          })
        );

        if (result.dataUrl) {
          return await maybeProcessStoryboardImage(
            result.dataUrl,
            storyboardImageSettings,
            {
              beatNumber: beatNumber ?? null,
              imageSize,
            }
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
              prompt: [result.fallbackText!, STORYBOARD_LAYOUT_HARD_REQUIREMENTS].join('\n\n'),
              referenceParts,
              aspectRatio: '16:9',
              imageSize,
              telemetry: costTelemetry,
            })
          );
          if (retryResult.dataUrl) {
            return await maybeProcessStoryboardImage(
              retryResult.dataUrl,
              storyboardImageSettings,
              {
                beatNumber: beatNumber ?? null,
                imageSize,
                retry: true,
              }
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
  promptOverride?: string,
  costTelemetry?: CostTelemetryContext
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
          telemetry: costTelemetry,
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
  const seedSourceText = getSeedSourceText(cfg);
  const seedPlan = getSeedPlan(cfg);
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
    `- Source Text: ${seedSourceText ? 'present' : 'absent'}`,
    `- Source Guidance: ${cfg.authoring.guidanceText?.trim() ? 'present' : 'absent'}`,
    `- Source Fidelity: ${cfg.authoring.sourceFidelity || 'balanced_adaptation'}`,
    `- Canonical Seed Plan: ${seedPlan ? 'present' : 'absent'}`,
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
