import { describe, expect, it } from 'vitest';
import { normalizeStoryboardPlan } from './storyboard-plan.shared';

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
