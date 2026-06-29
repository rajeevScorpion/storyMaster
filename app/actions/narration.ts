'use server';

import { GoogleGenAI } from '@google/genai';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { getModelConfig } from '@/lib/ai/model-config';
import {
  LOCKED_PROMPT_GUARDRAILS,
  resolvePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import { estimateElevenLabsModelCostUsd } from '@/lib/ai/provider-costs';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { StoryBeat, WordTiming } from '@/lib/types/story';
import { DEFAULT_REEL_STORY_SETTINGS, normalizeReelStorySettings, type ReelStorySettings } from '@/lib/reel/settings';
import {
  buildNarrationPerformanceScript,
  getTextHighlightSupported,
  getElevenLabsUnsupportedLanguageReason,
  getNarrationPresetById,
  normalizeNarrationMetadata,
  normalizeReelNarrationPanelPauseMs,
  normalizeReelNarrationSettings,
  resolveElevenLabsModelForLanguage,
  toElevenLabsLanguageCode,
  type BeatNarrationMetadata,
  type NarrationGenerationMode,
  type NarrationProvider,
  type NarrationPreset,
  type ReelNarrationSettings,
  type WordTimestamp,
} from '@/lib/reel/narration';
import { getNarrationVoiceSettings } from '@/lib/ai/narration-voice-settings';
import { resolveNarrationVoiceDecision } from '@/lib/ai/narration-voice-resolver';
import { updateBeatMediaState } from '@/app/actions/persistence';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { putR2Object, createR2SignedGetUrl } from '@/lib/media/r2-server';
import { recordMediaAsset } from '@/lib/media/media-assets';
import {
  getDefaultVoiceForGender,
  resolveStoryNarrationLanguage,
  type NarrationGenderBucket,
  type NarrationLanguageCode,
  type NarrationVoiceClientConfig,
  type NarrationVoiceMode,
  type NarrationVoiceSampleClientStatus,
  type NarrationVoiceSampleStatus,
  type NarrationVoiceSettings,
} from '@/lib/ai/narration-voices';

const GEMINI_TTS_TIMEOUT_MS = 120_000;
const ELEVENLABS_TTS_TIMEOUT_MS = 45_000;
const NARRATION_SAMPLE_BUCKET = 'narration-voice-samples';
const VOICE_SAMPLE_BATCH_SIZE = 6;
const VOICE_SAMPLE_BATCH_DELAY_MS = 65_000;
const VOICE_SAMPLE_MAX_ATTEMPTS = 3;

function narrationNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function timeNarrationStep<T>(
  scope: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = narrationNowMs();
  try {
    const result = await fn();
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(narrationNowMs() - startedAt),
      success: true,
      ...meta,
    });
    return result;
  } catch (error) {
    console.info(`[timing:${scope}]`, {
      durationMs: Math.round(narrationNowMs() - startedAt),
      success: false,
      ...meta,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Narration provider timeout after ${ms / 1000}s (${label})`)), ms)
    ),
  ]);
}

const AVAILABLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

const DEFAULT_VOICE = 'Sulafat';

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
}

function pcmBufferToWavBuffer(pcmBytes: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const dataSize = pcmBytes.length;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');

  // fmt sub-chunk
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBytes]);
}

function pcmToWavBuffer(pcmBase64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  return pcmBufferToWavBuffer(Buffer.from(pcmBase64, 'base64'), sampleRate, channels, bitsPerSample);
}

function pcmBase64DurationMs(pcmBase64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16): number {
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  const pcmBytes = Buffer.from(pcmBase64, 'base64');
  return Math.round((pcmBytes.length / bytesPerSecond) * 1000);
}

function pcmBufferDurationMs(pcmBytes: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): number {
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  return Math.round((pcmBytes.length / bytesPerSecond) * 1000);
}

function silencePcmBuffer(durationMs: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  return Buffer.alloc(Math.max(0, Math.round((durationMs / 1000) * bytesPerSecond)));
}

function sampleTextHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24);
}

function safeStorageSegment(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '_') || 'voice';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function extractRetryDelayMs(error: unknown): number | null {
  const text = getErrorText(error);
  const retryMatch = text.match(/retry\s+in\s+([\d.]+)\s*s/i);
  if (retryMatch?.[1]) {
    return Math.ceil(Number(retryMatch[1]) * 1000) + 1000;
  }

  const retryDelayMatch = text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (retryDelayMatch?.[1]) {
    return Math.ceil(Number(retryDelayMatch[1]) * 1000) + 1000;
  }

  return null;
}

function isRateLimitError(error: unknown): boolean {
  const text = getErrorText(error);
  return text.includes('429') || /RESOURCE_EXHAUSTED/i.test(text) || /quota exceeded/i.test(text);
}

function sanitizeNarrationSampleError(error: unknown): string {
  const text = getErrorText(error);
  if (isRateLimitError(error)) {
    const retryDelayMs = extractRetryDelayMs(error);
    if (retryDelayMs) {
      return `Gemini TTS rate limit reached. Try again in about ${Math.ceil(retryDelayMs / 1000)} seconds.`;
    }
    return 'Gemini TTS rate limit reached. Try again in about a minute.';
  }

  if (/voice/i.test(text) && (/invalid|unsupported|not found/i.test(text))) {
    return 'Gemini TTS could not use this voice ID. Check the voice list and regenerate samples.';
  }

  if (/upload|storage/i.test(text)) {
    return 'Voice sample was generated, but storage upload failed. Try regenerating samples.';
  }

  const firstLine = text.split(/\r?\n/)[0]?.trim();
  return firstLine ? firstLine.slice(0, 180) : 'Voice sample generation failed.';
}

function isMissingNarrationColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error?.message) return false;
  return (
    error.code === 'PGRST204'
    || (/schema cache/i.test(error.message) && /column/i.test(error.message))
  );
}

function buildVoiceEntries(settings: Pick<NarrationVoiceSettings, 'maleVoiceList' | 'femaleVoiceList'>): Array<{
  voiceId: string;
  genderBucket: NarrationGenderBucket;
}> {
  return [
    ...settings.maleVoiceList.map((voiceId) => ({ voiceId, genderBucket: 'male' as const })),
    ...settings.femaleVoiceList.map((voiceId) => ({ voiceId, genderBucket: 'female' as const })),
  ];
}

async function listNarrationVoiceSampleStatuses(
  settings: NarrationVoiceSettings
): Promise<NarrationVoiceSampleClientStatus[]> {
  const voiceEntries = buildVoiceEntries(settings);
  const languageHashes = new Map(
    settings.supportedLanguages.map((language) => [
      language.code,
      sampleTextHash(settings.sampleTextByLanguage[language.code]),
    ])
  );

  let rows: Array<{
    voice_id: string;
    gender_bucket: string;
    language_code: string;
    sample_text_hash: string;
    file_url: string | null;
    generation_status: string;
    generation_error: string | null;
    updated_at: string | null;
  }> = [];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('narration_voice_samples')
      .select('voice_id, gender_bucket, language_code, sample_text_hash, file_url, generation_status, generation_error, updated_at')
      .in('voice_id', voiceEntries.map((entry) => entry.voiceId))
      .in('language_code', settings.supportedLanguages.map((language) => language.code))
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to list narration voice sample statuses:', error.message);
    } else {
      rows = data || [];
    }
  } catch (error) {
    console.error('Failed to list narration voice sample statuses:', error);
  }

  return voiceEntries.flatMap((entry) =>
    settings.supportedLanguages.map((language) => {
      const activeHash = languageHashes.get(language.code);
      const row = rows.find((candidate) =>
        candidate.voice_id === entry.voiceId
        && candidate.language_code === language.code
        && candidate.sample_text_hash === activeHash
      );
      const status = (row?.generation_status || 'pending') as NarrationVoiceSampleStatus;

      return {
        voiceId: entry.voiceId,
        genderBucket: entry.genderBucket,
        languageCode: language.code,
        status,
        audioUrl: status === 'ready' ? row?.file_url || null : null,
        lastGeneratedAt: status === 'ready' ? row?.updated_at || null : row?.updated_at || null,
        error: status === 'failed' ? sanitizeNarrationSampleError(row?.generation_error || 'Sample generation failed.') : null,
      };
    })
  );
}

export async function getNarrationVoiceSelectionConfig(
  storyLanguage: string = 'english'
): Promise<NarrationVoiceClientConfig> {
  const settings = await getNarrationVoiceSettings();
  const languageResolution = resolveStoryNarrationLanguage(storyLanguage);
  const samples = await listNarrationVoiceSampleStatuses(settings);

  return {
    enabled: settings.userLedVoiceSelectionEnabled,
    maleVoiceList: settings.maleVoiceList,
    femaleVoiceList: settings.femaleVoiceList,
    defaultMaleVoice: settings.defaultMaleVoice,
    defaultFemaleVoice: settings.defaultFemaleVoice,
    languageCode: languageResolution.languageCode,
    requestedStoryLanguage: storyLanguage === 'hindi' ? 'hindi' : 'english',
    fallbackToEnglishSample: languageResolution.fallbackToEnglishSample,
    samples: samples.filter((sample) => sample.languageCode === languageResolution.languageCode),
  };
}

export async function getNarrationVoiceSampleStatusesForAdmin(): Promise<NarrationVoiceSampleClientStatus[]> {
  const settings = await getNarrationVoiceSettings();
  return listNarrationVoiceSampleStatuses(settings);
}

export async function generateNarrationVoiceSamples(options: { regenerateAll?: boolean } = {}): Promise<{
  statuses: NarrationVoiceSampleClientStatus[];
  generatedCount: number;
  failedCount: number;
  skippedCount: number;
}> {
  await verifyAdmin();
  const settings = await getNarrationVoiceSettings();
  const admin = createAdminClient();
  const existingStatuses = await listNarrationVoiceSampleStatuses(settings);
  const allTasks = buildVoiceEntries(settings).flatMap((entry) =>
    settings.supportedLanguages.map((language) => ({
      ...entry,
      languageCode: language.code,
      sampleText: settings.sampleTextByLanguage[language.code],
    }))
  );
  const tasks = options.regenerateAll
    ? allTasks
    : allTasks.filter((task) => {
        const existing = existingStatuses.find((status) =>
          status.voiceId === task.voiceId && status.languageCode === task.languageCode
        );
        return existing?.status !== 'ready' || !existing.audioUrl;
      });

  let generatedCount = 0;
  let failedCount = 0;
  const skippedCount = allTasks.length - tasks.length;

  for (let batchStart = 0; batchStart < tasks.length; batchStart += VOICE_SAMPLE_BATCH_SIZE) {
    const batch = tasks.slice(batchStart, batchStart + VOICE_SAMPLE_BATCH_SIZE);
    await Promise.all(batch.map(async (task) => {
      const hash = sampleTextHash(task.sampleText);
      const storagePath = `${task.languageCode}/${safeStorageSegment(task.voiceId)}/${hash}.wav`;

      try {
        await admin
          .from('narration_voice_samples')
          .upsert(
            {
              voice_id: task.voiceId,
              gender_bucket: task.genderBucket,
              language_code: task.languageCode,
              sample_text_hash: hash,
              sample_text: task.sampleText,
              storage_bucket: NARRATION_SAMPLE_BUCKET,
              storage_path: storagePath,
              file_url: null,
              duration_ms: null,
              generation_status: 'generating',
              generation_error: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'voice_id,language_code,sample_text_hash' }
          );

        let pcmBase64: string | null = null;
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= VOICE_SAMPLE_MAX_ATTEMPTS; attempt += 1) {
          try {
            const ttsResult = await callGeminiTTS(
              task.sampleText,
              'warm',
              'narration voice sample',
              task.voiceId,
              task.languageCode
            );
            pcmBase64 = ttsResult.pcmBase64;
            break;
          } catch (error) {
            lastError = error;
            const retryDelayMs = extractRetryDelayMs(error);
            if (!isRateLimitError(error) || attempt === VOICE_SAMPLE_MAX_ATTEMPTS) {
              throw error;
            }
            await sleep(Math.max(retryDelayMs ?? VOICE_SAMPLE_BATCH_DELAY_MS, 10_000));
          }
        }

        if (!pcmBase64) {
          throw lastError || new Error('No audio generated.');
        }

        const wavBuffer = pcmToWavBuffer(pcmBase64);
        const durationMs = pcmBase64DurationMs(pcmBase64);

        const upload = await admin.storage
          .from(NARRATION_SAMPLE_BUCKET)
          .upload(storagePath, wavBuffer, {
            contentType: 'audio/wav',
            upsert: true,
          });

        if (upload.error) {
          throw new Error(upload.error.message);
        }

        const { data: urlData } = admin.storage
          .from(NARRATION_SAMPLE_BUCKET)
          .getPublicUrl(storagePath);

        const { error: updateError } = await admin
          .from('narration_voice_samples')
          .update({
            file_url: urlData.publicUrl,
            duration_ms: durationMs,
            generation_status: 'ready',
            generation_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('voice_id', task.voiceId)
          .eq('language_code', task.languageCode)
          .eq('sample_text_hash', hash);

        if (updateError) {
          throw new Error(updateError.message);
        }

        generatedCount += 1;
      } catch (error) {
        failedCount += 1;
        const message = sanitizeNarrationSampleError(error);
        console.error('Narration voice sample generation failed:', {
          voiceId: task.voiceId,
          languageCode: task.languageCode,
          message,
          rawMessage: getErrorText(error).slice(0, 500),
        });
        await admin
          .from('narration_voice_samples')
          .upsert(
            {
              voice_id: task.voiceId,
              gender_bucket: task.genderBucket,
              language_code: task.languageCode,
              sample_text_hash: hash,
              sample_text: task.sampleText,
              storage_bucket: NARRATION_SAMPLE_BUCKET,
              storage_path: storagePath,
              file_url: null,
              duration_ms: null,
              generation_status: 'failed',
              generation_error: message,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'voice_id,language_code,sample_text_hash' }
          );
      }
    }));

    if (batchStart + VOICE_SAMPLE_BATCH_SIZE < tasks.length) {
      await sleep(VOICE_SAMPLE_BATCH_DELAY_MS);
    }
  }

  return {
    statuses: await listNarrationVoiceSampleStatuses(settings),
    generatedCount,
    failedCount,
    skippedCount,
  };
}

interface GeminiTTSResult {
  pcmBase64: string;
  modelId: string;
  tokensUsed?: number;
}

async function callGeminiTTS(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  costTelemetry?: CostTelemetryContext,
  options: {
    taskKey?: Extract<TaskKey, 'tts' | 'reel_tts'>;
    narrationStyle?: string;
  } = {}
): Promise<GeminiTTSResult> {
  return timeNarrationStep(
    'narration.call_gemini_tts',
    {
      language,
      voiceName,
      storyLength: storyText.length,
    },
    async () => {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const taskKey = options.taskKey ?? 'tts';
      const ttsConfig = await getModelConfig(taskKey);
      const ttsPrompt = resolvePromptTemplate(
        await getPublishedPrompt(taskKey),
        {
          storyText,
          tone,
          genre,
          language,
          narrationStyle: options.narrationStyle || tone,
        }
      );
      const ttsFlagVal = await getFeatureFlagValue('gemini_tts_timeout_ms');
      const ttsTimeoutMs = (ttsFlagVal ? parseInt(ttsFlagVal, 10) : 0) || GEMINI_TTS_TIMEOUT_MS;

      const startedAt = narrationNowMs();
      const response = await withTimeout(
        ai.models.generateContent({
          model: ttsConfig.model,
          contents: [{ parts: [{ text: ttsPrompt }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
        ttsTimeoutMs,
        'tts'
      );

      const audioPart = response.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData
      );

      if (!audioPart?.inlineData?.data) {
        throw new Error('No audio generated');
      }

      if (costTelemetry) {
        const pcmBytes = Buffer.from(audioPart.inlineData.data, 'base64');
        const audioSeconds = pcmBytes.length / (24000 * 2);
        const fallbackAudioOutputTokens = Math.ceil(audioSeconds * 25);
        await recordModelCostEvent({
          context: costTelemetry,
          taskKey,
          modelId: ttsConfig.model,
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount || fallbackAudioOutputTokens,
          audioSeconds,
          latencyMs: narrationNowMs() - startedAt,
          metadata: {
            storyLength: storyText.length,
            language,
            voiceName,
            outputTokenFallback: !response.usageMetadata?.candidatesTokenCount,
          },
        });
      }

      return {
        pcmBase64: audioPart.inlineData.data,
        modelId: ttsConfig.model,
        tokensUsed: response.usageMetadata
          ? (response.usageMetadata.promptTokenCount ?? 0) + (response.usageMetadata.candidatesTokenCount ?? 0)
          : undefined,
      };
    }
  );
}

type ReelCaptionTiming = NonNullable<StoryBeat['reelCaptions']>;

interface NarrationAudioPayload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  reelCaptions?: ReelCaptionTiming;
  providerUsed: NarrationProvider;
  fallbackUsed: boolean;
  fallbackReason?: string;
  selectedVoice: string;
  selectedModel: string;
  language: string;
  durationMs: number;
  wordTimestamps?: WordTimestamp[];
  textHighlightSupported: boolean;
  timestampSource: 'elevenlabs' | 'none';
  charsUsed: number;
  tokensUsed?: number;
  detectedLanguage: string | null;
  isMixedLanguage: boolean;
  presetId: string | null;
  generationDurationMs: number;
  errorMessage?: string | null;
  estimatedCostMetadata?: Record<string, unknown>;
}

interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface ElevenLabsTimestampResponse {
  audio_base64?: string;
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
}

function getReelCaptionTexts(captions: ReelCaptionTiming | undefined): string[] {
  return captions
    ?.map((caption) => caption.text.trim())
    .filter(Boolean)
    ?? [];
}

function joinReelCaptionText(captions: ReelCaptionTiming | undefined, fallback: string): string {
  const text = getReelCaptionTexts(captions).join(' ').trim();
  return text || fallback;
}

function estimateReelCaptionTimings(
  captions: ReelCaptionTiming | undefined,
  panelPauseMs = 0,
  totalDurationMs?: number
): ReelCaptionTiming | undefined {
  if (!captions?.length) return captions;
  const normalizedPanelPauseMs = normalizeReelNarrationPanelPauseMs(panelPauseMs);
  const wordCounts = captions.map((caption) => Math.max(1, caption.text.trim().split(/\s+/).filter(Boolean).length));
  const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
  const pauseBudgetMs = normalizedPanelPauseMs * Math.max(0, captions.length - 1);
  const spokenDurationMs = typeof totalDurationMs === 'number' && Number.isFinite(totalDurationMs) && totalDurationMs > 0
    ? Math.max(captions.length * 700, totalDurationMs - pauseBudgetMs)
    : Math.max(3200, totalWords * 430 + captions.length * 160);
  let cursor = 0;
  let spokenCursor = 0;
  return captions.map((caption, index) => {
    const isLast = index === captions.length - 1;
    const duration = isLast
      ? spokenDurationMs - spokenCursor
      : Math.max(700, Math.round((wordCounts[index] / totalWords) * spokenDurationMs));
    const startMs = cursor;
    const endMs = Math.max(startMs + 700, Math.round(startMs + duration));
    spokenCursor += Math.max(700, duration);
    cursor = endMs + (isLast ? 0 : normalizedPanelPauseMs);
    return { ...caption, startMs, endMs };
  });
}

function deriveWordTimings(
  alignment: ElevenLabsAlignment,
  charStart: number,
  charEnd: number
): WordTiming[] {
  const characters = alignment.characters ?? [];
  const startTimes = alignment.character_start_times_seconds ?? [];
  const endTimes = alignment.character_end_times_seconds ?? [];

  const timings: WordTiming[] = [];
  let wordFirstIdx = -1;
  let wordChars: string[] = [];

  const flush = (lastIdx: number) => {
    if (wordFirstIdx < 0 || wordChars.length === 0) return;
    const word = wordChars.join('');
    const startMs = Math.round((startTimes[wordFirstIdx] ?? 0) * 1000);
    const endMs = Math.round((endTimes[lastIdx] ?? startTimes[lastIdx] ?? 0) * 1000);
    timings.push({ word, startMs: Math.max(0, startMs), endMs: Math.max(startMs, endMs) });
    wordFirstIdx = -1;
    wordChars = [];
  };

  for (let i = charStart; i <= charEnd && i < characters.length; i++) {
    const ch = characters[i];
    const isSpace = ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
    if (isSpace) {
      flush(i - 1);
    } else {
      if (wordFirstIdx < 0) wordFirstIdx = i;
      wordChars.push(ch);
    }
  }
  flush(charEnd);

  return timings;
}

function applyAlignmentToReelCaptions(
  captions: ReelCaptionTiming | undefined,
  narrationText: string,
  alignment: ElevenLabsAlignment | undefined,
  panelPauseMs = 0
): ReelCaptionTiming | undefined {
  if (!captions?.length || !alignment?.characters?.length) {
    return estimateReelCaptionTimings(captions, panelPauseMs);
  }

  const startTimes = alignment.character_start_times_seconds ?? [];
  const endTimes = alignment.character_end_times_seconds ?? [];
  const source = (alignment.characters?.join('') || narrationText).toLowerCase();
  let cursor = 0;
  const timed = captions.map((caption) => {
    const captionText = caption.text.trim();
    const search = captionText.toLowerCase();
    const found = search ? source.indexOf(search, cursor) : -1;
    const startIndex = found >= 0 ? found : cursor;
    const endIndex = Math.max(startIndex, startIndex + captionText.length - 1);
    cursor = Math.min(source.length, endIndex + 1);

    const start = startTimes[startIndex];
    const end = endTimes[Math.min(endIndex, endTimes.length - 1)];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return caption;
    }

    const wordTimings = deriveWordTimings(alignment, startIndex, Math.min(endIndex, endTimes.length - 1));

    return {
      ...caption,
      startMs: Math.max(0, Math.round(start * 1000)),
      endMs: Math.max(0, Math.round(end * 1000)),
      wordTimings: wordTimings.length > 0 ? wordTimings : undefined,
    };
  });

  return timed.some((caption) => typeof caption.startMs === 'number' && typeof caption.endMs === 'number')
    ? timed
    : estimateReelCaptionTimings(captions, panelPauseMs);
}

function flattenWordTimestamps(captions: ReelCaptionTiming | undefined): WordTimestamp[] {
  return captions
    ?.flatMap((caption) => caption.wordTimings ?? [])
    .map((timing) => ({
      word: timing.word,
      startMs: timing.startMs,
      endMs: timing.endMs,
    }))
    ?? [];
}

function getLastCaptionEndMs(captions: ReelCaptionTiming | undefined): number {
  return Math.max(
    0,
    ...(captions ?? []).map((caption) => (
      typeof caption.endMs === 'number' && Number.isFinite(caption.endMs) ? caption.endMs : 0
    ))
  );
}

function getAlignmentDurationMs(alignment: ElevenLabsAlignment | undefined): number {
  const endTimes = alignment?.character_end_times_seconds ?? [];
  const last = [...endTimes].reverse().find((value) => Number.isFinite(value) && value > 0);
  return last ? Math.round(last * 1000) : 0;
}

async function recordElevenLabsReelTtsCostEvent(input: {
  costTelemetry: CostTelemetryContext | undefined;
  taskKey?: Extract<TaskKey, 'tts' | 'reel_tts'>;
  modelId: string;
  characterCount: number;
  audioSeconds?: number | null;
  latencyMs?: number | null;
  status?: 'success' | 'failed';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.costTelemetry) return;
  const estimatedSuccessCostUsd = await estimateElevenLabsModelCostUsd({
    modelId: input.modelId,
    characterCount: input.characterCount,
  }).catch(() => 0);
  const status = input.status ?? 'success';
  await recordModelCostEvent({
    context: input.costTelemetry,
    taskKey: input.taskKey ?? 'reel_tts',
    provider: 'elevenlabs',
    modelId: input.modelId,
    audioSeconds: input.audioSeconds ?? null,
    latencyMs: input.latencyMs ?? null,
    status,
    estimatedCostUsdOverride: status === 'success' ? estimatedSuccessCostUsd : 0,
    metadata: {
      charsUsed: input.characterCount,
      estimatedSuccessCostUsd,
      ...(input.metadata || {}),
    },
  });
}

function buildBeatNarrationMetadata(input: {
  payload: NarrationAudioPayload;
  audioUrl?: string | null;
  previewId?: string;
  scope?: 'sample' | 'full';
}): BeatNarrationMetadata {
  const metadata = normalizeNarrationMetadata({
    provider: input.payload.providerUsed,
    model: input.payload.selectedModel,
    voiceId: input.payload.selectedVoice,
    language: input.payload.language,
    audioUrl: input.audioUrl ?? null,
    durationMs: input.payload.durationMs,
    wordTimestamps: input.payload.wordTimestamps,
    textHighlightSupported: input.payload.textHighlightSupported,
    timestampSource: input.payload.timestampSource,
    fallbackUsed: input.payload.fallbackUsed,
    fallbackReason: input.payload.fallbackReason ?? input.payload.errorMessage ?? undefined,
    charsUsed: input.payload.charsUsed,
    tokensUsed: input.payload.tokensUsed,
    createdAt: new Date().toISOString(),
  }) as BeatNarrationMetadata;
  return {
    ...metadata,
    ...(input.previewId ? { previewId: input.previewId } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    panelDurationsMs: input.payload.reelCaptions
      ? [...input.payload.reelCaptions]
        .sort((left, right) => left.panelIndex - right.panelIndex)
        .map((caption) => (
          typeof caption.startMs === 'number' && typeof caption.endMs === 'number'
            ? Math.max(0, caption.endMs - caption.startMs)
            : 0
        ))
        .filter((duration) => duration > 0)
      : undefined,
  };
}

async function callElevenLabsTTSWithTimestamps(
  text: string,
  settings: ReelStorySettings,
  narrationSettings: ReelNarrationSettings
): Promise<{ audioBuffer: Buffer; mimeType: string; reelCaptions?: ReelCaptionTiming; alignment?: ElevenLabsAlignment }> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured.');
  }

  const voiceId = (narrationSettings.voiceId || settings.elevenLabs.voiceId).trim();
  if (!voiceId) {
    throw new Error('Reel ElevenLabs voiceId is not configured.');
  }
  const languageCode = toElevenLabsLanguageCode(narrationSettings.language);
  const pronunciationLocators = settings.narration.pronunciationDictionaryEnabled
    && narrationSettings.usePronunciationDictionary
    ? settings.narration.pronunciationDictionaryLocators
    : [];
  const requestBody: Record<string, unknown> = {
    text,
    model_id: narrationSettings.model || settings.elevenLabs.modelId,
    voice_settings: {
      speed: narrationSettings.speed,
      stability: narrationSettings.stability,
      similarity_boost: narrationSettings.similarityBoost,
      style: narrationSettings.style,
      use_speaker_boost: narrationSettings.speakerBoost,
    },
  };
  if (languageCode) {
    requestBody.language_code = languageCode;
  }
  if (pronunciationLocators.length > 0) {
    requestBody.pronunciation_dictionary_locators = pronunciationLocators;
  }

  const response = await withTimeout(
    fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    }),
    ELEVENLABS_TTS_TIMEOUT_MS,
    'elevenlabs_tts'
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${message.slice(0, 160)}`);
  }

  const json = await response.json() as ElevenLabsTimestampResponse;
  if (!json.audio_base64) {
    throw new Error('ElevenLabs TTS returned no audio.');
  }

  return {
    audioBuffer: Buffer.from(json.audio_base64, 'base64'),
    mimeType: 'audio/mpeg',
    alignment: json.normalized_alignment ?? json.alignment,
  };
}

