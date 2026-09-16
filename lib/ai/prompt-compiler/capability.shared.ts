// Prompt compiler capability — the per-model settings that drive compilation.
// Read from the image_model_registry `capabilities` JSONB (capabilities.
// promptCompiler) and normalized fail-closed so a missing or malformed record
// disables the compiler rather than producing an unbounded prompt.

import type { ImageModelCapabilities } from '@/lib/ai/image-models.shared';

export type PromptCompilerAdapterVersion = 'neutral-v1' | 'gemini-v1';

export interface PromptCompilerCapability {
  enabled: boolean;
  promptBudgetChars: number;
  supportsNegativePrompt: boolean;
  adapterVersion: PromptCompilerAdapterVersion;
}

export const MIN_PROMPT_BUDGET_CHARS = 1200;
// The stored promptBudgetChars is a TARGET, not a ceiling: the compiler is
// allowed to exceed it (recording `over_target`) up to this hard cap, never
// beyond it. Migration 122 moves every registry row still at the 081 default
// (2800) up to the new default below.
export const PROMPT_HARD_MAX_CHARS = 5000;
export const MAX_PROMPT_BUDGET_CHARS = PROMPT_HARD_MAX_CHARS;
export const DEFAULT_PROMPT_BUDGET_CHARS = 3000;

const KNOWN_ADAPTER_VERSIONS: readonly PromptCompilerAdapterVersion[] = ['neutral-v1', 'gemini-v1'];

// Compiler is off by default: it only runs where a model explicitly enables it.
export const DEFAULT_PROMPT_COMPILER_CAPABILITY: PromptCompilerCapability = {
  enabled: false,
  promptBudgetChars: DEFAULT_PROMPT_BUDGET_CHARS,
  supportsNegativePrompt: false,
  adapterVersion: 'neutral-v1',
};

function clampBudget(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_PROMPT_BUDGET_CHARS;
  return Math.min(MAX_PROMPT_BUDGET_CHARS, Math.max(MIN_PROMPT_BUDGET_CHARS, n));
}

function normalizeAdapterVersion(value: unknown): PromptCompilerAdapterVersion {
  return typeof value === 'string' && (KNOWN_ADAPTER_VERSIONS as readonly string[]).includes(value)
    ? (value as PromptCompilerAdapterVersion)
    : 'neutral-v1';
}

export function normalizePromptCompilerCapability(
  capabilities: ImageModelCapabilities | null | undefined
): PromptCompilerCapability {
  const raw = capabilities?.promptCompiler;
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PROMPT_COMPILER_CAPABILITY };
  }
  return {
    enabled: raw.enabled === true,
    promptBudgetChars: clampBudget(raw.promptBudgetChars),
    supportsNegativePrompt: raw.supportsNegativePrompt === true,
    adapterVersion: normalizeAdapterVersion(raw.adapterVersion),
  };
}
