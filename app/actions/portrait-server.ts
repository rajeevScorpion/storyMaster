'use server';

import { generateSelectedImage } from '@/app/actions/image-generation';
import { buildFinalPortraitPrompt } from '@/lib/ai/portrait-prompt.shared';
import { DEFAULT_IMAGE_MODEL_ID } from '@/lib/ai/model-config.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { ImageModelSelection, ImageModelSnapshot } from '@/lib/ai/image-models.shared';
import type {
  ImageContinuityProviderState,
  ImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
import type { Character, PortraitReferenceConfig } from '@/lib/types/story';

export interface GenerateCharacterPortraitServerInput {
  character: Character;
  visualStyle: string;
  portraitReferenceConfig: PortraitReferenceConfig;
  imageModelSelection?: ImageModelSelection | null;
  telemetry?: CostTelemetryContext;
  continuity?: {
    requestedStrategy: ImageContinuityStrategy;
    previousState?: ImageContinuityProviderState | null;
    allowRuntimeFallback?: boolean;
  } | null;
}

export interface GenerateCharacterPortraitServerResult {
  dataUrl: string | null;
  finalPromptText: string;
  modelSnapshot: ImageModelSnapshot;
  metadata: Record<string, unknown>;
}

/**
 * Server-safe character portrait generation. Unlike `generateCharacterPortrait`
 * (a 'use client' function that finishes with browser-canvas compression), this
 * runs entirely on the server: it builds the prompt via the shared builder and
 * calls the `generateSelectedImage` server action, returning the raw data URL for
 * the caller to compress/upload (e.g. via `uploadCharacterPortrait`). Used by the
 * batch (resend_refs) and stateful bulk-visual paths, which have no DOM.
 */
export async function generateCharacterPortraitServer(
  input: GenerateCharacterPortraitServerInput
): Promise<GenerateCharacterPortraitServerResult> {
  const { character, visualStyle, portraitReferenceConfig } = input;
  const prompt = buildFinalPortraitPrompt(character, visualStyle, portraitReferenceConfig);
  const imageSize = portraitReferenceConfig.quality === '1K' ? '1K' : '512';

  const result = await generateSelectedImage({
    task: 'portrait_generation',
    prompt,
    aspectRatio: '1:1',
    imageSize,
    telemetry: input.telemetry,
    selection: input.imageModelSelection ?? {
      taskKey: 'portrait_generation',
      modelKey: DEFAULT_IMAGE_MODEL_ID,
    },
    continuity: input.continuity ?? null,
  });

  return {
    dataUrl: result.dataUrl,
    finalPromptText: prompt,
    modelSnapshot: result.modelSnapshot,
    metadata: {
      ...result.metadata,
      imageModelSnapshot: result.modelSnapshot,
      aspectRatio: '1:1',
      imageSize,
    },
  };
}