async function buildGeminiReelAudio(input: {
  narrationText: string;
  tone: string;
  genre: string;
  voiceName: string;
  language: string;
  costTelemetry: CostTelemetryContext | undefined;
  reelCaptions?: ReelCaptionTiming;
  reelCaptionTexts?: string[];
  narrationSettings: ReelNarrationSettings;
  preset: NarrationPreset | null;
  adminSettings: ReelStorySettings['narration'];
  generationMode: NarrationGenerationMode;
  panelPauseMs: number;
  narrationStyle?: string;
  taskKey?: Extract<TaskKey, 'tts' | 'reel_tts'>;
}): Promise<{
  buffer: Buffer;
  reelCaptions?: ReelCaptionTiming;
  durationMs: number;
  selectedModel: string;
  tokensUsed?: number;
  detectedLanguage: string | null;
  isMixedLanguage: boolean;
}> {
  const baseScript = buildNarrationPerformanceScript({
    text: input.narrationText,
    captionTexts: input.reelCaptionTexts,
    settings: input.narrationSettings,
    preset: input.preset,
    provider: 'gemini_tts',
    adminSettings: input.adminSettings,
    generationMode: input.generationMode,
  });

  const captions = input.reelCaptions
    ?.filter((caption) => caption.text.trim())
    .sort((left, right) => left.panelIndex - right.panelIndex);

  if (captions && captions.length > 1) {
    const chunks: Buffer[] = [];
    const timedCaptions: ReelCaptionTiming = [];
    let cursorMs = 0;
    let selectedModel = 'gemini_tts';
    let tokensUsed = 0;

    for (let index = 0; index < captions.length; index += 1) {
      const caption = captions[index];
      const panelScript = buildNarrationPerformanceScript({
        text: caption.text,
        captionTexts: [caption.text],
        settings: input.narrationSettings,
        preset: input.preset,
        provider: 'gemini_tts',
        adminSettings: input.adminSettings,
        generationMode: input.generationMode,
      });
      const result = await callGeminiTTS(
        panelScript.text,
        input.tone,
        input.genre,
        input.voiceName,
        input.language,
        input.costTelemetry,
        {
          taskKey: input.taskKey,
          narrationStyle: panelScript.deliveryInstruction || input.narrationStyle || input.tone,
        }
      );
      const pcm = Buffer.from(result.pcmBase64, 'base64');
      const durationMs = pcmBufferDurationMs(pcm);
      const startMs = cursorMs;
      const endMs = startMs + durationMs;
      chunks.push(pcm);
      selectedModel = result.modelId || selectedModel;
      tokensUsed += result.tokensUsed ?? 0;
      timedCaptions.push({
        ...caption,
        startMs,
        endMs,
        wordTimings: undefined,
      });
      cursorMs = endMs;

      if (index < captions.length - 1 && input.panelPauseMs > 0) {
        chunks.push(silencePcmBuffer(input.panelPauseMs));
        cursorMs += input.panelPauseMs;
      }
    }

    const pcm = Buffer.concat(chunks);
    return {
      buffer: pcmBufferToWavBuffer(pcm),
      reelCaptions: timedCaptions,
      durationMs: cursorMs || pcmBufferDurationMs(pcm),
      selectedModel,
      tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
      detectedLanguage: baseScript.language.detectedLanguage,
      isMixedLanguage: baseScript.language.isMixedLanguage,
    };
  }

  const result = await callGeminiTTS(
    baseScript.text,
    input.tone,
    input.genre,
    input.voiceName,
    input.language,
    input.costTelemetry,
    {
      taskKey: input.taskKey,
      narrationStyle: baseScript.deliveryInstruction || input.narrationStyle,
    }
  );
  const durationMs = pcmBase64DurationMs(result.pcmBase64);
  return {
    buffer: pcmToWavBuffer(result.pcmBase64),
    reelCaptions: estimateReelCaptionTimings(input.reelCaptions, input.panelPauseMs, durationMs),
    durationMs,
    selectedModel: result.modelId,
    tokensUsed: result.tokensUsed,
    detectedLanguage: baseScript.language.detectedLanguage,
    isMixedLanguage: baseScript.language.isMixedLanguage,
  };
}

