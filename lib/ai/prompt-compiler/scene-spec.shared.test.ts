import { describe, it, expect } from 'vitest';
import {
  buildCanonicalImageScene,
  validateCanonicalImageScene,
  deriveCharactersPresent,
  slugifyCharacterKey,
  SCENE_SCHEMA_VERSION,
  SCENE_LIMITS,
  type CanonicalImageScene,
} from './scene-spec.shared';
import {
  MEDIEVAL_MARKET_INPUT,
  MEDIEVAL_MARKET_PLAN,
  MINIMAL_INPUT,
  LEGACY_TEXT_INPUT,
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

describe('deriveCharactersPresent', () => {
  it('matches whole words and respects absence', () => {
    const chars = [
      { key: 'leo', displayName: 'Leo', visualIdentity: '', hasReference: false, continuityPriority: 'critical' as const },
      { key: 'master-elrick', displayName: 'Master Elrick', visualIdentity: '', hasReference: false, continuityPriority: 'critical' as const },
    ];
    expect(deriveCharactersPresent('Master Elrick tosses an apple. Leo is absent.', chars).sort()).toEqual(['master-elrick']);
    expect(deriveCharactersPresent('A quiet empty street.', chars)).toEqual([]);
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
