import { describe, it, expect } from 'vitest';
import {
  buildCanonicalImageScene,
  validateCanonicalImageScene,
  deriveCharactersPresent,
  findWholeName,
  sanitizeText,
  slugifyCharacterKey,
  SCENE_SCHEMA_VERSION,
  SCENE_LIMITS,
  type CanonicalImageScene,
  type SceneCharacter,
} from './scene-spec.shared';
import {
  MEDIEVAL_MARKET_INPUT,
  MEDIEVAL_MARKET_PLAN,
  MINIMAL_INPUT,
  LEGACY_TEXT_INPUT,
  HINDI_VILLAGE_PLAN,
  HINDI_VILLAGE_INPUT,
  ANVI,
  RAGHAV,
  LAYLA,
  SAKURA,
  ELRICK,
  LEO,
} from './__fixtures__/scenes';

describe('buildCanonicalImageScene', () => {
  it('builds a storyboard scene from the plan, using description not the redundant prompt field', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    expect(scene.provenance.source).toBe('storyboard_plan');
    expect(scene.panels).toHaveLength(4);
    const bottomLeft = scene.panels.find((p) => p.position === 'bottom-left')!;
    expect(bottomLeft.action).toContain('tosses a bright red apple');
    // The per-frame `prompt` field (the redundant composer copy) must be ignored.
    const serialized = JSON.stringify(scene);
    expect(serialized).not.toContain('REDUNDANT COMPOSER PROMPT');
  });

  it('derives stable character keys from names, never uuids', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    expect(scene.characters.map((c) => c.key)).toEqual(['master-elrick', 'leo']);
    for (const character of scene.characters) {
      expect(character.key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it('excludes uuids, personality summaries and portrait flags from the scene', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const serialized = JSON.stringify(scene);
    expect(serialized).not.toContain(ELRICK.id);
    expect(serialized).not.toContain(LEO.id);
    expect(serialized).not.toContain('patient mentor');
    expect(serialized).not.toContain('inquisitive apprentice');
    expect(serialized).not.toContain('hasReferencePortrait');
    // hasReference boolean is kept (it drives reference mapping, not text).
    expect(scene.characters.every((c) => c.hasReference)).toBe(true);
  });

  it('maps composer-supplied charactersPresent by display name to keys', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    const topLeft = scene.panels.find((p) => p.position === 'top-left')!;
    const topRight = scene.panels.find((p) => p.position === 'top-right')!;
    const bottomLeft = scene.panels.find((p) => p.position === 'bottom-left')!;
    expect(topLeft.charactersPresent).toEqual([]);
    expect(topRight.charactersPresent.sort()).toEqual(['leo', 'master-elrick']);
    expect(bottomLeft.charactersPresent).toEqual(['master-elrick']);
  });

  it('falls back to derivation (with absence guard) when charactersPresent is absent', () => {
    const strippedPlan = structuredClone(MEDIEVAL_MARKET_PLAN);
    for (const key of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      delete strippedPlan[key].charactersPresent;
    }
    const scene = buildCanonicalImageScene({ ...MEDIEVAL_MARKET_INPUT, storyboardPlan: strippedPlan });
    const topRight = scene.panels.find((p) => p.position === 'top-right')!;
    const bottomLeft = scene.panels.find((p) => p.position === 'bottom-left')!;
    // "Leo is absent" in bottom-left must NOT count Leo as present.
    expect(bottomLeft.charactersPresent).toEqual(['master-elrick']);
    expect(topRight.charactersPresent.sort()).toEqual(['leo', 'master-elrick']);
  });

  it('carries regeneration deltas as scoped user directives', () => {
    const scene = buildCanonicalImageScene({
      ...MEDIEVAL_MARKET_INPUT,
      regeneration: {
        mode: 'refine',
        overallSuggestion: 'make the market busier and add evening light',
        panelSuggestions: { bottomRight: 'move the apple closer to Leo', topLeft: '   ' },
      },
    });
    expect(scene.userDirectives?.mode).toBe('refine');
    expect(scene.userDirectives?.overall).toBe('make the market busier and add evening light');
    expect(scene.userDirectives?.perPanel).toEqual({ 'bottom-right': 'move the apple closer to Leo' });
  });

  it('applies the legacy conversion path when no plan exists', () => {
    const scene = buildCanonicalImageScene(LEGACY_TEXT_INPUT);
    expect(scene.provenance.source).toBe('legacy_text');
    expect(scene.panels).toHaveLength(0);
    expect(scene.legacyText).toContain('A market square');
  });

  it('sanitizes and length-caps free text', () => {
    const scene = buildCanonicalImageScene({
      ...MINIMAL_INPUT,
      characters: [
        {
          ...MINIMAL_INPUT.characters[0],
          appearanceSummary: 'x'.repeat(500),
          name: 'WeirdName\twith\ncontrol',
        },
        MINIMAL_INPUT.characters[1],
      ],
    });
    expect(scene.characters[0].visualIdentity.length).toBeLessThanOrEqual(SCENE_LIMITS.visualIdentity);
    expect(scene.characters[0].displayName).toBe('Weird Name with control');
  });
});