async function buildNarrationAudioPayload(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  costTelemetry: CostTelemetryContext | undefined,
  options: {
    taskKey?: Extract<TaskKey, 'tts' | 'reel_tts'>;
    narrationStyle?: string;
    reelCaptions?: ReelCaptionTiming;
    reelSettings?: ReelStorySettings;
    narrationSettings?: ReelNarrationSettings;
    generationMode?: NarrationGenerationMode;
    panelPauseMs?: number;
  } = {}
): Promise<NarrationAudioPayload> {
  const payloadStartedAt = narrationNowMs();
  const isReel = options.taskKey === 'reel_tts';
  const reelSettings = normalizeReelStorySettings(options.reelSettings ?? DEFAULT_REEL_STORY_SETTINGS);
  const narrationSettings = normalizeReelNarrationSettings(options.narrationSettings, {
    storyLanguage: language,
    adminSettings: reelSettings.narration,
  });
  const preset = getNarrationPresetById(narrationSettings.presetId);
  const maxLength = Math.max(200, reelSettings.narration.maxNarrationLength);
  const reelCaptionTexts = isReel ? getReelCaptionTexts(options.reelCaptions) : undefined;
  const panelPauseMs = normalizeReelNarrationPanelPauseMs(options.panelPauseMs);
  const narrationText = (isReel ? joinReelCaptionText(options.reelCaptions, storyText) : storyText).slice(0, maxLength);
  const geminiVoiceName = isReel
    ? reelSettings.narration.fallbackGeminiVoice || voiceName
    : voiceName;

  if (isReel && reelSettings.elevenLabs.enabled && narrationSettings.provider === 'elevenlabs') {
    const elevenModel = resolveElevenLabsModelForLanguage(
      narrationSettings.model || reelSettings.elevenLabs.modelId,
      narrationSettings.language,
      [
        options.generationMode === 'preview'
          ? reelSettings.narration.previewElevenLabsModel
          : reelSettings.narration.finalElevenLabsModel,
        reelSettings.narration.defaultElevenLabsModel,
        reelSettings.elevenLabs.modelId,
      ]
    );
    const elevenNarrationSettings = normalizeReelNarrationSettings(
      {
        ...narrationSettings,
        model: elevenModel,
      },
      {
        storyLanguage: language,
        adminSettings: reelSettings.narration,
      }
    );
    const elevenAttemptStartedAt = narrationNowMs();
    const fallbackToGemini = async (error: unknown): Promise<NarrationAudioPayload> => {
      console.warn('ElevenLabs reel TTS failed; falling back to Gemini TTS:', error instanceof Error ? error.message : error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await recordElevenLabsReelTtsCostEvent({
        costTelemetry,
        taskKey: options.taskKey,
        modelId: elevenNarrationSettings.model,
        characterCount: narrationText.length,
        latencyMs: narrationNowMs() - elevenAttemptStartedAt,
        status: 'failed',
        metadata: {
          errorMessage,
          voiceId: elevenNarrationSettings.voiceId,
          language: elevenNarrationSettings.language,
          presetId: elevenNarrationSettings.presetId,
          generationMode: options.generationMode ?? 'final',
        },
      });
      const gemini = await buildGeminiReelAudio({
        narrationText,
        tone,
        genre,
        voiceName: geminiVoiceName,
        language: elevenNarrationSettings.language || language,
        costTelemetry,
        reelCaptions: options.reelCaptions,
        reelCaptionTexts,
        narrationSettings: elevenNarrationSettings,
        preset,
        adminSettings: reelSettings.narration,
        generationMode: options.generationMode ?? 'final',
        panelPauseMs,
        narrationStyle: options.narrationStyle || tone,
        taskKey: options.taskKey,
      });
      return {
        buffer: gemini.buffer,
        mimeType: 'audio/wav',
        extension: 'wav',
        reelCaptions: gemini.reelCaptions,
        providerUsed: 'gemini_tts',
        fallbackUsed: true,
        fallbackReason: errorMessage,
        selectedVoice: geminiVoiceName,
        selectedModel: gemini.selectedModel,
        language: elevenNarrationSettings.language || language,
        durationMs: gemini.durationMs,
        wordTimestamps: undefined,
        textHighlightSupported: false,
        timestampSource: 'none',
        charsUsed: narrationText.length,
        tokensUsed: gemini.tokensUsed,
        detectedLanguage: gemini.detectedLanguage,
        isMixedLanguage: gemini.isMixedLanguage,
        presetId: elevenNarrationSettings.presetId,
        generationDurationMs: Math.round(narrationNowMs() - payloadStartedAt),
        errorMessage,
        estimatedCostMetadata: {
          provider: 'gemini_tts',
          fallbackFrom: 'elevenlabs',
          attemptedElevenLabsModel: elevenNarrationSettings.model,
          generationMode: options.generationMode ?? 'final',
          textLength: narrationText.length,
        },
      };
    };
    const unsupportedReason = getElevenLabsUnsupportedLanguageReason(
      elevenNarrationSettings.model,
      elevenNarrationSettings.language
    );
    if (unsupportedReason) {
      return fallbackToGemini(new Error(unsupportedReason));
    }

    const elevenScript = buildNarrationPerformanceScript({
      text: narrationText,
      captionTexts: reelCaptionTexts,
      panelPauseMs,
      settings: elevenNarrationSettings,
      preset,
      provider: 'elevenlabs',
      adminSettings: reelSettings.narration,
      generationMode: options.generationMode ?? 'final',
    });
    try {
      const eleven = await timeNarrationStep(
        'narration.call_elevenlabs_tts_with_timestamps',
        {
          language: elevenNarrationSettings.language,
          storyLength: narrationText.length,
          modelId: elevenNarrationSettings.model,
          presetId: elevenNarrationSettings.presetId,
          expressiveTagsUsed: elevenScript.expressiveTagsUsed,
        },
        () => callElevenLabsTTSWithTimestamps(elevenScript.text, reelSettings, elevenNarrationSettings)
      );

      const reelCaptions = applyAlignmentToReelCaptions(options.reelCaptions, elevenScript.text, eleven.alignment, panelPauseMs);
      const wordTimestamps = flattenWordTimestamps(reelCaptions);
      const textHighlightSupported = getTextHighlightSupported('elevenlabs', wordTimestamps);
      const durationMs = getAlignmentDurationMs(eleven.alignment) || getLastCaptionEndMs(reelCaptions);
      await recordElevenLabsReelTtsCostEvent({
        costTelemetry,
        taskKey: options.taskKey,
        modelId: elevenNarrationSettings.model,
        characterCount: narrationText.length,
        audioSeconds: durationMs > 0 ? durationMs / 1000 : null,
        latencyMs: narrationNowMs() - elevenAttemptStartedAt,
        status: 'success',
        metadata: {
          voiceId: elevenNarrationSettings.voiceId,
          language: elevenNarrationSettings.language,
          presetId: elevenNarrationSettings.presetId,
          generationMode: options.generationMode ?? 'final',
          expressiveTagsUsed: elevenScript.expressiveTagsUsed,
          timestampSource: textHighlightSupported ? 'elevenlabs' : 'none',
        },
      });

      return {
        buffer: eleven.audioBuffer,
        mimeType: eleven.mimeType,
        extension: 'mp3',
        reelCaptions,
        providerUsed: 'elevenlabs',
        fallbackUsed: false,
        selectedVoice: elevenNarrationSettings.voiceId,
        selectedModel: elevenNarrationSettings.model,
        language: elevenNarrationSettings.language,
        durationMs,
        wordTimestamps: wordTimestamps.length > 0 ? wordTimestamps : undefined,
        textHighlightSupported,
        timestampSource: textHighlightSupported ? 'elevenlabs' : 'none',
        charsUsed: narrationText.length,
        detectedLanguage: elevenScript.language.detectedLanguage,
        isMixedLanguage: elevenScript.language.isMixedLanguage,
        presetId: elevenNarrationSettings.presetId,
        generationDurationMs: Math.round(narrationNowMs() - payloadStartedAt),
        estimatedCostMetadata: {
          provider: 'elevenlabs',
          generationMode: options.generationMode ?? 'final',
          textLength: narrationText.length,
        },
      };
    } catch (error) {
      return fallbackToGemini(error);
    }
  }

  const gemini = isReel
    ? await buildGeminiReelAudio({
        narrationText,
        tone,
        genre,
        voiceName: geminiVoiceName,
        language: narrationSettings.language || language,
        costTelemetry,
        reelCaptions: options.reelCaptions,
        reelCaptionTexts,
        narrationSettings,
        preset,
        adminSettings: reelSettings.narration,
        generationMode: options.generationMode ?? 'final',
        panelPauseMs,
        narrationStyle: options.narrationStyle,
        taskKey: options.taskKey,
      })
    : null;
  const nonReelGemini = !isReel
    ? await callGeminiTTS(
        narrationText,
        tone,
        genre,
        geminiVoiceName,
        narrationSettings.language || language,
        costTelemetry,
        {
          taskKey: options.taskKey,
          narrationStyle: options.narrationStyle,
        }
      )
    : null;
  const nonReelDurationMs = nonReelGemini ? pcmBase64DurationMs(nonReelGemini.pcmBase64) : 0;
  return {
    buffer: gemini?.buffer ?? pcmToWavBuffer(nonReelGemini?.pcmBase64 ?? ''),
    mimeType: 'audio/wav',
    extension: 'wav',
    reelCaptions: gemini?.reelCaptions,
    providerUsed: 'gemini_tts',
    fallbackUsed: false,
    selectedVoice: geminiVoiceName,
    selectedModel: gemini?.selectedModel ?? nonReelGemini?.modelId ?? 'gemini_tts',
    language: narrationSettings.language || language,
    durationMs: gemini?.durationMs ?? nonReelDurationMs,
    wordTimestamps: undefined,
    textHighlightSupported: false,
    timestampSource: 'none',
    charsUsed: narrationText.length,
    tokensUsed: gemini?.tokensUsed ?? nonReelGemini?.tokensUsed,
    detectedLanguage: gemini?.detectedLanguage ?? null,
    isMixedLanguage: gemini?.isMixedLanguage ?? false,
    presetId: narrationSettings.presetId,
    generationDurationMs: Math.round(narrationNowMs() - payloadStartedAt),
    estimatedCostMetadata: {
      provider: 'gemini_tts',
      generationMode: options.generationMode ?? 'final',
      textLength: narrationText.length,
    },
  };
}

async function recordNarrationGenerationLog(input: {
  storyId: string | null;
  nodeId: string | null;
  userId: string | null;
  mode: NarrationGenerationMode;
  payload: NarrationAudioPayload;
  storagePath?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('narration_generation_logs')
      .insert({
        story_id: input.storyId,
        node_id: input.nodeId,
        user_id: input.userId,
        generation_mode: input.mode,
        provider_used: input.payload.providerUsed,
        fallback_used: input.payload.fallbackUsed,
        selected_voice: input.payload.selectedVoice,
        selected_model: input.payload.selectedModel,
        language: input.payload.language,
        detected_language: input.payload.detectedLanguage,
        is_mixed_language: input.payload.isMixedLanguage,
        preset_id: input.payload.presetId,
        generation_duration_ms: input.payload.generationDurationMs,
        error_message: input.payload.errorMessage ?? null,
        generated_audio_storage_path: input.storagePath ?? null,
        estimated_cost_metadata: input.payload.estimatedCostMetadata ?? {},
      });
    if (error && !/schema cache|relation .*narration_generation_logs/i.test(error.message)) {
      console.error('Failed to record narration generation log:', error.message);
    }
  } catch (error) {
    console.error('Failed to record narration generation log:', error);
  }
}

/**
 * Generate narration and persist directly to Supabase Storage + beats table.
 * Returns the public storage URL.
 */
export async function generateAndPersistNarration(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  savedStoryId: string,
  nodeId: string,
  costTelemetry?: CostTelemetryContext,
  options: {
    taskKey?: Extract<TaskKey, 'tts' | 'reel_tts'>;
    narrationStyle?: string;
    reelCaptions?: ReelCaptionTiming;
    reelSettings?: ReelStorySettings;
    narrationSettings?: ReelNarrationSettings;
    generationMode?: NarrationGenerationMode;
    panelPauseMs?: number;
  } = {}
): Promise<{ audioUrl: string; reelCaptions?: ReelCaptionTiming; narrationMetadata?: BeatNarrationMetadata }> {
  return timeNarrationStep(
    'narration.generate_and_persist',
    {
      storyId: savedStoryId,
      nodeId,
      language,
      voiceName,
    },
    async () => {
      const audioPayload = await buildNarrationAudioPayload(storyText, tone, genre, voiceName, language, costTelemetry, options);

      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Not authenticated');

      const storagePath = `${user.id}/${savedStoryId}/${nodeId}/audio.${audioPayload.extension}`;
      const r2ObjectKey = `stories/${savedStoryId}/beats/${nodeId}/audio.${audioPayload.extension}`;
      const storageConfig = await getEffectiveMediaStorageConfig();
      let persistedAudioUrl: string | null = null;
      let playbackAudioUrl: string | null = null;

      await timeNarrationStep(
        'narration.upload_audio',
        {
          storyId: savedStoryId,
          nodeId,
        },
        async () => {
          if (storageConfig.r2.enabled && storageConfig.settings.r2UseForNarrationAudio) {
            try {
              const r2 = await putR2Object({
                access: 'private',
                objectKey: r2ObjectKey,
                body: audioPayload.buffer,
                contentType: audioPayload.mimeType,
                cacheControl: storageConfig.r2.cacheControlPrivate,
              });
              persistedAudioUrl = r2.urlOrReference;
              playbackAudioUrl = await createR2SignedGetUrl(persistedAudioUrl, undefined, 3600);
              await recordMediaAsset({
                storyId: savedStoryId,
                nodeId,
                userId: user.id,
                assetType: 'narration_audio',
                storageProvider: 'r2',
                bucket: r2.bucket,
                objectKey: r2.objectKey,
                mimeType: audioPayload.mimeType,
                sizeBytes: audioPayload.buffer.byteLength,
                isPublic: false,
                cacheControl: storageConfig.r2.cacheControlPrivate,
              });
              return;
            } catch (r2Error) {
              console.error(
                'R2 narration upload failed; falling back to Supabase:',
                r2Error instanceof Error ? r2Error.message : r2Error
              );
              if (!storageConfig.settings.r2FallbackToSupabase) {
                throw r2Error;
              }
            }
          }

          let uploadError: { message: string } | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            const result = await supabase.storage
              .from('story-assets')
              .upload(storagePath, audioPayload.buffer, {
                contentType: audioPayload.mimeType,
                upsert: true,
              });

            if (!result.error) {
              uploadError = null;
              break;
            }

            uploadError = result.error;
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }

          if (uploadError) {
            throw new Error(`Audio upload failed: ${uploadError.message}`);
          }

          const { data: urlData } = supabase.storage
            .from('story-assets')
            .getPublicUrl(storagePath);
          persistedAudioUrl = urlData.publicUrl;
          await recordMediaAsset({
            storyId: savedStoryId,
            nodeId,
            userId: user.id,
            assetType: 'narration_audio',
            storageProvider: 'supabase',
            bucket: 'story-assets',
            objectKey: storagePath,
            publicUrl: urlData.publicUrl,
            mimeType: audioPayload.mimeType,
            sizeBytes: audioPayload.buffer.byteLength,
            isPublic: false,
          });
        }
      );

      let narrationMetadata: BeatNarrationMetadata | undefined;

      await timeNarrationStep(
        'narration.persist_audio_url',
        {
          storyId: savedStoryId,
          nodeId,
        },
        async () => {
          try {
            await updateBeatMediaState(savedStoryId, nodeId, {
              audioUrl: persistedAudioUrl,
              audioStatus: 'ready',
              audioError: null,
              narrationVoiceId: voiceName,
              narrationMetadata: buildBeatNarrationMetadata({
                payload: audioPayload,
                audioUrl: persistedAudioUrl,
                scope: 'full',
              }),
              activeNarrationPreviewId: null,
              ...(audioPayload.reelCaptions?.length ? { reelCaptions: audioPayload.reelCaptions } : {}),
            });
            narrationMetadata = buildBeatNarrationMetadata({
              payload: audioPayload,
              audioUrl: persistedAudioUrl,
              scope: 'full',
            });
            if (audioPayload.reelCaptions?.length) {
              const admin = createAdminClient();
              const { error: captionsError } = await admin
                .from('beats')
                .update({ reel_captions: audioPayload.reelCaptions as unknown as Record<string, unknown>[] })
                .eq('story_id', savedStoryId)
                .eq('node_id', nodeId);
              if (captionsError) {
                console.error('Failed to update reel caption timings:', captionsError.message);
              }
            }
          } catch (updateError) {
            console.error(
              'Failed to update beat audio media state:',
              updateError instanceof Error ? updateError.message : updateError
            );
          }
        }
      );

      if (!playbackAudioUrl) {
        const { data: signedData } = await timeNarrationStep(
          'narration.create_signed_url',
          {
            storyId: savedStoryId,
            nodeId,
          },
          () => supabase.storage.from('story-assets').createSignedUrl(storagePath, 3600)
        );
        playbackAudioUrl = signedData?.signedUrl || persistedAudioUrl;
      }

      await recordNarrationGenerationLog({
        storyId: savedStoryId,
        nodeId,
        userId: user.id,
        mode: options.generationMode ?? 'final',
        payload: audioPayload,
        storagePath: persistedAudioUrl,
      });

      return {
        audioUrl: playbackAudioUrl || persistedAudioUrl || '',
        reelCaptions: audioPayload.reelCaptions,
        narrationMetadata: narrationMetadata ?? buildBeatNarrationMetadata({
          payload: audioPayload,
          audioUrl: persistedAudioUrl,
          scope: 'full',
        }),
      };
    }
  );
}

