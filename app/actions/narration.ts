'use server';

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@/lib/supabase/server';

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
  language: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const ttsPrompt = `You are a master storyteller narrating a ${genre} tale with a ${tone} tone in ${language}. Read this passage aloud with natural pacing, dramatic pauses, and emotional expression that matches the scene:

${storyText}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: ttsPrompt }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.find(
    (p: any) => p.inlineData
  );

  if (!audioPart?.inlineData?.data) {
    throw new Error('No audio generated');
  }

  return audioPart.inlineData.data; // raw PCM base64
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
  nodeId: string
): Promise<{ audioUrl: string }> {
  const pcmBase64 = await callGeminiTTS(storyText, tone, genre, voiceName, language);
  const wavBuffer = pcmToWavBuffer(pcmBase64);

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const storagePath = `${user.id}/${savedStoryId}/${nodeId}/audio.wav`;

  const { error: uploadError } = await supabase.storage
    .from('story-assets')
    .upload(storagePath, wavBuffer, {
      contentType: 'audio/wav',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Audio upload failed: ${uploadError.message}`);
  }

  // Store the canonical public URL in the DB (gets re-signed when loading)
  const { data: urlData } = supabase.storage
    .from('story-assets')
    .getPublicUrl(storagePath);

  // Update beats table with the storage URL
  const { error: updateError } = await supabase
    .from('beats')
    .update({ audio_url: urlData.publicUrl })
    .eq('story_id', savedStoryId)
    .eq('node_id', nodeId)
    .eq('generated_by', user.id);

  if (updateError) {
    console.error('Failed to update beat audio_url:', updateError.message);
  }

  // Return a signed URL for immediate playback (story-assets bucket is private)
  const { data: signedData } = await supabase.storage
    .from('story-assets')
    .createSignedUrl(storagePath, 3600);

  return { audioUrl: signedData?.signedUrl || urlData.publicUrl };
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
  language: string
): Promise<string> {
  const pcmBase64 = await callGeminiTTS(storyText, tone, genre, voiceName, language);
  const wavBuffer = pcmToWavBuffer(pcmBase64);
  return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
}

/**
 * Select narrator voice server-side.
 */
export async function selectNarratorVoiceServer(
  genre: string,
  tone: string,
  targetAge: string,
  language: string = 'english'
): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: `Pick the single best narrator voice for a ${genre} story with a ${tone} tone, aimed at a ${targetAge} audience. The story will be narrated in ${language}.

Available voices: ${AVAILABLE_VOICES.join(', ')}

Respond with ONLY the voice name, nothing else.`,
      config: { temperature: 0.3 },
    });

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
