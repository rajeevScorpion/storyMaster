import { describe, it, expect } from 'vitest';
import {
  buildCanonicalCharacterAdoptionPrompt,
  buildCanonicalWorldAdoptionPrompt,
  compileCharacterAnchor,
  compileWorldAnchor,
} from './reference-adoption-prompts';
import type {
  CharacterReferenceDescription,
  WorldReferenceDescription,
} from '@/lib/types/references';

const character: CharacterReferenceDescription = {
  schemaVersion: 1,
  summary: 'A curious young boy',
  subjectType: 'human',
  stableTraits: {
    face: ['round face', 'freckles'],
    hair: ['messy brown hair'],
    silhouette: ['slim build'],
    marks: ['scar over left eyebrow'],
    stableAccessories: ['red scarf'],
  },
  changeable: { clothing: ['blue tunic'], pose: ['standing'], expression: ['smiling'] },
  continuityAnchors: ['freckles', 'red scarf'],
  prohibitedDrift: ['do not add spectacles'],
};

const world: WorldReferenceDescription = {
  schemaVersion: 1,
  summary: 'A dusty medieval library',
  worldType: 'interior_library',
  architecture: ['carved stone archway', 'tall shelves'],
  geography: [],
  spatialLayout: ['central reading floor'],
  materials: ['aged oak', 'stone'],
  lighting: ['warm shafts'],
  atmosphere: ['quiet', 'dusty'],
  recurringObjects: ['brass telescope'],
  continuityAnchors: ['carved archway'],
  keywords: ['library', 'archway'],
  incidentalElements: ['a stray cat'],
  prohibitedDrift: [],
};

describe('compileCharacterAnchor', () => {
  it('includes summary and stable trait groups', () => {
    const anchor = compileCharacterAnchor(character);
    expect(anchor).toContain('A curious young boy');
    expect(anchor).toContain('messy brown hair');
    expect(anchor).toContain('scar over left eyebrow');
  });

  it('clamps to at most 60 words', () => {
    const wordy: CharacterReferenceDescription = {
      ...character,
      summary: Array.from({ length: 90 }, (_, i) => `word${i}`).join(' '),
    };
    const anchor = compileCharacterAnchor(wordy);
    expect(anchor.split(/\s+/).length).toBeLessThanOrEqual(61); // 60 words + ellipsis token
  });
});

describe('buildCanonicalCharacterAdoptionPrompt', () => {
  it('locks to the story visual style and states identity-only rule', () => {
    const prompt = buildCanonicalCharacterAdoptionPrompt({
      description: character,
      visualStyle: 'whimsical pastel storybook',
      displayName: 'Leo',
    });
    expect(prompt).toContain('whimsical pastel storybook');
    expect(prompt).toContain('Leo');
    expect(prompt.toLowerCase()).toContain('identity only');
    expect(prompt).toContain('do not add spectacles');
  });

  it('works without a display name', () => {
    const prompt = buildCanonicalCharacterAdoptionPrompt({
      description: character,
      visualStyle: 'anime cel',
    });
    expect(prompt).toContain('anime cel');
  });
});

describe('compileWorldAnchor', () => {
  it('captures layout, architecture, materials and landmarks', () => {
    const anchor = compileWorldAnchor(world);
    expect(anchor).toContain('dusty medieval library');
    expect(anchor).toContain('carved stone archway');
    expect(anchor).toContain('brass telescope');
  });

  it('clamps to at most 80 words', () => {
    const wordy: WorldReferenceDescription = {
      ...world,
      summary: Array.from({ length: 120 }, (_, i) => `w${i}`).join(' '),
    };
    const anchor = compileWorldAnchor(wordy);
    expect(anchor.split(/\s+/).length).toBeLessThanOrEqual(81);
  });
});

describe('buildCanonicalWorldAdoptionPrompt', () => {
  it('locks to style, forbids people, and ignores incidental elements', () => {
    const prompt = buildCanonicalWorldAdoptionPrompt({
      description: world,
      visualStyle: 'watercolor fable',
      displayName: 'Ancient Library',
    });
    expect(prompt).toContain('watercolor fable');
    expect(prompt).toContain('Ancient Library');
    expect(prompt.toLowerCase()).toContain('no people');
    expect(prompt).toContain('a stray cat');
  });
});