/**
 * Generate narration without persisting — returns base64 data URL.
 * Used for first beat before savedStoryId exists.
 */
export async function generateNarrationOnly(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  costTelemetry?: CostTelemetryContext,
  options: {
    taskKey?: Extract<TaskKey, 'tts' | 'reel_tts'>;
    narrationStyle?: string;
  } = {}
): Promise<string> {
  return timeNarrationStep(
    'narration.generate_only',
    {
      language,
      voiceName,
    },
    async () => {
      const result = await callGeminiTTS(storyText, tone, genre, voiceName, language, costTelemetry, options);
      const wavBuffer = pcmToWavBuffer(result.pcmBase64);
      return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
    }
  );
}

export async function generateReelNarrationOnly(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  costTelemetry?: CostTelemetryContext,
  options: {
    narrationStyle?: string;
    reelCaptions?: ReelCaptionTiming;
    reelSettings?: ReelStorySettings;
    narrationSettings?: ReelNarrationSettings;
    generationMode?: NarrationGenerationMode;
    previewScope?: 'sample' | 'full';
    panelPauseMs?: number;
    logUserId?: string | null;
  } = {}
): Promise<{ audioUrl: string; reelCaptions?: ReelCaptionTiming; narrationMetadata: BeatNarrationMetadata }> {
  return timeNarrationStep(
    'narration.generate_reel_only',
    {
      language,
      voiceName,
    },
    async () => {
      const payload = await buildNarrationAudioPayload(storyText, tone, genre, voiceName, language, costTelemetry, {
        ...options,
        taskKey: 'reel_tts',
      });
      await recordNarrationGenerationLog({
        storyId: null,
        nodeId: null,
        userId: options.logUserId ?? null,
        mode: options.generationMode ?? 'preview',
        payload,
        storagePath: null,
      });
      const audioUrl = `data:${payload.mimeType};base64,${payload.buffer.toString('base64')}`;
      return {
        audioUrl,
        reelCaptions: payload.reelCaptions,
        narrationMetadata: buildBeatNarrationMetadata({
          payload,
          audioUrl,
          scope: options.previewScope ?? (options.generationMode === 'preview' ? 'sample' : 'full'),
        }),
      };
    }
  );
}

