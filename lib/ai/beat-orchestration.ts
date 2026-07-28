// Beat text + storyboard-plan orchestration, shared by the client runtime
// (app/actions/story-runtime.ts) and the server beat bundle
// (app/actions/beat-bundle.ts). No 'use client'/'use server' directive on
// purpose: the imported server actions (callGeminiText, reel moods) resolve to
// POST references in the browser and to direct calls on the server — the same
// dual behavior story-runtime.ts has always relied on. Keep browser-only APIs
// (canvas, FileReader) out of this module.

import { StorySession, StoryBeat, StoryboardPlan, StoryConfig, type StoryAspectRatio, type StoryTextParts } from '@/lib/types/story';
import type { Character } from '@/lib/types/story';
import type { CompilerEngine, PromptCompilerBeatMetadata } from '@/lib/ai/prompt-compiler/assemble.shared';
import { callGeminiText } from '@/app/actions/gemini-proxy';
import { getPublishedReelMoodsForRuntime } from '@/app/actions/reel-moods';
import {
  buildPromptCharacterAnchors,
  buildValidationRepairNote,
  formatStoryBible,
  validateGeneratedBeat,
} from '@/lib/ai/story-bible';
import {
  deriveVisualStyleSummary,
  getPreludeText,
  getSeedPlan,
  getSeedSourceText,
  isReelStoryConfig,
  normalizeStoryConfig,
} from '@/lib/ai/story-config';
import {
  getDefaultPromptBody,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import {
  STORYBOARD_MAX_WIDTH,
  STORYBOARD_MAX_HEIGHT,
  STORYBOARD_VERTICAL_MAX_WIDTH,
  STORYBOARD_VERTICAL_MAX_HEIGHT,
} from '@/lib/constants/media';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import { DEFAULT_TEXT_MODEL_ID, type TaskKey } from '@/lib/ai/model-config.shared';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  findReelDefiner,
  normalizeReelStorySettings,
  type ReelDefiner,
  type ReelStorySettings,
} from '@/lib/reel/settings';
import { splitTextIntoCompleteCaptionPanels } from '@/lib/reel/captions';
import type { ReelVisualStyleRuntime } from '@/lib/reel/styles';
import type { StoryboardImageQualitySettings } from '@/lib/types/storyboard-settings';

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

export const VERTICAL_STORY_PROMPT_INSTRUCTION = [
  'Create the image in vertical portrait orientation, 9:16 aspect ratio, mobile-first composition, suitable for Instagram Reels, Facebook Reels, and YouTube Shorts.',
  'Keep the subject framed clearly for a phone screen.',
  'Maintain the existing storyboard-style visual composition unless otherwise specified.',
].join(' ');

const STORY_TEXT_PART_COUNT = 4;
const STORY_TEXT_PARTS_PLACEHOLDER = /{{\s*storyTextParts\s*}}/;
const SEED_AUTHORING_CONTEXT_PLACEHOLDER = /{{\s*seedAuthoringContext\s*}}/;

const STORY_TEXT_PARTS_OUTPUT_CONTRACT = [
  'Storyboard narration sync contract:',
  '- Return storyTextParts as exactly 4 non-empty strings.',
  '- The parts must preserve storyText in order and split it into near-equal spoken-duration chunks.',
  '- Do not add labels, numbering, brackets, timing markers, or visible separators to storyText.',
  '- storyTextParts are hidden internal metadata for panel sync only.',
].join('\n');

export interface StoryboardImagePromptOptions {
  aspectRatio?: StoryAspectRatio;
  task?: Extract<TaskKey, 'image_generation' | 'reel_image_generation'>;
  visualStyleDefiner?: string;
  noFaceRule?: string;
  textOverlayMode?: string;
  /** Reference Personalization: compact world continuity anchor for this beat. */
  worldAnchor?: string;
  /**
   * Image prompt compiler: a pre-assembled final prompt (compiled or legacy) that
   * overrides buildFinalStoryboardImagePrompt for this call. The store assembles
   * it (it owns the mode/capability + canonical scene); generateImage just uses it
   * and records the diagnostics. When absent, the legacy assembler is used.
   */
  finalPromptOverride?: {
    finalPrompt: string;
    engine: CompilerEngine;
    compiler?: PromptCompilerBeatMetadata;
  };
}

