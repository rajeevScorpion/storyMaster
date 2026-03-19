'use client';

import { GoogleGenAI, Type } from '@google/genai';
import { StorySession, StoryBeat, Character } from '@/lib/types/story';
import { STORY_MASTER_SYSTEM_PROMPT, VISUAL_PROMPT_COMPOSER_PROMPT } from '@/lib/ai/prompts';

const AVAILABLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

const DEFAULT_VOICE = 'Sulafat';

const beatSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    beatNumber: { type: Type.INTEGER },
    isEnding: { type: Type.BOOLEAN },
    storyText: { type: Type.STRING },
    sceneSummary: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          intent: { type: Type.STRING },
        },
        required: ['id', 'label', 'intent'],
      },
    },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          type: { type: Type.STRING },
          appearanceSummary: { type: Type.STRING },
          personalitySummary: { type: Type.STRING },
        },
        required: ['id', 'name', 'type', 'appearanceSummary', 'personalitySummary'],
      },
    },
    continuityNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    imagePrompt: { type: Type.STRING },
    clues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    nextBeatGoal: { type: Type.STRING },
    endingForecast: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'title',
    'beatNumber',
    'isEnding',
    'storyText',
    'sceneSummary',
    'options',
    'characters',
    'continuityNotes',
    'imagePrompt',
    'clues',
    'nextBeatGoal',
    'endingForecast',
  ],
};

export async function generateStoryBeat(
  userPrompt: string,
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string
): Promise<StoryBeat> {
  if (userPrompt.toLowerCase() === 'mock') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const isFirstBeat = !sessionState?.beats || sessionState.beats.length === 0;
    
    if (isFirstBeat) {
      return {
        title: "The Monkey and the Mountain Giant",
        beatNumber: 1,
        isEnding: false,
        storyText: "Miko the monkey hopped from stone to stone on the misty mountain trail. Ahead of him rested what looked like an enormous grey rock, warm in the morning sun. Curious as ever, he leaned forward and whispered, 'What a strange rock to be sleeping here all alone.'",
        sceneSummary: "A monkey mistakes a resting elephant for a giant rock on a mountain path.",
        options: [
          { id: "opt_1", label: "Miko jumps onto the rock", intent: "playful action" },
          { id: "opt_2", label: "Miko hides behind a bush", intent: "fearful retreat" },
          { id: "opt_3", label: "Miko pokes the rock with a stick", intent: "careful curiosity" },
        ],
        characters: [
          { id: "char_monkey", name: "Miko", type: "monkey", appearanceSummary: "small golden-brown monkey with a curled tail and expressive eyes", personalitySummary: "curious, energetic, impulsive" },
          { id: "char_elephant", name: "Bhoora", type: "elephant", appearanceSummary: "large soft-grey elephant with kind eyes and slightly dusty ears", personalitySummary: "gentle, wise, calm" }
        ],
        continuityNotes: ["Miko has just encountered Bhoora for the first time."],
        imagePrompt: "Cinematic children's storybook illustration of a small golden-brown monkey with a curled tail staring curiously at a huge resting grey elephant that looks like a rock on a misty mountain forest path, morning light, whimsical, emotionally warm, highly detailed, consistent character design, soft painterly style.",
        clues: ["Some rocks can breathe... if they are not rocks at all.", "Curiosity can sometimes lead to friendship."],
        nextBeatGoal: "Reveal whether the giant rock is alive and deepen the encounter.",
        endingForecast: ["friendship", "comedy", "moral discovery"]
      };
    } else {
      return {
        title: "The Monkey and the Mountain Giant",
        beatNumber: (sessionState?.currentBeat || 1) + 1,
        isEnding: true,
        storyText: "The giant rock slowly opened one eye, then let out a deep, rumbling laugh that shook the leaves from the trees. 'Little monkey,' Bhoora the elephant chuckled, 'I am no rock, but I make an excellent climbing frame.' Miko grinned, realizing he had just made the biggest friend in the forest.",
        sceneSummary: "The elephant wakes up and befriends the monkey.",
        options: [],
        characters: sessionState?.characters || [],
        continuityNotes: ["Miko and Bhoora are now friends."],
        imagePrompt: "Cinematic children's storybook illustration of a small golden-brown monkey sitting happily on the head of a large soft-grey elephant, misty mountain forest path, morning light, whimsical, emotionally warm, highly detailed, consistent character design, soft painterly style.",
        clues: ["Friendship comes in all sizes."],
        nextBeatGoal: "Conclude the story with a heartwarming friendship.",
        endingForecast: ["friendship"]
      };
    }
  }

  const lang = sessionState?.storyConfig?.language || 'english';
  let prompt = `[LANGUAGE: ${lang}] — Generate ALL story content in this language.\n\n`;
  prompt += `User Request: ${userPrompt}\n\n`;

  // Inject story configuration for age/setting/pacing
  if (sessionState?.storyConfig) {
    const cfg = sessionState.storyConfig;
    prompt += `Story Configuration:\n`;
    prompt += `- Language: ${cfg.language || 'english'}\n`;
    prompt += `- Age Group: ${cfg.ageGroup}\n`;
    prompt += `- Setting/Country: ${cfg.settingCountry}\n`;
    prompt += `- Maximum Beats: ${cfg.maxBeats}\n`;
    prompt += `- Current Beat: ${(sessionState.currentBeat || 0) + 1} of ${cfg.maxBeats}\n\n`;
  }

  if (sessionState) {
    // Clone session state and remove imageUrls/storyMap to save tokens
    const { storyMap, storyConfig, ...safeState } = sessionState as any;
    if (safeState.beats) {
      safeState.beats = safeState.beats.map((beat: any) => {
        const { imageUrl, audioUrl, ...rest } = beat;
        return rest;
      });
    }
    prompt += `Current Story State:\n${JSON.stringify(safeState, null, 2)}\n\n`;
  }

  if (selectedOptionLabel) {
    prompt += `User Selected Option: ${selectedOptionLabel}\n\n`;
  }

  prompt += `Generate the next story beat.`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        systemInstruction: STORY_MASTER_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: beatSchema,
        temperature: 0.7,
      },
    });

    const text = response.text;
    if (!text) throw new Error('Failed to generate story beat');
    
    return JSON.parse(text) as StoryBeat;
  } catch (error) {
    console.error("Story beat generation failed:", error);
    throw error;
  }
}