describe('slugifyCharacterKey', () => {
  it('slugifies and dedupes', () => {
    expect(slugifyCharacterKey('Master Elrick')).toBe('master-elrick');
    expect(slugifyCharacterKey("  D'Artagnan!! ")).toBe('d-artagnan');
  });

  it('disambiguates colliding names in the builder', () => {
    const scene = buildCanonicalImageScene({
      ...MINIMAL_INPUT,
      characters: [
        { ...MINIMAL_INPUT.characters[0], name: 'Guard' },
        { ...MINIMAL_INPUT.characters[1], name: 'Guard' },
      ],
    });
    expect(scene.characters.map((c) => c.key)).toEqual(['guard', 'guard-2']);
  });
});

function sceneChar(key: string, displayName: string): SceneCharacter {
  return { key, displayName, visualIdentity: '', hasReference: false, continuityPriority: 'critical' };
}

describe('findWholeName', () => {
  it('matches Devanagari names on a real word boundary', () => {
    expect(findWholeName(`${RAGHAV.name} अपने खेत की मेड़ पर खड़े हैं।`, RAGHAV.name)).toBe(0);
  });

  it('does not match a name that is a prefix of a longer Devanagari word', () => {
    // अन्वी = अन्व + ी, and ी (U+0940) is a combining mark (\p{M}), not a
    // letter — the boundary check must include \p{M} or this would wrongly match.
    const truncated = ANVI.name.slice(0, -1); // अन्व
    expect(findWholeName(`${ANVI.name} दौड़ रही है।`, truncated)).toBe(-1);
    expect(findWholeName(`${ANVI.name} दौड़ रही है।`, ANVI.name)).toBe(0);
  });

  it('matches Arabic names', () => {
    expect(findWholeName(`${LAYLA.name} تجلس في الحديقة.`, LAYLA.name)).toBe(0);
  });

  it('matches a Japanese name immediately followed by a particle (no space)', () => {
    expect(findWholeName(`${SAKURA.name}は学校に行った。`, SAKURA.name)).toBe(0);
  });

  it('English regression: Leo does not match inside Leonard', () => {
    expect(findWholeName('Leonard walked in.', 'Leo')).toBe(-1);
    expect(findWholeName('Leo walked in.', 'Leo')).toBe(0);
  });

  it('is case-insensitive and returns -1 when absent', () => {
    expect(findWholeName('LEO walked in.', 'Leo')).toBe(0);
    expect(findWholeName('A quiet empty street.', 'Leo')).toBe(-1);
  });
});

describe('deriveCharactersPresent', () => {
  it('matches whole words and respects absence', () => {
    const chars = [sceneChar('leo', 'Leo'), sceneChar('master-elrick', 'Master Elrick')];
    expect(deriveCharactersPresent('Master Elrick tosses an apple. Leo is absent.', chars).sort()).toEqual(['master-elrick']);
    expect(deriveCharactersPresent('A quiet empty street.', chars)).toEqual([]);
  });

  it('finds Devanagari, Arabic and Japanese names', () => {
    const chars = [
      sceneChar('raghav', RAGHAV.name),
      sceneChar('anvi', ANVI.name),
      sceneChar('layla', LAYLA.name),
      sceneChar('sakura', SAKURA.name),
    ];
    expect(deriveCharactersPresent(`${RAGHAV.name} अपने खेत की मेड़ पर खड़े हैं।`, chars)).toEqual(['raghav']);
    expect(deriveCharactersPresent(`${LAYLA.name} تجلس في الحديقة.`, chars)).toEqual(['layla']);
    expect(deriveCharactersPresent(`${SAKURA.name}は学校に行った。`, chars)).toEqual(['sakura']);
  });

  it('does not treat a name-prefix as present inside a longer Devanagari word', () => {
    const truncated = ANVI.name.slice(0, -1); // अन्व, a prefix of अन्वी
    const chars = [sceneChar('anv', truncated), sceneChar('anvi', ANVI.name)];
    expect(deriveCharactersPresent(`${ANVI.name} दौड़ रही है।`, chars)).toEqual(['anvi']);
  });

  it('the Hindi danda (।) negation guard excludes an absent character', () => {
    const chars = [sceneChar('anvi', ANVI.name)];
    expect(deriveCharactersPresent(`${ANVI.name} is absent।`, chars)).toEqual([]);
  });
});

