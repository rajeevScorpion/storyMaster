import { describe, expect, it } from 'vitest';
import { buildRegenerationInstructionBlock } from './image-regeneration.shared';

describe('buildRegenerationInstructionBlock', () => {
  it('emits the refine instruction with strict rules', () => {
    const block = buildRegenerationInstructionBlock({ mode: 'refine', isStoryboard: true });
    expect(block).toContain('REGENERATION MODE:');
    expect(block).toContain('Refine the existing storyboard concept.');
    expect(block).toContain('STRICT REGENERATION RULES:');
    expect(block).toContain('Preserve the exact panel count and storyboard layout.');
    expect(block).not.toContain('USER OVERALL VISUAL SUGGESTION:');
  });

  it('emits the reimagine instruction', () => {
    const block = buildRegenerationInstructionBlock({ mode: 'reimagine', isStoryboard: false });
    expect(block).toContain('Reimagine the visual treatment');
    expect(block).toContain('preserving the same story event');
  });

  it('includes the overall suggestion when provided', () => {
    const block = buildRegenerationInstructionBlock({
      mode: 'refine',
      overallSuggestion: 'Make the lighting warmer.',
      isStoryboard: true,
    });
    expect(block).toContain('USER OVERALL VISUAL SUGGESTION:\nMake the lighting warmer.');
  });

  it('maps panel suggestions to labeled frames on storyboards', () => {
    const block = buildRegenerationInstructionBlock({
      mode: 'refine',
      isStoryboard: true,
      panelSuggestions: {
        topLeft: 'Show Tara looking surprised',
        bottomRight: 'Both friends smiling at sunset',
      },
    });
    expect(block).toContain('USER PANEL-SPECIFIC SUGGESTIONS:');
    expect(block).toContain('Panel 1 (top-left): Show Tara looking surprised');
    expect(block).toContain('Panel 4 (bottom-right): Both friends smiling at sunset');
    expect(block).not.toContain('Panel 2 (top-right):');
    expect(block).toContain('Apply panel-specific suggestions only to their own panels');
  });

  it('omits panel wording entirely for single-image beats', () => {
    const block = buildRegenerationInstructionBlock({
      mode: 'refine',
      isStoryboard: false,
      panelSuggestions: { topLeft: 'ignored on non-storyboards' },
    });
    expect(block).not.toContain('PANEL-SPECIFIC');
    expect(block).not.toContain('panel count');
  });

  it('ignores whitespace-only suggestions', () => {
    const block = buildRegenerationInstructionBlock({
      mode: 'refine',
      overallSuggestion: '   ',
      isStoryboard: true,
      panelSuggestions: { topRight: '  ' },
    });
    expect(block).not.toContain('USER OVERALL VISUAL SUGGESTION:');
    expect(block).not.toContain('USER PANEL-SPECIFIC SUGGESTIONS:');
  });

  it('always forbids plot changes', () => {
    for (const mode of ['refine', 'reimagine'] as const) {
      const block = buildRegenerationInstructionBlock({ mode, isStoryboard: true });
      expect(block).toContain('visual direction only');
      expect(block).toContain('Do not change story text, narration, or the future direction of the story.');
    }
  });
});
