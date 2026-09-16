import { loadEnv } from 'vite';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import { mapTextModelRow, type TextModelRow } from '@/lib/ai/text-models.shared';

/**
 * Live smoke for the storyboard composer's continuity schema (image-composer-continuity Unit 3):
 * sends the real default visual_prompt template and LOCKED guardrail, filled with an invented Hindi
 * beat set twelve years after a childhood scene, to GPT-5.6 Luna (strict json_schema) and Gemini 3.8
 * Flash (native responseSchema) with storyboardContinuityPlanSchema.
 *
 * Proves what unit tests cannot: that each provider accepts the schema (enums across four panels),
 * returns English planning output, and recognises the time jump. Prints latency, tokens and a
 * compact summary of the plan for review.
 *
 * Gated so it never runs or spends during `npm test`. Run explicitly:
 *
 *   COMPOSER_SCHEMA_SMOKE=1 npx vitest run --config vitest.smoke.config.ts scripts/composer-schema.smoke.ts
 */

const SHOULD_RUN = process.env.COMPOSER_SCHEMA_SMOKE === '1';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('composer schema smoke: createAdminClient should never be called');
  },
}));

const { getTextModelRegistryMock, getFeatureFlagValueMock, recordModelCostEventMock } = vi.hoisted(() => ({
  getTextModelRegistryMock: vi.fn(),
  getFeatureFlagValueMock: vi.fn(),
  recordModelCostEventMock: vi.fn(),
}));

vi.mock('@/lib/ai/text-models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/text-models')>();
  return { ...actual, getTextModelRegistry: getTextModelRegistryMock };
});

vi.mock('@/lib/ai/model-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/model-config')>();
  return { ...actual, getFeatureFlagValue: getFeatureFlagValueMock };
});

vi.mock('@/lib/ai/cost-telemetry', () => ({
  recordModelCostEvent: recordModelCostEventMock,
}));

