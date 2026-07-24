import { describe, it, expect } from 'vitest';
import { compileImagePrompt, COMPILER_VERSION } from './compile.shared';
import { buildCanonicalImageScene } from './scene-spec.shared';
import type { PromptCompilerCapability } from './capability.shared';
import { MEDIEVAL_MARKET_INPUT, MINIMAL_INPUT, LEGACY_TEXT_INPUT } from './__fixtures__/scenes';

const NEUTRAL: PromptCompilerCapability = {
  enabled: true,
  promptBudgetChars: 2800,
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
  it('states layout first, then identity, then panels', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { fullPrompt } = compileImagePrompt(scene, NEUTRAL);
    const layoutIdx = fullPrompt.indexOf('four equal panels');
    const identityIdx = fullPrompt.indexOf('Characters and identity');
    const panelsIdx = fullPrompt.indexOf('Panels:');
    expect(layoutIdx).toBeGreaterThanOrEqual(0);
    expect(layoutIdx).toBeLessThan(identityIdx);
    expect(identityIdx).toBeLessThan(panelsIdx);
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
    expect(fullPrompt).toContain('User visual directives');
    expect(fullPrompt).toContain('add evening light');
    expect(fullPrompt).toContain('Bottom-right: apple closer to Leo.');
  });
});

describe('compileImagePrompt adapters', () => {
  it('neutral lists negatives, gemini folds them into one Avoid sentence', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const neutral = compileImagePrompt(scene, NEUTRAL);
    const gemini = compileImagePrompt(scene, GEMINI);
    expect(neutral.sections.negatives).toContain('Avoid the following:');
    expect(gemini.sections.negatives.startsWith('Avoid:')).toBe(true);
    expect(gemini.sections.negatives).not.toContain('\n- ');
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

  it('warns when still over budget at max compression instead of truncating', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const impossible: PromptCompilerCapability = { ...NEUTRAL, promptBudgetChars: 1200 };
    // Force a very small budget by inflating identity text.
    scene.characters[0].visualIdentity = 'x'.repeat(1200);
    const result = compileImagePrompt(scene, impossible);
    expect(result.compressionLevel).toBe(3);
    expect(result.warnings).toContain('over_budget_after_max_compression');
    // Identity anchor is still present (not blindly truncated away).
    expect(result.fullPrompt).toContain('xxxxx');
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
