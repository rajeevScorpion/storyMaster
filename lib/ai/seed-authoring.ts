// Seed-authoring orchestration (seed plan preview generation, seeded-beat
// materialization), shared by the client runtime (app/actions/story-runtime.ts,
// which re-exports this module's API so existing imports keep working) and
// Phase 6 agentic story generation, which calls these functions directly with
// no cookie session. No 'use client'/'use server' directive on purpose: the
// imported server actions (text calls) resolve to POST references in the
// browser and to direct calls on the server — the same dual behavior
// story-runtime.ts has always relied on. Keep browser-only APIs (canvas,
// FileReader) out of this module.

import { StorySession, StoryBeat, SeedBeatOutline, SeedPlan, SourceFidelity, StoryConfig } from '@/lib/types/story';
import { callTextModelForReader } from '@/lib/ai/text-gateway/reader-call';
import {
  assessGeneratedBeatLength,
  buildValidationRepairNote,
  validateGeneratedBeat,
} from '@/lib/ai/story-bible';
import {
  deriveVisualStyleSummary,
  getSeedPlan,
  getSeedSourceText,
  normalizeStoryConfig,
} from '@/lib/ai/story-config';
import {
  getDefaultPromptBody,
  resolvePromptTemplate,
  validatePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import { splitStrictSeedSource } from '@/lib/ai/strict-seed-segmentation';
import { applyCharacterNameProvenance } from '@/lib/ai/character-novelty.shared';
import {
  SEED_GUIDANCE_WORD_CAP,
  SEED_SOURCE_WORD_CAP,
  countAuthoringWords,
} from '@/lib/story/authoring-limits';
import { DEFAULT_TEXT_MODEL_ID } from '@/lib/ai/model-config.shared';
import {
  appendNarrativeVisualBoundaryContract,
  appendStoryTextPartsOutputContract,
  formatNarrativeStoryConfig,
  formatNarrativeStoryState,
  normalizeStoryBeatTextParts,
  normalizeStoryTextParts,
  type StoryModelOverrides,
} from '@/lib/ai/beat-orchestration';
import {
  assessStoryBeatLength,
  formatAudienceNarrativeContract,
  getStoryAudienceProfile,
  resolveStoryBeatLength,
} from '@/lib/ai/story-audience';

function appendExtraVisualGuidanceContract(prompt: string, guidanceText?: string): string {
  if (!guidanceText?.trim()) {
    return prompt;
  }

  return [
    prompt,
    '',
    'Extra Guidance Role:',
    'Extra Guidance contains visual reference details only. Use it for character appearance, scenes, locations, and world design; never use it to change source wording, dialogue, plot, or events.',
  ].join('\n');
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
  /**
   * Whether to enforce SEED_SOURCE_WORD_CAP against `sourceText`. Defaults to
   * `true` (enforced) so every existing caller -- the human composer path via
   * app/actions/story-runtime.ts's re-export -- is byte-for-byte unaffected.
   *
   * SEED_SOURCE_WORD_CAP bounds what a human pastes into the composer; it is
   * a product limit on input length, not a correctness constraint on the
   * prose itself. The agentic pipeline (lib/agentic/story-assembly.ts)
   * generates its own source prose from a persona and a target beat count and
   * passes `false` here -- there length is governed by the persona's
   * beat-length range instead. Stacking this fixed cap on top of a per-scene
   * word target is exactly the contradiction that burned 2 of 3 attempts on a
   * live run (8fa3a959-4fcf-4bdc-b243-01a9b380737f): 8 beats under a 500-word
   * ceiling is ~62 words/scene, far below what the persona's own beat-length
   * band asked for.
   */
  enforceSourceWordCap?: boolean;
}

export async function generateSeedPlanPreview(input: SeedPlanPreviewInput): Promise<SeedPlan> {
  if ((input.enforceSourceWordCap ?? true) && countAuthoringWords(input.sourceText) > SEED_SOURCE_WORD_CAP) {
    throw new Error(`Source text must be ${SEED_SOURCE_WORD_CAP} words or fewer.`);
  }
  if (countAuthoringWords(input.guidanceText || '') > SEED_GUIDANCE_WORD_CAP) {
    throw new Error(`Extra guidance must be ${SEED_GUIDANCE_WORD_CAP} words or fewer.`);
  }

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
  const strictSourceSegments = storyConfig.authoring.sourceFidelity === 'strictly_follow'
    ? splitStrictSeedSource(storyConfig.authoring.sourceText || '', input.beatCount)
    : null;
  const seedPlanTemplateCandidate = input.modelOverrides?.seedPlanPrompt || getDefaultPromptBody('seed_plan_generation');
  const seedPlanTemplate = validatePromptTemplate('seed_plan_generation', seedPlanTemplateCandidate).isValid
    ? seedPlanTemplateCandidate
    : getDefaultPromptBody('seed_plan_generation');
  const resolvedPrompt = appendNarrativeVisualBoundaryContract(resolvePromptTemplate(seedPlanTemplate, {
    language: storyConfig.language,
    storyConfig: formatNarrativeStoryConfig({ storyConfig, currentBeat: 0 }),
    workingTitle: storyConfig.authoring.workingTitle || '',
    sourceFidelity: storyConfig.authoring.sourceFidelity || 'strictly_follow',
    guidanceText: storyConfig.authoring.guidanceText || '',
    sourceText: storyConfig.authoring.sourceText || '',
    beatCount: input.beatCount,
    strictSourceSegments: strictSourceSegments ? JSON.stringify(strictSourceSegments) : '',
  }));
  const strictPrompt = strictSourceSegments && !/\{\{\s*strictSourceSegments\s*\}\}/u.test(seedPlanTemplate)
    ? [
        resolvedPrompt,
        '',
        'Strict Follow Source Segments (authoritative):',
        JSON.stringify(strictSourceSegments),
        'Copy segment N exactly into beat N storyText. Do not rewrite, translate, correct, expand, or shorten any segment.',
      ].join('\n')
    : resolvedPrompt;
  const prompt = appendExtraVisualGuidanceContract(
    `${strictPrompt}\n\n${formatAudienceNarrativeContract(storyConfig.ageGroup, storyConfig.beatLength?.level)}`,
    storyConfig.authoring.guidanceText
  );

  const generatePlanAttempt = async (repairNote?: string): Promise<SeedPlan> => {
    const text = await callTextModelForReader({
      task: 'seed_plan_generation',
      model: input.modelOverrides?.seedPlanModel || DEFAULT_TEXT_MODEL_ID,
      prompt: repairNote ? `${prompt}\n\nQuality Repair Note:\n${repairNote}` : prompt,
      temperature: input.modelOverrides?.seedPlanTemperature ?? 0.3,
      telemetry: input.costTelemetry
        ? { ...input.costTelemetry, metadata: { ...input.costTelemetry.metadata, attempt: repairNote ? 2 : 1 } }
        : undefined,
    });

    try {
      return normalizeSeedPlanResult(JSON.parse(text) as SeedPlan, storyConfig);
    } catch {
      throw new Error(`Failed to parse seed plan JSON: ${text.slice(0, 200)}`);
    }
  };

  const validatePlan = (plan: SeedPlan): string[] => {
    if (plan.beats.length !== input.beatCount) {
      return [`Seed plan returned ${plan.beats.length} beats, expected ${input.beatCount}.`];
    }
    return [];
  };

  let normalizedPlan = await generatePlanAttempt();
  let planIssues = validatePlan(normalizedPlan);
  if (planIssues.length > 0) {
    normalizedPlan = await generatePlanAttempt(buildValidationRepairNote(planIssues));
    planIssues = validatePlan(normalizedPlan);
    if (planIssues.length > 0) {
      throw new Error(`Seed plan validation failed after retry: ${planIssues.join('; ')}`);
    }
  }

  if (!strictSourceSegments) {
    const length = resolveStoryBeatLength(storyConfig.ageGroup, storyConfig.beatLength?.level);
    for (const beat of normalizedPlan.beats) {
      const assessment = assessStoryBeatLength(beat.storyText, length);
      if (!assessment.withinAllowance) {
        console.warn('[story_runtime.beat_length_outside_allowance]', {
          task: 'seed_plan_generation',
          beatIndex: beat.beatIndex,
          wordCount: assessment.wordCount,
          targetWords: assessment.targetWords,
          allowanceMinWords: assessment.allowanceMinWords,
          allowanceMaxWords: assessment.allowanceMaxWords,
        });
      }
    }
    return normalizedPlan;
  }

  return {
    ...normalizedPlan,
    beats: normalizedPlan.beats.map((beat, index) => ({
      ...beat,
      storyText: strictSourceSegments[index],
    })),
  };
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
  const basePrompt = appendNarrativeVisualBoundaryContract(
    appendStoryTextPartsOutputContract(
      appendExtraVisualGuidanceContract(
        resolvePromptTemplate(materializationTemplate, {
          language: storyConfig.language,
          storyConfig: formatNarrativeStoryConfig(normalizedSessionState),
          storyState: formatNarrativeStoryState(normalizedSessionState),
          sourceText: getSeedSourceText(storyConfig),
          guidanceText: storyConfig.authoring.guidanceText || '',
          seedBeat: JSON.stringify(reorderCanonicalOptions(seedBeat)),
        }),
        storyConfig.authoring.guidanceText
      )
    )
  ) + `\n\n${formatAudienceNarrativeContract(storyConfig.ageGroup, storyConfig.beatLength?.level)}`;

  const generateAttempt = async (repairNote?: string): Promise<StoryBeat> => {
    const text = await callTextModelForReader({
      task: 'seeded_beat_materialization',
      model: modelOverrides?.seededBeatModel || DEFAULT_TEXT_MODEL_ID,
      prompt: repairNote ? `${basePrompt}\n\nQuality Repair Note:\n${repairNote}` : basePrompt,
      temperature: modelOverrides?.seededBeatTemperature ?? 0.4,
      telemetry: costTelemetry
        ? { ...costTelemetry, metadata: { ...costTelemetry.metadata, attempt: repairNote ? 2 : 1 } }
        : undefined,
    });

    try {
      const mergedBeat = mergeSeededBeatWithGeneratedFields(seedBeat, JSON.parse(text) as StoryBeat);
      return storyConfig.authoring.sourceFidelity === 'strictly_follow'
        ? {
            ...mergedBeat,
            storyTextParts: normalizeStoryTextParts(undefined, mergedBeat.storyText),
          }
        : mergedBeat;
    } catch {
      throw new Error(`Failed to parse seeded beat JSON: ${text.slice(0, 200)}`);
    }
  };

  let beat = await generateAttempt();
  const issues = validateGeneratedBeat(beat, normalizedSessionState);
  if (issues.length > 0) {
    // Word count alone must never force this retry -- only structural issues
    // do. When one is already forcing a retry, ride the length note along in
    // the same repair note instead of spending a second call on it.
    const lengthAssessment = assessGeneratedBeatLength(beat, normalizedSessionState);
    const issuesWithLength = lengthAssessment?.note ? [...issues, lengthAssessment.note] : issues;
    beat = await generateAttempt(buildValidationRepairNote(issuesWithLength));
    const retryIssues = validateGeneratedBeat(beat, normalizedSessionState);
    if (retryIssues.length > 0) {
      throw new Error(`Seeded beat validation failed after retry: ${retryIssues.join('; ')}`);
    }
  }

  const finalBeat = normalizeStoryBeatTextParts(applyCharacterNameProvenance(
    beat,
    normalizedSessionState,
    getSeedSourceText(storyConfig)
  ));

  const finalLengthAssessment = assessGeneratedBeatLength(finalBeat, normalizedSessionState);
  if (finalLengthAssessment && !finalLengthAssessment.withinAllowance) {
    console.warn('[story_runtime.beat_length_outside_allowance]', {
      task: 'seeded_beat_materialization',
      beatNumber: finalBeat.beatNumber,
      wordCount: finalLengthAssessment.wordCount,
      targetWords: finalLengthAssessment.targetWords,
      allowanceMinWords: finalLengthAssessment.allowanceMinWords,
      allowanceMaxWords: finalLengthAssessment.allowanceMaxWords,
    });
  }

  return finalBeat;
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
  const audience = getStoryAudienceProfile(storyConfig.ageGroup);
  if (beats.some((beat) => (
    !beat.isEnding
    && (audience.optionCount === 'exactly_3'
      ? beat.options.length !== 3
      : beat.options.length < 3 || beat.options.length > 4)
  ))) {
    throw new Error(
      audience.optionCount === 'exactly_3'
        ? `Seed plan generation must return exactly 3 options for ${audience.label}.`
        : `Seed plan generation must return 3 or 4 options for ${audience.label}.`
    );
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
    options: [canonical, ...alternates].map((option, index) => ({
      ...option,
      isCanonical: index === 0,
    })),
  };
}
