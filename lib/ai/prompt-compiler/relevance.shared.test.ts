import { describe, it, expect } from 'vitest';
import {
  filterAndDedupScene,
  canonicalizeNegativeConstraints,
  dedupPhrases,
  detectPhraseConflict,
  phraseKey,
} from './relevance.shared';
import { buildCanonicalImageScene } from './scene-spec.shared';
import { MEDIEVAL_MARKET_INPUT, MINIMAL_INPUT } from './__fixtures__/scenes';

describe('phraseKey', () => {
  it('folds synonyms and ignores order/case/punctuation', () => {
    expect(phraseKey('Warm, golden palette.')).toBe(phraseKey('warm gold tone'));
    expect(phraseKey('speech balloons')).toBe(phraseKey('Speech Bubbles'));
  });
});

describe('canonicalizeNegativeConstraints', () => {
  it('collapses the no-text and gutter families into one representative each', () => {
    const result = canonicalizeNegativeConstraints([
      'text', 'captions', 'speech bubbles', 'watermarks',
      'white gutters', 'cream gutters', 'outer borders',
      'extra panels', 'nested panels',
    ]);
    // one text bucket, one gutter bucket, one panels bucket = 3 kept.
    expect(result.kept).toHaveLength(3);
    expect(result.kept.some((k) => k.includes('captions'))).toBe(true);
    expect(result.excluded.length).toBeGreaterThan(0);
    expect(result.converted.length).toBeGreaterThan(0);
  });

  it('is deterministic (lexicographically sorted)', () => {
    const a = canonicalizeNegativeConstraints(['nested panels', 'text', 'gutters']);
    const b = canonicalizeNegativeConstraints(['gutters', 'nested panels', 'text']);
    expect(a.kept).toEqual(b.kept);
    expect(a.kept).toEqual([...a.kept].sort((x, y) => x.localeCompare(y)));
  });
});

describe('dedupPhrases', () => {
  it('drops synonym duplicates, keeps the longer phrasing', () => {
    const result = dedupPhrases(['Warm golden palette', 'warm gold palette', 'cobblestone streets'], 'world.invariants');
    expect(result.kept).toEqual(['Warm golden palette', 'cobblestone streets']);
    expect(result.excluded).toHaveLength(1);
  });
});

describe('detectPhraseConflict', () => {
  it('flags conflicting colors, temperatures, shots and emotions', () => {
    expect(detectPhraseConflict('a red apple', 'a green apple')).toBe('color');
    expect(detectPhraseConflict('warm golden light', 'cold blue light')).toBeTruthy();
    expect(detectPhraseConflict('wide establishing shot', 'tight close-up')).toBe('shot');
    expect(detectPhraseConflict('a smiling face', 'a worried face')).toBe('emotion');
  });

  it('does not flag compatible phrases', () => {
    expect(detectPhraseConflict('golden sunlight', 'warm amber tones')).toBeNull();
    expect(detectPhraseConflict('cobblestone streets', 'wooden stalls')).toBeNull();
  });
});

describe('filterAndDedupScene', () => {
  it('dedups negatives and reports diagnostics without dropping critical data', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
    expect(diagnostics.included).toContain('characters');
    expect(diagnostics.included).toContain('panels');
    // Characters and panels are untouched in count.
    expect(filtered.characters).toHaveLength(2);
    expect(filtered.panels).toHaveLength(4);
    // Negatives are canonicalized (fewer than the merged baseline list).
    expect(filtered.negativeConstraints.length).toBeLessThan(scene.negativeConstraints.length);
  });

  it('hoists a visual focus shared by >= 3 panels to a global invariant', () => {
    const scene = buildCanonicalImageScene(MINIMAL_INPUT);
    scene.panels[0].visualFocus = ['torch light'];
    scene.panels[1].visualFocus = ['torch light'];
    scene.panels[2].visualFocus = ['torch light'];
    const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
    expect(filtered.world.invariants.some((i) => /torch light/i.test(i))).toBe(true);
    expect(diagnostics.converted.some((c) => c.reason === 'hoisted-to-global')).toBe(true);
    expect(filtered.panels.every((p) => !p.visualFocus.includes('torch light'))).toBe(true);
  });

  it('demotes a global invariant that names exactly one panel', () => {
    const scene = buildCanonicalImageScene(MINIMAL_INPUT);
    scene.world.invariants = [...scene.world.invariants, 'In the bottom-right, a lantern glows'];
    const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
    expect(filtered.world.invariants.some((i) => /lantern/i.test(i))).toBe(false);
    const bottomRight = filtered.panels.find((p) => p.position === 'bottom-right')!;
    expect(bottomRight.visualFocus.some((f) => /lantern/i.test(f))).toBe(true);
    expect(diagnostics.converted.some((c) => c.reason === 'demoted-to-panel')).toBe(true);
  });

  it('warns on conflicting invariants but keeps both', () => {
    const scene = buildCanonicalImageScene(MINIMAL_INPUT);
    scene.world.invariants = ['warm golden daylight', 'cold blue moonlight'];
    const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
    expect(filtered.world.invariants).toHaveLength(2);
    expect(diagnostics.warnings.length).toBeGreaterThan(0);
  });

  it('drops visual-focus items that only restate a present character name', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
    const topRight = filtered.panels.find((p) => p.position === 'top-right')!;
    expect(topRight.visualFocus.some((f) => /leo|elrick/i.test(f))).toBe(false);
    expect(diagnostics.excluded.some((e) => e.reason === 'redundant-character-name')).toBe(true);
  });
});
