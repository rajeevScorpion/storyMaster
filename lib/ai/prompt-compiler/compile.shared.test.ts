import { describe, it, expect } from 'vitest';
import { compileImagePrompt, COMPILER_VERSION } from './compile.shared';
import { buildCanonicalImageScene, type BuildCanonicalSceneInput } from './scene-spec.shared';
import { PROMPT_HARD_MAX_CHARS, type PromptCompilerCapability } from './capability.shared';
import { buildReferenceBindingLines, estimateReferenceBindingChars } from '../reference-binding';
import type { Character, StoryboardFramePlan, StoryboardPlan } from '@/lib/types/story';
import {
  MEDIEVAL_MARKET_INPUT,
  MEDIEVAL_MARKET_PLAN,
  MINIMAL_INPUT,
  LEGACY_TEXT_INPUT,
  HINDI_VILLAGE_INPUT,
  HINDI_VILLAGE_PLAN,
  RAGHAV,
  ANVI,
} from './__fixtures__/scenes';

const NEUTRAL: PromptCompilerCapability = {
  enabled: true,
  promptBudgetChars: 3000,
  supportsNegativePrompt: false,
  adapterVersion: 'neutral-v1',
};
const GEMINI: PromptCompilerCapability = { ...NEUTRAL, adapterVersion: 'gemini-v1' };
const TIGHT: PromptCompilerCapability = { ...NEUTRAL, promptBudgetChars: 1200 };

describe('compileImagePrompt determinism', () => {
  it('produces byte-identical output for the same scene + capability', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const a = compileImagePrompt(scene, NEUTRAL);
    const b = compileImagePrompt(buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT), NEUTRAL);
    expect(a.fullPrompt).toBe(b.fullPrompt);
    expect(a.compilerVersion).toBe(COMPILER_VERSION);
  });
});

describe('compileImagePrompt structure', () => {
  it('orders sections FORMAT, STYLE, SETTING AND TIME, CHARACTERS, PANELS, CONTINUITY, AVOID', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    const headings = ['FORMAT', 'STYLE', 'SETTING AND TIME', 'CHARACTERS', 'PANELS', 'CONTINUITY', 'AVOID'];
    const indices = headings.map((h) => fullPrompt.indexOf(`${h}\n`));
    for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < indices.length; i += 1) expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  });

  it('separates sections with a blank line, never collapsing the prompt into one block', () => {
    // Regression: redact() used to strip \n as a control character, collapsing
    // every section break into a single space (docs/image-composer-continuity-
    // handoff.md section 0, 4a's last finding before the session limit).
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    expect(fullPrompt).toContain('\n\n');
    // Every section heading starts its own line, immediately preceded by a
    // blank line (or the very start of the prompt, for FORMAT).
    const headings = ['STYLE', 'SETTING AND TIME', 'CHARACTERS', 'PANELS', 'CONTINUITY', 'AVOID'];
    for (const heading of headings) {
      expect(fullPrompt).toContain(`\n\n${heading}\n`);
    }
    expect(fullPrompt.startsWith('FORMAT\n')).toBe(true);
  });

  it('states each character identity exactly once', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    const occurrences = fullPrompt.split('elderly scholar with a long white beard').length - 1;
    expect(occurrences).toBe(1);
  });

  it('adds explicit absence only for recurring characters, not every panel', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { sections } = compileImagePrompt(scene, NEUTRAL);
    const bottomLeft = sections.panels.find((p) => p.startsWith('Bottom-left'))!;
    expect(bottomLeft).toContain('Leo is absent');
    const bottomRight = sections.panels.find((p) => p.startsWith('Bottom-right'))!;
    // Both present in bottom-right — no absence note.
    expect(bottomRight).not.toContain('absent');
  });

  it('renders a bounded user-directives block for regeneration', () => {
    const scene = buildCanonicalImageScene({
      ...MEDIEVAL_MARKET_INPUT,
      regeneration: { mode: 'refine', overallSuggestion: 'add evening light', panelSuggestions: { bottomRight: 'apple closer to Leo' } },
    });
    const { fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    expect(fullPrompt).toContain('USER DIRECTIVES');
    expect(fullPrompt).toContain('add evening light');
    expect(fullPrompt).toContain('Bottom-right: apple closer to Leo.');
  });
});

