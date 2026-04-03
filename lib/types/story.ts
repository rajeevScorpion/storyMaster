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
  imageUrl?: string;
  isStoryboard?: boolean;
  portraitImageUrl?: string;
  audioUrl?: string;
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

export interface VisualSettings {
  preset: VisualStylePreset;
  theme: StoryTheme;
  palette: StoryPalette;
  detail: StoryDetailLevel;
}

export type AuthoringMode = 'prompt' | 'seed_continue';

export interface StoryAuthoringConfig {
  mode: AuthoringMode;
  preludeText?: string;
}

export interface StoryConfig {
  ageGroup: AgeGroup;
  settingCountry: string;
  maxBeats: number;
  language: StoryLanguage;
  visualSettings: VisualSettings;
  authoring: StoryAuthoringConfig;
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
  enableReferenceImages?: boolean;
}