export function normalizeStoryboardAspectRatio(aspectRatio?: StoryAspectRatio | string | null): StoryAspectRatio {
  return aspectRatio === '9:16' ? '9:16' : '16:9';
}

export function resolveReelVisualStyle(
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

export function describeReelNoFaceRule(noFaceDefault: boolean | undefined): string {
  return noFaceDefault === false
    ? 'Faces may appear only when the beat explicitly needs them; still avoid celebrity likeness and unnecessary close-up portraits.'
    : 'Default to no visible faces: use silhouettes, back views, hands, objects, spaces, symbolic landscapes, and abstract human presence.';
}

export function describeReelTextOverlayMode(storyConfig: StoryConfig): string {
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

export function normalizeStoryTextParts(value: unknown, storyText: string): StoryTextParts {
  return hasUsableStoryTextParts(value)
    ? toStoryTextParts(value)
    : splitStoryTextIntoBalancedParts(storyText);
}

export function normalizeStoryBeatTextParts(beat: StoryBeat): StoryBeat {
  return {
    ...beat,
    storyTextParts: normalizeStoryTextParts(beat.storyTextParts, beat.storyText),
  };
}

export function appendStoryTextPartsOutputContract(prompt: string): string {
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

export function formatSeedAuthoringContext(
  storyConfig: StoryConfig,
  beatOrigin?: StoryBeat['originKind']
): string {
  const normalizedConfig = normalizeStoryConfig(storyConfig);
  if (normalizedConfig.authoring.mode !== 'seeded') {
    return '';
  }

  const sourceFidelity = normalizedConfig.authoring.sourceFidelity || 'strictly_follow';
  return JSON.stringify({
    sourceMode: 'seed_story',
    sourceFidelity,
    strictFollow: sourceFidelity === 'strictly_follow',
    beatOrigin: beatOrigin || 'generated',
    strictCanonicalBeat: sourceFidelity === 'strictly_follow' && beatOrigin === 'seeded_canonical',
    guidanceRole: 'visual_details_only',
    extraVisualGuidance: normalizedConfig.authoring.guidanceText?.trim() || null,
  });
}

function appendSeedAuthoringContextComposerContract(
  prompt: string,
  template: string,
  seedAuthoringContext: string
): string {
  if (!seedAuthoringContext || SEED_AUTHORING_CONTEXT_PLACEHOLDER.test(template)) {
    return prompt;
  }

  return [
    prompt,
    '',
    'Seed Authoring Context:',
    seedAuthoringContext,
    'When strictFollow is true, visualize the authored beat literally. Extra visual guidance may clarify appearance, setting, and world details only; it must not add or reinterpret story events.',
  ].join('\n');
}

export function getStoryboardLayoutHardRequirements(aspectRatio?: StoryAspectRatio | string | null): string {
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

export function getStoryboardMaxDimensions(aspectRatio?: StoryAspectRatio | string | null): { width: number; height: number } {
  return normalizeStoryboardAspectRatio(aspectRatio) === '9:16'
    ? { width: STORYBOARD_VERTICAL_MAX_WIDTH, height: STORYBOARD_VERTICAL_MAX_HEIGHT }
    : { width: STORYBOARD_MAX_WIDTH, height: STORYBOARD_MAX_HEIGHT };
}

function runtimeNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export async function timeRuntimeStep<T>(
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

export function buildFallbackStoryboardPlan(
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
      // Published moods only matter for reel prompts; skip the round-trip otherwise.
      const dbMoodsForCompose = isReel ? await getPublishedReelMoodsForRuntime().catch(() => []) : [];
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
      const seedAuthoringContext = formatSeedAuthoringContext(storyConfig, beat.originKind);
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
        seedAuthoringContext,
      });
      const promptWithTextParts = isReel
        ? resolvedComposerPrompt
        : appendStoryTextPartsComposerContract(resolvedComposerPrompt, composerTemplate, storyTextParts);
      const prompt = isReel
        ? promptWithTextParts
        : appendSeedAuthoringContextComposerContract(
            promptWithTextParts,
            composerTemplate,
            seedAuthoringContext
          );

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

  if (options?.worldAnchor && options.worldAnchor.trim().length > 0) {
    // Kept as a distinct section so it never overrides the style lock: the world
    // reference supplies layout/continuity, the story style wins on rendering.
    promptParts.push(
      `World reference continuity anchor (story style wins over any reference): ${options.worldAnchor.trim()}`
    );
  }

  if (aspectRatio === '9:16') {
    promptParts.push(VERTICAL_STORY_PROMPT_INSTRUCTION);
  }

  promptParts.push(getStoryboardLayoutHardRequirements(aspectRatio));
  return promptParts.join('\n\n');
}

export function summarizePreviousStoryboard(previousBeat: StoryBeat | undefined): string {
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

export function formatStoryConfig(sessionState: Partial<StorySession> | null): string {
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
    `- Extra Visual Guidance: ${cfg.authoring.guidanceText?.trim() ? 'present' : 'absent'}`,
    `- Source Fidelity: ${cfg.authoring.sourceFidelity || 'strictly_follow'}`,
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

export function formatStoryState(
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string
): string {
  return formatStoryBible(sessionState, selectedOptionLabel);
}

export function resolveNewCharacterIds(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null
): string[] {
  // Pack 2: the roster can be pre-seeded before beat 1 (episode carry /
  // library mixing) — seeded characters are never "new", by id or by name,
  // even on the first beat, so their portraits are reused not regenerated.
  const seededCharacters = sessionState?.characters || [];
  const seededIds = new Set(seededCharacters.map((character) => character.id));
  const seededNames = new Set(
    seededCharacters
      .map((character) => character.name?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name))
  );
  const isSeeded = (character: { id: string; name?: string }) =>
    seededIds.has(character.id) || seededNames.has(character.name?.trim().toLowerCase() ?? '');

  if ((beat.newCharacterIds || []).length > 0) {
    return (beat.newCharacterIds || []).filter((characterId) => {
      const character = beat.characters.find((entry) => entry.id === characterId);
      return !character || !isSeeded(character);
    });
  }

  if (!sessionState?.beats || sessionState.beats.length === 0) {
    return beat.characters.filter((character) => !isSeeded(character)).map((character) => character.id);
  }

  return beat.characters
    .filter((character) => !isSeeded(character))
    .map((character) => character.id);
}

export function resolveChangedCharacterIds(beat: StoryBeat): string[] {
  return beat.changedCharacterIds || [];
}

export function compactPromptText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

// Mirrors the client helper in lib/store/story-store.ts (kept there too so the
// legacy path is untouched) — the beat bundle applies it server-side so the
// storyboard plan is composed against the merged roster, exactly like legacy.
export function mergeCharacterVisualReferences(
  beat: StoryBeat,
  referenceCharacters: Character[]
): StoryBeat {
  if (!referenceCharacters.length || !beat.characters.length) {
    return beat;
  }

  const referencesById = new Map(referenceCharacters.map((character) => [character.id, character]));
  // Pack 2 fallback: seeded characters (episode carry / library mixing) keep
  // their ids in castRegistry, but the LLM may still mint new ids on beat 1 —
  // matching by normalized name re-attaches the carried visuals and links.
  const referencesByName = new Map(
    referenceCharacters
      .filter((character) => character.name?.trim())
      .map((character) => [character.name.trim().toLowerCase(), character])
  );
  const nextCharacters = beat.characters.map((character) => {
    const reference =
      referencesById.get(character.id) ??
      referencesByName.get(character.name?.trim().toLowerCase() ?? '');
    if (!reference) {
      return character;
    }

    return {
      ...reference,
      ...character,
      portraitBase64: character.portraitBase64 || reference.portraitBase64,
      portraitUrl: character.portraitUrl || reference.portraitUrl,
      referenceSheetUrl: character.referenceSheetUrl || reference.referenceSheetUrl,
      referenceSheetStorageKey: character.referenceSheetStorageKey || reference.referenceSheetStorageKey,
      referenceSheetUploadedAt: character.referenceSheetUploadedAt || reference.referenceSheetUploadedAt,
      referenceSheetGallery: character.referenceSheetGallery ?? reference.referenceSheetGallery,
    };
  });

  return {
    ...beat,
    characters: nextCharacters,
  };
}

export function withGeneratedOrigin(beat: StoryBeat): StoryBeat {
  if (beat.originKind) {
    return beat;
  }

  return {
    ...beat,
    originKind: 'generated',
  };
}
