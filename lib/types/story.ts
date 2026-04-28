import type { BeatMediaStatus } from './beat-media';

export interface Character {
  id: string;
  name: string;
  type: string;
  appearanceSummary: string;
  personalitySummary: string;
  portraitBase64?: string;
  portraitUrl?: string;
}

export interface Option {
  id: string;
  label: string;
  intent: string;
}

export interface SeedPlanOption {
  id: string;
  label: string;
  intent: string;
  isCanonical: boolean;
}

export interface SeedBeatOutline {
  beatIndex: number;
  title: string;
  storyText: string;
  sceneSummary: string;
  isEnding: boolean;
  options: SeedPlanOption[];
}

export interface SeedPlan {
  beatCount: number;
  beats: SeedBeatOutline[];
}

export interface PortraitTask {
  characterId: string;
  characterName: string;
  reason: 'new_character' | 'visual_change';
  prompt: string;
  finalPromptText?: string;
}

export type PortraitReferenceMode = 'single_portrait' | 'character_sheet';

export type PortraitReferenceQuality = '0.5K' | '1K';

export interface PortraitReferenceConfig {
  mode: PortraitReferenceMode;
  quality: PortraitReferenceQuality;
}

export interface StoryboardFramePlan {
  description: string;
  prompt: string;
  cameraAngle: string;
  visualFocus: string[];
  emotion: string;
  continuityAnchor: string;
}

export interface StoryboardPlan {
  sharedVisualInvariants: string[];
  portraitTasks: PortraitTask[];
  topLeft: StoryboardFramePlan;
  topRight: StoryboardFramePlan;
  bottomLeft: StoryboardFramePlan;
  bottomRight: StoryboardFramePlan;
  negativeConstraints: string[];
}

export interface BeatImageGalleryEntry {
  url: string;
  storageKey: string;
  uploadedAt: string;
}

export interface StoryBeat {
  title: string;
  beatNumber: number;
  isEnding: boolean;
  storyText: string;
  sceneSummary: string;
  options: Option[];
  characters: Character[];
  continuityNotes: string[];
  imagePrompt: string;
  clues: string[];
  nextBeatGoal: string;
  endingForecast: string[];
  newCharacterIds?: string[];
  changedCharacterIds?: string[];
  storyboardPlan?: StoryboardPlan;
  storyboardPromptText?: string;
  finalImagePromptText?: string;
  imageUrl?: string;
  persistedImageUrl?: string;
  imageStatus?: BeatMediaStatus;
  imageError?: string;
  imageGallery?: BeatImageGalleryEntry[];
  isStoryboard?: boolean;
  portraitImageUrl?: string;
  audioUrl?: string;
  audioStatus?: BeatMediaStatus;
  audioError?: string;
  narrationVoiceId?: string;
  originKind?: 'generated' | 'seeded_canonical';
  seedPlanBeatIndex?: number;
  canonicalOptionId?: string;
}

export type AgeGroup = 'all_ages' | 'kids_3_5' | 'kids_5_8' | 'kids_8_12' | 'teens' | 'adults';

export type StoryLanguage = 'english' | 'hindi';

export type VisualStylePreset =
  | 'storybook_illustration'
  | 'watercolor_fable'
  | 'anime_cel'
  | 'graphic_novel'
  | 'three_d_animated'
  | 'cinematic_photo';

export type StoryTheme =
  | 'whimsical'
  | 'cozy'
  | 'epic'
  | 'mysterious'
  | 'dark_fantasy'
  | 'futuristic';

export type StoryPalette =
  | 'warm'
  | 'vibrant'
  | 'pastel'
  | 'moody'
  | 'earthy'
  | 'neon';

export type StoryDetailLevel = 'simple' | 'balanced' | 'lush';
export type SourceFidelity = 'preserve_closely' | 'balanced_adaptation' | 'creative_expansion';

export interface VisualSettings {
  preset: VisualStylePreset;
  theme: StoryTheme;
  palette: StoryPalette;
  detail: StoryDetailLevel;
}

export type AuthoringMode = 'prompt' | 'seeded';

export interface StoryAuthoringConfig {
  mode: AuthoringMode;
  preludeText?: string;
  workingTitle?: string;
  sourceText?: string;
  guidanceText?: string;
  sourceFidelity?: SourceFidelity;
  seedPlan?: SeedPlan;
}

export interface StoryConfig {
  ageGroup: AgeGroup;
  settingCountry: string;
  maxBeats: number;
  language: StoryLanguage;
  imageGenerationMode: 'generate' | 'prompt_only';
  visualSettings: VisualSettings;
  authoring: StoryAuthoringConfig;
  portraitReferences: PortraitReferenceConfig;
  narrationVoice?: import('@/lib/ai/narration-voices').StoryNarrationVoiceSelection;
}

export interface StoryNode {
  id: string;
  beatNumber: number;
  parentId: string | null;
  selectedOptionId: string | null;
  data: StoryBeat;
  children: string[];
}

export interface StoryMap {
  nodes: Record<string, StoryNode>;
  rootNodeId: string;
  currentNodeId: string;
}

export interface StorySession {
  storySessionId: string;
  savedStoryId?: string;
  savedByUserId?: string;
  explorationMode?: boolean;
  sourceStoryOwnerId?: string;
  userPrompt: string;
  title: string;
  genre: string;
  tone: string;
  targetAge: string;
  visualStyle: string;
  currentBeat: number;
  maxBeats: number;
  status: 'active' | 'completed' | 'error';
  characters: Character[];
  setting: {
    world: string;
    timeOfDay: string;
    mood: string;
  };
  storyConfig: StoryConfig;
  storyMap: StoryMap;
  beats: StoryBeat[];
  choiceHistory: string[];
  openThreads: string[];
  allowedEndings: string[];
  safetyProfile: string;
  narratorVoice?: string;
  narrationVoiceMode?: import('@/lib/ai/narration-voices').NarrationVoiceMode;
  narrationVoiceGenderBucket?: import('@/lib/ai/narration-voices').NarrationGenderBucket;
  narrationLanguageCode?: import('@/lib/ai/narration-voices').NarrationLanguageCode;
  enableReferenceImages?: boolean;
}
