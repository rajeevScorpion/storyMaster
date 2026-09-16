// Server-only reader for the image prompt compiler mode feature flag. Kept out
// of the *.shared modules so the client never imports the admin Supabase client.

import 'server-only';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import {
  normalizeImagePromptCompilerMode,
  type ImagePromptCompilerMode,
  type ImagePromptCompilerRuntime,
} from './assemble.shared';
import {
  DEFAULT_PROMPT_COMPILER_CAPABILITY,
  normalizePromptCompilerCapability,
} from './capability.shared';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import type { ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import type { PlanKey } from '@/lib/types/pricing';

export const IMAGE_PROMPT_COMPILER_MODE_FLAG = 'image_prompt_compiler_mode';

export const LEGACY_IMAGE_PROMPT_COMPILER_RUNTIME: ImagePromptCompilerRuntime = {
  mode: 'legacy',
  capability: { ...DEFAULT_PROMPT_COMPILER_CAPABILITY },
};

/** Read + normalize the compiler mode. Missing/unknown -> 'legacy'. 60s cached. */
export async function getImagePromptCompilerMode(): Promise<ImagePromptCompilerMode> {
  const value = await getFeatureFlagValue(IMAGE_PROMPT_COMPILER_MODE_FLAG);
  return normalizeImagePromptCompilerMode(value);
}

/**
 * Resolves the compiler mode + per-model capability for one generation, given
 * an already-resolved plan key. Extracted out of
 * resolveImagePromptCompilerRuntimeAction (app/actions/prompt-compiler.ts) so a
 * caller with no user session can reach the same logic without that action's
 * session-derived pricing lookup -- namely the agentic pipeline
 * (lib/agentic/story-assembly.ts), which runs headless on the admin client.
 * Fail-safe to legacy on any error, exactly like the action.
 */
export async function resolveImagePromptCompilerRuntime(input: {
  taskKey: ImageTaskKey;
  selection?: ImageModelSelection | null;
  planKey: PlanKey;
}): Promise<ImagePromptCompilerRuntime> {
  // Storyboard beats only in this rollout; reels/portraits stay legacy.
  if (input.taskKey !== 'image_generation') return LEGACY_IMAGE_PROMPT_COMPILER_RUNTIME;

  try {
    const mode = await getImagePromptCompilerMode();
    if (mode === 'legacy') return LEGACY_IMAGE_PROMPT_COMPILER_RUNTIME;

    const snapshot = await resolveImageModelSnapshot({
      taskKey: input.taskKey,
      selection: input.selection ?? null,
      currentPlanKey: input.planKey,
    });
    return { mode, capability: normalizePromptCompilerCapability(snapshot.capabilities) };
  } catch {
    return LEGACY_IMAGE_PROMPT_COMPILER_RUNTIME;
  }
}
