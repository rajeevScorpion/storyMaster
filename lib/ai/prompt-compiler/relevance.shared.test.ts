import { describe, it, expect } from 'vitest';
import {
  filterAndDedupScene,
  canonicalizeNegativeConstraints,
  dedupPhrases,
  detectPhraseConflict,
  phraseKey,
} from './relevance.shared';
import { buildCanonicalImageScene, type CanonicalImageScene, type PanelPosition } from './scene-spec.shared';
import { MEDIEVAL_MARKET_INPUT, MINIMAL_INPUT, HINDI_VILLAGE_INPUT, HINDI_VILLAGE_PLAN } from './__fixtures__/scenes';

// scene-spec's English gate (Unit 4a) drops all-Hindi invariants/focus/
// negatives at build time, since the compiled prompt must be English-only.
// These tests exercise relevance.shared.ts's Unicode-safe dedup itself, so
// they repopulate the built scene with the fixture's raw Hindi content —
// independent of, and upstream of, that gate.
const FRAME_KEYS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
const POSITION_BY_FRAME_KEY: Record<(typeof FRAME_KEYS)[number], PanelPosition> = {
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
};

function withRawHindiContent(scene: CanonicalImageScene): CanonicalImageScene {
  const panels = scene.panels.map((panel) => {
    const frameKey = FRAME_KEYS.find((key) => POSITION_BY_FRAME_KEY[key] === panel.position)!;
    return { ...panel, visualFocus: [...HINDI_VILLAGE_PLAN[frameKey].visualFocus] };
  });
  return {
    ...scene,
    world: { ...scene.world, invariants: [...HINDI_VILLAGE_PLAN.sharedVisualInvariants] },
    panels,
    negativeConstraints: [...HINDI_VILLAGE_PLAN.negativeConstraints, ...scene.negativeConstraints],
  };
}

describe('phraseKey', () => {
  it('folds synonyms and ignores order/case/punctuation', () => {
    expect(phraseKey('Warm, golden palette.')).toBe(phraseKey('warm gold tone'));
    expect(phraseKey('speech balloons')).toBe(phraseKey('Speech Bubbles'));
  });

  it('does not collapse distinct non-Latin phrases to the empty key', () => {
    // अन्वी (a name) and अन्व (a truncation of it) must produce distinct,
    // non-empty keys — the old ASCII-only tokenizer mapped both to ''.
    const anvi = phraseKey('अन्वी');
    const anv = phraseKey('अन्व');
    expect(anvi).not.toBe('');
    expect(anv).not.toBe('');
    expect(anvi).not.toBe(anv);
  });

  it('keeps Devanagari combining marks so words are not shredded', () => {
    expect(phraseKey('बरगद का पेड़')).not.toBe('');
    expect(phraseKey('बरगद का पेड़')).toBe(phraseKey('पेड़ का बरगद'));
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

  it('keeps distinct Hindi negatives instead of collapsing them to one', () => {
    // None of these match an English canonical bucket, so they used to all
    // tokenize to the empty key and collapse into a single survivor.
    const result = canonicalizeNegativeConstraints(['टेक्स्ट', 'कैप्शन', 'आधुनिक वस्तुएँ', 'डुप्लिकेट पात्र']);
    expect(result.kept).toHaveLength(4);
  });
});

describe('dedupPhrases', () => {
  it('drops synonym duplicates, keeps the longer phrasing', () => {
    const result = dedupPhrases(['Warm golden palette', 'warm gold palette', 'cobblestone streets'], 'world.invariants');
    expect(result.kept).toEqual(['Warm golden palette', 'cobblestone streets']);
    expect(result.excluded).toHaveLength(1);
  });

  it('does not let a punctuation/emoji-only phrase swallow other phrases', () => {
    // "..." and "!!" both tokenize to the empty phraseKey. Before the raw
    // fallback, the second would be excluded as a "duplicate" of the first.
    const result = dedupPhrases(['...', '!!', 'a real phrase'], 'world.invariants');
    expect(result.kept).toEqual(['...', '!!', 'a real phrase']);
    expect(result.excluded).toHaveLength(0);
  });

  it('keeps distinct non-Latin phrases (Hindi) that used to share the empty key', () => {
    const result = dedupPhrases(
      ['धुंधली सुबह की रोशनी खेतों पर फैली हुई है', 'गाँव के घरों की मिट्टी की दीवारें और खपरैल छतें'],
      'world.invariants'
    );
    expect(result.kept).toHaveLength(2);
    expect(result.excluded).toHaveLength(0);
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

  describe('non-Latin scenes (Hindi)', () => {
    it('keeps every distinct world invariant, visual-focus item and negative', () => {
      const scene = withRawHindiContent(buildCanonicalImageScene(HINDI_VILLAGE_INPUT));
      const { scene: filtered } = filterAndDedupScene(scene);
      // All 4 invariants are distinct topics — none should be dropped as a
      // "duplicate" of another via the empty phraseKey.
      expect(filtered.world.invariants).toHaveLength(4);
      // Every panel's visual-focus items are distinct within that panel and
      // none of them is only a character's name.
      for (const panel of filtered.panels) {
        expect(panel.visualFocus.length).toBeGreaterThan(0);
      }
      const topRight = filtered.panels.find((p) => p.position === 'top-right')!;
      // "अन्वी की पीली फ्रॉक" and "राघव की मुस्कान" are not bare names, so they
      // survive the redundant-character-name filter.
      expect(topRight.visualFocus).toHaveLength(2);
      // Negatives: the 13 baseline English negatives canonicalize into 4
      // buckets (text/gutters/panels/duplicates); the 4 Hindi negatives match
      // no English bucket and must each survive distinctly (8 total) rather
      // than collapsing into one via the empty phraseKey.
      expect(filtered.negativeConstraints).toHaveLength(8);
    });

    it('still dedups genuinely identical Hindi phrases', () => {
      const scene = withRawHindiContent(buildCanonicalImageScene(HINDI_VILLAGE_INPUT));
      scene.world.invariants = [...scene.world.invariants, scene.world.invariants[0]];
      const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
      expect(filtered.world.invariants).toHaveLength(4);
      expect(diagnostics.excluded.some((e) => e.field === 'world.invariants' && e.reason === 'duplicate')).toBe(true);
    });

    it('does not hoist or drop a Hindi focus item unless it really is only a character name', () => {
      const scene = withRawHindiContent(buildCanonicalImageScene(HINDI_VILLAGE_INPUT));
      // Make a genuine bare-name focus item ("राघव") appear in >= 3 panels —
      // it must be dropped as redundant-character-name, not hoisted.
      for (const panel of scene.panels) panel.visualFocus.push('राघव');
      const { scene: filtered, diagnostics } = filterAndDedupScene(scene);
      expect(filtered.world.invariants.some((i) => i === 'राघव')).toBe(false);
      expect(filtered.panels.every((p) => !p.visualFocus.includes('राघव'))).toBe(true);
      expect(diagnostics.excluded.some((e) => e.reason === 'redundant-character-name' && e.detail === 'राघव')).toBe(true);
    });
  });
});
