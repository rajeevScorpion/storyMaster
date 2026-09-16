import { describe, expect, it } from 'vitest';
import {
  LOCKED_PROMPT_GUARDRAILS,
  PROMPT_TASK_DEFINITIONS,
  getDefaultPromptBody,
  resolvePromptTemplate,
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

describe('visual_prompt composer template — leaner input (Unit 3)', () => {
  it('fills every placeholder into exactly one place in the resolved default prompt', () => {
    const prompt = getDefaultPromptBody('visual_prompt');
    const placeholderKeys = PROMPT_TASK_DEFINITIONS.visual_prompt.placeholders.map((placeholder) => placeholder.key);
    const values: Record<string, string> = {};
    placeholderKeys.forEach((key, index) => {
      values[key] = `SENTINEL_${index}_${key}_END`;
    });

    const resolved = resolvePromptTemplate(prompt, values);

    for (const key of placeholderKeys) {
      const sentinel = values[key];
      const occurrences = resolved.split(sentinel).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('stays a valid template once every placeholder is duplicated only in its own section', () => {
    const prompt = getDefaultPromptBody('visual_prompt');
    const result = validatePromptTemplate('visual_prompt', prompt);
    expect(result.isValid).toBe(true);
    expect(result.unknownPlaceholders).toEqual([]);
    expect(result.missingRequiredPlaceholders).toEqual([]);
  });

  it('keeps the LOCKED_PROMPT_GUARDRAILS.visual_prompt entry carrying the English rule and its canonical-name exception', () => {
    const guardrail = LOCKED_PROMPT_GUARDRAILS.visual_prompt;
    expect(guardrail).toContain('English');
    expect(guardrail).toContain('canonical name');
    expect(guardrail).toContain('Do not keep clothing, hair, accessories, or location only because an earlier beat or panel had them.');
  });
});