/**
 * Lock the narrator voice for a story exactly once.
 * If a voice is already stored, it wins over any newly proposed voice.
 */
export async function ensureNarratorVoiceLocked(
  storyId: string,
  proposedVoiceName: string,
  options: {
    mode?: NarrationVoiceMode | null;
    genderBucket?: NarrationGenderBucket | null;
    languageCode?: NarrationLanguageCode | null;
  } = {}
): Promise<string> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('narrator_voice')
    .eq('id', storyId)
    .single();

  if (storyError) {
    throw new Error(`Failed to load narrator voice: ${storyError.message}`);
  }

  const existingVoice = story?.narrator_voice?.trim();
  if (existingVoice) {
    return existingVoice;
  }

  const updateData: Record<string, string | null> = {
    narrator_voice: proposedVoiceName,
  };
  if (options.mode) updateData.narration_voice_mode = options.mode;
  if (options.genderBucket) updateData.narration_voice_gender_bucket = options.genderBucket;
  if (options.languageCode) updateData.narration_language_code = options.languageCode;

  const { error: updateError } = await supabase
    .from('stories')
    .update(updateData)
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (updateError) {
    if (isMissingNarrationColumnError(updateError)) {
      const { error: fallbackError } = await supabase
        .from('stories')
        .update({ narrator_voice: proposedVoiceName })
        .eq('id', storyId)
        .eq('user_id', user.id);

      if (!fallbackError) {
        return proposedVoiceName;
      }
    }
    throw new Error(`Failed to lock narrator voice: ${updateError.message}`);
  }

  return proposedVoiceName;
}