describe('resolvePanelCharacters fallback (via buildCanonicalImageScene)', () => {
  it('falls back to text derivation when explicit charactersPresent resolves to nothing', () => {
    const strippedPlan = structuredClone(HINDI_VILLAGE_PLAN);
    strippedPlan.topRight.charactersPresent = ['Some Unresolvable Transliteration'];
    const scene = buildCanonicalImageScene({ ...HINDI_VILLAGE_INPUT, storyboardPlan: strippedPlan });
    const raghavKey = scene.characters.find((c) => c.displayName === 'राघव')!.key;
    const anviKey = scene.characters.find((c) => c.displayName === 'अन्वी')!.key;
    const topRight = scene.panels.find((p) => p.position === 'top-right')!;
    // The composer's name didn't resolve, so this falls back to deriving from
    // the Hindi action text, which names both characters.
    expect(topRight.charactersPresent.sort()).toEqual([anviKey, raghavKey].sort());
  });
});

describe('sanitizeText', () => {
  it('never exceeds the cap', () => {
    const long = 'The quick brown fox jumps over the lazy dog and then runs away quickly. '.repeat(5);
    for (const cap of [10, 30, 80, 160]) {
      expect(sanitizeText(long, cap).length).toBeLessThanOrEqual(cap);
    }
  });

  it('does not end mid-word for Latin input with spaces', () => {
    const text = 'The quick brown fox jumps over the lazy dog and then runs away quickly';
    const cap = 30;
    const result = sanitizeText(text, cap);
    expect(result.length).toBeLessThanOrEqual(cap);
    const sourceWords = text.split(/\s+/);
    for (const word of result.split(/\s+/).filter(Boolean)) {
      expect(sourceWords).toContain(word.replace(/[.,;:]+$/, ''));
    }
  });

  it('does not end mid-word for Hindi input with spaces', () => {
    const text = 'धुंधली सुबह की रोशनी खेतों पर फैली हुई है और गाँव जाग उठा है';
    const cap = 35;
    const result = sanitizeText(text, cap);
    expect(result.length).toBeLessThanOrEqual(cap);
    const sourceWords = text.split(/\s+/);
    for (const word of result.split(/\s+/).filter(Boolean)) {
      expect(sourceWords).toContain(word);
    }
  });

  it('does not split a surrogate pair for emoji input', () => {
    const text = '🎉🎊🎈🎆🎇🧨✨🎃👻💀☠️👽🤖🎭🖼️ celebration party festival'.repeat(3);
    const cap = 12;
    const result = sanitizeText(text, cap);
    expect(result.length).toBeLessThanOrEqual(cap);
    const lastCode = result.length > 0 ? result.charCodeAt(result.length - 1) : 0;
    // A lone leading (high) surrogate at the very end means a pair was split.
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
  });

  it('is deterministic for a given runtime', () => {
    const text = 'धुंधली सुबह की रोशनी खेतों पर फैली हुई है और गाँव जाग उठा है';
    expect(sanitizeText(text, 35)).toBe(sanitizeText(text, 35));
  });
});

describe('validateCanonicalImageScene', () => {
  it('accepts a well-formed scene', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT);
    expect(validateCanonicalImageScene(scene)).toEqual({ ok: true, errors: [] });
  });

  it('rejects unknown schema versions safely', () => {
    const result = validateCanonicalImageScene({ schemaVersion: '99.0' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unsupported schemaVersion');
  });

  it('rejects wrong panel count and unknown character refs', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT) as CanonicalImageScene;
    const broken = structuredClone(scene);
    broken.panels[0].charactersPresent = ['ghost'];
    broken.panels = broken.panels.slice(0, 3);
    const result = validateCanonicalImageScene(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('expected 4 panels'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknown character ghost'))).toBe(true);
  });

  it('rejects a character key that looks like a uuid', () => {
    const scene = buildCanonicalImageScene(MEDIEVAL_MARKET_INPUT) as CanonicalImageScene;
    const broken = structuredClone(scene);
    broken.characters[0].key = 'b3f1c2d4-5678-4abc-9def-0123456789ab';
    const result = validateCanonicalImageScene(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('looks like a uuid'))).toBe(true);
  });

  it('accepts the metadata baseline for a legacy_text scene', () => {
    const scene = buildCanonicalImageScene(LEGACY_TEXT_INPUT);
    expect(scene.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
    expect(validateCanonicalImageScene(scene).ok).toBe(true);
  });
});