export async function generateImage(prompt: string, characters: any[], visualStyle: string): Promise<string> {
  if (prompt.includes("Cinematic children's storybook illustration")) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1920/1080?blur=4`;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const composerPrompt = `
      ${VISUAL_PROMPT_COMPOSER_PROMPT}
      
      Story Beat Image Prompt: ${prompt}
      Characters: ${JSON.stringify(characters)}
      Visual Style: ${visualStyle}
      
      Generate the final image prompt based on the above.
    `;

    const composerResponse = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: composerPrompt,
      config: {
        temperature: 0.7,
      }
    });

    const finalImagePrompt = composerResponse.text || prompt;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: finalImagePrompt,
      config: {
        imageConfig: {
          aspectRatio: '16:9',
        }
      }
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error('No image generated');
  } catch (error) {
    console.error("Image generation failed:", error);
    // Return a placeholder if image generation fails
    return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1920/1080?blur=4`;
  }
}

function pcmToWavBase64(pcmBase64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16): string {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const dataSize = pcmBytes.length;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // file size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt sub-chunk
  view.setUint32(12, 0x666D7420, false); // "fmt "
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  const wavBytes = new Uint8Array(44 + dataSize);
  wavBytes.set(new Uint8Array(header), 0);
  wavBytes.set(pcmBytes, 44);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < wavBytes.length; i++) {
    binary += String.fromCharCode(wavBytes[i]);
  }
  return btoa(binary);
}

export async function selectNarratorVoice(genre: string, tone: string, targetAge: string, language: string = 'english'): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
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
    // Try partial match
    const match = AVAILABLE_VOICES.find(v => voiceName.toLowerCase().includes(v.toLowerCase()));
    return match || DEFAULT_VOICE;
  } catch (error) {
    console.error('Voice selection failed:', error);
    return DEFAULT_VOICE;
  }
}

export async function generateNarration(
  storyText: string,
  tone: string,
  genre: string,
  voiceName: string,
  language: string = 'english'
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

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

  const wavBase64 = pcmToWavBase64(audioPart.inlineData.data);
  return `data:audio/wav;base64,${wavBase64}`;
}
