// Shared types for the admin prompt-compiler settings + comparison view. Kept
// client-safe so the panel component can import them without pulling in server
// code.

import type { ImagePromptCompilerMode, PromptCompilerBeatMetadata } from './assemble.shared';

export const IMAGE_PROMPT_COMPILER_MODES: ImagePromptCompilerMode[] = [
  'legacy',
  'shadow',
  'new',
  'new_with_legacy_fallback',
];

export const IMAGE_PROMPT_COMPILER_MODE_LABELS: Record<ImagePromptCompilerMode, string> = {
  legacy: 'Legacy only',
  shadow: 'Shadow (compile + compare, send legacy)',
  new: 'New (send compiled)',
  new_with_legacy_fallback: 'New with legacy fallback',
};

export const IMAGE_PROMPT_COMPILER_MODE_DESCRIPTIONS: Record<ImagePromptCompilerMode, string> = {
  legacy: 'No compilation. Existing prompt assembly only.',
  shadow: 'Compile the new prompt and record a legacy-vs-compiled comparison, but still send the legacy prompt. Zero user-visible change.',
  new: 'Send the compiled prompt. A compile failure fails the image (reservation released).',
  new_with_legacy_fallback: 'Send the compiled prompt; fall back to the legacy prompt if compilation fails.',
};

export interface PromptCompilerComparisonRow {
  storyId: string;
  nodeId: string;
  beatNumber: number | null;
  updatedAt: string;
  meta: PromptCompilerBeatMetadata;
}

export interface PromptCompilerModelCapabilitySummary {
  taskKey: string;
  modelKey: string;
  displayName: string;
  enabled: boolean;
  promptBudgetChars: number;
  adapterVersion: string;
  supportsNegativePrompt: boolean;
}

export interface PromptCompilerAdminState {
  mode: ImagePromptCompilerMode;
  models: PromptCompilerModelCapabilitySummary[];
  comparisons: PromptCompilerComparisonRow[];
}

/** Percentage reduction of the compiled prompt vs the legacy prompt (0 if n/a). */
export function promptReductionPct(meta: PromptCompilerBeatMetadata): number {
  if (!meta.compiledChars || meta.legacyChars <= 0) return 0;
  return Math.round(((meta.legacyChars - meta.compiledChars) / meta.legacyChars) * 100);
}