/**
 * Read the already-locked narrator voice for a story.
 */
export async function getNarratorVoiceForStory(storyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('narrator_voice')
    .eq('id', storyId)
    .single();

  if (storyError) {
    throw new Error(`Failed to fetch narrator voice: ${storyError.message}`);
  }

  const voice = story?.narrator_voice?.trim();
  return voice || null;
}

/**
 * Resolve the narration voice for a story or newly-created story.
 * This is the single decision point for the user-selected vs legacy selector paths.
 */
export async function resolveNarrationVoiceServer(input: {
  savedStoryId?: string | null;
  requestedMode?: NarrationVoiceMode | null;
  requestedVoiceId?: string | null;
  requestedGenderBucket?: NarrationGenderBucket | null;
  language?: string | null;
  genre: string;
  tone: string;
  targetAge: string;
  costTelemetry?: CostTelemetryContext;
}): Promise<{
  voiceId: string;
  mode: NarrationVoiceMode;
  genderBucket: NarrationGenderBucket | null;
  languageCode: NarrationLanguageCode;
  usedLegacySelector: boolean;
  warnings: string[];
}> {
  const settings = await getNarrationVoiceSettings();
  const languageResolution = resolveStoryNarrationLanguage(input.language);
  let storyRecord: {
    voiceId: string | null;
    mode: NarrationVoiceMode | null;
    genderBucket: NarrationGenderBucket | null;
  } | null = null;

  if (input.savedStoryId) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('stories')
        .select('narrator_voice, narration_voice_mode, narration_voice_gender_bucket')
        .eq('id', input.savedStoryId)
        .single();

      if (error) {
        if (isMissingNarrationColumnError(error)) {
          const fallback = await supabase
            .from('stories')
            .select('narrator_voice')
            .eq('id', input.savedStoryId)
            .single();
          storyRecord = {
            voiceId: fallback.data?.narrator_voice?.trim() || null,
            mode: 'legacy_auto',
            genderBucket: null,
          };
        } else {
          throw error;
        }
      } else {
        storyRecord = {
          voiceId: data?.narrator_voice?.trim() || null,
          mode: data?.narration_voice_mode === 'user_selected' ? 'user_selected' : 'legacy_auto',
          genderBucket: data?.narration_voice_gender_bucket === 'male' ? 'male' : data?.narration_voice_gender_bucket === 'female' ? 'female' : null,
        };
      }
    } catch (error) {
      console.error('Failed to load story narration voice record:', error);
    }
  }

  const decision = resolveNarrationVoiceDecision({
    globalUserLedVoiceSelectionEnabled: settings.userLedVoiceSelectionEnabled,
    settings,
    storyVoiceMode: storyRecord?.mode ?? null,
    storyVoiceId: storyRecord?.voiceId ?? null,
    storyGenderBucket: storyRecord?.genderBucket ?? null,
    requestedVoiceMode: input.requestedMode ?? null,
    requestedVoiceId: input.requestedVoiceId ?? null,
    requestedGenderBucket: input.requestedGenderBucket ?? null,
    hasPersistedStory: Boolean(storyRecord),
  });

  let voiceId = decision.voiceId;
  let usedLegacySelector = false;

  if (decision.shouldUseLegacySelector) {
    usedLegacySelector = true;
    voiceId = await selectLegacyNarratorVoiceServer(
      input.genre,
      input.tone,
      input.targetAge,
      input.language || 'english',
      input.costTelemetry
    );
  }

  if (!voiceId) {
    const fallbackGender = decision.genderBucket || input.requestedGenderBucket || 'female';
    voiceId = getDefaultVoiceForGender(fallbackGender, settings) || DEFAULT_VOICE;
    decision.warnings.push(`Fell back to ${voiceId} because no narration voice was resolved.`);
  }

  console.info('[narration.voice_resolver]', {
    storyId: input.savedStoryId ?? null,
    mode: decision.mode,
    voiceId,
    languageCode: languageResolution.languageCode,
    usedLegacySelector,
    warnings: decision.warnings,
  });

  return {
    voiceId,
    mode: decision.mode,
    genderBucket: decision.genderBucket,
    languageCode: languageResolution.languageCode,
    usedLegacySelector,
    warnings: decision.warnings,
  };
}