import { generateText } from '@/lib/ai/text-gateway/router';
import { storyboardContinuityPlanSchema } from '@/lib/ai/generation-schemas';
import {
  getDefaultPromptBody,
  LOCKED_PROMPT_GUARDRAILS,
  resolvePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { normalizeStoryboardPlan } from '@/lib/ai/storyboard-plan.shared';
import { buildCanonicalImageScene } from '@/lib/ai/prompt-compiler/scene-spec.shared';
import { compileImagePrompt } from '@/lib/ai/prompt-compiler/compile.shared';
import { PROMPT_HARD_MAX_CHARS, type PromptCompilerCapability } from '@/lib/ai/prompt-compiler/capability.shared';
import { isEnglishText } from '@/lib/ai/prompt-compiler/language.shared';
import type { Character } from '@/lib/types/story';

const fileEnv = loadEnv('development', process.cwd(), '');
function ensureEnv(name: string): string {
  const value = process.env[name] || fileEnv[name] || '';
  if (value) process.env[name] = value;
  return value;
}
const GEMINI_KEY = ensureEnv('GEMINI_API_KEY');
const OPENAI_KEY = ensureEnv('OPENAI_API_KEY');

const NOW = new Date().toISOString();

function buildRow(overrides: Partial<TextModelRow>): TextModelRow {
  return {
    id: 'smoke-row',
    model_key: 'placeholder',
    provider_key: 'gemini',
    provider_model_id: 'placeholder',
    display_name: 'Placeholder',
    description: '',
    is_enabled: true,
    capabilities: {},
    default_params: {},
    timeout_ms: null,
    input_cost_per_mtok_usd: null,
    output_cost_per_mtok_usd: null,
    cached_input_cost_per_mtok_usd: null,
    required_env_vars: [],
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    updated_by: null,
    ...overrides,
  };
}

const GEMINI_RECORD = mapTextModelRow(
  buildRow({
    id: 'smoke-gemini',
    model_key: 'gemini-3.8-flash',
    provider_key: 'gemini',
    provider_model_id: 'gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash (smoke)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['low', 'medium', 'high'] },
    timeout_ms: 150000,
    required_env_vars: ['GEMINI_API_KEY'],
  })
);

const OPENAI_RECORD = mapTextModelRow(
  buildRow({
    id: 'smoke-openai',
    model_key: 'openai:gpt-5.6-luna',
    provider_key: 'openai',
    provider_model_id: 'gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna (smoke)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false },
    default_params: { reasoningLevel: 'low' },
    timeout_ms: 150000,
    input_cost_per_mtok_usd: 0.2,
    output_cost_per_mtok_usd: 1.2,
    cached_input_cost_per_mtok_usd: 0.02,
    required_env_vars: ['OPENAI_API_KEY'],
  })
);

// The dev Gemini storyboard row's compiler capability (migration 081 + 122): 3,000-character
// target, gemini-v1 adapter, no separate negative channel.
const GEMINI_CAPABILITY: PromptCompilerCapability = {
  enabled: true,
  promptBudgetChars: 3000,
  supportsNegativePrompt: false,
  adapterVersion: 'gemini-v1',
};

// Invented beat: Anvi was a frightened child at a village lotus pond (beat 1); twelve years
// later she coaches a frightened boy at a city swimming pool (beat 2). Story text is Hindi;
// imagePrompt and continuityNotes are English, as story generation requires.
const CHARACTERS = [
  { id: 'char-anvi', name: 'अन्वी', type: 'human', appearanceSummary: 'लंबे काले बाल, गहरी आँखें, गेहुँआ रंग', personalitySummary: 'धैर्यवान' },
  { id: 'char-rohan', name: 'रोहन', type: 'human', appearanceSummary: 'आठ साल का दुबला लड़का', personalitySummary: 'डरपोक' },
];

const STORY_TEXT_PARTS = [
  'बारह साल बाद, अन्वी अब शहर के बड़े स्विमिंग पूल में बच्चों को तैरना सिखाती है।',
  'किनारे पर खड़ा रोहन पानी से डर रहा है।',
  'अन्वी घुटनों के बल बैठकर उसकी ओर हाथ बढ़ाती है।',
  'रोहन धीरे-धीरे पानी में उतरता है, और अन्वी को अपना बचपन याद आता है।',
];

const VISUAL_STYLE = [
  'Rendering: ink-wash illustration with soft brush textures',
  'Emotional atmosphere: gentle and hopeful',
  'Color and light: muted earth tones with warm highlights',
  'Scene richness: moderate detail with clear subjects',
  'Scope boundary: apply these directions only to the visual treatment of story-grounded people, places, objects, and actions.',
].join('\n');

function buildComposerPrompt(): string {
  return resolvePromptTemplate(getDefaultPromptBody('visual_prompt'), {
    storyText: STORY_TEXT_PARTS.join(' '),
    storyTextParts: JSON.stringify(STORY_TEXT_PARTS),
    sceneSummary: 'बारह साल बाद शहर के स्विमिंग पूल में अन्वी एक डरे हुए बच्चे को तैरना सिखाती है।',
    imageIntent: 'Twelve years later, adult Anvi coaches a frightened boy, Rohan, at a city swimming pool.',
    characters: JSON.stringify(CHARACTERS),
    continuityNotes: JSON.stringify(['Anvi wore yellow hair clips as a child', 'the village pond had lotus leaves']),
    visualStyle: VISUAL_STYLE,
    beatNumber: 2,
    storyState: JSON.stringify({ title: 'तैराकी', language: 'Hindi', audience: 'teens' }),
    newCharacterIds: JSON.stringify(['char-rohan']),
    changedCharacterIds: JSON.stringify(['char-anvi']),
    previousStoryboardContext: JSON.stringify({
      beatNumber: 1,
      sceneSummary: 'छोटी अन्वी गाँव के तालाब के किनारे डरती है',
      continuityNotes: ['Anvi wore yellow hair clips as a child', 'the village pond had lotus leaves'],
      imagePromptExcerpt: 'Seven-year-old Anvi with yellow hair clips hesitates at a lotus pond in her village',
      storyboardFrames: null,
    }),
    seedAuthoringContext: '',
  });
}

const FRAME_KEYS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;

async function runComposerSmoke(modelKey: string): Promise<void> {
  recordModelCostEventMock.mockClear();
  const telemetry: CostTelemetryContext = { activityKey: 'agentic_creator', metadata: { smokeTest: true } };
  const prompt = buildComposerPrompt();

  const startedAt = Date.now();
  const result = await generateText({
    taskKey: 'visual_prompt',
    modelKey,
    prompt,
    systemInstruction: LOCKED_PROMPT_GUARDRAILS.visual_prompt,
    schema: storyboardContinuityPlanSchema,
    schemaName: 'visual_prompt',
    temperature: 0.5,
    telemetry,
  });
  const latencyMs = Date.now() - startedAt;

  const { plan, needsLanguageFallback } = normalizeStoryboardPlan(JSON.parse(result.text), {
    characterNames: CHARACTERS.map((character) => character.name),
  });

  console.info(
    `[composer schema smoke] ${modelKey}: latencyMs=${latencyMs} promptChars=${prompt.length} `
    + `inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} responseChars=${result.text.length}`
  );
  console.info(`[composer schema smoke] ${modelKey} plan summary:`, JSON.stringify({
    needsLanguageFallback,
    transition: plan.transition,
    setting: plan.setting,
    mustNotInherit: plan.mustNotInherit,
    characterVisuals: plan.characterVisuals,
    frames: FRAME_KEYS.map((key) => ({
      panel: key,
      storyFunction: plan[key].storyFunction,
      shotScale: plan[key].shotScale,
      cameraHeight: plan[key].cameraHeight,
      timeRelationToPreviousPanel: plan[key].timeRelationToPreviousPanel,
      charactersPresent: plan[key].charactersPresent,
      description: plan[key].description,
      prompt: plan[key].prompt,
    })),
    invariants: plan.sharedVisualInvariants,
  }, null, 2));

  expect(needsLanguageFallback).toBe(false);
  expect(plan.transition?.timeRelation).not.toBe('continuous');
  expect(plan.transition?.timeRelation).not.toBe('unknown');
  const anvi = plan.characterVisuals?.find((entry) => entry.name === 'अन्वी');
  expect(anvi).toBeDefined();
  expect(anvi?.englishName).toMatch(/^[A-Za-z][A-Za-z .'-]*$/);
  for (const key of FRAME_KEYS) {
    expect(plan[key].storyFunction).toBeDefined();
  }

  // End-to-end: the real plan through the real compiler. Unit tests cover the
  // compiler on fixtures; this proves the prompt an actual model response
  // produces is English, sectioned and inside the hard cap.
  const scene = buildCanonicalImageScene({
    storyboardPlan: plan,
    continuityNotes: ['Anvi wore yellow hair clips as a child'],
    characters: CHARACTERS as unknown as Character[],
    visualStyle: VISUAL_STYLE,
    aspectRatio: '16:9',
  });
  const compiled = compileImagePrompt(scene, GEMINI_CAPABILITY);

  console.info(
    `[composer schema smoke] ${modelKey} compiled: chars=${compiled.characterCount} tier=${compiled.compressionLevel} `
    + `warnings=${compiled.warnings.join('|') || 'none'}`
  );
  console.info(`[composer schema smoke] ${modelKey} compiled prompt:\n${compiled.fullPrompt}`);

  expect(compiled.characterCount).toBeLessThanOrEqual(PROMPT_HARD_MAX_CHARS);
  expect(compiled.fullPrompt).toContain('\n\n');
  for (const heading of ['FORMAT', 'STYLE', 'SETTING AND TIME', 'CHARACTERS', 'PANELS', 'CONTINUITY']) {
    expect(compiled.fullPrompt).toContain(heading);
  }
  expect(isEnglishText(compiled.fullPrompt)).toBe(true);
  // No Devanagari anywhere in the prompt: canonical names must be replaced by
  // their English image-facing names. Built from a string so this file never
  // holds the literal characters.
  expect(new RegExp('[\\u0900-\\u097F]').test(compiled.fullPrompt)).toBe(false);
  expect(compiled.warnings).not.toContain('non_english_prompt');
}

describe.skipIf(!SHOULD_RUN)('composer continuity schema live smoke (COMPOSER_SCHEMA_SMOKE=1)', () => {
  beforeAll(() => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_RECORD, OPENAI_RECORD]);
    getFeatureFlagValueMock.mockResolvedValue(null);
    recordModelCostEventMock.mockResolvedValue(undefined);
  });

  it.skipIf(!OPENAI_KEY)('GPT-5.6 Luna accepts the schema and returns an English continuity plan', async () => {
    await runComposerSmoke('openai:gpt-5.6-luna');
  }, 180_000);

  it.skipIf(!GEMINI_KEY)('Gemini 3.8 Flash accepts the schema and returns an English continuity plan', async () => {
    await runComposerSmoke('gemini-3.8-flash');
  }, 180_000);
});
