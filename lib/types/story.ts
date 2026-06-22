import type { BeatMediaStatus } from './beat-media';
import type { ImageCompressionMetadata } from '@/lib/media/imageUploadOptimization';
import type { ReelLengthKey, ReelTextLengthKey } from '@/lib/reel/settings';
import type { BeatNarrationMetadata, ReelNarrationSettings } from '@/lib/reel/narration';
import type { ReelTextOverlayStyle } from '@/lib/reel/styles';
import type { ReelTransitionSettings } from '@/lib/reel/transitions';
import type { StoryTransitionSettings } from '@/lib/story-transitions/settings';
import type {
  StoryTextOverlayAlignment,
  StoryTextOverlayCaption,
  StoryTextOverlayConfig,
  StoryTextOverlayMode,
  StoryTextOverlayStyle,
} from '@/lib/story-overlay/types';

export interface CharacterSheetGalleryEntry {
  url: string;
  storageKey: string;
  uploadedAt: string;
  optimizationMetadata?: ImageCompressionMetadata;
}

export interface Character {
  id: string;
  name: string;
  type: string;
  appearanceSummary: string;
  personalitySummary: string;
  portraitBase64?: string;
  portraitUrl?: string;
  // User-uploaded reference sheet, kept distinct from the auto-generated
  // portrait so the source is preserved and a stable storage key remains
  // available for future episode/continuation flows. The gallery is a
  // cap-bounded history of past uploads (story-level only); the active
  // pointer fields are propagated to every matching beat character.
  referenceSheetUrl?: string;
  referenceSheetStorageKey?: string;
  referenceSheetUploadedAt?: string;
  referenceSheetGallery?: CharacterSheetGalleryEntry[];
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

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface ReelPanelCaption {
  panelIndex: number;
  text: string;
  startMs?: number;
  endMs?: number;
  wordTimings?: WordTiming[];
}

export interface StoryboardNarrationTiming {
  version: 1;
  panelEndTimesMs: [number, number, number];
  audioDurationMs: number;
}

export type StoryTextParts = [string, string, string, string];

export interface BeatImageGalleryEntry {
  url: string;
  storageKey: string;
  uploadedAt: string;
  optimizationMetadata?: ImageCompressionMetadata;
}

export interface StoryBeat {
  title: string;
  beatNumber: number;
  isEnding: boolean;
  storyText: string;
  storyTextParts?: StoryTextParts;
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
  reelCaptions?: ReelPanelCaption[];
  storyboardNarrationTiming?: StoryboardNarrationTiming;
  reelTextOverlayEnabled?: boolean;
  reelTextOverlayStyle?: ReelTextOverlayStyle;
  storyTextOverlayEnabled?: boolean;
  storyTextOverlayMode?: StoryTextOverlayMode;
  storyTextOverlayStyle?: StoryTextOverlayStyle;
  storyTextOverlayCaptions?: StoryTextOverlayCaption[];
  storyTextOverlayAlignment?: StoryTextOverlayAlignment;
  finalImagePromptText?: string;
  imageUrl?: string;
  persistedImageUrl?: string;
  imageVersion?: string;
  imageStatus?: BeatMediaStatus;
  imageError?: string;
  imageGallery?: BeatImageGalleryEntry[];
  isStoryboard?: boolean;
  portraitImageUrl?: string;
  audioUrl?: string;
  audioVersion?: string;
  audioStatus?: BeatMediaStatus;
  audioError?: string;
  narrationVoiceId?: string;
  narrationMetadata?: BeatNarrationMetadata;
  activeNarrationPreviewId?: string;
  originKind?: 'generated' | 'seeded_canonical';
  seedPlanBeatIndex?: number;
  canonicalOptionId?: string;
}

export type AgeGroup = 'all_ages' | 'kids_3_5' | 'kids_5_8' | 'kids_8_12' | 'teens' | 'adults';

export type StoryLanguage = 'english' | 'hindi' | 'bangla' | 'urdu' | 'gujarati';

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
export type StoryAspectRatio = '16:9' | '9:16';

export interface VisualSettings {
  preset: VisualStylePreset;
  theme: StoryTheme;
  palette: StoryPalette;
  detail: StoryDetailLevel;
}

export type AuthoringMode = 'prompt' | 'seeded' | 'user_text';
export type StoryKind = 'story' | 'reel';

export interface StoryAuthoringConfig {
  mode: AuthoringMode;
  preludeText?: string;
  workingTitle?: string;
  sourceText?: string;
  guidanceText?: string;
  sourceFidelity?: SourceFidelity;
  seedPlan?: SeedPlan;
  reelPanelTexts?: string[][];
  reelImagePrompts?: string[];
}

export interface ReelStoryConfig {
  length: ReelLengthKey;
  beatCount: 1 | 2 | 3;
  textLength: ReelTextLengthKey;
  textOverlayEnabled: boolean;
  visualStyleId?: string | null;
  textOverlayStyle?: ReelTextOverlayStyle;
  transitionSettings?: ReelTransitionSettings;
  moodKey: string;
  visualStyleKey: string;
  narrationStyleKey: string;
  narrationSettings: ReelNarrationSettings;
  brandingEnabled: boolean;
}

export type StoryTextOverlaySettings = StoryTextOverlayConfig;

export interface StoryConfig {
  storyKind: StoryKind;
  ageGroup: AgeGroup;
  settingCountry: string;
  maxBeats: number;
  language: StoryLanguage;
  imageGenerationMode: 'generate' | 'prompt_only';
  isVerticalStory: boolean;
  aspectRatio: StoryAspectRatio;
  visualSettings: VisualSettings;
  authoring: StoryAuthoringConfig;
  reel: ReelStoryConfig;
  storyTextOverlay: StoryTextOverlaySettings;
  storyTransition: StoryTransitionSettings;
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
  sourceUpdatedAt?: string;
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