/**
 * Legacy AI narrator voice selection.
 * Kept for old content and for global setting OFF.
 */
export async function selectLegacyNarratorVoiceServer(
  genre: string,
  tone: string,
  targetAge: string,
  language: string = 'english',
  costTelemetry?: CostTelemetryContext
): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const voiceConfig = await getModelConfig('voice_selection');
    const voicePrompt = resolvePromptTemplate(
      await getPublishedPrompt('voice_selection'),
      {
        genre,
        tone,
        targetAge,
        language,
        availableVoices: AVAILABLE_VOICES.join(', '),
      }
    );
    const startedAt = narrationNowMs();
    const response = await ai.models.generateContent({
      model: voiceConfig.model,
      contents: voicePrompt,
      config: {
        systemInstruction: LOCKED_PROMPT_GUARDRAILS.voice_selection,
        temperature: voiceConfig.temperature ?? 0.3,
      },
    });

    if (costTelemetry) {
      await recordModelCostEvent({
        context: costTelemetry,
        taskKey: 'voice_selection',
        modelId: voiceConfig.model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: narrationNowMs() - startedAt,
        metadata: {
          genre,
          tone,
          targetAge,
          language,
        },
      });
    }

    const voiceName = response.text?.trim() || '';
    if (AVAILABLE_VOICES.includes(voiceName as any)) {
      return voiceName;
    }
    const match = AVAILABLE_VOICES.find(v => voiceName.toLowerCase().includes(v.toLowerCase()));
    return match || DEFAULT_VOICE;
  } catch (error) {
    console.error('Legacy voice selection failed:', error);
    return DEFAULT_VOICE;
  }
}

/**
 * @deprecated Use resolveNarrationVoiceServer so user-selected mode can bypass legacy AI selection.
 */
export async function selectNarratorVoiceServer(
  genre: string,
  tone: string,
  targetAge: string,
  language: string = 'english',
  costTelemetry?: CostTelemetryContext
): Promise<string> {
  return selectLegacyNarratorVoiceServer(genre, tone, targetAge, language, costTelemetry);
}
