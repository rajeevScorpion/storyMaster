'use server';

// Resolves the image prompt compiler runtime (mode + per-model capability) for a
// generation. Called by the client store (cached) before it assembles a prompt,
// mirroring resolveImageProcessingModeAction. Fail-safe to legacy on any error
// so a config/registry problem can never block image generation. Reels are not
// covered by the compiler in this rollout.
//
// The actual mode/capability resolution lives in lib/ai/prompt-compiler/mode.ts
// as a plain function taking an explicit plan key -- this action's only job is
// to supply that plan key from the signed-in user's pricing context. See that
// module's resolveImagePromptCompilerRuntime for why the split exists: the
// agentic pipeline (lib/agentic/story-assembly.ts) needs the same resolution
// with no user session to read pricing context from.

import {
  resolveImagePromptCompilerRuntime,
  LEGACY_IMAGE_PROMPT_COMPILER_RUNTIME,
} from '@/lib/ai/prompt-compiler/mode';
import type { ImagePromptCompilerRuntime } from '@/lib/ai/prompt-compiler/assemble.shared';
import type { ImageModelSelection, ImageTaskKey } from '@/lib/ai/image-models.shared';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';

export async function resolveImagePromptCompilerRuntimeAction(input: {
  taskKey: ImageTaskKey;
  selection?: ImageModelSelection | null;
}): Promise<ImagePromptCompilerRuntime> {
  // Storyboard beats only in this rollout; reels/portraits stay legacy. Checked
  // here too (not just inside resolveImagePromptCompilerRuntime) so a reel/
  // portrait call skips the pricing context lookup entirely.
  if (input.taskKey !== 'image_generation') return LEGACY_IMAGE_PROMPT_COMPILER_RUNTIME;

  const pricing = await getPricingRuntimeContext().catch(() => null);
  const planKey = pricing?.snapshot.entitlementPlanKey ?? 'free';
  return resolveImagePromptCompilerRuntime({
    taskKey: input.taskKey,
    selection: input.selection,
    planKey,
  });
}
