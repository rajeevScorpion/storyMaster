'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { resolveEffectiveProcessingMode } from '@/lib/media/processing-mode';
import { getStoryModelOverrides } from '@/app/actions/admin';
import { saveBeat, saveStory, updateBeatMediaState } from '@/app/actions/persistence';
import { enqueueBeatImageJob } from '@/app/actions/image-jobs';
import { linkCostEventsToBeat } from '@/app/actions/cost-tracking';
import { authorizeImageModelBillableActionForUser } from '@/lib/pricing/image-aware-authorize';
import { releaseBillableAction } from '@/lib/pricing/enforcement';
import {
  composeStoryboardPlan,
  generateStoryBeat,
  buildFinalStoryboardImagePrompt,
  mergeCharacterVisualReferences,
  renderStoryboardPlan,
  withGeneratedOrigin,
  type StoryModelOverrides,
} from '@/lib/ai/beat-orchestration';
import { buildCanonicalImageScene } from '@/lib/ai/prompt-compiler/scene-spec.shared';
import { assembleFinalImagePrompt } from '@/lib/ai/prompt-compiler/assemble.shared';
import { resolveImagePromptCompilerRuntimeAction } from '@/app/actions/prompt-compiler';
import {
  collectCharacterPortraitReferences,
  generatePortraitsForPlanServer,
  mergeServerReferenceImages,
  persistBeatPortraitsServer,
  type ServerReferenceImage,
} from '@/lib/ai/portraits-server';
import { normalizeBeatMediaFields } from '@/lib/types/beat-media';
import { normalizeStoryboardImageQualitySettings } from '@/lib/types/storyboard-settings';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { ImageContinuityProviderState, ImageContinuityStrategy } from '@/lib/ai/image-continuity.shared';
import type { ImageTaskKey } from '@/lib/ai/image-models.shared';
import type {
  PricingActionKey,
  PricingBillableActionAuthorization,
} from '@/lib/types/pricing';
import type {
  StoryAspectRatio,
  StoryBeat,
  StoryConfig,
  StoryNode,
  StorySession,
  StoryboardPlan,
} from '@/lib/types/story';

/**
 * Beat bundle: the flag-gated two-call generation flow.
 *
 * `generateBeatCore` collapses [coin authorize ∥ model overrides] + beat text
 * + storyboard plan into one round-trip; `processBeatVisuals` collapses
 * [portraits + beat persistence + cost linking + image-job enqueue] into a
 * second. The image itself is delivered by the existing server_pipeline job
 * worker, which owns finalize/release of the coin reservation once a job is
 * queued — identical to the legacy server_pipeline path.
 */

export async function resolveBeatGenerationModeAction(): Promise<'legacy' | 'bundle'> {
  const bundleEnabled = await getFeatureFlag('beat_bundle_enabled', false);
  if (!bundleEnabled) return 'legacy';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'legacy';

  const mode = await resolveEffectiveProcessingMode(user.id);
  return mode === 'server_pipeline' ? 'bundle' : 'legacy';
}

export interface GenerateBeatCoreInput {
  userPrompt: string;
  /** Linear-path session context the client already assembles for Gemini. */
  sessionForPrompt: Partial<StorySession>;
  selectedOptionLabel?: string;
  visualStyle: string;
  authorize: {
    actionKey: PricingActionKey;
    idempotencyKey: string;
    relatedStoryId?: string | null;
    relatedNodeId?: string | null;
    storyConfig: StoryConfig;
    imageCount?: number;
    taskKey?: ImageTaskKey;
    metadata?: Record<string, unknown>;
  };
  storyTelemetry?: CostTelemetryContext;
  composerTelemetry?: CostTelemetryContext;
}

export type GenerateBeatCoreResult =
  /** Flag off / mode mismatch / signed out — caller must run the legacy path. */
  | { status: 'legacy' }
  /** Authorization did not allow generation (denied). No work was done. */
  | { status: 'blocked'; authorization: PricingBillableActionAuthorization }
  | {
      status: 'ok';
      beat: StoryBeat;
      storyboardPlan: StoryboardPlan;
      authorization: PricingBillableActionAuthorization;
      /** Hard reservation id (null in soft/shadow/bypass modes). */
      reservationId: string | null;
      userId: string;
    };

