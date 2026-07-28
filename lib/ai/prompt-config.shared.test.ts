import { describe, expect, it } from 'vitest';
import {
  getDefaultPromptBody,
  validatePromptTemplate,
} from './prompt-config.shared';

describe('seed authoring prompt contracts', () => {
  it('keeps the default seed plan prompt valid with strict source segments', () => {
    const prompt = getDefaultPromptBody('seed_plan_generation');
    const result = validatePromptTemplate('seed_plan_generation', prompt);

    expect(result.isValid).toBe(true);
    expect(result.usedPlaceholders).toContain('strictSourceSegments');
  });

  it('keeps the default visual composer prompt valid with seed authoring context', () => {
    const prompt = getDefaultPromptBody('visual_prompt');
    const result = validatePromptTemplate('visual_prompt', prompt);

    expect(result.isValid).toBe(true);
    expect(result.usedPlaceholders).toContain('seedAuthoringContext');
  });
});