describe('compileImagePrompt adapters', () => {
  it('neutral lists negatives one per line, gemini folds them into one sentence', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const neutral = compileImagePrompt(scene, NEUTRAL);
    const gemini = compileImagePrompt(scene, GEMINI);
    expect(neutral.sections.negatives.startsWith('- ')).toBe(true);
    expect(neutral.sections.negatives).toContain('\n- ');
    expect(gemini.sections.negatives).not.toContain('\n- ');
    expect(gemini.sections.negatives.endsWith('.')).toBe(true);
  });
});

describe('compileImagePrompt compression', () => {
  it('compresses under a tight budget while preserving critical requirements', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const result = compileImagePrompt(scene, TIGHT);
    expect(result.compressionLevel).toBeGreaterThan(0);
    // Never-drop set must survive.
    expect(result.fullPrompt).toContain('four equal panels');
    expect(result.fullPrompt).toContain('Master Elrick');
    expect(result.fullPrompt).toContain('elderly scholar');
    expect(result.fullPrompt).toContain('tosses a bright red apple');
    expect(result.fullPrompt.toLowerCase()).toContain('avoid');
    expect(result.compressionActions.length).toBeGreaterThan(0);
  });

});

describe('compileImagePrompt budget tiers', () => {
  it('tier 0: a fixture within target renders untouched and byte-identical across runs', () => {
    const a = compileImagePrompt(buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT), NEUTRAL);
    const b = compileImagePrompt(buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT), NEUTRAL);
    expect(a.budget.tier).toBe(0);
    expect(a.compressionLevel).toBe(0);
    expect(a.characterCount).toBeLessThanOrEqual(NEUTRAL.promptBudgetChars);
    expect(a.fullPrompt).toBe(b.fullPrompt);
  });

  it('tier 1: lossless passes bring an over-target scene back under target, keeping the never-drop set', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    // The full render is ~2545 chars and the lossless floor for this fixture
    // is ~2451 (verified empirically) -- a target in that gap reaches tier 1
    // by breaking out of the lossless loop early, never touching the lossy
    // passes at all.
    const capability: PromptCompilerCapability = { ...NEUTRAL, promptBudgetChars: 2500 };
    const result = compileImagePrompt(scene, capability);
    expect(result.budget.tier).toBe(1);
    expect(result.compressionLevel).toBe(1);
    expect(result.characterCount).toBeLessThanOrEqual(2500);
    expect(result.compressionActions.length).toBeGreaterThan(0);
    expect(result.warnings).not.toContain('over_target');
    expect(result.fullPrompt).toContain('four equal panels');
    expect(result.fullPrompt).toContain('Master Elrick');
    expect(result.fullPrompt).toContain('tosses a bright red apple');
  });

  it('tier 2: over target but within the hard cap is accepted with an over_target warning', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    scene.characters[0].visualIdentity = 'x'.repeat(1400);
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.budget.tier).toBe(2);
    expect(result.compressionLevel).toBe(2);
    expect(result.warnings).toContain('over_target');
    expect(result.characterCount).toBeGreaterThan(NEUTRAL.promptBudgetChars);
    expect(result.characterCount).toBeLessThanOrEqual(5000);
  });

  it('tier 3: a pathological scene is trimmed to the hard cap and never cut mid-word', () => {
    const LONGWORD = 'Supercalifragilisticexpialidocious';
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    scene.world.invariants = Array.from({ length: 12 }, (_, i) => `${LONGWORD} invariant number ${i} in the market.`);
    for (const panel of scene.panels) {
      panel.action = `${LONGWORD} `.repeat(40).trim();
      panel.emotion = 'a complex layered emotional state described at unusual length for testing';
      panel.visualFocus = Array.from({ length: 6 }, (_, i) => `unique focus descriptor number ${i} extra words`);
    }
    scene.continuity.notes = [`${LONGWORD} continuity note one.`, `${LONGWORD} continuity note two.`];
    scene.negativeConstraints = [
      ...scene.negativeConstraints,
      ...Array.from({ length: 20 }, (_, i) => `unwanted specific element number ${i}`),
    ];
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.budget.tier).toBe(3);
    expect(result.compressionLevel).toBe(3);
    expect(result.characterCount).toBeLessThanOrEqual(5000);
    expect(result.warnings).toContain('lossy_trim');
    // Never mid-word: a trailing run of letters is either empty or the whole
    // repeated long word, never a partial fragment of it.
    const trailingLetters = /[A-Za-z]+$/.exec(result.fullPrompt.trimEnd())?.[0] ?? '';
    if (trailingLetters && LONGWORD.toLowerCase().startsWith(trailingLetters.toLowerCase())) {
      expect(trailingLetters.length).toBe(LONGWORD.length);
    }
  });

  it('reservedChars lowers both the target and the hard cap; nothing ever exceeds the resulting hard cap', () => {
    const withoutReserve = compileImagePrompt(buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT), NEUTRAL);
    const withReserve = compileImagePrompt(buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT), NEUTRAL, {
      reservedChars: 500,
    });
    expect(withReserve.budget.reservedChars).toBe(500);
    expect(withReserve.budget.targetChars).toBe(withoutReserve.budget.targetChars - 502);
    expect(withReserve.budget.hardMaxChars).toBe(withoutReserve.budget.hardMaxChars - 502);
    expect(withReserve.characterCount).toBeLessThanOrEqual(withReserve.budget.hardMaxChars);
  });
});

