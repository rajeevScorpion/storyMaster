'use client';

import { StorySession, StoryBeat, StoryboardPlan, SeedBeatOutline, SeedPlan, SourceFidelity, StoryConfig, type StoryAspectRatio, type StoryTextParts } from '@/lib/types/story';
import { compressImage, sanitizeStoryboardGridImage } from '@/lib/utils/image';
import { callGeminiText, type InlineImagePart } from '@/app/actions/gemini-proxy';
import { generateSelectedImage } from '@/app/actions/image-generation';
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
  REEL_LANGUAGE_OPTIONS,
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
import {
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_TEXT_MODEL_ID,
  type TaskKey,
} from '@/lib/ai/model-config.shared';
import type { ImageModelSelection, ImageModelSnapshot } from '@/lib/ai/image-models.shared';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  findReelDefiner,
  getReelTextLengthRange,
  normalizeReelStorySettings,
  type ReelDefiner,
  type ReelStorySettings,
  type ReelTextLengthWordRange,
} from '@/lib/reel/settings';
import {
  ensureCompleteCaptionSentence,
  hasCompleteCaptionEnding,
  splitTextIntoCompleteCaptionPanels,
} from '@/lib/reel/captions';
import type { ReelVisualStyleRuntime } from '@/lib/reel/styles';
import { getPublishedReelMoodsForRuntime } from '@/app/actions/reel-moods';
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

const STORY_TEXT_PART_COUNT = 4;
const STORY_TEXT_PARTS_PLACEHOLDER = /{{\s*storyTextParts\s*}}/;

const STORY_TEXT_PARTS_OUTPUT_CONTRACT = [
  'Storyboard narration sync contract:',
  '- Return storyTextParts as exactly 4 non-empty strings.',
  '- The parts must preserve storyText in order and split it into near-equal spoken-duration chunks.',
  '- Do not add labels, numbering, brackets, timing markers, or visible separators to storyText.',
  '- storyTextParts are hidden internal metadata for panel sync only.',
].join('\n');

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

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toStoryTextParts(parts: string[]): StoryTextParts {
  return [
    compactWhitespace(parts[0] || ''),
    compactWhitespace(parts[1] || ''),
    compactWhitespace(parts[2] || ''),
    compactWhitespace(parts[3] || ''),
  ];
}

function hasUsableStoryTextParts(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length === STORY_TEXT_PART_COUNT
    && value.every((part) => typeof part === 'string' && compactWhitespace(part).length > 0);
}

function splitStoryTextByWords(storyText: string): StoryTextParts {
  const text = compactWhitespace(storyText);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= STORY_TEXT_PART_COUNT) {
    return toStoryTextParts(Array.from({ length: STORY_TEXT_PART_COUNT }, (_, index) => {
      const start = Math.round((words.length * index) / STORY_TEXT_PART_COUNT);
      const end = Math.round((words.length * (index + 1)) / STORY_TEXT_PART_COUNT);
      return words.slice(start, Math.max(start + 1, end)).join(' ');
    }));
  }

  const chars = Array.from(text);
  if (chars.length === 0) return toStoryTextParts([]);
  return toStoryTextParts(Array.from({ length: STORY_TEXT_PART_COUNT }, (_, index) => {
    const start = Math.round((chars.length * index) / STORY_TEXT_PART_COUNT);
    const end = Math.round((chars.length * (index + 1)) / STORY_TEXT_PART_COUNT);
    return chars.slice(start, Math.max(start + 1, end)).join('');
  }));
}

function splitStoryTextIntoBalancedParts(storyText: string): StoryTextParts {
  const sentencePanels = splitTextIntoCompleteCaptionPanels(storyText, STORY_TEXT_PART_COUNT);
  if (sentencePanels.length === STORY_TEXT_PART_COUNT && sentencePanels.every((part) => compactWhitespace(part))) {
    return toStoryTextParts(sentencePanels);
  }
  return splitStoryTextByWords(storyText);
}

function normalizeStoryTextParts(value: unknown, storyText: string): StoryTextParts {
  return hasUsableStoryTextParts(value)
    ? toStoryTextParts(value)
    : splitStoryTextIntoBalancedParts(storyText);
}

