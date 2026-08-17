'use server';

// Resolves the image prompt compiler runtime (mode + per-model capability) for a
// generation. Called by the client store (cached) before it assembles a prompt,
// mirroring resolveImageProcessingModeAction. Fail-safe to legacy on any error
// so a config/registry problem can never block image generation. Reels are not
// covered by the compiler in this rollout.

import { getImagePromptCompilerMode } from '@/lib/ai/prompt-compiler/mode';
import {
  DEFAULT_PROMPT_COMPILER_CAPABILITY,
  normalizePromptCompilerCapability,
} from '@/lib/ai/prompt-compiler/capability.shared';
import type { ImagePromptCompilerRuntime } from '@/lib/ai/prompt-compiler/assemble.shared';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import type { ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';

const LEGACY_RUNTIME: ImagePromptCompilerRuntime = {
  mode: 'legacy',
  capability: { ...DEFAULT_PROMPT_COMPILER_CAPABILITY },
};

export async function resolveImagePromptCompilerRuntimeAction(input: {
  taskKey: ImageTaskKey;
  selection?: ImageModelSelection | null;
}): Promise<ImagePromptCompilerRuntime> {
  // Storyboard beats only in this rollout; reels/portraits stay legacy.
  if (input.taskKey !== 'image_generation') return LEGACY_RUNTIME;

  try {
    const mode = await getImagePromptCompilerMode();
    if (mode === 'legacy') return LEGACY_RUNTIME;

    const pricing = await getPricingRuntimeContext().catch(() => null);
    const planKey = pricing?.snapshot.entitlementPlanKey ?? 'free';
    const snapshot = await resolveImageModelSnapshot({
      taskKey: input.taskKey,
      selection: input.selection ?? null,
      currentPlanKey: planKey,
    });
    return { mode, capability: normalizePromptCompilerCapability(snapshot.capabilities) };
  } catch {
    return LEGACY_RUNTIME;
  }
}