describe('compileImagePrompt + reference-binding lines (Unit 4b end-to-end budget)', () => {
  it('never exceeds PROMPT_HARD_MAX_CHARS once binding lines for 4 references are appended to a pathological scene', () => {
    // Same pathological scene as the tier-3 test above, plus 4 reference
    // images -- the exact combination Unit 4b's reservation is meant to
    // cover: a scene compressed all the way to the hard cap, and the text
    // appended after compilation (story-runtime.ts / image-job-runner.ts),
    // together, never crossing PROMPT_HARD_MAX_CHARS.
    const LONGWORD = 'Supercalifragilisticexpialidocious';
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    scene.world.invariants = Array.from({ length: 12 }, (_, i) => `${LONGWORD} invariant number ${i} in the market.`);
    for (const panel of scene.panels) {
      panel.action = `${LONGWORD} `.repeat(40).trim();
      panel.emotion = 'a complex layered emotional state described at unusual length for testing';
      panel.visualFocus = Array.from({ length: 6 }, (_, i) => `unique focus descriptor number ${i} extra words`);
    }
    scene.continuity.notes = [`${LONGWORD} continuity note one.`, `${LONGWORD} continuity note two.`];
    scene.negativeConstraints = [
      ...scene.negativeConstraints,
      ...Array.from({ length: 20 }, (_, i) => `unwanted specific element number ${i}`),
    ];

    const references = [
      { type: 'character', name: 'Master Elrick' },
      { type: 'character', name: 'Leo' },
      { type: 'scene' },
      { type: 'character', name: 'A Third Character With An Unusually Long Display Name Indeed' },
    ];
    const reservedChars = estimateReferenceBindingChars(references);
    const result = compileImagePrompt(scene, NEUTRAL, { reservedChars });
    // The estimate is computed pre-resolution (the planned list); the compact
    // form is what a compiled engine actually sends -- exactly as
    // assembleStoryboardFinalPrompt / processBeatVisuals do.
    const bindingLines = buildReferenceBindingLines(references, { compact: true });
    const boundPrompt = bindingLines ? `${result.fullPrompt}\n\n${bindingLines}` : result.fullPrompt;
    expect(boundPrompt.length).toBeLessThanOrEqual(PROMPT_HARD_MAX_CHARS);
  });
});

