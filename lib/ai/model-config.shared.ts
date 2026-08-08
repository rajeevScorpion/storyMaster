// Shared types and constants — safe to import from both client and server code

export type TaskKey =
  | 'story_generation'
  | 'reel_story_generation'
  | 'seed_plan_generation'
  | 'seeded_beat_materialization'
  | 'story_bible_generation'
  | 'storyline_discovery_metadata'
  | 'visual_prompt'
  | 'reel_visual_prompt'
  | 'image_generation'
  | 'reel_image_generation'
  | 'portrait_generation'
  | 'graphic_style_extraction'
  | 'reference_character_analysis'
  | 'reference_world_analysis'
  | 'tts'
  | 'reel_tts'
  | 'story_text_overlay_alignment'
  | 'voice_selection';

export interface ModelConfig {
  taskKey: TaskKey;
  modelId: string;
  temperature: number | null;
  updatedAt: string;
}

export const DEFAULT_TEXT_MODEL_ID = 'gemini-3.5-flash';
export const DEFAULT_IMAGE_MODEL_ID = 'gemini-3.1-flash-image';
export const DEFAULT_TTS_MODEL_ID = 'gemini-3.1-flash-tts-preview';

export const TASK_DEFINITIONS: {
  key: TaskKey;
  label: string;
  description: string;
}[] = [
  { key: 'story_generation', label: 'Story Generation', description: 'Generates structured JSON story beats with characters, options, and continuity' },
  { key: 'reel_story_generation', label: 'Reel Story Generation', description: 'Generates short-form reel beats capped at 1-3 beats' },
  { key: 'seed_plan_generation', label: 'Seed Plan Generation', description: 'Turns user-authored source material into a structured canonical beat plan preview' },
  { key: 'seeded_beat_materialization', label: 'Seeded Beat Materialization', description: 'Turns one confirmed seed-plan beat into a full runtime story beat while preserving the authored path' },
  { key: 'story_bible_generation', label: 'Story Bible Writer', description: 'Condenses a finished episode into an updated series bible plus a journal summary for episodic continuity' },
  { key: 'storyline_discovery_metadata', label: 'Discovery Metadata', description: 'Writes the 1-2 sentence gallery introduction for a published storyline, plus suggested genre and audience fit' },
  { key: 'visual_prompt', label: 'Visual Prompt Composer', description: 'Builds structured 4-frame storyboard plans and portrait tasks from each story beat' },
  { key: 'reel_visual_prompt', label: 'Reel Visual Composer', description: 'Builds 4-frame storyboard plans optimized for vertical reel pacing' },
  { key: 'image_generation', label: 'Image Generation', description: 'Generates scene illustrations from refined prompts' },
  { key: 'reel_image_generation', label: 'Reel Image Generation', description: 'Generates abstract vertical reel storyboard panels from reel-specific image prompts' },
  { key: 'portrait_generation', label: 'Portrait Generation', description: 'Generates character reference portraits for visual consistency across beats' },
  { key: 'graphic_style_extraction', label: 'Graphic Style Extraction', description: 'Analyzes a reference image and returns a concise ≤150-word visual style description for the Graphic Style Studio' },
  { key: 'reference_character_analysis', label: 'Reference Character Analysis', description: 'Analyzes an uploaded character reference image and extracts stable identity traits vs changeable attributes for style adoption' },
  { key: 'reference_world_analysis', label: 'Reference World Analysis', description: 'Analyzes an uploaded world/location reference image and extracts structured World DNA (architecture, layout, materials, lighting) for continuity' },
  { key: 'tts', label: 'Text-to-Speech', description: 'Narrates story text with expressive voice acting' },
  { key: 'reel_tts', label: 'Reel Text-to-Speech', description: 'Narrates reel text with short-form pacing and selected narration style' },
  { key: 'story_text_overlay_alignment', label: 'Story Text Overlay Alignment', description: 'Aligns generated narration audio to story text for timed overlay highlighting' },
  { key: 'voice_selection', label: 'Legacy Voice Selection', description: 'Legacy AI selector used only when user-led narration voice selection is off' },
];

export const DEFAULT_MODELS: Record<TaskKey, { modelId: string; temperature: number | null }> = {
  story_generation: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.7 },
  reel_story_generation: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.7 },
  seed_plan_generation: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.3 },
  seeded_beat_materialization: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.4 },
  story_bible_generation: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.35 },
  storyline_discovery_metadata: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.4 },
  visual_prompt: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.7 },
  reel_visual_prompt: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.5 },
  image_generation: { modelId: DEFAULT_IMAGE_MODEL_ID, temperature: null },
  reel_image_generation: { modelId: DEFAULT_IMAGE_MODEL_ID, temperature: null },
  portrait_generation: { modelId: DEFAULT_IMAGE_MODEL_ID, temperature: null },
  graphic_style_extraction: { modelId: 'gemini-2.5-flash', temperature: 0.4 },
  reference_character_analysis: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.2 },
  reference_world_analysis: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.2 },
  tts: { modelId: DEFAULT_TTS_MODEL_ID, temperature: null },
  reel_tts: { modelId: DEFAULT_TTS_MODEL_ID, temperature: null },
  story_text_overlay_alignment: { modelId: 'elevenlabs-forced-alignment', temperature: null },
  voice_selection: { modelId: DEFAULT_TEXT_MODEL_ID, temperature: 0.3 },
};

// Known Gemini models for the playground dropdown
export const KNOWN_MODELS = {
  text: [
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  image: [
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'gemini-2.5-flash-image',
  ],
  tts: [
    'gemini-3.1-flash-tts-preview',
  ],
};
