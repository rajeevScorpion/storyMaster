import { describe, it, expect } from 'vitest';
import { buildPersonaSpendReport } from './persona-spend.shared';

const PERSONAS = [
  { id: 'p1', displayName: 'Asha', slug: 'asha', status: 'active' },
  { id: 'p2', displayName: 'Bela', slug: 'bela', status: 'active' },
  { id: 'p3', displayName: 'Chandra', slug: 'chandra', status: 'draft' },
];
const STORY_PERSONA = new Map([['s1', 'p1'], ['s2', 'p1'], ['s3', 'p2']]);

describe('buildPersonaSpendReport', () => {
  it('adds up each persona’s spend and ranks the biggest first', () => {
    const report = buildPersonaSpendReport({
      personas: PERSONAS,
      storyPersona: STORY_PERSONA,
      rows: [
        { relatedStoryId: 's1', actionKey: 'narration', beatCost: 2, wasBypassed: true },
        { relatedStoryId: 's2', actionKey: 'images', beatCost: 3, wasBypassed: true },
        { relatedStoryId: 's3', actionKey: 'narration', beatCost: 1, wasBypassed: true },
      ],
    });

    expect(report.personas.map((p) => [p.displayName, p.beats])).toEqual([
      ['Asha', 5], ['Bela', 1], ['Chandra', 0],
    ]);
    expect(report.totalBeats).toBe(6);
    expect(report.totalCoins).toBe(60);
  });

  // A persona that has not spent anything is a real answer, not a missing row.
  it('lists a persona that has spent nothing', () => {
    const report = buildPersonaSpendReport({ personas: PERSONAS, storyPersona: STORY_PERSONA, rows: [] });
    expect(report.personas).toHaveLength(3);
    expect(report.personas.every((p) => p.beats === 0 && p.operations === 0)).toBe(true);
  });

  // The number that stops this report being mistaken for money actually collected.
  it('reports how much was never deducted because of the bypass', () => {
    const report = buildPersonaSpendReport({
      personas: PERSONAS,
      storyPersona: STORY_PERSONA,
      rows: [
        { relatedStoryId: 's1', actionKey: 'narration', beatCost: 4, wasBypassed: true },
        { relatedStoryId: 's1', actionKey: 'images', beatCost: 6, wasBypassed: false },
      ],
    });
    expect(report.totalBeats).toBe(10);
    expect(report.bypassedBeats).toBe(4);
  });

  // A charge with no usable story must never be folded into someone else's total.
  it('keeps a charge it cannot attribute out of every persona’s number', () => {
    const report = buildPersonaSpendReport({
      personas: PERSONAS,
      storyPersona: STORY_PERSONA,
      rows: [
        { relatedStoryId: null, actionKey: 'narration', beatCost: 7, wasBypassed: true },
        { relatedStoryId: 'deleted-story', actionKey: 'images', beatCost: 3, wasBypassed: true },
        { relatedStoryId: 's1', actionKey: 'narration', beatCost: 1, wasBypassed: true },
      ],
    });
    expect(report.unattributedBeats).toBe(10);
    expect(report.unattributedOperations).toBe(2);
    expect(report.personas.find((p) => p.displayName === 'Asha')?.beats).toBe(1);
    expect(report.totalBeats).toBe(11);
  });

  it('breaks a persona’s spend down by what it was spent on, dearest first', () => {
    const report = buildPersonaSpendReport({
      personas: PERSONAS,
      storyPersona: STORY_PERSONA,
      rows: [
        { relatedStoryId: 's1', actionKey: 'narration', beatCost: 1, wasBypassed: true },
        { relatedStoryId: 's1', actionKey: 'images', beatCost: 5, wasBypassed: true },
        { relatedStoryId: 's2', actionKey: 'narration', beatCost: 2, wasBypassed: true },
      ],
    });
    const asha = report.personas.find((p) => p.displayName === 'Asha');
    expect(asha?.byAction).toEqual([
      { actionKey: 'images', beats: 5, operations: 1 },
      { actionKey: 'narration', beats: 3, operations: 2 },
    ]);
    expect(asha?.storiesCharged).toBe(2);
  });

  // Beat costs are fractional; the report must not drift into floating-point noise.
  it('keeps fractional costs to two decimals', () => {
    const report = buildPersonaSpendReport({
      personas: PERSONAS,
      storyPersona: STORY_PERSONA,
      rows: [
        { relatedStoryId: 's1', actionKey: 'narration', beatCost: 0.1, wasBypassed: true },
        { relatedStoryId: 's1', actionKey: 'narration', beatCost: 0.2, wasBypassed: true },
      ],
    });
    expect(report.personas.find((p) => p.displayName === 'Asha')?.beats).toBe(0.3);
    expect(report.totalBeats).toBe(0.3);
  });
});
