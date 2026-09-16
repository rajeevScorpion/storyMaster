import { describe, expect, it } from 'vitest';
import {
  normalizeStoryboardPlan,
  resolveContinuityContradictions,
  presentCharacterNames,
  filterCharacterReferencesByPresence,
  shouldAttachPreviousStoryboardReference,
} from './storyboard-plan.shared';
import type { Character, StoryboardFramePlan, StoryboardPlan } from '@/lib/types/story';

function baseFrame(overrides: Record<string, unknown> = {}) {
  return {
    description: 'A wide shot of the harbor at dawn.',
    prompt: 'The harbor glows under a soft sunrise.',
    cameraAngle: 'wide establishing shot',
    visualFocus: ['harbor', 'sunrise light'],
    emotion: 'hope',
    continuityAnchor: 'the harbor scene',
    charactersPresent: ['Anvi'],
    storyFunction: 'ESTABLISH',
    timeRelationToPreviousPanel: 'continuous',
    appearanceChanges: [],
    shotScale: 'wide',
    cameraHeight: 'eye level',
    visualEcho: false,
    ...overrides,
  };
}

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    sharedVisualInvariants: ['same painterly art style throughout'],
    portraitTasks: [],
    topLeft: baseFrame(),
    topRight: baseFrame(),
    bottomLeft: baseFrame(),
    bottomRight: baseFrame(),
    negativeConstraints: ['no text overlays'],
    transition: { timeRelation: 'continuous', locationRelation: 'same_exact', evidence: 'same scene, seconds later' },
    setting: { location: 'harbor', timeOfDay: 'dawn', era: 'present day' },
    characterVisuals: [
      {
        name: 'Anvi',
        englishName: 'Anvi',
        identityAnchors: 'warm brown eyes, oval face',
        currentAppearance: 'teenage girl in a blue jacket',
        modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
      },
    ],
    mustNotInherit: [],
    ...overrides,
  };
}

const CTX = { characterNames: ['Anvi'] };

describe('normalizeStoryboardPlan - shape coercion', () => {
  it('coerces a completely empty plan: missing arrays to [], missing strings to "", frames to minimal empty frames', () => {
    const { plan, needsLanguageFallback } = normalizeStoryboardPlan({}, { characterNames: [] });

    expect(plan.sharedVisualInvariants).toEqual([]);
    expect(plan.negativeConstraints).toEqual([]);
    expect(plan.mustNotInherit).toEqual([]);
    expect(plan.portraitTasks).toEqual([]);
    expect(plan.characterVisuals).toEqual([]);
    expect(plan.topLeft.description).toBe('');
    expect(plan.topLeft.cameraAngle).toBe('');
    expect(plan.topLeft.visualFocus).toEqual([]);
    expect(plan.topLeft.charactersPresent).toEqual([]);
    // needsLanguageFallback is true because every panel has an empty description.
    expect(needsLanguageFallback).toBe(true);
  });

  it('handles non-object raw input the same as an empty object', () => {
    const { plan, needsLanguageFallback } = normalizeStoryboardPlan(null, { characterNames: [] });
    expect(plan.topLeft.description).toBe('');
    expect(needsLanguageFallback).toBe(true);
  });
});

describe('normalizeStoryboardPlan - empty panel description', () => {
  it('flags needsLanguageFallback when one panel description is empty, even if the rest is valid', () => {
    const raw = basePlan({ topLeft: baseFrame({ description: '' }) });
    const { needsLanguageFallback } = normalizeStoryboardPlan(raw, CTX);
    expect(needsLanguageFallback).toBe(true);
  });

  it('does not flag needsLanguageFallback for an otherwise-valid all-English plan', () => {
    const { needsLanguageFallback } = normalizeStoryboardPlan(basePlan(), CTX);
    expect(needsLanguageFallback).toBe(false);
  });
});

