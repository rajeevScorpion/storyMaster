import { describe, it, expect } from 'vitest';
import {
  normalizePromptCompilerCapability,
  DEFAULT_PROMPT_COMPILER_CAPABILITY,
  MIN_PROMPT_BUDGET_CHARS,
  MAX_PROMPT_BUDGET_CHARS,
} from './capability.shared';

describe('normalizePromptCompilerCapability', () => {
  it('returns fail-closed defaults for missing/malformed capabilities', () => {
    expect(normalizePromptCompilerCapability(null)).toEqual(DEFAULT_PROMPT_COMPILER_CAPABILITY);
    expect(normalizePromptCompilerCapability(undefined)).toEqual(DEFAULT_PROMPT_COMPILER_CAPABILITY);
    expect(normalizePromptCompilerCapability({ promptCompiler: 'nope' } as never)).toEqual(
      DEFAULT_PROMPT_COMPILER_CAPABILITY
    );
    expect(normalizePromptCompilerCapability({})).toEqual(DEFAULT_PROMPT_COMPILER_CAPABILITY);
  });

  it('reads and coerces a valid record', () => {
    const cap = normalizePromptCompilerCapability({
      promptCompiler: { enabled: true, promptBudgetChars: 3000, supportsNegativePrompt: true, adapterVersion: 'gemini-v1' },
    });
    expect(cap).toEqual({ enabled: true, promptBudgetChars: 3000, supportsNegativePrompt: true, adapterVersion: 'gemini-v1' });
  });

  it('clamps the budget and defaults unknown adapter versions', () => {
    expect(normalizePromptCompilerCapability({ promptCompiler: { promptBudgetChars: 10 } }).promptBudgetChars).toBe(
      MIN_PROMPT_BUDGET_CHARS
    );
    expect(normalizePromptCompilerCapability({ promptCompiler: { promptBudgetChars: 999999 } }).promptBudgetChars).toBe(
      MAX_PROMPT_BUDGET_CHARS
    );
    expect(normalizePromptCompilerCapability({ promptCompiler: { adapterVersion: 'made-up' } }).adapterVersion).toBe(
      'neutral-v1'
    );
    expect(normalizePromptCompilerCapability({ promptCompiler: { promptBudgetChars: NaN } }).promptBudgetChars).toBe(
      2800
    );
  });

  it('treats non-true enabled as disabled', () => {
    expect(normalizePromptCompilerCapability({ promptCompiler: { enabled: 1 as never } }).enabled).toBe(false);
    expect(normalizePromptCompilerCapability({ promptCompiler: { enabled: false } }).enabled).toBe(false);
  });
});
