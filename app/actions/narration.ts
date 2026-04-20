'use server';

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@/lib/supabase/server';
import { getModelConfig } from '@/lib/ai/model-config';
import {
  LOCKED_PROMPT_GUARDRAILS,
  resolvePromptTemplate,
} from '@/lib/ai/prompt-config.shared';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';

const GEMINI_TTS_TIMEOUT_MS = 120_000;

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
      setTimeout(() => reject(new Error(`Gemini timeout after ${ms / 1000}s (${label})`)), ms)
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

function pcmToWavBuffer(pcmBase64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const pcmBytes = Buffer.from(pcmBase64, 'base64');
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

async function callGeminiTTS(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string,
  costTelemetry?: CostTelemetryContext
): Promise<string> {
  return timeNarrationStep(
    'narration.call_gemini_tts',
    {
      language,
      voiceName,
      storyLength: storyText.length,
    },
    async () => {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const ttsConfig = await getModelConfig('tts');
      const ttsPrompt = resolvePromptTemplate(
        await getPublishedPrompt('tts'),
        {
          storyText,
          tone,
          genre,
          language,
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
          taskKey: 'tts',
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

      return audioPart.inlineData.data;
    }
  );
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
  costTelemetry?: CostTelemetryContext
): Promise<{ audioUrl: string }> {
  return timeNarrationStep(
    'narration.generate_and_persist',
    {
      storyId: savedStoryId,
      nodeId,
      language,
      voiceName,
    },
    async () => {
      const pcmBase64 = await callGeminiTTS(storyText, tone, genre, voiceName, language, costTelemetry);
      const wavBuffer = pcmToWavBuffer(pcmBase64);

      const supabase = await createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Not authenticated');

      const storagePath = `${user.id}/${savedStoryId}/${nodeId}/audio.wav`;

      await timeNarrationStep(
        'narration.upload_audio',
        {
          storyId: savedStoryId,
          nodeId,
        },
        async () => {
          let uploadError: { message: string } | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            const result = await supabase.storage
              .from('story-assets')
              .upload(storagePath, wavBuffer, {
                contentType: 'audio/wav',
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
        }
      );

      const { data: urlData } = supabase.storage
        .from('story-assets')
        .getPublicUrl(storagePath);

      await timeNarrationStep(
        'narration.persist_audio_url',
        {
          storyId: savedStoryId,
          nodeId,
        },
        async () => {
          const { error: updateError } = await supabase
            .from('beats')
            .update({ audio_url: urlData.publicUrl })
            .eq('story_id', savedStoryId)
            .eq('node_id', nodeId)
            .eq('generated_by', user.id);

          if (updateError) {
            console.error('Failed to update beat audio_url:', updateError.message);
          }

          const { data: check } = await supabase
            .from('beats')
            .select('audio_url')
            .eq('story_id', savedStoryId)
            .eq('node_id', nodeId)
            .single();

          if (!check?.audio_url) {
            await new Promise(r => setTimeout(r, 2000));
            await supabase
              .from('beats')
              .update({ audio_url: urlData.publicUrl })
              .eq('story_id', savedStoryId)
              .eq('node_id', nodeId);
          }
        }
      );

      const { data: signedData } = await timeNarrationStep(
        'narration.create_signed_url',
        {
          storyId: savedStoryId,
          nodeId,
        },
        () => supabase.storage.from('story-assets').createSignedUrl(storagePath, 3600)
      );

      return { audioUrl: signedData?.signedUrl || urlData.publicUrl };
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
  costTelemetry?: CostTelemetryContext
): Promise<string> {
  return timeNarrationStep(
    'narration.generate_only',
    {
      language,
      voiceName,
    },
    async () => {
      const pcmBase64 = await callGeminiTTS(storyText, tone, genre, voiceName, language, costTelemetry);
      const wavBuffer = pcmToWavBuffer(pcmBase64);
      return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
    }
  );
}

/**
 * Lock the narrator voice for a story exactly once.
 * If a voice is already stored, it wins over any newly proposed voice.
 */
export async function ensureNarratorVoiceLocked(
  storyId: string,
  proposedVoiceName: string
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

  const { error: updateError } = await supabase
    .from('stories')
    .update({ narrator_voice: proposedVoiceName })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (updateError) {
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
 * Select narrator voice server-side.
 */
export async function selectNarratorVoiceServer(
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
    console.error('Voice selection failed:', error);
    return DEFAULT_VOICE;
  }
}
