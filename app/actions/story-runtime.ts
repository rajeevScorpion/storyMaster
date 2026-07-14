'use client';

import { StorySession, StoryBeat, StoryboardPlan, SeedBeatOutline, SeedPlan, SourceFidelity, StoryConfig, type StoryAspectRatio, type StoryTextParts } from '@/lib/types/story';
import { compressImage, sanitizeStoryboardGridImage } from '@/lib/utils/image';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
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
import { buildFinalPortraitPrompt } from '@/lib/ai/portrait-prompt.shared';
import {
  PORTRAIT_MAX_WIDTH,
  PORTRAIT_MAX_HEIGHT,
  PORTRAIT_QUALITY,
  STORYBOARD_MAX_WIDTH,
  STORYBOARD_MAX_HEIGHT,
  STORYBOARD_VERTICAL_MAX_WIDTH,
  STORYBOARD_VERTICAL_MAX_HEIGHT,
} from '@/lib/constants/media';
import type { Character, PortraitReferenceConfig } from '@/lib/types/story';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type {
  ImageContinuityProviderState,
  ImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
import {
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_TEXT_MODEL_ID,
  type TaskKey,
} from '@/lib/ai/model-config.shared';
import type { ImageModelSelection, ImageModelSnapshot } from '@/lib/ai/image-models.shared';
import { persistInlineBeatImageAction } from '@/app/actions/media-persist';
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

// Text-side orchestration (beat generation, storyboard planning, prompt
// formatting) lives in lib/ai/beat-orchestration.ts so the server beat bundle
// can call it directly. This module keeps the browser-side pieces (canvas
// image processing, portraits, reels) and re-exports the moved API so
// existing imports keep working.
import {
  appendStoryTextPartsOutputContract,
  buildFinalStoryboardImagePrompt,
  describeReelNoFaceRule,
  describeReelTextOverlayMode,
  formatStoryConfig,
  formatStoryState,
  getStoryboardLayoutHardRequirements,
  getStoryboardMaxDimensions,
  normalizeStoryboardAspectRatio,
  normalizeStoryBeatTextParts,
  normalizeStoryTextParts,
  resolveReelVisualStyle,
  timeRuntimeStep,
  VERTICAL_STORY_PROMPT_INSTRUCTION,
  type StoryboardImagePromptOptions,
  type StoryModelOverrides,
} from '@/lib/ai/beat-orchestration';

export {
  buildFinalStoryboardImagePrompt,
  composeStoryboardPlan,
  generateStoryBeat,
  renderStoryboardPlan,
} from '@/lib/ai/beat-orchestration';
export type { StoryModelOverrides, StoryboardImagePromptOptions } from '@/lib/ai/beat-orchestration';

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

export interface ImageContinuityRuntimeOptions {
  requestedStrategy: ImageContinuityStrategy;
  previousState?: ImageContinuityProviderState | null;
  allowRuntimeFallback?: boolean;
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
  imageModelSelection?: ImageModelSelection | null,
  imageContinuity?: ImageContinuityRuntimeOptions | null,
  // persistTarget: inline flows pass the saved story/node so the generated
  // image is stored server-side (private original + variants) instead of
  // relying on the browser to upload it later. All gating (admin setting,
  // processing mode, ownership, R2 availability) happens server-side.
  persistOptions?: {
    persistTarget?: { storyId: string; nodeId: string };
  }
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
            continuity: imageContinuity ?? null,
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
          return finalizeInlineImageResult(
            {
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
            },
            persistOptions?.persistTarget
          );
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
                continuity: imageContinuity ?? null,
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
            return finalizeInlineImageResult(
              {
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
              },
              persistOptions?.persistTarget
            );
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

/** When an inline flow supplied a persist target, store the generated image
 *  server-side (private original + variants) and hand the client a signed
 *  display URL instead of multi-MB base64. Falls back to the base64 result
 *  whenever the pipeline declines (legacy mode, setting off, R2 down). */
async function finalizeInlineImageResult(
  result: GeneratedImageResult,
  persistTarget?: { storyId: string; nodeId: string }
): Promise<GeneratedImageResult> {
  if (!persistTarget || !result.imageUrl.startsWith('data:')) return result;
  const persisted = await persistInlineBeatImageAction({
    dataUrl: result.imageUrl,
    storyId: persistTarget.storyId,
    nodeId: persistTarget.nodeId,
  }).catch((error) => {
    console.error('Inline image persist action failed:', error);
    return null;
  });
  if (!persisted) return result;
  return {
    ...result,
    imageUrl: persisted.signedDisplayUrl,
    imageGenerationMetadata: {
      ...(result.imageGenerationMetadata ?? {}),
      persisted: true,
      persistedReference: persisted.displayReference,
      mediaGroupId: persisted.mediaGroupId,
      processingMode: 'server_pipeline',
    },
  };
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
        const parsed = splitBase64DataUrl(dataUrl);
        if (parsed) {
          parts.push({ mimeType: parsed.mimeType, data: parsed.base64 });
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
  imageModelSelection?: ImageModelSelection | null,
  imageContinuity?: ImageContinuityRuntimeOptions | null
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
          continuity: imageContinuity ?? null,
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