describe('compileImagePrompt non-Latin scenes', () => {
  it('falls back to "Character N" (never the Devanagari name) in the absent line', () => {
    const plan = structuredClone(HINDI_VILLAGE_PLAN);
    // Bottom-right's action must not name राघव itself, so it is the
    // compiler's own absence detection — not the composer's text — that has
    // to add the line via a Unicode-aware name match.
    plan.bottomRight.description = 'अन्वी अकेली बरगद के पेड़ के नीचे बैठी किताब पढ़ रही है।';
    plan.bottomRight.charactersPresent = ['अन्वी'];
    const scene = buildCanonicalImageScene({ ...HINDI_VILLAGE_INPUT, storyboardPlan: plan });
    // Neither fixture character has an englishName, and both names are
    // Devanagari, so both fall back to a positional placeholder.
    const raghav = scene.characters.find((c) => c.displayName === RAGHAV.name)!;
    expect(raghav.imageName).toBe('Character 1');
    const { sections, fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    const bottomRight = sections.panels.find((p) => p.startsWith('Bottom-right'))!;
    expect(bottomRight).toContain(`${raghav.imageName} is absent`);
    expect(fullPrompt).not.toContain(RAGHAV.name);
  });

  it('replaces a non-English display name wherever it survives into a rendered string, not just the absent line', () => {
    // Every fixture panel action mentions राघव by name (see __fixtures__/scenes.ts),
    // and the action is the one field kept verbatim even when non-English —
    // so without the imageName substitution, his raw Devanagari name would
    // leak into an otherwise-English compiled prompt.
    const scene = buildCanonicalImageScene(HINDI_VILLAGE_INPUT);
    const raghav = scene.characters.find((c) => c.displayName === RAGHAV.name)!;
    const anvi = scene.characters.find((c) => c.displayName === ANVI.name)!;
    expect(raghav.imageName).not.toBe(RAGHAV.name);
    const { fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    expect(fullPrompt).not.toContain(RAGHAV.name);
    expect(fullPrompt).not.toContain(ANVI.name);
    expect(fullPrompt).toContain(raghav.imageName);
    expect(fullPrompt).toContain(anvi.imageName);
  });
});

describe('compileImagePrompt old non-English stored plan', () => {
  it('drops secondary Hindi fields but keeps the panel action, and warns non_english_prompt', () => {
    // HINDI_VILLAGE_PLAN has no transition/setting/mustNotInherit/characterVisuals
    // -- exactly the shape of a plan stored before the continuity model landed.
    const scene = buildCanonicalImageScene(HINDI_VILLAGE_INPUT);
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.warnings).toContain('non_english_prompt');
    // The action is the one field the scene builder keeps even when non-English
    // (so the image still depicts the event) -- it must survive into the prompt.
    expect(result.fullPrompt).toContain('अपने खेत की मेड़ पर खड़े होकर');
    // Every other per-panel/world Hindi field is dropped at scene-build time
    // (scene-spec.shared.ts's English gate), so none of it reaches the prompt.
    expect(result.fullPrompt).not.toContain('शांत और संतुष्ट'); // emotion
    expect(result.fullPrompt).not.toContain('दूर के पहाड़'); // visual focus
    expect(result.fullPrompt).not.toContain('टेक्स्ट'); // Hindi negative constraint
    expect(result.fullPrompt).not.toContain('यही सुबह की रोशनी'); // continuity anchor
  });
});

describe('compileImagePrompt STYLE axes', () => {
  const AXIS_STYLE = [
    'Rendering: Whimsical medieval storybook illustration with painterly textures.',
    'Emotional atmosphere: warm and wondrous, with gentle golden warmth throughout.',
    'Color and light: golden hour glow with amber highlights and soft long shadows.',
    'Scope boundary: keep every embellishment strictly within the bounds of the story world and nothing more.',
  ].join('\n');

  it('tier 0: keeps every axis in full -- never the old first-clause cut', () => {
    const scene = buildCanonicalImageScene({ ...MEDIEVAL_MARKET_INPUT, visualStyle: AXIS_STYLE });
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.budget.tier).toBe(0);
    for (const line of AXIS_STYLE.split('\n')) {
      expect(result.sections.style).toContain(line);
    }
  });

  it('a tight budget shortens only the scope line -- the other three axes and the axis count survive', () => {
    const scene = buildCanonicalImageScene({ ...MEDIEVAL_MARKET_INPUT, visualStyle: AXIS_STYLE });
    const result = compileImagePrompt(scene, TIGHT);
    expect(result.compressionActions.some((a) => a.reason === 'lossless-shorten-scope-line')).toBe(true);
    const styleLines = result.sections.style.split('\n');
    expect(styleLines).toHaveLength(4);
    expect(result.sections.style).toContain(
      'Scope boundary: style applies only to story-grounded content; add nothing just to express it.'
    );
    expect(result.sections.style).toContain('Rendering: Whimsical medieval storybook illustration with painterly textures.');
    expect(result.sections.style).toContain(
      'Emotional atmosphere: warm and wondrous, with gentle golden warmth throughout.'
    );
    expect(result.sections.style).toContain(
      'Color and light: golden hour glow with amber highlights and soft long shadows.'
    );
  });
});

