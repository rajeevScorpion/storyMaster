// Shared types and constants — safe to import from both client and server code

export type TaskKey =
  | 'story_generation'
  | 'reel_story_generation'
  | 'seed_plan_generation'
  | 'seeded_beat_materialization'
  | 'visual_prompt'
  | 'reel_visual_prompt'
  | 'image_generation'
  | 'portrait_generation'
  | 'tts'
  | 'reel_tts'
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
  { key: 'reel_story_generation', label: 'Reel Story Generation', description: 'Generates short-form reel beats capped at 1-3 beats' },
  { key: 'seed_plan_generation', label: 'Seed Plan Generation', description: 'Turns user-authored source material into a structured canonical beat plan preview' },
  { key: 'seeded_beat_materialization', label: 'Seeded Beat Materialization', description: 'Turns one confirmed seed-plan beat into a full runtime story beat while preserving the authored path' },
  { key: 'visual_prompt', label: 'Visual Prompt Composer', description: 'Builds structured 4-frame storyboard plans and portrait tasks from each story beat' },
  { key: 'reel_visual_prompt', label: 'Reel Visual Composer', description: 'Builds 4-frame storyboard plans optimized for vertical reel pacing' },
  { key: 'image_generation', label: 'Image Generation', description: 'Generates scene illustrations from refined prompts' },
  { key: 'portrait_generation', label: 'Portrait Generation', description: 'Generates character reference portraits for visual consistency across beats' },
  { key: 'tts', label: 'Text-to-Speech', description: 'Narrates story text with expressive voice acting' },
  { key: 'reel_tts', label: 'Reel Text-to-Speech', description: 'Narrates reel text with short-form pacing and selected narration style' },
  { key: 'voice_selection', label: 'Legacy Voice Selection', description: 'Legacy AI selector used only when user-led narration voice selection is off' },
];

export const DEFAULT_MODELS: Record<TaskKey, { modelId: string; temperature: number | null }> = {
  story_generation: { modelId: 'gemini-3.1-pro-preview', temperature: 0.7 },
  reel_story_generation: { modelId: 'gemini-3.1-pro-preview', temperature: 0.7 },
  seed_plan_generation: { modelId: 'gemini-3.1-pro-preview', temperature: 0.3 },
  seeded_beat_materialization: { modelId: 'gemini-3.1-pro-preview', temperature: 0.4 },
  visual_prompt: { modelId: 'gemini-3.1-pro-preview', temperature: 0.7 },
  reel_visual_prompt: { modelId: 'gemini-3.1-pro-preview', temperature: 0.5 },
  image_generation: { modelId: 'gemini-3.1-flash-image-preview', temperature: null },
  portrait_generation: { modelId: 'gemini-3.1-flash-image-preview', temperature: null },
  tts: { modelId: 'gemini-2.5-flash-preview-tts', temperature: null },
  reel_tts: { modelId: 'gemini-2.5-flash-preview-tts', temperature: null },
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
