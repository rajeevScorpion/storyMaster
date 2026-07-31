import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_OPTIONS_PER_BEAT,
  countCustomOptions,
} from './custom-options';

describe('custom option limits', () => {
  it('counts only user-authored options', () => {
    expect(
      countCustomOptions([
        { id: 'ai-1', label: 'AI choice', intent: 'continue', source: 'ai' },
        { id: 'custom-1', label: 'My choice', intent: 'custom', source: 'user_custom' },
        { id: 'legacy-1', label: 'Legacy choice', intent: 'continue' },
      ])
    ).toBe(1);
  });

  it('keeps the product limit at three choices per beat', () => {
    expect(MAX_CUSTOM_OPTIONS_PER_BEAT).toBe(3);
  });
});