describe('compileImagePrompt CONTINUITY', () => {
  it('a continuous scene (no transition) keeps clothing continuity', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.sections.continuity).toContain('clothing');
  });

  it('a years_later transition drops the clothing-lock wording and renders Do not carry over', () => {
    const plan = structuredClone(MEDIEVAL_MARKET_PLAN);
    plan.transition = {
      timeRelation: 'years_later',
      locationRelation: 'new_location',
      evidence: 'Years have passed since the last scene.',
    };
    // mustNotInherit is intentionally left unset -- Unit 5's
    // resolveContinuityContradictions (called inside buildCanonicalImageScene)
    // derives it from the transition itself: wardrobe/hairstyle from the big
    // time jump, location architecture from the location change.
    const scene = buildCanonicalImageScene({ ...MEDIEVAL_MARKET_INPUT, storyboardPlan: plan });
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.sections.continuity).toContain(
      'reassess age, hair, clothing and setting for this point in the story'
    );
    expect(result.sections.continuity).not.toContain('within this continuous scene keep identity, clothing');
    expect(result.sections.continuity).toContain('Do not carry over:');
    expect(result.sections.continuity).toContain('previous wardrobe');
    expect(result.sections.continuity).toContain('previous hairstyle');
    expect(result.sections.continuity).toContain('previous location architecture');
  });
});

