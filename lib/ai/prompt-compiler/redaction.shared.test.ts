import { describe, it, expect } from 'vitest';
import { compileImagePrompt } from './compile.shared';
import { buildCanonicalImageScene } from './scene-spec.shared';
import { MEDIEVAL_MARKET_INPUT } from './__fixtures__/scenes';
import type { PromptCompilerCapability } from './capability.shared';

const CAP: PromptCompilerCapability = {
  enabled: true,
  promptBudgetChars: 4000,
  supportsNegativePrompt: false,
  adapterVersion: 'neutral-v1',
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('compiler redaction', () => {
  it('scrubs uuids, r2 references and storage keys that reach a compiled field', () => {
    const scene = buildCanonicalImageScene({
      ...MEDIEVAL_MARKET_INPUT,
      characters: [
        {
          ...MEDIEVAL_MARKET_INPUT.characters[0],
          appearanceSummary:
            'wizard r2://media/secret-key.webp linked to b3f1c2d4-5678-4abc-9def-0123456789ab and internal/store-42',
        },
        MEDIEVAL_MARKET_INPUT.characters[1],
      ],
    });
    const result = compileImagePrompt(scene, CAP);
    expect(result.fullPrompt).not.toMatch(UUID_RE);
    expect(result.fullPrompt).not.toContain('r2://');
    expect(result.fullPrompt).not.toContain('internal/');
    expect(result.warnings.some((w) => w.startsWith('redacted'))).toBe(true);
  });

  it('never serializes provenance or internal scene metadata into the prompt', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const result = compileImagePrompt(scene, CAP);
    expect(result.fullPrompt).not.toContain('provenance');
    expect(result.fullPrompt).not.toContain('builderVersion');
    expect(result.fullPrompt).not.toContain('scene-builder');
    expect(result.fullPrompt).not.toContain('storyboard_plan');
  });

  it('does not leak character uuids from the fixture', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const result = compileImagePrompt(scene, CAP);
    expect(result.fullPrompt).not.toContain('b3f1c2d4-5678-4abc-9def-0123456789ab');
    expect(result.fullPrompt).not.toContain('a1b2c3d4-9999-4eee-8fff-abcdef012345');
  });
});
