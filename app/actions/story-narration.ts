'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { splitBase64DataUrl } from '@/lib/utils/data-url';
import { generateAndPersistNarration, generateNarrationOnly } from '@/app/actions/narration';
import { updateBeatMediaState, updateBeatMediaStateWithRetry } from '@/app/actions/persistence';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import {
  estimateElevenLabsForcedAlignmentCostUsd,
  getElevenLabsForcedAlignmentUsdPerHour,
} from '@/lib/ai/provider-costs';
import { normalizeStoryConfig, isReelStoryConfig } from '@/lib/ai/story-config';
import {
  applyForcedAlignmentToStoryCaptions,
  buildStoryTextOverlayAlignment,
  type ElevenLabsForcedAlignmentResponse,
} from '@/lib/story-overlay/alignment';
import { buildStoryTextOverlayCaptions } from '@/lib/story-overlay/captions';
import {
  getStoryTextOverlayGenerationEligibility,
  hasStoryTextOverlayTimedAlignment,
} from '@/lib/story-overlay/generation';
import {
  DEFAULT_STORY_TEXT_OVERLAY_STYLE,
  normalizeStoryTextOverlayStyle,
} from '@/lib/story-overlay/styles';
import { getR2ObjectBuffer } from '@/lib/media/r2-server';
import { createClient } from '@/lib/supabase/server';
import { extractStoragePath } from '@/lib/supabase/storage';
import type { DbBeat } from '@/lib/types/database';
import type {
  StoryTextOverlayAlignment,
  StoryTextOverlayCaption,
  StoryTextOverlayConfig,
} from '@/lib/story-overlay/types';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { StoryBeat, StoryConfig, StoryMap, StoryTextParts } from '@/lib/types/story';

const ELEVENLABS_FORCED_ALIGNMENT_TIMEOUT_MS = 60_000;

type StoryOverlayNarrationResult = {
  audioUrl: string;
  narrationMetadata?: StoryBeat['narrationMetadata'];
  storyTextOverlayEnabled: boolean;
  storyTextOverlayMode: NonNullable<StoryBeat['storyTextOverlayMode']>;
  storyTextOverlayStyle: NonNullable<StoryBeat['storyTextOverlayStyle']>;
  storyTextOverlayCaptions: StoryTextOverlayCaption[];
  storyTextOverlayAlignment: StoryTextOverlayAlignment;
};

export type StoryTextOverlayBeatGenerationStatus = 'synced' | 'fallback';

export interface StoryTextOverlayBeatGenerationResult {
  nodeId: string;
  status: StoryTextOverlayBeatGenerationStatus;
  storyTextOverlayEnabled: boolean;
  storyTextOverlayMode: NonNullable<StoryBeat['storyTextOverlayMode']>;
  storyTextOverlayStyle: NonNullable<StoryBeat['storyTextOverlayStyle']>;
  storyTextOverlayCaptions: StoryTextOverlayCaption[];
  storyTextOverlayAlignment: StoryTextOverlayAlignment;
}

export interface StoryTextOverlayStoryGenerationResult {
  storyId: string;
  generated: number;
  fallback: number;
  skipped: number;
  failed: number;
  results: Array<
    | (StoryTextOverlayBeatGenerationResult & { status: StoryTextOverlayBeatGenerationStatus })
    | {
        nodeId: string;
        status: 'skipped' | 'failed';
        message: string;
        storyTextOverlayCaptions?: StoryTextOverlayCaption[];
        storyTextOverlayAlignment?: StoryTextOverlayAlignment;
      }
  >;
}

type StoryTextOverlaySourceBeat = Pick<
  StoryBeat,
  | 'isStoryboard'
  | 'imageUrl'
  | 'audioUrl'
  | 'storyText'
  | 'storyTextParts'
  | 'storyTextOverlayEnabled'
  | 'storyTextOverlayMode'
  | 'storyTextOverlayStyle'
  | 'storyTextOverlayCaptions'
  | 'storyTextOverlayAlignment'
  | 'narrationMetadata'
