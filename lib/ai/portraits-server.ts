import 'server-only';

import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';
import { putR2Object } from '@/lib/media/r2-server';
import { recordMediaAsset } from '@/lib/media/media-assets';
import { generateSelectedImage } from '@/app/actions/image-generation';
import { buildFinalPortraitPrompt } from '@/lib/ai/portrait-prompt.shared';
import { normalizePortraitReferenceConfig } from '@/lib/ai/story-config';
import { extractImageContinuityState } from '@/lib/ai/image-continuity.shared';
import { DEFAULT_IMAGE_MODEL_ID } from '@/lib/ai/model-config.shared';
import { PORTRAIT_MAX_WIDTH, PORTRAIT_MAX_HEIGHT, PORTRAIT_QUALITY } from '@/lib/constants/media';
import { splitBase64DataUrl } from '@/lib/utils/data-url';
import type { StoryModelOverrides } from '@/lib/ai/beat-orchestration';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type {
  ImageContinuityProviderState,
  ImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import type {
  Character,
  CharacterSheetGalleryEntry,
  PortraitReferenceConfig,
  PortraitTask,
  StoryBeat,
  StoryboardPlan,
} from '@/lib/types/story';

/**
 * Server-side portrait generation for the beat bundle. Mirrors the client
 * pipeline (`generatePortraitsForStoryboardPlan` in lib/store/story-store.ts +
 * `generateCharacterPortrait` in app/actions/story-runtime.ts) with sharp
 * replacing the browser canvas for WebP compression. The small pure ordering /
 * reference helpers are copies of the client ones — keep them in sync.
 */

export interface ServerReferenceImage {
  type: 'character' | 'scene';
  url?: string;
  dataUrl?: string;
}

export interface ServerImageContinuityOptions {
  requestedStrategy: ImageContinuityStrategy;
  previousState: ImageContinuityProviderState | null;
  allowRuntimeFallback: boolean;
}

function sortPortraitTasksForGeneration(
  characters: Character[],
  portraitTasks: PortraitTask[]
): PortraitTask[] {
  const characterPriority = new Map(characters.map((character, index) => [character.id, index]));

  return [...portraitTasks].sort((left, right) => {
    const leftPriority = characterPriority.get(left.characterId) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = characterPriority.get(right.characterId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.characterName.localeCompare(right.characterName);
  });
}

function resolvePrioritizedSheetTaskIds(
  portraitTasks: PortraitTask[],
  portraitReferenceConfig: PortraitReferenceConfig
): Set<string> {
  if (portraitReferenceConfig.mode !== 'character_sheet') {
    return new Set<string>();
  }

  return new Set(portraitTasks.slice(0, 2).map((task) => task.characterId));
}

function pickFallbackGalleryEntry(
  entries: CharacterSheetGalleryEntry[]
): CharacterSheetGalleryEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

function buildReferenceFromValue(
  type: ServerReferenceImage['type'],
  value: string | undefined
): ServerReferenceImage | null {
  if (!value) return null;
  if (value.startsWith('data:')) {
    return { type, dataUrl: value };
  }
  return { type, url: value };
}

export function collectCharacterPortraitReferences(characters: Character[]): ServerReferenceImage[] {
  return characters
    .map((character) => {
      const fallbackSheet = pickFallbackGalleryEntry(character.referenceSheetGallery ?? []);
      return buildReferenceFromValue(
        'character',
        character.portraitBase64
          || character.portraitUrl
          || character.referenceSheetUrl
          || fallbackSheet?.url
      );
    })
    .filter((reference): reference is ServerReferenceImage => Boolean(reference));
}

export function mergeServerReferenceImages(...groups: ServerReferenceImage[][]): ServerReferenceImage[] {
  const seen = new Set<string>();
  const merged: ServerReferenceImage[] = [];
  for (const group of groups) {
    for (const reference of group) {
      const key = `${reference.type}:${reference.url || reference.dataUrl || ''}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(reference);
    }
  }
  return merged;
}

async function compressPortraitDataUrl(dataUrl: string): Promise<string> {
  const parsed = splitBase64DataUrl(dataUrl);
  if (!parsed) {
    return dataUrl;
  }

  try {
    const output = await sharp(Buffer.from(parsed.base64, 'base64'), { failOn: 'none' })
      .rotate()
      .resize({
        width: PORTRAIT_MAX_WIDTH,
        height: PORTRAIT_MAX_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: Math.round(Math.max(10, Math.min(100, PORTRAIT_QUALITY * 100))) })
      .toBuffer();
    return `data:image/webp;base64,${output.toString('base64')}`;
  } catch (error) {
    console.warn('Server portrait compression failed; using original image:', error);
    return dataUrl;
  }
}

/**
 * Durable-portrait parity with the client pipeline's `uploadBeatPortraits`
 * (lib/store/story-store.ts): upload each freshly generated base64 portrait to
 * private storage and set `portraitUrl`, so character refs survive reloads and
 * library saves. A character whose upload fails is returned untouched — its
 * portrait stays session-only, exactly like the pre-upload behavior.
 */
export async function persistBeatPortraitsServer(input: {
  userId: string;
  storyId: string;
  nodeId: string;
  characters: Character[];
}): Promise<{ characters: Character[]; uploadedCount: number }> {
  const { userId, storyId, nodeId } = input;
  let uploadedCount = 0;

  const characters = await Promise.all(
    input.characters.map(async (character) => {
      const dataUrl = character.portraitBase64;
      if (!dataUrl?.startsWith('data:')) return character;
      const parsed = splitBase64DataUrl(dataUrl);
      if (!parsed) return character;

      const buffer = Buffer.from(parsed.base64, 'base64');
      // Same object key the legacy client upload uses, so downstream signing
      // and cleanup treat both pipelines identically.
      const objectKey = `stories/${storyId}/beats/${nodeId}/portrait_${character.id}.webp`;

      try {
        const stored = await putR2Object({
          access: 'private',
          objectKey,
          body: buffer,
          contentType: parsed.mimeType,
        });
        await recordMediaAsset({
          storyId,
          nodeId,
          userId,
          assetType: 'portrait',
          storageProvider: 'r2',
          bucket: stored.bucket,
          objectKey,
          mimeType: parsed.mimeType,
          sizeBytes: buffer.length,
          isPublic: false,
          processingMode: 'server_pipeline',
        });
        uploadedCount += 1;
        return { ...character, portraitUrl: stored.urlOrReference };
      } catch (r2Error) {
        // Same fallback order as the client uploadAsset helper: R2 first,
        // Supabase Storage second.
        try {
          const admin = createAdminClient();
          const fallbackPath = `${userId}/${storyId}/${nodeId}/portrait_${character.id}.webp`;
          const { error } = await admin.storage
            .from('story-assets')
            .upload(fallbackPath, buffer, { contentType: parsed.mimeType, upsert: true });
          if (error) throw new Error(error.message);
          const { data } = admin.storage.from('story-assets').getPublicUrl(fallbackPath);
          uploadedCount += 1;
          return { ...character, portraitUrl: data.publicUrl };
        } catch (storageError) {
          console.error(
            `Failed to persist portrait for character ${character.id}:`,
            r2Error,
            storageError
          );
          return character;
        }
      }
    })
  );

  return { characters, uploadedCount };
}

/**
 * Generates reference portraits for the plan's portrait tasks, mutating
 * `beat.characters[].portraitBase64`, `task.finalPromptText`, and
 * `beat.imageGenerationMetadata.portraitGeneration` exactly like the client
 * pipeline so downstream persistence and continuity behave identically.
 */
export async function generatePortraitsForPlanServer(input: {
  beat: StoryBeat;
  storyboardPlan: StoryboardPlan;
  visualStyle: string;
  portraitReferenceConfig: PortraitReferenceConfig;
  modelOverrides?: StoryModelOverrides;
  costTelemetry?: CostTelemetryContext;
  imageModelSelection?: ImageModelSelection | null;
  continuity?: ServerImageContinuityOptions | null;
}): Promise<{ references: ServerReferenceImage[]; latestState: ImageContinuityProviderState | null }> {
  const { beat, storyboardPlan, visualStyle, portraitReferenceConfig, modelOverrides } = input;
  if (!storyboardPlan.portraitTasks.length) {
    return {
      references: [],
      latestState: input.continuity?.previousState ?? null,
    };
  }

  const orderedTasks = sortPortraitTasksForGeneration(beat.characters, storyboardPlan.portraitTasks);
  const prioritizedSheetTaskIds = resolvePrioritizedSheetTaskIds(orderedTasks, portraitReferenceConfig);

  const portraits: Array<{
    reference: ServerReferenceImage;
    metadata: Record<string, unknown>;
  }> = [];
  let latestState = input.continuity?.previousState ?? null;

  for (const task of orderedTasks) {
    const character = beat.characters.find((candidate) => candidate.id === task.characterId);
    if (!character) {
      continue;
    }

    const taskPortraitReferenceConfig =
      portraitReferenceConfig.mode === 'character_sheet' && prioritizedSheetTaskIds.has(task.characterId)
        ? portraitReferenceConfig
        : {
            mode: 'single_portrait' as const,
            quality: '0.5K' as const,
          };

    try {
      const normalizedPortraitReferenceConfig = normalizePortraitReferenceConfig(taskPortraitReferenceConfig);
      const prompt = buildFinalPortraitPrompt(
        character,
        visualStyle,
        normalizedPortraitReferenceConfig,
        modelOverrides,
        task.prompt
      );

      const portraitModel = modelOverrides?.portraitModel || DEFAULT_IMAGE_MODEL_ID;
      const result = await generateSelectedImage({
        task: 'portrait_generation',
        prompt,
        aspectRatio: '1:1',
        imageSize: normalizedPortraitReferenceConfig.quality === '1K' ? '1K' : '512',
        telemetry: input.costTelemetry,
        selection: input.imageModelSelection ?? {
          taskKey: 'portrait_generation',
          modelKey: portraitModel,
        },
        continuity: input.continuity
          ? { ...input.continuity, previousState: latestState }
          : null,
      });

      if (!result.dataUrl) {
        throw new Error('No portrait image generated');
      }

      const imageUrl = await compressPortraitDataUrl(result.dataUrl);
      const nextState = extractImageContinuityState(result.metadata) ?? latestState;
      latestState = nextState;
      character.portraitBase64 = imageUrl;
      task.finalPromptText = prompt;
      portraits.push({
        reference: { type: 'character', dataUrl: imageUrl },
        metadata: {
          characterId: character.id,
          characterName: character.name,
          imageModelSnapshot: result.modelSnapshot,
          imageGenerationMetadata: {
            ...result.metadata,
            imageModelSnapshot: result.modelSnapshot,
            aspectRatio: '1:1',
            imageSize: normalizedPortraitReferenceConfig.quality === '1K' ? '1K' : '512',
          },
          statefulContinuity: nextState,
        },
      });
    } catch (error) {
      console.error(`Server portrait generation failed for storyboard task ${task.characterId}:`, error);
    }
  }

  if (portraits.length > 0) {
    beat.imageGenerationMetadata = {
      ...(beat.imageGenerationMetadata ?? {}),
      portraitGeneration: {
        count: portraits.length,
        latestState,
        portraits: portraits.map((portrait) => portrait.metadata),
      },
    };
  }

  return {
    references: portraits.map((portrait) => portrait.reference),
    latestState,
  };
}