function normalizeStoryBeatTextParts(beat: StoryBeat): StoryBeat {
  return {
    ...beat,
    storyTextParts: normalizeStoryTextParts(beat.storyTextParts, beat.storyText),
  };
}

function appendStoryTextPartsOutputContract(prompt: string): string {
  return `${prompt}\n\n${STORY_TEXT_PARTS_OUTPUT_CONTRACT}`;
}

function appendStoryTextPartsComposerContract(
  prompt: string,
  template: string,
  storyTextParts: StoryTextParts
): string {
  if (STORY_TEXT_PARTS_PLACEHOLDER.test(template)) {
    return prompt;
  }

  return [
    prompt,
    '',
    'Hidden Story Text Parts for storyboard timing:',
    JSON.stringify(storyTextParts),
    'Use part 1 for topLeft, part 2 for topRight, part 3 for bottomLeft, and part 4 for bottomRight.',
  ].join('\n');
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
    model: input.modelOverrides?.seedPlanModel || DEFAULT_TEXT_MODEL_ID,
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
  const basePrompt = appendStoryTextPartsOutputContract(resolvePromptTemplate(materializationTemplate, {
    language: storyConfig.language,
    storyConfig: formatStoryConfig(normalizedSessionState),
    storyState: formatStoryState(normalizedSessionState),
    sourceText: getSeedSourceText(storyConfig),
    guidanceText: storyConfig.authoring.guidanceText || '',
    seedBeat: JSON.stringify(reorderCanonicalOptions(seedBeat)),
  }));

  const generateAttempt = async (repairNote?: string): Promise<StoryBeat> => {
    const text = await callGeminiText({
      task: 'seeded_beat_materialization',
      model: modelOverrides?.seededBeatModel || DEFAULT_TEXT_MODEL_ID,
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

  return normalizeStoryBeatTextParts(beat);
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
  const basePrompt = appendStoryTextPartsOutputContract(resolvePromptTemplate(storyTemplate, {
    language: lang,
    userPrompt,
    storyConfig: formatStoryConfig(normalizedSessionState),
    storyState: formatStoryState(normalizedSessionState, selectedOptionLabel),
    selectedOptionLabel: selectedOptionLabel || 'None yet - first beat',
  }));

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
          model: modelOverrides?.storyModel || DEFAULT_TEXT_MODEL_ID,
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

    return normalizeStoryBeatTextParts(beat);
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

function normalizeReelPanelWordRange(
  value: Partial<ReelTextLengthWordRange> | null | undefined,
  fallback: ReelTextLengthWordRange
): ReelTextLengthWordRange {
  const min = Number(value?.min);
  const max = Number(value?.max);
  const normalizedMin = Number.isFinite(min) ? Math.max(1, Math.min(200, Math.round(min))) : fallback.min;
  const normalizedMax = Number.isFinite(max) ? Math.max(normalizedMin, Math.min(240, Math.round(max))) : fallback.max;
  return { min: normalizedMin, max: normalizedMax };
}

function formatWordRange(range: ReelTextLengthWordRange): string {
  return `${range.min}-${range.max}`;
}

function formatStoryLanguageLabel(language: string | null | undefined): string {
  return REEL_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? 'English';
}

export async function distributeReelTextAction(input: {
  text: string;
  beatCount: 1 | 2 | 3;
  language?: StoryConfig['language'];
  wordsPerPanel?: Partial<ReelTextLengthWordRange>;
}): Promise<{ panelTexts: string[][]; imagePrompts: string[] }> {
  const { text, beatCount } = input;
  const languageLabel = formatStoryLanguageLabel(input.language);
  const panelCount = beatCount * 4;
  const wordsPerPanel = normalizeReelPanelWordRange(
    input.wordsPerPanel,
    DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges.medium
  );
  const prompt = [
    'You are a short-form reel content editor. Distribute the user\'s story text into exactly ' + panelCount + ' short captions — one per image panel — preserving the narrative arc.',
    `Write all panel captions in ${languageLabel}. Preserve names, places, and key meaning from the user text.`,
    `Rules for each caption: target ${formatWordRange(wordsPerPanel)} words, maximum ${wordsPerPanel.max} words.`,
    'Every panel caption must be one or more complete sentences. Never split one sentence across two panels.',
    'If the source sentence is long, rewrite or summarize it into shorter complete sentences instead of cutting it mid-sentence.',
    'End every caption with sentence-final punctuation appropriate to the selected language.',
    'Also write one brief visual scene description per beat (max 40 words), suitable as an AI image generation prompt, describing the setting/mood without referencing text or captions.',
    '',
    'Return ONLY valid JSON with this exact shape (no markdown, no explanation):',
    '{ "panels": string[][], "imagePrompts": string[] }',
    'Where panels[beatIndex][0..3] are the 4 captions for that beat, and imagePrompts[beatIndex] is the scene description for that beat.',
    '',
    `beats: ${beatCount}, panels per beat: 4`,
    '',
    "User's story text:",
    '"""',
    text.trim(),
    '"""',
  ].join('\n');

  const raw = await callGeminiText({
    task: 'reel_story_generation',
    model: DEFAULT_TEXT_MODEL_ID,
    prompt,
    temperature: 0.5,
  });

  let parsed: { panels?: unknown; imagePrompts?: unknown };
  try {
    parsed = JSON.parse(raw) as { panels?: unknown; imagePrompts?: unknown };
  } catch {
    throw new Error(`distributeReelTextAction: failed to parse JSON: ${raw.slice(0, 200)}`);
  }

  const panels: string[][] = Array.isArray(parsed?.panels)
    ? (parsed.panels as unknown[]).map((beat) =>
        Array.isArray(beat)
          ? (beat as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
          : []
      )
    : Array.from({ length: beatCount }, () => []);

  const imagePrompts: string[] = Array.isArray(parsed?.imagePrompts)
    ? (parsed.imagePrompts as unknown[]).map((t) => String(t ?? '').trim())
    : Array.from({ length: beatCount }, () => '');

  while (panels.length < beatCount) panels.push([]);
  while (imagePrompts.length < beatCount) imagePrompts.push('');

  return {
    panelTexts: panels.slice(0, beatCount).map((beatPanels) => {
      const sentenceSafePanels = splitTextIntoCompleteCaptionPanels(beatPanels.join(' '), 4);
      return Array.from({ length: 4 }, (_, index) => (
        sentenceSafePanels[index]
        || (hasCompleteCaptionEnding(beatPanels[index] || '')
          ? ensureCompleteCaptionSentence(beatPanels[index] || '')
          : '')
      ));
    }),
    imagePrompts: imagePrompts.slice(0, beatCount),
  };
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

  const beatCount = normalizedConfig.reel.beatCount;

  if (normalizedConfig.authoring.mode === 'user_text') {
    const panelTexts = normalizedConfig.authoring.reelPanelTexts ?? [];
    const imagePrompts = normalizedConfig.authoring.reelImagePrompts ?? [];
    return Array.from({ length: beatCount }, (_, index) => ({
      title: `Beat ${index + 1}`,
      beatNumber: index + 1,
      isEnding: index + 1 === beatCount,
      storyText: ensureCompleteCaptionSentence((panelTexts[index] ?? []).join(' ')),
      sceneSummary: imagePrompts[index] ?? '',
      options: [],
      characters: [],
      continuityNotes: [],
      imagePrompt: imagePrompts[index] ?? '',
      clues: [],
      nextBeatGoal: '',
      endingForecast: [],
      newCharacterIds: [],
      changedCharacterIds: [],
    }));
  }

  const lang = normalizedConfig.language || 'english';
  const languageLabel = formatStoryLanguageLabel(lang);
  const reelSettings = normalizeReelStorySettings(modelOverrides?.reelSettings ?? DEFAULT_REEL_STORY_SETTINGS);
  const dbMoodsForDraft = await getPublishedReelMoodsForRuntime().catch(() => []);
  const dbMoodForDraft = dbMoodsForDraft.find((m) => m.slug === normalizedConfig.reel.moodKey);
  const reelMood = dbMoodForDraft
    ? { key: dbMoodForDraft.slug, label: dbMoodForDraft.name, prompt: dbMoodForDraft.promptDefiner }
    : findReelDefiner(reelSettings.moods, normalizedConfig.reel.moodKey);
  const reelVisualStyle = resolveReelVisualStyle(modelOverrides, reelSettings, normalizedConfig);
  const reelNarrationStyle = findReelDefiner(reelSettings.narrationStyles, normalizedConfig.reel.narrationStyleKey);
  const textLengthRange = getReelTextLengthRange(reelSettings, normalizedConfig.reel.textLength);
  const reelPanelCount = reelSettings.panelCount;
  const textLengthWordRangePerPanel = formatWordRange(textLengthRange);
  const textLengthWordRangePerBeat = `${textLengthRange.min * reelPanelCount}-${textLengthRange.max * reelPanelCount}`;

  const templateCandidate = modelOverrides?.reelStoryPrompt || getDefaultPromptBody('reel_story_generation');
  const template = validatePromptTemplate('reel_story_generation', templateCandidate).isValid
    ? templateCandidate
    : getDefaultPromptBody('reel_story_generation');

  const resolvedPrompt = resolvePromptTemplate(template, {
    language: languageLabel,
    userPrompt,
    reelBeatCount: beatCount,
    reelPanelCount,
    textLength: normalizedConfig.reel.textLength,
    textLengthWordRange: textLengthWordRangePerPanel,
    textLengthWordRangePerPanel,
    textLengthWordRangePerBeat,
    textOverlayMode: describeReelTextOverlayMode(normalizedConfig),
    moodDefiner: `${reelMood.label}: ${reelMood.prompt}`,
    visualStyleDefiner: `${reelVisualStyle.label}: ${reelVisualStyle.prompt}`,
    narrationStyleDefiner: `${reelNarrationStyle.label}: ${reelNarrationStyle.prompt}`,
  });
  const prompt = [
    `Critical reel text budget: "${normalizedConfig.reel.textLength}" means ${textLengthWordRangePerPanel} words per visual panel. Each beat will be split into ${reelPanelCount} panels, so every beat.storyText must be about ${textLengthWordRangePerBeat} words total. Do not collapse a beat into a single short line unless that total word budget permits it.`,
    `Critical sentence rule: every visual panel must receive complete sentences only. Write each beat.storyText as sentence-complete units in ${languageLabel}; never rely on splitting one sentence across panels. If a thought is long, rewrite it into shorter complete sentences with language-appropriate sentence-final punctuation.`,
    resolvedPrompt,
  ].join('\n\n');

  const text = await timeRuntimeStep(
    'story_runtime.generate_reel_draft',
    { beatCount, language: lang },
    () => callGeminiText({
      task: 'reel_story_generation',
      model: modelOverrides?.reelStoryModel || modelOverrides?.storyModel || DEFAULT_TEXT_MODEL_ID,
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
      storyText: ensureCompleteCaptionSentence(draft?.storyText || ''),
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
  imageModelSnapshot?: ImageModelSnapshot;
  imageGenerationMetadata?: Record<string, unknown>;
}

export interface GeneratedPortraitResult {
  imageUrl: string;
  finalPromptText: string;
  imageModelSnapshot?: ImageModelSnapshot;
  imageGenerationMetadata?: Record<string, unknown>;
}

function buildFallbackStoryboardPlan(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null,
  visualStyle: string
): StoryboardPlan {
  const scene = compactPromptText(beat.sceneSummary || beat.imagePrompt || beat.storyText, 220);
  const imageIntent = compactPromptText(beat.imagePrompt || beat.sceneSummary || beat.storyText, 260);
  const characterAnchors = compactPromptText(buildPromptCharacterAnchors(beat.characters), 700);
  const storyTextParts = normalizeStoryTextParts(beat.storyTextParts, beat.storyText)
    .map((part) => compactPromptText(part, 180));
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
      `Opening storyboard moment aligned to narration part 1: ${storyTextParts[0] || scene}`,
      'wide establishing shot',
      'anticipation',
      ['setting', 'main characters', 'opening action']
    ),
    topRight: makeFrame(
      `Second storyboard moment aligned to narration part 2: ${storyTextParts[1] || scene}`,
      'medium character shot',
      'discovery',
      ['character reaction', 'relationship', 'story tension']
    ),
    bottomLeft: makeFrame(
      `Third storyboard moment aligned to narration part 3: ${storyTextParts[2] || scene}`,
      'dynamic close-up',
      'focus',
      ['key action', 'hands or faces', 'turning point']
    ),
    bottomRight: makeFrame(
      `Final storyboard moment aligned to narration part 4: ${storyTextParts[3] || scene}`,
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
      const dbMoodsForCompose = await getPublishedReelMoodsForRuntime().catch(() => []);
      const dbMoodForCompose = dbMoodsForCompose.find((m) => m.slug === storyConfig.reel.moodKey);
      const reelMood = dbMoodForCompose
        ? { key: dbMoodForCompose.slug, label: dbMoodForCompose.name, prompt: dbMoodForCompose.promptDefiner }
        : findReelDefiner(reelSettings.moods, storyConfig.reel.moodKey);
      const reelVisualStyle = resolveReelVisualStyle(modelOverrides, reelSettings, storyConfig);
      const composerTemplateCandidate = isReel
        ? modelOverrides?.reelVisualPrompt || getDefaultPromptBody('reel_visual_prompt')
        : modelOverrides?.visualPrompt || getDefaultPromptBody('visual_prompt');
      const composerTemplate = validatePromptTemplate(promptTask, composerTemplateCandidate).isValid
        ? composerTemplateCandidate
        : getDefaultPromptBody(promptTask);
      const previousBeat = sessionState?.beats?.[sessionState.beats.length - 1];
      const storyTextParts = normalizeStoryTextParts(beat.storyTextParts, beat.storyText);
      const resolvedComposerPrompt = resolvePromptTemplate(composerTemplate, {
        storyText: beat.storyText,
        storyTextParts: JSON.stringify(storyTextParts),
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
      const prompt = isReel
        ? resolvedComposerPrompt
        : appendStoryTextPartsComposerContract(resolvedComposerPrompt, composerTemplate, storyTextParts);

      let text = '';
      try {
        text = await callGeminiText({
          task: promptTask,
          model: isReel
            ? modelOverrides?.reelComposerModel || modelOverrides?.composerModel || DEFAULT_TEXT_MODEL_ID
            : modelOverrides?.composerModel || DEFAULT_TEXT_MODEL_ID,
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
    storyTextParts: normalizeStoryTextParts(generatedBeat.storyTextParts, normalizedSeedBeat.storyText),
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
    storyConfig?: StoryConfig;
  } = {}
): StoryBeat['reelCaptions'] {
  const beatIndex = beat.beatNumber - 1;
  const userPanelTexts = options.storyConfig?.authoring.mode === 'user_text'
    ? options.storyConfig.authoring.reelPanelTexts?.[beatIndex]
    : undefined;

  if (userPanelTexts && userPanelTexts.length >= 4) {
    const sentenceSafePanels = splitTextIntoCompleteCaptionPanels(userPanelTexts.join(' '), 4);
    return Array.from({ length: 4 }, (_, panelIndex) => ({
      panelIndex,
      text: ensureCompleteCaptionSentence(
        sentenceSafePanels[panelIndex]
        || (hasCompleteCaptionEnding(userPanelTexts[panelIndex] || '') ? userPanelTexts[panelIndex] : '')
      ),
    }));
  }

  const frameDescriptions = [
    plan.topLeft.description,
    plan.topRight.description,
    plan.bottomLeft.description,
    plan.bottomRight.description,
  ];
  const storyChunks = splitTextIntoCompleteCaptionPanels(beat.storyText, 4);

  return frameDescriptions.map((description, panelIndex) => ({
    panelIndex,
    text: ensureCompleteCaptionSentence(storyChunks[panelIndex] || description || beat.sceneSummary || beat.title),
  }));
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
  imagePromptOptions: Omit<StoryboardImagePromptOptions, 'aspectRatio' | 'task'> = {},
  imageModelSelection?: ImageModelSelection | null
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
      imageGenerationMetadata: {
        placeholder: true,
        reason: 'mock_prompt',
      },
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
          ? modelOverrides?.reelImageModel || modelOverrides?.imageModel || DEFAULT_IMAGE_MODEL_ID
          : modelOverrides?.imageModel || DEFAULT_IMAGE_MODEL_ID;
        const selection = imageModelSelection ?? {
          taskKey: imageTask,
          modelKey: imageModel,
        };
        const referenceParts = await resolveReferenceImageParts(referenceImages);
        const storyboardImageSettings = normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings);
        const imageSize = storyboardImageSettings.imageSize;

        const result = await timeRuntimeStep(
          'story_runtime.generate_image.provider',
          {
            beatNumber: beatNumber ?? null,
            referencePartCount: referenceParts.length,
            hasRetryFallback: false,
            aspectRatio: resolvedAspectRatio,
          },
          () => generateSelectedImage({
            task: imageTask,
            prompt: finalImagePrompt,
            referenceParts,
            aspectRatio: resolvedAspectRatio,
            imageSize,
            telemetry: costTelemetry,
            selection,
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
            imageModelSnapshot: result.modelSnapshot,
            imageGenerationMetadata: {
              ...result.metadata,
              imageModelSnapshot: result.modelSnapshot,
              referenceCount: referenceParts.length,
              aspectRatio: resolvedAspectRatio,
              imageSize,
            },
          };
        }

        if (result.fallbackText && result.fallbackText !== finalImagePrompt) {
          const retryPrompt = [
            result.fallbackText,
            ...(resolvedAspectRatio === '9:16' ? [VERTICAL_STORY_PROMPT_INSTRUCTION] : []),
            getStoryboardLayoutHardRequirements(resolvedAspectRatio),
          ].join('\n\n');
          const retryResult = await timeRuntimeStep(
              'story_runtime.generate_image.provider_retry',
              {
                beatNumber: beatNumber ?? null,
                referencePartCount: referenceParts.length,
                hasRetryFallback: true,
                aspectRatio: resolvedAspectRatio,
              },
              () => generateSelectedImage({
                task: imageTask,
                prompt: retryPrompt,
                referenceParts,
                aspectRatio: resolvedAspectRatio,
                imageSize,
                telemetry: costTelemetry,
                selection,
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
              imageModelSnapshot: retryResult.modelSnapshot,
              imageGenerationMetadata: {
                ...retryResult.metadata,
                imageModelSnapshot: retryResult.modelSnapshot,
                referenceCount: referenceParts.length,
                aspectRatio: resolvedAspectRatio,
                imageSize,
                retry: true,
              },
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
      imageGenerationMetadata: {
        placeholder: true,
        reason: error instanceof Error ? error.message : 'image_generation_failed',
      },
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
  costTelemetry?: CostTelemetryContext,
  imageModelSelection?: ImageModelSelection | null
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

        const portraitModel = modelOverrides?.portraitModel || DEFAULT_IMAGE_MODEL_ID;
        const result = await generateSelectedImage({
          task: 'portrait_generation',
          prompt,
          aspectRatio: '1:1',
          imageSize: normalizedPortraitReferenceConfig.quality === '1K' ? '1K' : '512',
          telemetry: costTelemetry,
          selection: imageModelSelection ?? {
            taskKey: 'portrait_generation',
            modelKey: portraitModel,
          },
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
            imageModelSnapshot: result.modelSnapshot,
            imageGenerationMetadata: {
              ...result.metadata,
              imageModelSnapshot: result.modelSnapshot,
              aspectRatio: '1:1',
              imageSize: normalizedPortraitReferenceConfig.quality === '1K' ? '1K' : '512',
            },
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
          `- Reel Narration Preset Id: ${cfg.reel.narrationSettings.presetId || 'none'}`,
          `- Reel Narration Voice: ${cfg.reel.narrationSettings.voiceId}`,
          `- Reel Narration Language: ${cfg.reel.narrationSettings.language}`,
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