export async function generateBeatCore(input: GenerateBeatCoreInput): Promise<GenerateBeatCoreResult> {
  // Server-side re-check — the client's cached mode answer is never trusted.
  if ((await resolveBeatGenerationModeAction()) !== 'bundle') {
    return { status: 'legacy' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'legacy' };
  }

  const [modelOverrides, authorization] = await Promise.all([
    getStoryModelOverrides().catch(() => undefined as StoryModelOverrides | undefined),
    authorizeImageModelBillableActionForUser(user.id, input.authorize),
  ]);

  if (authorization.status === 'denied') {
    return { status: 'blocked', authorization };
  }

  const reservationId =
    authorization.status === 'allowed' && authorization.mode === 'hard'
      ? authorization.reservationId
      : null;

  try {
    const generated = withGeneratedOrigin(
      await generateStoryBeat(
        input.userPrompt,
        input.sessionForPrompt,
        input.selectedOptionLabel,
        modelOverrides,
        input.storyTelemetry
      )
    );
    // Compose against the merged roster, exactly like the legacy client flow.
    const beat = mergeCharacterVisualReferences(generated, input.sessionForPrompt.characters || []);

    const storyboardPlan = await composeStoryboardPlan(
      beat,
      input.sessionForPrompt,
      input.visualStyle,
      modelOverrides,
      input.composerTelemetry
    );

    return { status: 'ok', beat, storyboardPlan, authorization, reservationId, userId: user.id };
  } catch (error) {
    // Unlike the legacy client flow, the reservation can be released here
    // before the error surfaces — no orphaned hold waiting for expiry.
    if (reservationId) {
      await releaseBillableAction({
        userId: user.id,
        reservationId,
        reason: 'beat_bundle_core_failed',
      }).catch((releaseError) => console.error('Failed to release reservation after core failure:', releaseError));
    }
    throw error;
  }
}

export type ProcessBeatVisualsTarget =
  | {
      kind: 'existing';
      storyId: string;
      nodeId: string;
      parentNodeId: string;
      selectedOptionId: string;
    }
  | {
      kind: 'new_story';
      /** Full session (with storyMap containing the pending root node). */
      session: StorySession;
      rootNodeId: string;
    };

export interface ProcessBeatVisualsInput {
  target: ProcessBeatVisualsTarget;
  /** Core output after the client attached storyboard metadata. */
  beat: StoryBeat;
  storyboardPlan: StoryboardPlan;
  visualStyle: string;
  storyConfig: StoryConfig;
  storyAspectRatio: StoryAspectRatio;
  reservationId: string | null;
  narrationVoiceId?: string | null;
  /** Parent beat's persisted storyboard URL for scene continuity (continue flow). */
  previousImageUrl?: string | null;
  parentContinuityState?: ImageContinuityProviderState | null;
  imageContinuityStrategy: ImageContinuityStrategy;
  storySessionId: string;
  portraitTelemetry?: CostTelemetryContext;
  imageTelemetry?: CostTelemetryContext;
}

export type ProcessBeatVisualsResult =
  | {
      status: 'queued';
      storyId: string;
      nodeId: string;
      savedByUserId: string;
      /** Beat with server-generated portraits + final image prompt attached. */
      beat: StoryBeat;
    }
  | {
      status: 'not_queued';
      reason: 'auth' | 'forbidden' | 'save_failed' | 'legacy_mode' | 'duplicate' | 'error';
      message?: string;
      /** Populated when portraits already ran so the client can keep them. */
      beat?: StoryBeat;
      storyId?: string;
      savedByUserId?: string;
    };

