export interface Character {
  id: string;
  name: string;
  type: string;
  appearanceSummary: string;
  personalitySummary: string;
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
  audioUrl?: string;
}

export type AgeGroup = 'all_ages' | 'kids_3_5' | 'kids_5_8' | 'kids_8_12' | 'teens' | 'adults';

export type StoryLanguage = 'english' | 'hindi';

export interface StoryConfig {
  ageGroup: AgeGroup;
  settingCountry: string;
  maxBeats: number;
  language: StoryLanguage;
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
}