describe('compileImagePrompt presence (Unit 5, replacing the recurring-in->=2 rule)', () => {
  function presenceFrame(description: string, charactersPresent: string[]): StoryboardFramePlan {
    return {
      description,
      prompt: '',
      cameraAngle: 'medium shot',
      visualFocus: [],
      emotion: '',
      continuityAnchor: '',
      charactersPresent,
      appearanceChanges: [],
      shotScale: '',
      cameraHeight: '',
      visualEcho: false,
    };
  }

  const ADA: Character = { id: 'a1', name: 'Ada', type: 'human', appearanceSummary: 'a young woman', personalitySummary: '' };
  const BEN: Character = { id: 'b1', name: 'Ben', type: 'human', appearanceSummary: 'an older man', personalitySummary: '' };

  function presenceInput(plan: StoryboardPlan): BuildCanonicalSceneInput {
    return { storyboardPlan: plan, characters: [ADA, BEN], visualStyle: 'flat vector', aspectRatio: '16:9' };
  }

  it('a character present in exactly one panel is rendered absent in the other three', () => {
    const plan: StoryboardPlan = {
      sharedVisualInvariants: [],
      portraitTasks: [],
      topLeft: presenceFrame('A quiet street corner.', ['Ada']),
      topRight: presenceFrame('A busy market stall.', []),
      bottomLeft: presenceFrame('A rooftop at dusk.', []),
      bottomRight: presenceFrame('A cosy kitchen.', []),
      negativeConstraints: [],
    };
    const scene = buildCanonicalImageScene(presenceInput(plan));
    const result = compileImagePrompt(scene, NEUTRAL);
    const byLabel = (label: string) => result.sections.panels.find((p) => p.startsWith(label))!;
    expect(byLabel('Top-left')).not.toContain('absent');
    expect(byLabel('Top-right')).toContain('Ada is absent');
    expect(byLabel('Bottom-left')).toContain('Ada is absent');
    expect(byLabel('Bottom-right')).toContain('Ada is absent');
  });

  it('a character present in no panel is not listed in CHARACTERS', () => {
    const plan: StoryboardPlan = {
      sharedVisualInvariants: [],
      portraitTasks: [],
      topLeft: presenceFrame('A quiet street corner.', ['Ada']),
      topRight: presenceFrame('A busy market stall.', ['Ada']),
      bottomLeft: presenceFrame('A rooftop at dusk.', ['Ada']),
      bottomRight: presenceFrame('A cosy kitchen.', ['Ada']),
      negativeConstraints: [],
    };
    const scene = buildCanonicalImageScene(presenceInput(plan));
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.sections.characters).toContain('Ada');
    expect(result.sections.characters).not.toContain('Ben');
    // Ada is present everywhere, so no absence line fires anywhere either.
    for (const panel of result.sections.panels) expect(panel).not.toContain('absent');
  });

  it('fails open (lists everyone, no absence lines) when no panel declares presence at all', () => {
    const plan: StoryboardPlan = {
      sharedVisualInvariants: [],
      portraitTasks: [],
      topLeft: presenceFrame('A quiet street corner.', []),
      topRight: presenceFrame('A busy market stall.', []),
      bottomLeft: presenceFrame('A rooftop at dusk.', []),
      bottomRight: presenceFrame('A cosy kitchen.', []),
      negativeConstraints: [],
    };
    const scene = buildCanonicalImageScene(presenceInput(plan));
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.sections.characters).toContain('Ada');
    expect(result.sections.characters).toContain('Ben');
    for (const panel of result.sections.panels) expect(panel).not.toContain('absent');
  });
});

describe('compileImagePrompt planWarnings (Unit 5)', () => {
  it('folds resolveContinuityContradictions warnings (camera_repetition) into the compiled warnings', () => {
    const plan = structuredClone(MEDIEVAL_MARKET_PLAN);
    for (const key of ['topLeft', 'topRight', 'bottomLeft'] as const) {
      plan[key].shotScale = 'medium shot';
      plan[key].cameraHeight = 'eye level';
      plan[key].visualEcho = false;
    }
    const scene = buildCanonicalImageScene({ ...MEDIEVAL_MARKET_INPUT, storyboardPlan: plan });
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.warnings).toContain('camera_repetition');
  });
});

describe('compileImagePrompt legacy conversion', () => {
  it('passes legacy text through with layout + negatives', () => {
    const scene = buildCanonicalImageScene(LEGACY_TEXT_INPUT);
    const result = compileImagePrompt(scene, NEUTRAL);
    expect(result.fullPrompt).toContain('four equal panels');
    expect(result.fullPrompt).toContain('A market square');
    expect(result.compressionLevel).toBe(0);
  });
});