export async function processBeatVisuals(input: ProcessBeatVisualsInput): Promise<ProcessBeatVisualsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'not_queued', reason: 'auth', message: 'Not authenticated' };
  }

  if (input.target.kind === 'existing') {
    const admin = createAdminClient();
    const { data: story, error: storyError } = await admin
      .from('stories')
      .select('id, user_id')
      .eq('id', input.target.storyId)
      .single();
    if (storyError || !story) {
      return { status: 'not_queued', reason: 'forbidden', message: 'Story not found.' };
    }
    if (story.user_id !== user.id) {
      return { status: 'not_queued', reason: 'forbidden', message: 'Forbidden.' };
    }
  }

  const modelOverrides = await getStoryModelOverrides().catch(() => undefined as StoryModelOverrides | undefined);
  const { beat, storyboardPlan } = input;

  // Server-side portraits (new/changed characters only — the plan carries the
  // tasks). Mutates beat.characters portraits + generation metadata in place.
  const portraitResult = await generatePortraitsForPlanServer({
    beat,
    storyboardPlan,
    visualStyle: input.visualStyle,
    portraitReferenceConfig: input.storyConfig.portraitReferences,
    modelOverrides,
    costTelemetry: input.portraitTelemetry,
    imageModelSelection: input.storyConfig.imageModelSelection,
    continuity: {
      requestedStrategy: input.imageContinuityStrategy,
      previousState: input.parentContinuityState ?? null,
      allowRuntimeFallback: true,
    },
  });

  const portraitReferences = mergeServerReferenceImages(
    collectCharacterPortraitReferences(beat.characters),
    portraitResult.references
  );
  const references: ServerReferenceImage[] = beat.beatNumber === 1
    ? portraitReferences
    : [
        ...portraitReferences,
        ...(input.previousImageUrl
          ? [
              input.previousImageUrl.startsWith('data:')
                ? { type: 'scene' as const, dataUrl: input.previousImageUrl }
                : { type: 'scene' as const, url: input.previousImageUrl },
            ]
          : []),
      ];

  const storyboardPrompt = beat.storyboardPromptText || renderStoryboardPlan(storyboardPlan);
  const legacyBuild = () => buildFinalStoryboardImagePrompt(
    storyboardPrompt,
    beat.characters,
    input.visualStyle,
    beat.beatNumber,
    modelOverrides,
    {
      aspectRatio: input.storyAspectRatio,
      task: 'image_generation',
    }
  );

  // Image prompt compiler: build the canonical scene and let the mode decide
  // legacy vs compiled. A strict 'new'-mode compile failure must not strand the
  // coin reservation or break beat visuals here, so fall back to legacy.
  const compilerRuntime = await resolveImagePromptCompilerRuntimeAction({
    taskKey: 'image_generation',
    selection: input.storyConfig.imageModelSelection ?? null,
  }).catch(() => null);
  const canonicalScene = buildCanonicalImageScene({
    storyboardPlan,
    storyboardPromptText: beat.storyboardPromptText,
    continuityNotes: beat.continuityNotes,
    characters: beat.characters,
    visualStyle: input.visualStyle,
    aspectRatio: input.storyAspectRatio,
  });
  let finalPrompt: string;
  let promptCompilerMeta: ReturnType<typeof assembleFinalImagePrompt>['compiler'] = undefined;
  try {
    const assembled = assembleFinalImagePrompt({ runtime: compilerRuntime, scene: canonicalScene, legacyBuild });
    finalPrompt = assembled.finalPrompt;
    promptCompilerMeta = assembled.compiler;
  } catch (error) {
    console.error('prompt compiler failed in bundle path; using legacy prompt:', error);
    finalPrompt = legacyBuild();
  }
  beat.finalImagePromptText = finalPrompt;
  if (promptCompilerMeta) {
    beat.imageGenerationMetadata = { ...(beat.imageGenerationMetadata ?? {}), promptCompiler: promptCompilerMeta };
  }

  // Durable beat copy: pending image, no inline media, portraits stripped
  // (the job carries its own staged references; base64 never lands in the DB).
  const durableBeatData = normalizeBeatMediaFields({
    ...beat,
    imageUrl: undefined,
    persistedImageUrl: undefined,
    ...(input.narrationVoiceId ? { narrationVoiceId: input.narrationVoiceId } : {}),
    imageStatus: 'pending' as const,
    imageError: undefined,
    audioStatus: 'not_requested' as const,
    audioError: undefined,
    characters: beat.characters.map((character) => ({
      ...character,
      portraitBase64: undefined,
    })),
  });

  let storyId: string;
  let nodeId: string;
  let beatId: string;

  try {
    if (input.target.kind === 'new_story') {
      const { session, rootNodeId } = input.target;
      nodeId = rootNodeId;
      // The map's root node reflects the final beat (pending image) before the
      // story row is created, mirroring the legacy early save.
      const storyMap = {
        ...session.storyMap,
        nodes: {
          ...session.storyMap.nodes,
          [rootNodeId]: {
            ...session.storyMap.nodes[rootNodeId],
            data: durableBeatData,
          },
        },
      };
      const saved = await saveStory({ ...session, storyMap }, storyMap);
      storyId = saved.storyId;
      ({ beatId } = await saveBeat(storyId, rootNodeId, {
        ...storyMap.nodes[rootNodeId],
        data: durableBeatData,
      }));
    } else {
      storyId = input.target.storyId;
      nodeId = input.target.nodeId;
      const durableNode: StoryNode = {
        id: nodeId,
        beatNumber: beat.beatNumber,
        parentId: input.target.parentNodeId,
        selectedOptionId: input.target.selectedOptionId,
        data: durableBeatData,
        children: [],
      };
      ({ beatId } = await saveBeat(storyId, nodeId, durableNode, {
        linkToParent: true,
        setAsCurrent: true,
      }));
    }
  } catch (error) {
    return {
      status: 'not_queued',
      reason: 'save_failed',
      message: error instanceof Error ? error.message : 'Failed to save the beat.',
      beat,
    };
  }

  // Durable portraits: the durable beat above strips base64, so without this
  // upload the character refs would exist only in the returned beat and vanish
  // on the next reload (and library saves would copy a null portrait_url).
  if (beat.characters.some((character) => character.portraitBase64?.startsWith('data:'))) {
    try {
      const persisted = await persistBeatPortraitsServer({
        userId: user.id,
        storyId,
        nodeId,
        characters: beat.characters,
      });
      if (persisted.uploadedCount > 0) {
        // Returned beat keeps portraitBase64 for instant display; the durable
        // rows get the storage reference only.
        beat.characters = persisted.characters;
        await updateBeatMediaState(storyId, nodeId, {
          characters: persisted.characters.map((character) => ({
            ...character,
            portraitBase64: undefined,
          })),
        });
      }
    } catch (error) {
      // Non-fatal: beat + image job stay durable; portraits fall back to the
      // pre-upload session-only behavior.
      console.error('Failed to persist bundle beat portraits:', error);
    }
  }

  linkCostEventsToBeat({
    storySessionId: input.storySessionId,
    storyId,
    nodeId,
    beatId,
  }).catch((error) => console.error('Failed to link bundle beat cost events:', error));

  const enqueueResult = await enqueueBeatImageJob({
    storyId,
    nodeId,
    kind: 'beat_image',
    beatNumber: beat.beatNumber,
    reservationId: input.reservationId,
    payload: {
      finalPrompt,
      beatNumber: beat.beatNumber,
      aspectRatio: input.storyAspectRatio,
      imageTask: 'image_generation',
      imageSize: normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings).imageSize,
      imageModelSelection: input.storyConfig.imageModelSelection ?? null,
      imageContinuity: {
        requestedStrategy: input.imageContinuityStrategy,
        previousState: portraitResult.latestState ?? null,
        allowRuntimeFallback: true,
      },
      costTelemetry: input.imageTelemetry,
      references,
      promptCompiler: promptCompilerMeta ?? null,
    },
  });

  if (enqueueResult.status !== 'queued') {
    return {
      status: 'not_queued',
      reason: enqueueResult.status === 'legacy_mode'
        ? 'legacy_mode'
        : enqueueResult.status === 'duplicate'
          ? 'duplicate'
          : 'error',
      message: enqueueResult.status === 'error' ? enqueueResult.message : undefined,
      beat,
      storyId,
      savedByUserId: user.id,
    };
  }

  return {
    status: 'queued',
    storyId,
    nodeId,
    savedByUserId: user.id,
    beat,
  };
}
