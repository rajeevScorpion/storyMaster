import { describe, expect, it, vi } from 'vitest';
import type { Character, StoryBeat, StorySession } from '@/lib/types/story';

// buildFallbackStoryboardPlan is pure and calls neither of these, but
// beat-orchestration.ts imports them at module scope for generateStoryBeat /
// composeStoryboardPlan's LLM calls, and both transitively pull in
// server-only-marked modules. Under plain vitest (no Next "react-server"
// export condition) that throws at import time regardless of whether this
// test ever calls them, so they are stubbed here purely to make the module
// importable -- mirrors how app/actions/beat-bundle.test.ts mocks
// lib/ai/beat-orchestration's own dependencies for the same reason.
vi.mock('@/lib/ai/text-gateway/reader-call', () => ({
  callTextModelForReader: vi.fn(),
}));
vi.mock('@/app/actions/reel-moods', () => ({
  getPublishedReelMoodsForRuntime: vi.fn(async () => []),
}));

const { buildFallbackStoryboardPlan } = await import('./beat-orchestration');
const { isEnglishText } = await import('./prompt-compiler/language.shared');

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-anvi',
    name: 'अन्वी',
    type: 'protagonist',
    appearanceSummary: 'एक किशोरी जो नीली जैकेट पहनती है',
    personalitySummary: 'जिज्ञासु और साहसी',
    ...overrides,
  };
}

const HINDI_STORY_TEXT_PARTS: [string, string, string, string] = [
  'अन्वी बंदरगाह की ओर चली गई।',
  'सूरज उग रहा था।',
  'हवा ठंडी थी।',
  'वह मुस्कुराई।',
];

const ENGLISH_STORY_TEXT_PARTS: [string, string, string, string] = [
  'Anvi walked toward the harbor.',
  'The sun was rising.',
  'The air was cool.',
  'She smiled.',
];

function makeHindiBeat(overrides: Partial<StoryBeat> = {}): StoryBeat {
  return {
    title: 'बंदरगाह पर सुबह',
    beatNumber: 2,
    isEnding: false,
    // storyText must be exactly the parts joined (round-trips through
    // normalizeStoryTextParts's storyTextPartsPreserveSource check), so the
    // fallback builder uses these parts as given instead of re-splitting.
    storyText: HINDI_STORY_TEXT_PARTS.join(' '),
    storyTextParts: HINDI_STORY_TEXT_PARTS,
    sceneSummary: 'अन्वी सुबह बंदरगाह पर खड़ी है।',
    options: [],
    characters: [makeCharacter()],
    continuityNotes: ['अन्वी की नीली जैकेट अभी भी वैसी ही है।'],
    imagePrompt: 'Wide establishing shot of a harbor at dawn, soft golden light.',
    clues: [],
    nextBeatGoal: 'Reveal what Anvi finds at the harbor.',
    endingForecast: [],
    newCharacterIds: ['char-anvi'],
    changedCharacterIds: [],
    ...overrides,
  };
}

function makeEnglishBeat(overrides: Partial<StoryBeat> = {}): StoryBeat {
  return {
    title: 'Morning at the Harbor',
    beatNumber: 2,
    isEnding: false,
    storyText: ENGLISH_STORY_TEXT_PARTS.join(' '),
    storyTextParts: ENGLISH_STORY_TEXT_PARTS,
    sceneSummary: 'Anvi stands at the harbor in the early morning.',
    options: [],
    characters: [makeCharacter({ name: 'Anvi', appearanceSummary: 'a teenage girl in a blue jacket', personalitySummary: 'curious and brave' })],
    continuityNotes: ["Anvi's blue jacket is unchanged."],
    imagePrompt: 'Wide establishing shot of a harbor at dawn, soft golden light.',
    clues: [],
    nextBeatGoal: 'Reveal what Anvi finds at the harbor.',
    endingForecast: [],
    newCharacterIds: ['char-anvi'],
    changedCharacterIds: [],
    ...overrides,
  };
}

const NO_SESSION: Partial<StorySession> | null = null;

function collectPlanStrings(plan: ReturnType<typeof buildFallbackStoryboardPlan>): string[] {
  const frames = [plan.topLeft, plan.topRight, plan.bottomLeft, plan.bottomRight];
  return [
    ...plan.sharedVisualInvariants,
    ...plan.negativeConstraints,
    ...(plan.mustNotInherit || []),
    plan.transition?.evidence || '',
    plan.setting?.location || '',
    plan.setting?.timeOfDay || '',
    plan.setting?.era || '',
    ...frames.flatMap((frame) => [
      frame.description,
      frame.prompt,
      frame.cameraAngle,
      frame.emotion,
      frame.continuityAnchor,
      frame.shotScale || '',
      frame.cameraHeight || '',
      ...(frame.visualFocus || []),
      ...(frame.appearanceChanges || []),
    ]),
    // portraitTasks[].prompt legitimately opens with the character's own
    // canonical name/type ("अन्वी, protagonist.") -- character ids/names are
    // the one exemption from the "every string is English" rule (see the
    // isEnglishText ignore checks below), so this field is collected
    // separately rather than folded into the generic pool.
    ...plan.portraitTasks.map((task) => task.prompt),
  ];
}