>;

interface LoadedStoryTextOverlayBeat {
  storyId: string;
  beatId: string | null;
  nodeId: string;
  beatNumber: number | null;
  storyConfig: StoryConfig;
  beat: StoryTextOverlaySourceBeat;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ]);
}

function normalizeOverlayConfig(config: Partial<StoryTextOverlayConfig> | null | undefined): StoryTextOverlayConfig {
  return {
    enabled: config?.enabled !== false,
    mode: config?.mode === 'line' ? 'line' : 'word',
    style: normalizeStoryTextOverlayStyle(config?.style ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE),
  };
}

function parseDataAudioUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const parsed = splitBase64DataUrl(dataUrl);
  if (!parsed) return null;
  return {
    mimeType: parsed.mimeType || 'audio/wav',
    buffer: Buffer.from(parsed.base64, 'base64'),
  };
}

async function readAudioUrl(
  audioUrl: string,
  supabase?: SupabaseClient
): Promise<{ buffer: Buffer; mimeType: string }> {
  const dataPayload = parseDataAudioUrl(audioUrl);
  if (dataPayload) return dataPayload;

  const r2Payload = await getR2ObjectBuffer(audioUrl).catch((error) => {
    throw new Error(
      `Unable to load story narration audio from R2: ${error instanceof Error ? error.message : 'download failed'}`
    );
  });
  if (r2Payload) {
    return {
      buffer: r2Payload.buffer,
      mimeType: r2Payload.contentType || 'audio/wav',
    };
  }

  const storagePath = supabase ? extractStoragePath(audioUrl, 'story-assets') : null;
  if (storagePath && supabase) {
    const { data, error } = await supabase.storage.from('story-assets').download(storagePath);
    if (error || !data) {
      throw new Error(`Unable to load story narration audio from storage: ${error?.message || 'not found'}`);
    }
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      mimeType: data.type || 'audio/wav',
    };
  }

  const response = await fetch(audioUrl).catch((error) => {
    throw new Error(
      `Unable to load story narration audio URL: ${error instanceof Error ? error.message : 'fetch failed'}`
    );
  });
  if (!response.ok) {
    throw new Error(`Unable to load story narration audio for alignment: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/wav',
  };
}

function extensionFromMimeType(mimeType: string): string {
  if (/mpeg|mp3/i.test(mimeType)) return 'mp3';
  if (/ogg/i.test(mimeType)) return 'ogg';
  if (/webm/i.test(mimeType)) return 'webm';
  return 'wav';
}

async function callElevenLabsForcedAlignment(input: {
  audioBuffer: Buffer;
  mimeType: string;
  transcript: string;
}): Promise<ElevenLabsForcedAlignmentResponse> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured.');
  }

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(input.audioBuffer)], { type: input.mimeType }),
    `story-narration.${extensionFromMimeType(input.mimeType)}`
  );
  formData.append('text', input.transcript);

  const response = await withTimeout(
    fetch('https://api.elevenlabs.io/v1/forced-alignment', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: formData,
    }).catch((error) => {
      throw new Error(
        `Unable to reach ElevenLabs forced alignment: ${error instanceof Error ? error.message : 'fetch failed'}`
      );
    }),
    ELEVENLABS_FORCED_ALIGNMENT_TIMEOUT_MS,
    'ElevenLabs forced alignment'
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`ElevenLabs forced alignment failed: ${response.status} ${message.slice(0, 180)}`);
  }

  return response.json() as Promise<ElevenLabsForcedAlignmentResponse>;
}

async function buildStoryOverlayTiming(input: {
  audioUrl: string;
  storyText: string;
  storyTextParts?: StoryTextParts;
  supabase?: SupabaseClient;
  costTelemetry?: CostTelemetryContext | null;
  audioSeconds?: number | null;
}): Promise<{
  captions: StoryTextOverlayCaption[];
  alignment: StoryTextOverlayAlignment;
}> {
  const captions = buildStoryTextOverlayCaptions({
    storyText: input.storyText,
    storyTextParts: input.storyTextParts,
  });

  const startedAt = Date.now();
  try {
    const audio = await readAudioUrl(input.audioUrl, input.supabase);
    const response = await callElevenLabsForcedAlignment({
      audioBuffer: audio.buffer,
      mimeType: audio.mimeType,
      transcript: input.storyText,
    });
    const overlay = applyForcedAlignmentToStoryCaptions(captions, response);
    const audioSeconds = input.audioSeconds || getCaptionAudioSeconds(overlay.captions);
    await recordForcedAlignmentCostEvent({
      context: input.costTelemetry,
      status: 'success',
      storyText: input.storyText,
      audioSeconds,
      latencyMs: Date.now() - startedAt,
      alignedWordCount: overlay.alignment.alignedWordCount,
      loss: overlay.alignment.loss,
    });
    return overlay;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Story text alignment failed.';
    await recordForcedAlignmentCostEvent({
      context: input.costTelemetry,
      status: 'failed',
      storyText: input.storyText,
      audioSeconds: input.audioSeconds,
      latencyMs: Date.now() - startedAt,
      error: message,
      failedBeforeProviderCall:
        message.includes('ELEVENLABS_API_KEY')
        || message.includes('Unable to load story narration audio'),
    });
    console.warn('[story-narration] Forced alignment failed; story overlay will show without timed highlight:', message);
    return {
      captions,
      alignment: buildStoryTextOverlayAlignment({
        source: 'none',
        textHighlightSupported: false,
        alignedWordCount: 0,
        error: message,
      }),
    };
  }
}

function getStoryTextPartsFromMap(storyMap: unknown, nodeId: string): StoryTextParts | undefined {
  if (!storyMap || typeof storyMap !== 'object' || !('nodes' in storyMap)) return undefined;
  const node = (storyMap as StoryMap).nodes?.[nodeId];
  const parts = node?.data?.storyTextParts;
  return Array.isArray(parts) && parts.length === 4 ? parts as StoryTextParts : undefined;
}

function isSyncedAlignment(alignment: StoryTextOverlayAlignment): boolean {
  return alignment.source === 'elevenlabs_forced_alignment' && alignment.textHighlightSupported !== false;
}

function getCaptionAudioSeconds(captions: StoryTextOverlayCaption[]): number {
  const maxEndMs = captions.reduce((max, caption) => Math.max(max, caption.endMs ?? 0), 0);
  return maxEndMs > 0 ? maxEndMs / 1000 : 0;
}

function withOverlayPhase(context: CostTelemetryContext): CostTelemetryContext {
  return {
    ...context,
    phase: 'story_text_overlay_alignment',
    metadata: {
      ...(context.metadata || {}),
      overlayProvider: 'elevenlabs',
      overlayEndpoint: 'forced-alignment',
    },
  };
}

async function recordForcedAlignmentCostEvent(input: {
  context?: CostTelemetryContext | null;
  status: 'success' | 'failed';
  storyText: string;
  audioSeconds?: number | null;
  latencyMs: number;
  alignedWordCount?: number | null;
  loss?: number | null;
  error?: string | null;
  failedBeforeProviderCall?: boolean;
}) {
  if (!input.context) return;

  const audioSeconds = Math.max(0, Number.isFinite(input.audioSeconds ?? NaN) ? Number(input.audioSeconds) : 0);
  const [estimatedCostUsd, usdPerHour] = await Promise.all([
    input.status === 'success'
      ? estimateElevenLabsForcedAlignmentCostUsd({ audioSeconds })
      : Promise.resolve(0),
    getElevenLabsForcedAlignmentUsdPerHour(),
  ]);

  await recordModelCostEvent({
    context: withOverlayPhase(input.context),
    taskKey: 'story_text_overlay_alignment',
    provider: 'elevenlabs',
    modelId: 'elevenlabs-forced-alignment',
    audioSeconds,
    latencyMs: input.latencyMs,
    estimatedCostUsdOverride: estimatedCostUsd,
    status: input.status,
    metadata: {
      transcriptCharacterCount: input.storyText.length,
      pricingBasis: 'audio_seconds',
      forcedAlignmentUsdPerHour: usdPerHour,
      ...(input.alignedWordCount != null ? { alignedWordCount: input.alignedWordCount } : {}),
      ...(input.loss != null && Number.isFinite(input.loss) ? { loss: input.loss } : {}),
      ...(input.error ? { error: input.error.slice(0, 240) } : {}),
      ...(input.failedBeforeProviderCall ? { failedBeforeProviderCall: true } : {}),
    },
  });
}

async function loadSavedStoryOverlayBeat(
  supabase: SupabaseClient,
  storyId: string,
  nodeId: string
): Promise<LoadedStoryTextOverlayBeat> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('story_config, story_kind, is_vertical_story, aspect_ratio, story_map')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .single();

  if (storyError || !story) {
    throw new Error(`Story not found for text overlay generation: ${storyError?.message || 'not found'}`);
  }

  const storyConfig = normalizeStoryConfig({
    ...((story.story_config as Record<string, unknown> | null) ?? {}),
    story_kind: story.story_kind,
    isVerticalStory: story.is_vertical_story,
    aspectRatio: story.aspect_ratio,
  });
  if (isReelStoryConfig(storyConfig)) {
    throw new Error('Story text overlay generation is not available for reels.');
  }

  const { data: beatRow, error: beatError } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .eq('node_id', nodeId)
    .maybeSingle();

  if (beatError || !beatRow) {
    throw new Error(`Beat not found for text overlay generation: ${beatError?.message || 'not found'}`);
  }

  const beat = beatRow as DbBeat;
  const mapTextParts = getStoryTextPartsFromMap(story.story_map, nodeId);
  const mapNode = story.story_map && typeof story.story_map === 'object' && 'nodes' in story.story_map
    ? (story.story_map as unknown as StoryMap).nodes?.[nodeId]
    : undefined;
  const mapBeat = mapNode?.data;

  return {
    storyId,
    beatId: beat.id || null,
    nodeId,
    beatNumber: typeof beat.beat_number === 'number' ? beat.beat_number : null,
    storyConfig,
    beat: {
      isStoryboard: Boolean(beat.is_storyboard || mapBeat?.isStoryboard),
      imageUrl: beat.image_url || mapBeat?.imageUrl,
      audioUrl: beat.audio_url || mapBeat?.audioUrl,
      storyText: beat.story_text || mapBeat?.storyText || '',
      storyTextParts: mapTextParts,
      narrationMetadata: (beat.narration_metadata as StoryBeat['narrationMetadata'] | undefined) ?? mapBeat?.narrationMetadata,
      storyTextOverlayEnabled: typeof beat.story_text_overlay_enabled === 'boolean'
        ? beat.story_text_overlay_enabled
        : mapBeat?.storyTextOverlayEnabled,
      storyTextOverlayMode: beat.story_text_overlay_mode || mapBeat?.storyTextOverlayMode,
      storyTextOverlayStyle: beat.story_text_overlay_style || mapBeat?.storyTextOverlayStyle,
      storyTextOverlayCaptions: Array.isArray(beat.story_text_overlay_captions)
        ? beat.story_text_overlay_captions as StoryTextOverlayCaption[]
        : mapBeat?.storyTextOverlayCaptions,
      storyTextOverlayAlignment: beat.story_text_overlay_alignment
        ? beat.story_text_overlay_alignment as StoryTextOverlayAlignment
        : mapBeat?.storyTextOverlayAlignment,
    },
  };
}

async function generateAndPersistOverlayForLoadedBeat(
  supabase: SupabaseClient,
  source: LoadedStoryTextOverlayBeat,
  overlayConfigInput?: Partial<StoryTextOverlayConfig> | null
): Promise<StoryTextOverlayBeatGenerationResult> {
  const overlayConfig = normalizeOverlayConfig(overlayConfigInput ?? source.storyConfig.storyTextOverlay);
  const eligibility = getStoryTextOverlayGenerationEligibility(source.beat);
  if (!eligibility.eligible) {
    throw new Error(eligibility.message || 'This beat is not ready for story text overlay generation.');
  }
  if (!source.beat.audioUrl) {
    throw new Error('Generate narration before generating text overlay timing.');
  }

  const overlay = await buildStoryOverlayTiming({
    audioUrl: source.beat.audioUrl,
    storyText: source.beat.storyText,
    storyTextParts: source.beat.storyTextParts,
    supabase,
    costTelemetry: {
      activityKey: 'generate_story_text_overlay',
      storyId: source.storyId,
      beatId: source.beatId,
      nodeId: source.nodeId,
      beatNumber: source.beatNumber,
    },
    audioSeconds: source.beat.narrationMetadata?.durationMs
      ? source.beat.narrationMetadata.durationMs / 1000
      : null,
  });

  await updateBeatMediaState(source.storyId, source.nodeId, {
    storyTextOverlayEnabled: overlayConfig.enabled,
    storyTextOverlayMode: overlayConfig.mode,
    storyTextOverlayStyle: overlayConfig.style,
    storyTextOverlayCaptions: overlay.captions,
    storyTextOverlayAlignment: overlay.alignment,
  });

  return {
    nodeId: source.nodeId,
    status: isSyncedAlignment(overlay.alignment) ? 'synced' : 'fallback',
    storyTextOverlayEnabled: overlayConfig.enabled,
    storyTextOverlayMode: overlayConfig.mode,
    storyTextOverlayStyle: overlayConfig.style,
    storyTextOverlayCaptions: overlay.captions,
    storyTextOverlayAlignment: overlay.alignment,
  };
}

export async function generateStoryTextOverlayForBeat(
  input: {
    storyId: string;
    nodeId: string;
    overlayConfig?: Partial<StoryTextOverlayConfig> | null;
  }
): Promise<StoryTextOverlayBeatGenerationResult> {
  const supabase = await createClient();
  const source = await loadSavedStoryOverlayBeat(supabase, input.storyId, input.nodeId);
  return generateAndPersistOverlayForLoadedBeat(supabase, source, input.overlayConfig);
}

export async function generateStoryTextOverlayForStory(
  input: {
    storyId: string;
    nodeIds: string[];
    overlayConfig?: Partial<StoryTextOverlayConfig> | null;
    force?: boolean;
  }
): Promise<StoryTextOverlayStoryGenerationResult> {
  const supabase = await createClient();
  const nodeIds = Array.from(new Set(input.nodeIds.filter(Boolean)));
  if (nodeIds.length === 0) {
    throw new Error('No story beats were selected for text overlay generation.');
  }

  const result: StoryTextOverlayStoryGenerationResult = {
    storyId: input.storyId,
    generated: 0,
    fallback: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  for (const nodeId of nodeIds) {
    try {
      const source = await loadSavedStoryOverlayBeat(supabase, input.storyId, nodeId);
      const eligibility = getStoryTextOverlayGenerationEligibility(source.beat);
      if (!eligibility.eligible) {
        result.skipped += 1;
        result.results.push({
          nodeId,
          status: 'skipped',
          message: eligibility.message || 'This beat is not ready for story text overlay generation.',
        });
        continue;
      }
      if (!input.force && hasStoryTextOverlayTimedAlignment(source.beat)) {
        result.skipped += 1;
        result.results.push({
          nodeId,
          status: 'skipped',
          message: 'Beat already has synced story text overlay timing.',
          storyTextOverlayCaptions: source.beat.storyTextOverlayCaptions,
          storyTextOverlayAlignment: source.beat.storyTextOverlayAlignment,
        });
        continue;
      }

      const beatResult = await generateAndPersistOverlayForLoadedBeat(
        supabase,
        source,
        input.overlayConfig
      );
      if (beatResult.status === 'synced') {
        result.generated += 1;
      } else {
        result.fallback += 1;
      }
      result.results.push(beatResult);
    } catch (error) {
      result.failed += 1;
      result.results.push({
        nodeId,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Story text overlay generation failed.',
      });
    }
  }

  return result;
}

export async function generateAndPersistStoryNarrationWithOverlay(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  savedStoryId: string,
  nodeId: string,
  costTelemetry?: CostTelemetryContext,
  options: {
    narrationStyle?: string;
    accent?: string | null;
    storyTextParts?: StoryTextParts;
    overlayConfig?: Partial<StoryTextOverlayConfig> | null;
    // Background worker path: persist on behalf of `userId` via the service-role
    // client. Absent for the interactive path (unchanged behaviour).
    serverAuth?: { userId: string };
  } = {}
): Promise<StoryOverlayNarrationResult> {
  const overlayConfig = normalizeOverlayConfig(options.overlayConfig);
  const narration = await generateAndPersistNarration(
    storyText,
    tone,
    genre,
    voiceName,
    language,
    savedStoryId,
    nodeId,
    costTelemetry,
    {
      taskKey: 'tts',
      narrationStyle: options.narrationStyle,
      accent: options.accent,
      ...(options.serverAuth ? { serverAuth: options.serverAuth } : {}),
    }
  );

  const overlay = await buildStoryOverlayTiming({
    audioUrl: narration.audioUrl,
    storyText,
    storyTextParts: options.storyTextParts,
    costTelemetry,
    audioSeconds: narration.narrationMetadata?.durationMs
      ? narration.narrationMetadata.durationMs / 1000
      : null,
  });

  try {
    // Retry BEAT_ROW_NOT_FOUND: in interactive mode the beat row may still be landing
    // from the client's fire-and-forget save. The worker path (serverAuth) opts out.
    await updateBeatMediaStateWithRetry(savedStoryId, nodeId, {
      storyTextOverlayEnabled: overlayConfig.enabled,
      storyTextOverlayMode: overlayConfig.mode,
      storyTextOverlayStyle: overlayConfig.style,
      storyTextOverlayCaptions: overlay.captions,
      storyTextOverlayAlignment: overlay.alignment,
    }, options.serverAuth, options.serverAuth ? { attempts: 1 } : {});
  } catch (error) {
    console.warn(
      '[story-narration] Failed to persist story text overlay metadata:',
      error instanceof Error ? error.message : error
    );
  }

  return {
    audioUrl: narration.audioUrl,
    narrationMetadata: narration.narrationMetadata,
    storyTextOverlayEnabled: overlayConfig.enabled,
    storyTextOverlayMode: overlayConfig.mode,
    storyTextOverlayStyle: overlayConfig.style,
    storyTextOverlayCaptions: overlay.captions,
    storyTextOverlayAlignment: overlay.alignment,
  };
}

export async function generateStoryNarrationOnlyWithOverlay(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  costTelemetry?: CostTelemetryContext,
  options: {
    narrationStyle?: string;
    accent?: string | null;
    storyTextParts?: StoryTextParts;
    overlayConfig?: Partial<StoryTextOverlayConfig> | null;
  } = {}
): Promise<StoryOverlayNarrationResult> {
  const overlayConfig = normalizeOverlayConfig(options.overlayConfig);
  const audioUrl = await generateNarrationOnly(
    storyText,
    tone,
    genre,
    voiceName,
    language,
    costTelemetry,
    {
      taskKey: 'tts',
      narrationStyle: options.narrationStyle,
      accent: options.accent,
    }
  );
  const overlay = await buildStoryOverlayTiming({
    audioUrl,
    storyText,
    storyTextParts: options.storyTextParts,
    costTelemetry,
  });

  return {
    audioUrl,
    storyTextOverlayEnabled: overlayConfig.enabled,
    storyTextOverlayMode: overlayConfig.mode,
    storyTextOverlayStyle: overlayConfig.style,
    storyTextOverlayCaptions: overlay.captions,
    storyTextOverlayAlignment: overlay.alignment,
  };
}
