// Shared types and constants — safe to import from both client and server code

export type TaskKey =
  | 'story_generation'
  | 'visual_prompt'
  | 'image_generation'
  | 'tts'
  | 'voice_selection';

export interface ModelConfig {
  taskKey: TaskKey;
  modelId: string;
  temperature: number | null;
  updatedAt: string;
}

export const TASK_DEFINITIONS: {
  key: TaskKey;
  label: string;
  description: string;
}[] = [
  { key: 'story_generation', label: 'Story Generation', description: 'Generates structured JSON story beats with characters, options, and continuity' },
  { key: 'visual_prompt', label: 'Visual Prompt Composer', description: 'Refines scene descriptions into detailed image generation prompts' },
  { key: 'image_generation', label: 'Image Generation', description: 'Generates scene illustrations from refined prompts' },
  { key: 'tts', label: 'Text-to-Speech', description: 'Narrates story text with expressive voice acting' },
  { key: 'voice_selection', label: 'Voice Selection', description: 'Picks the best narrator voice for the story genre and tone' },
];

export const DEFAULT_MODELS: Record<TaskKey, { modelId: string; temperature: number | null }> = {
  story_generation: { modelId: 'gemini-3.1-pro-preview', temperature: 0.7 },
  visual_prompt: { modelId: 'gemini-3.1-pro-preview', temperature: 0.7 },
  image_generation: { modelId: 'gemini-3.1-flash-image-preview', temperature: null },
  tts: { modelId: 'gemini-2.5-flash-preview-tts', temperature: null },
  voice_selection: { modelId: 'gemini-3.1-pro-preview', temperature: 0.3 },
};

// Known Gemini models for the playground dropdown
export const KNOWN_MODELS = {
  text: [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  image: [
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image',
  ],
  tts: [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
  ],
};