describe('buildFallbackStoryboardPlan — English fallback plan (Unit 3)', () => {
  it('produces an all-English plan for a Hindi beat (character names/ids excepted), with no storyText fragment anywhere', () => {
    const beat = makeHindiBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    const characterNames = beat.characters.map((character) => character.name);

    for (const value of collectPlanStrings(plan)) {
      expect(isEnglishText(value, { ignore: characterNames })).toBe(true);
    }

    // Story-text-derived Hindi fragments beyond the character's own name must
    // never appear anywhere in the plan (storyText, storyTextParts,
    // sceneSummary, appearanceSummary are all off-limits sources).
    const haystack = collectPlanStrings(plan).join('\n');
    expect(haystack).not.toContain('बंदरगाह');
    expect(haystack).not.toContain('सूरज');
    expect(haystack).not.toContain('जिज्ञासु');
  });

  it('keeps continuityNotes out when they are not English', () => {
    const beat = makeHindiBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    expect(plan.sharedVisualInvariants.join('\n')).not.toContain('जैकेट');
  });

  it('omits charactersPresent on every frame, leaving presence to the scene builder', () => {
    const beat = makeHindiBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    expect(plan.topLeft.charactersPresent).toBeUndefined();
    expect(plan.topRight.charactersPresent).toBeUndefined();
    expect(plan.bottomLeft.charactersPresent).toBeUndefined();
    expect(plan.bottomRight.charactersPresent).toBeUndefined();
  });

  it('sets transition to unknown/unknown/empty and leaves characterVisuals and mustNotInherit empty', () => {
    const beat = makeHindiBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    expect(plan.transition).toEqual({ timeRelation: 'unknown', locationRelation: 'unknown', evidence: '' });
    expect(plan.characterVisuals).toEqual([]);
    expect(plan.mustNotInherit).toEqual([]);
  });

  it('excludes appearanceSummary/personalitySummary from the portrait prompt when they are not English', () => {
    const beat = makeHindiBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    expect(plan.portraitTasks).toHaveLength(1);
    const prompt = plan.portraitTasks[0].prompt;
    expect(prompt).not.toContain('किशोरी');
    expect(prompt).not.toContain('जिज्ञासु');
  });

  it('assigns each frame a distinct ESTABLISH/REVEAL/ACT/RESOLVE storyFunction with distinct shotScale/cameraHeight', () => {
    const beat = makeHindiBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    expect([plan.topLeft.storyFunction, plan.topRight.storyFunction, plan.bottomLeft.storyFunction, plan.bottomRight.storyFunction])
      .toEqual(['ESTABLISH', 'REVEAL', 'ACT', 'RESOLVE']);
    const shotScales = [plan.topLeft.shotScale, plan.topRight.shotScale, plan.bottomLeft.shotScale, plan.bottomRight.shotScale];
    const cameraHeights = [plan.topLeft.cameraHeight, plan.topRight.cameraHeight, plan.bottomLeft.cameraHeight, plan.bottomRight.cameraHeight];
    expect(new Set(shotScales).size).toBe(4);
    expect(new Set(cameraHeights).size).toBe(4);
  });
});

describe('buildFallbackStoryboardPlan — English beat keeps its narration alignment', () => {
  it('still reaches the frame descriptions for an English story', () => {
    const beat = makeEnglishBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    expect(plan.topLeft.description).toContain('Anvi walked toward the harbor.');
    expect(plan.topRight.description).toContain('The sun was rising.');
    expect(plan.bottomLeft.description).toContain('The air was cool.');
    expect(plan.bottomRight.description).toContain('She smiled.');
  });

  it('includes appearanceSummary/personalitySummary in the portrait prompt when they are English', () => {
    const beat = makeEnglishBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    const prompt = plan.portraitTasks[0].prompt;
    expect(prompt).toContain('a teenage girl in a blue jacket');
    expect(prompt).toContain('curious and brave');
  });

  it('keeps every plan string English for an English beat too', () => {
    const beat = makeEnglishBeat();
    const plan = buildFallbackStoryboardPlan(beat, NO_SESSION, 'storybook illustration');
    for (const value of collectPlanStrings(plan)) {
      expect(isEnglishText(value)).toBe(true);
    }
  });
});
