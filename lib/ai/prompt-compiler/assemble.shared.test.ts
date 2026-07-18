import { describe, it, expect } from 'vitest';
import {
  assembleFinalImagePrompt,
  normalizeImagePromptCompilerMode,
  ImagePromptCompileError,
  type ImagePromptCompilerRuntime,
} from './assemble.shared';
import { buildCanonicalImageScene, type CanonicalImageScene } from './scene-spec.shared';
import { MEDIEVAL_MARKET_INPUT } from './__fixtures__/scenes';

const LEGACY = 'LEGACY PROMPT TEXT';
const legacyBuild = () => LEGACY;

function runtime(mode: ImagePromptCompilerRuntime['mode'], enabled = true): ImagePromptCompilerRuntime {
  return {
    mode,
    capability: { enabled, promptBudgetChars: 2800, supportsNegativePrompt: false, adapterVersion: 'gemini-v1' },
  };
}

const scene = () => buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);

describe('normalizeImagePromptCompilerMode', () => {
  it('passes known modes and defaults unknown to legacy', () => {
    expect(normalizeImagePromptCompilerMode('shadow')).toBe('shadow');
    expect(normalizeImagePromptCompilerMode('new_with_legacy_fallback')).toBe('new_with_legacy_fallback');
    expect(normalizeImagePromptCompilerMode('bogus')).toBe('legacy');
    expect(normalizeImagePromptCompilerMode(null)).toBe('legacy');
  });
});

describe('assembleFinalImagePrompt', () => {
  it('legacy mode returns the legacy prompt with no metadata', () => {
    const result = assembleFinalImagePrompt({ runtime: runtime('legacy'), scene: scene(), legacyBuild });
    expect(result.finalPrompt).toBe(LEGACY);
    expect(result.engine).toBe('legacy');
    expect(result.compiler).toBeUndefined();
  });

  it('disabled capability forces legacy even in new mode', () => {
    const result = assembleFinalImagePrompt({ runtime: runtime('new', false), scene: scene(), legacyBuild });
    expect(result.finalPrompt).toBe(LEGACY);
    expect(result.engine).toBe('legacy');
    expect(result.compiler).toBeUndefined();
  });

  it('null runtime forces legacy', () => {
    const result = assembleFinalImagePrompt({ runtime: null, scene: scene(), legacyBuild });
    expect(result.engine).toBe('legacy');
  });

  it('shadow sends legacy but records compiled diagnostics + preview', () => {
    const result = assembleFinalImagePrompt({ runtime: runtime('shadow'), scene: scene(), legacyBuild });
    expect(result.finalPrompt).toBe(LEGACY);
    expect(result.engine).toBe('legacy');
    expect(result.compiler?.mode).toBe('shadow');
    expect(result.compiler?.legacyChars).toBe(LEGACY.length);
    expect(result.compiler?.compiledChars).toBeGreaterThan(0);
    expect(result.compiler?.compiledPreview).toContain('four equal panels');
  });

  it('shadow never throws on an invalid scene — records the failure', () => {
    const broken = { ...scene(), panels: [] } as CanonicalImageScene;
    const result = assembleFinalImagePrompt({ runtime: runtime('shadow'), scene: broken, legacyBuild });
    expect(result.finalPrompt).toBe(LEGACY);
    expect(result.compiler?.fallbackReason).toBeTruthy();
  });

  it('new sends the compiled prompt', () => {
    const result = assembleFinalImagePrompt({ runtime: runtime('new'), scene: scene(), legacyBuild });
    expect(result.finalPrompt).not.toBe(LEGACY);
    expect(result.finalPrompt).toContain('four equal panels');
    expect(result.engine).toBe('compiled');
    expect(result.compiler?.compiledChars).toBe(result.finalPrompt.length);
  });

  it('new throws ImagePromptCompileError on an invalid scene', () => {
    const broken = { ...scene(), panels: [] } as CanonicalImageScene;
    expect(() => assembleFinalImagePrompt({ runtime: runtime('new'), scene: broken, legacyBuild })).toThrow(
      ImagePromptCompileError
    );
  });

  it('new_with_legacy_fallback falls back to legacy with a reason on failure', () => {
    const broken = { ...scene(), panels: [] } as CanonicalImageScene;
    const result = assembleFinalImagePrompt({ runtime: runtime('new_with_legacy_fallback'), scene: broken, legacyBuild });
    expect(result.finalPrompt).toBe(LEGACY);
    expect(result.engine).toBe('compiled_fallback_legacy');
    expect(result.compiler?.fallbackReason).toBeTruthy();
  });

  it('new_with_legacy_fallback uses the compiled prompt when compilation succeeds', () => {
    const result = assembleFinalImagePrompt({ runtime: runtime('new_with_legacy_fallback'), scene: scene(), legacyBuild });
    expect(result.engine).toBe('compiled');
    expect(result.finalPrompt).toContain('four equal panels');
  });
});