describe('normalizeStoryboardPlan - enum normalization', () => {
  it('maps an unknown timeRelation/locationRelation/timeRelationToPreviousPanel to "unknown"', () => {
    const raw = basePlan({
      transition: { timeRelation: 'not-a-value', locationRelation: 'also-bad', evidence: 'seconds later' },
      topLeft: baseFrame({ timeRelationToPreviousPanel: 'nonsense' }),
    });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.transition?.timeRelation).toBe('unknown');
    expect(plan.transition?.locationRelation).toBe('unknown');
    expect(plan.topLeft.timeRelationToPreviousPanel).toBe('unknown');
  });

  it('maps an unknown storyFunction or continuity mode to undefined', () => {
    const raw = basePlan({
      topLeft: baseFrame({ storyFunction: 'NOT_A_FUNCTION' }),
      characterVisuals: [
        {
          name: 'Anvi',
          englishName: 'Anvi',
          identityAnchors: 'warm brown eyes',
          currentAppearance: 'teenage girl',
          modes: { age: 'bogus', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.topLeft.storyFunction).toBeUndefined();
    expect(plan.characterVisuals?.[0].modes.age).toBeUndefined();
    expect(plan.characterVisuals?.[0].modes.hair).toBe('EVOLVE');
  });
});

describe('normalizeStoryboardPlan - English enforcement', () => {
  it('drops non-English items from list fields but keeps English ones', () => {
    const raw = basePlan({
      sharedVisualInvariants: ['same painterly art style', 'हिंदी में एक वाक्य'],
      negativeConstraints: ['no text overlays', 'कोई पाठ नहीं'],
      mustNotInherit: ['previous wardrobe', 'पिछला परिधान'],
      topLeft: baseFrame({
        visualFocus: ['harbor light', 'तट की रोशनी'],
        appearanceChanges: ['now wears a coat', 'अब कोट पहनती है'],
      }),
    });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.sharedVisualInvariants).toEqual(['same painterly art style']);
    expect(plan.negativeConstraints).toEqual(['no text overlays']);
    expect(plan.mustNotInherit).toEqual(['previous wardrobe']);
    expect(plan.topLeft.visualFocus).toEqual(['harbor light']);
    expect(plan.topLeft.appearanceChanges).toEqual(['now wears a coat']);
  });

  it('blanks (not drops) a non-English scalar field', () => {
    const raw = basePlan({
      topLeft: baseFrame({ emotion: 'डर', continuityAnchor: 'पिछला दृश्य', prompt: 'यह एक वाक्य है', shotScale: 'चौड़ा', cameraHeight: 'आँख के स्तर पर' }),
      transition: { timeRelation: 'continuous', locationRelation: 'same_exact', evidence: 'कुछ सेकंड बाद' },
      setting: { location: 'बंदरगाह', timeOfDay: 'भोर', era: 'वर्तमान' },
      characterVisuals: [
        {
          name: 'Anvi',
          englishName: 'Anvi',
          identityAnchors: 'गर्म भूरी आँखें',
          currentAppearance: 'किशोरी नीली जैकेट में',
          modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.topLeft.emotion).toBe('');
    expect(plan.topLeft.continuityAnchor).toBe('');
    expect(plan.topLeft.prompt).toBe('');
    expect(plan.topLeft.shotScale).toBe('');
    expect(plan.topLeft.cameraHeight).toBe('');
    expect(plan.transition?.evidence).toBe('');
    expect(plan.setting?.location).toBe('');
    expect(plan.setting?.timeOfDay).toBe('');
    expect(plan.setting?.era).toBe('');
    expect(plan.characterVisuals?.[0].identityAnchors).toBe('');
    expect(plan.characterVisuals?.[0].currentAppearance).toBe('');
  });

  it('flags needsLanguageFallback when a panel description is non-English', () => {
    const raw = basePlan({ topLeft: baseFrame({ description: 'यह बंदरगाह पर सुबह का एक दृश्य है।' }) });
    const { needsLanguageFallback } = normalizeStoryboardPlan(raw, CTX);
    expect(needsLanguageFallback).toBe(true);
  });

  it('flags needsLanguageFallback when a panel cameraAngle is non-English', () => {
    const raw = basePlan({ topLeft: baseFrame({ cameraAngle: 'चौड़ा शॉट' }) });
    const { needsLanguageFallback } = normalizeStoryboardPlan(raw, CTX);
    expect(needsLanguageFallback).toBe(true);
  });

  it('tolerates a canonical non-Latin character name embedded in an otherwise-English description', () => {
    const raw = basePlan({
      topLeft: baseFrame({ description: 'अन्वी looks out over the harbor as the sun rises.' }),
      characterVisuals: [
        {
          name: 'अन्वी',
          englishName: 'Anvi',
          identityAnchors: 'warm brown eyes',
          currentAppearance: 'teenage girl',
          modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const { needsLanguageFallback } = normalizeStoryboardPlan(raw, { characterNames: ['अन्वी'] });
    expect(needsLanguageFallback).toBe(false);
  });
});

describe('normalizeStoryboardPlan - character name canonicalization', () => {
  it('maps a charactersPresent entry given as englishName back to the canonical name', () => {
    const raw = basePlan({
      topLeft: baseFrame({
        description: 'अन्वी looks out over the harbor as the sun rises.',
        charactersPresent: ['Anvi'],
      }),
      characterVisuals: [
        {
          name: 'अन्वी',
          englishName: 'Anvi',
          identityAnchors: 'warm brown eyes',
          currentAppearance: 'teenage girl',
          modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const { plan } = normalizeStoryboardPlan(raw, { characterNames: ['अन्वी'] });
    expect(plan.topLeft.charactersPresent).toEqual(['अन्वी']);
    expect(plan.characterVisuals?.[0].name).toBe('अन्वी');
  });

  it('drops a characterVisuals entry whose name does not resolve to a known character', () => {
    const raw = basePlan({
      characterVisuals: [
        {
          name: 'Anvi',
          englishName: 'Anvi',
          identityAnchors: 'warm brown eyes',
          currentAppearance: 'teenage girl',
          modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
        {
          name: 'Ghost Character',
          englishName: 'Ghost Character',
          identityAnchors: 'unknown',
          currentAppearance: 'unknown',
          modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.characterVisuals).toHaveLength(1);
    expect(plan.characterVisuals?.[0].name).toBe('Anvi');
  });

  it('blanks a non-Latin englishName', () => {
    const raw = basePlan({
      characterVisuals: [
        {
          name: 'Anvi',
          englishName: 'अन्वी',
          identityAnchors: 'warm brown eyes',
          currentAppearance: 'teenage girl',
          modes: { age: 'EVOLVE', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.characterVisuals?.[0].englishName).toBe('');
  });
});

describe('normalizeStoryboardPlan - portraitTasks', () => {
  it('preserves portraitTasks unvalidated, as today', () => {
    const portraitTasks = [{ characterId: 'c1', characterName: 'Anvi', reason: 'new_character', prompt: 'Anvi portrait' }];
    const raw = basePlan({ portraitTasks });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.portraitTasks).toEqual(portraitTasks);
  });

  it('defaults portraitTasks to [] when missing or not an array', () => {
    const raw = basePlan({ portraitTasks: 'not-an-array' });
    const { plan } = normalizeStoryboardPlan(raw, CTX);
    expect(plan.portraitTasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit 5: continuity contradiction resolution + presence-scoped references
// ---------------------------------------------------------------------------

function frame(overrides: Partial<StoryboardFramePlan> = {}): StoryboardFramePlan {
  return {
    description: 'A quiet moment in the story.',
    prompt: '',
    cameraAngle: 'medium shot',
    visualFocus: [],
    emotion: 'calm',
    continuityAnchor: '',
    charactersPresent: ['Anvi'],
    appearanceChanges: [],
    shotScale: '',
    cameraHeight: '',
    visualEcho: false,
    ...overrides,
  };
}

function plan(overrides: Partial<StoryboardPlan> = {}): StoryboardPlan {
  return {
    sharedVisualInvariants: ['adult Anvi has dark hair tied in an athletic ponytail'],
    portraitTasks: [],
    topLeft: frame(),
    topRight: frame(),
    bottomLeft: frame(),
    bottomRight: frame(),
    negativeConstraints: [],
    ...overrides,
  };
}

function character(overrides: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
  return { type: 'human', appearanceSummary: '', personalitySummary: '', ...overrides };
}

const ANVI: Character = character({ id: 'c1', name: 'Anvi' });
const RAJ: Character = character({ id: 'c2', name: 'Raj' });

describe('resolveContinuityContradictions', () => {
  it('a continuous scene (no transition) leaves the plan and continuity notes untouched', () => {
    const p = plan();
    const result = resolveContinuityContradictions(p, { continuityNotes: ['Keep the yellow hair clips visible.'] });
    expect(result.plan.mustNotInherit).toEqual([]);
    expect(result.continuityNotes).toEqual(['Keep the yellow hair clips visible.']);
    expect(result.warnings).toEqual([]);
    // Composer invariants describing the current (already up to date) state
    // are never touched by this function -- see the module header.
    expect(result.plan.sharedVisualInvariants).toEqual(p.sharedVisualInvariants);
  });

  it('years_later: a LOCKED age mode becomes EVOLVE, previous wardrobe/hairstyle are added to mustNotInherit, and a matching prior-state note is dropped', () => {
    const p = plan({
      transition: { timeRelation: 'years_later', locationRelation: 'same_exact', evidence: 'Years have passed.' },
      characterVisuals: [
        {
          name: 'Anvi',
          englishName: 'Anvi',
          identityAnchors: 'warm brown eyes',
          currentAppearance: 'adult woman',
          modes: { age: 'LOCKED', hair: 'EVOLVE', wardrobe: 'FREE', accessories: 'FREE' },
        },
      ],
    });
    const result = resolveContinuityContradictions(p, {
      continuityNotes: ['She always wears her yellow hair clips.', 'She loves adventure stories.'],
    });
    expect(result.plan.characterVisuals?.[0].modes.age).toBe('EVOLVE');
    expect(result.plan.mustNotInherit).toEqual(expect.arrayContaining(['previous wardrobe', 'previous hairstyle']));
    // The wardrobe/hair-referencing note is dropped; the unrelated one survives.
    expect(result.continuityNotes).toEqual(['She loves adventure stories.']);
    // Composer invariants (already-current-state) are never dropped for a jump.
    expect(result.plan.sharedVisualInvariants).toEqual(p.sharedVisualInvariants);
  });

  it('does not duplicate a mustNotInherit item the plan already declared (phrase-key containment)', () => {
    const p = plan({
      transition: { timeRelation: 'years_later', locationRelation: 'same_exact', evidence: 'later' },
      mustNotInherit: ['previous wardrobe and hairstyle'],
    });
    const result = resolveContinuityContradictions(p, {});
    expect(result.plan.mustNotInherit).toEqual(['previous wardrobe and hairstyle']);
  });

  it('a new_location transition adds previous location architecture and drops a location-referencing note', () => {
    const p = plan({
      transition: { timeRelation: 'continuous', locationRelation: 'new_location', evidence: 'They travelled to a new village.' },
    });
    const result = resolveContinuityContradictions(p, {
      continuityNotes: ['The village pond is always calm at dusk.', 'She is determined to succeed.'],
    });
    expect(result.plan.mustNotInherit).toContain('previous location architecture');
    expect(result.continuityNotes).toEqual(['She is determined to succeed.']);
  });

  it('a time jump staged inside a beat (panel-level) also counts as a big jump', () => {
    const p = plan({
      bottomRight: frame({ timeRelationToPreviousPanel: 'years_later' }),
    });
    const result = resolveContinuityContradictions(p, {});
    expect(result.plan.mustNotInherit).toEqual(expect.arrayContaining(['previous wardrobe', 'previous hairstyle']));
  });

  it('camera_repetition: 3+ panels sharing shotScale+cameraHeight with no visualEcho fires the warning', () => {
    const p = plan({
      topLeft: frame({ shotScale: 'medium shot', cameraHeight: 'eye level' }),
      topRight: frame({ shotScale: 'Medium Shot', cameraHeight: 'Eye Level' }), // same, different case
      bottomLeft: frame({ shotScale: 'medium shot', cameraHeight: 'eye level' }),
      bottomRight: frame({ shotScale: 'wide shot', cameraHeight: 'low angle' }),
    });
    const result = resolveContinuityContradictions(p, {});
    expect(result.warnings).toContain('camera_repetition');
  });

  it('a deliberate visual echo on one of the repeated shots suppresses the warning', () => {
    const p = plan({
      topLeft: frame({ shotScale: 'medium shot', cameraHeight: 'eye level' }),
      topRight: frame({ shotScale: 'medium shot', cameraHeight: 'eye level', visualEcho: true }),
      bottomLeft: frame({ shotScale: 'medium shot', cameraHeight: 'eye level' }),
      bottomRight: frame({ shotScale: 'wide shot', cameraHeight: 'low angle' }),
    });
    const result = resolveContinuityContradictions(p, {});
    expect(result.warnings).not.toContain('camera_repetition');
  });

  it('only two panels sharing a shot does not fire camera_repetition', () => {
    const p = plan({
      topLeft: frame({ shotScale: 'medium shot', cameraHeight: 'eye level' }),
      topRight: frame({ shotScale: 'medium shot', cameraHeight: 'eye level' }),
      bottomLeft: frame({ shotScale: 'wide shot', cameraHeight: 'low angle' }),
      bottomRight: frame({ shotScale: 'close up', cameraHeight: 'high angle' }),
    });
    const result = resolveContinuityContradictions(p, {});
    expect(result.warnings).not.toContain('camera_repetition');
  });
});

describe('presentCharacterNames', () => {
  it('returns null for a fallback plan (attach all, as today)', () => {
    expect(presentCharacterNames(plan({ fallbackReason: 'content_blocked' }), [ANVI, RAJ])).toBeNull();
    expect(presentCharacterNames(plan({ languageFallback: true }), [ANVI, RAJ])).toBeNull();
  });

  it('returns null when any frame lacks a charactersPresent array (a legacy stored plan)', () => {
    const legacyFrame = { ...frame() } as Partial<StoryboardFramePlan>;
    delete legacyFrame.charactersPresent;
    const p = plan({ topLeft: legacyFrame as StoryboardFramePlan });
    expect(presentCharacterNames(p, [ANVI, RAJ])).toBeNull();
  });

  it('returns null when the union of all panels is empty', () => {
    const p = plan({
      topLeft: frame({ charactersPresent: [] }),
      topRight: frame({ charactersPresent: [] }),
      bottomLeft: frame({ charactersPresent: [] }),
      bottomRight: frame({ charactersPresent: [] }),
    });
    expect(presentCharacterNames(p, [ANVI, RAJ])).toBeNull();
  });

  it('returns the union of canonical names present across all panels', () => {
    const p = plan({
      topLeft: frame({ charactersPresent: ['Anvi'] }),
      topRight: frame({ charactersPresent: ['Raj'] }),
      bottomLeft: frame({ charactersPresent: [] }),
      bottomRight: frame({ charactersPresent: [] }),
    });
    const names = presentCharacterNames(p, [ANVI, RAJ]);
    expect(names).toEqual(new Set(['Anvi', 'Raj']));
  });

  it('a character present in no panel is excluded from the union', () => {
    const p = plan({
      topLeft: frame({ charactersPresent: ['Anvi'] }),
      topRight: frame({ charactersPresent: ['Anvi'] }),
      bottomLeft: frame({ charactersPresent: ['Anvi'] }),
      bottomRight: frame({ charactersPresent: ['Anvi'] }),
    });
    const names = presentCharacterNames(p, [ANVI, RAJ]);
    expect(names).toEqual(new Set(['Anvi']));
  });
});

describe('filterCharacterReferencesByPresence', () => {
  const refs = [
    { type: 'character', name: 'Anvi' },
    { type: 'character', name: 'Raj' },
    { type: 'scene', name: 'A World' },
  ];

  it('returns every reference unchanged when presentNames is null (don\'t restrict)', () => {
    expect(filterCharacterReferencesByPresence(refs, null)).toEqual(refs);
  });

  it('keeps only character refs whose name is in the present set, and always keeps non-character refs', () => {
    const filtered = filterCharacterReferencesByPresence(refs, new Set(['Anvi']));
    expect(filtered).toEqual([
      { type: 'character', name: 'Anvi' },
      { type: 'scene', name: 'A World' },
    ]);
  });

  it('drops a character ref with no name when restricting', () => {
    const withUnnamed = [...refs, { type: 'character', name: undefined }];
    const filtered = filterCharacterReferencesByPresence(withUnnamed, new Set(['Anvi']));
    expect(filtered.some((r) => r.type === 'character' && !r.name)).toBe(false);
  });
});

describe('shouldAttachPreviousStoryboardReference', () => {
  it('true for a plan with no transition', () => {
    expect(shouldAttachPreviousStoryboardReference(plan(), { presentCharacterHasReference: false })).toBe(true);
  });

  it('true for a small transition (not a big jump or location change)', () => {
    const p = plan({ transition: { timeRelation: 'next_day', locationRelation: 'same_exact', evidence: '' } });
    expect(shouldAttachPreviousStoryboardReference(p, { presentCharacterHasReference: false })).toBe(true);
  });

  it('false on a big time jump when a present character has a reference', () => {
    const p = plan({ transition: { timeRelation: 'years_later', locationRelation: 'same_exact', evidence: '' } });
    expect(shouldAttachPreviousStoryboardReference(p, { presentCharacterHasReference: true })).toBe(false);
  });

  it('true on a big time jump when NO present character has a reference (R8/Q4 exception)', () => {
    const p = plan({ transition: { timeRelation: 'years_later', locationRelation: 'same_exact', evidence: '' } });
    expect(shouldAttachPreviousStoryboardReference(p, { presentCharacterHasReference: false })).toBe(true);
  });

  it('false on a location change when a present character has a reference', () => {
    const p = plan({ transition: { timeRelation: 'continuous', locationRelation: 'new_location', evidence: '' } });
    expect(shouldAttachPreviousStoryboardReference(p, { presentCharacterHasReference: true })).toBe(false);
  });
});
