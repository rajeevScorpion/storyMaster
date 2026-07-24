import { describe, it, expect } from 'vitest';
import { compileImagePrompt } from './compile.shared';
import { buildCanonicalImageScene } from './scene-spec.shared';
import { MEDIEVAL_MARKET_INPUT } from './__fixtures__/scenes';
import type { PromptCompilerCapability } from './capability.shared';

const GEMINI: PromptCompilerCapability = {
  enabled: true,
  promptBudgetChars: 2800,
  supportsNegativePrompt: false,
  adapterVersion: 'gemini-v1',
};

describe('compiled prompt snapshots', () => {
  it('medieval market — 9:16', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const result = compileImagePrompt(scene, GEMINI);
    expect(result.characterCount).toBeLessThanOrEqual(GEMINI.promptBudgetChars);
    expect(result.fullPrompt).toMatchSnapshot();
  });

  it('medieval market — 16:9', () => {
    const scene = buildCanonicalImageScene({ ...MEDIEVAL_MARKET_INPUT, aspectRatio: '16:9' });
    const result = compileImagePrompt(scene, GEMINI);
    expect(result.characterCount).toBeLessThanOrEqual(GEMINI.promptBudgetChars);
    expect(result.fullPrompt).toMatchSnapshot();
  });

  it('medieval market — 9:16 with regeneration deltas', () => {
    const scene = buildCanonicalImageScene({
      ...MEDIEVAL_MARKET_INPUT,
      regeneration: {
        mode: 'reimagine',
        overallSuggestion: 'make the market busier and add evening light',
        panelSuggestions: { bottomRight: 'move the apple closer to Leo' },
      },
    });
    const result = compileImagePrompt(scene, GEMINI);
    expect(result.fullPrompt).toMatchSnapshot();
  });
});
