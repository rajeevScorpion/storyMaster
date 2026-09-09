import { describe, expect, it } from 'vitest';
import {
  SEED_GUIDANCE_WORD_CAP,
  SEED_SOURCE_WORD_CAP,
  STORY_PROMPT_WORD_CAP,
  countAuthoringWords,
} from './authoring-limits';

describe('seed authoring limits', () => {
  it('keeps story and visual guidance limits independent', () => {
    expect(SEED_SOURCE_WORD_CAP).toBe(800);
    expect(STORY_PROMPT_WORD_CAP).toBe(800);
    expect(SEED_GUIDANCE_WORD_CAP).toBe(150);
  });

  it('counts whitespace-separated authoring words', () => {
    expect(countAuthoringWords('  character details\nand world notes  ')).toBe(5);
    expect(countAuthoringWords('')).toBe(0);
  });
});
