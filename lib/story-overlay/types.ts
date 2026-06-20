export type StoryTextOverlayMode = 'word' | 'line';
export type StoryTextOverlayPosition = 'upper' | 'middle' | 'lower';
export type StoryTextOverlayAlign = 'left' | 'center' | 'right';
export type StoryTextOverlayTimestampSource = 'elevenlabs_forced_alignment' | 'none';

export interface StoryTextOverlayWordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface StoryTextOverlayCaption {
  panelIndex: number;
  text: string;
  startMs?: number;
  endMs?: number;
  wordTimings?: StoryTextOverlayWordTiming[];
}

export interface StoryTextOverlayStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;
  textOpacity?: number;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundBlur?: number;
  position?: StoryTextOverlayPosition;
  verticalOffset?: number;
  align?: StoryTextOverlayAlign;
  wordsPerLine?: number;
  wordHighlightColor?: string;
  wordHighlightOpacity?: number;
  wordHighlightPaddingX?: number;
  wordHighlightPaddingY?: number;
  wordHighlightBorderRadius?: number;
  wordHighlightWordSpacing?: number;
  wordHighlightScale?: number;
}

export interface StoryTextOverlayAlignment {
  version: 1;
  provider: 'elevenlabs';
  source: StoryTextOverlayTimestampSource;
  textHighlightSupported: boolean;
  alignedWordCount: number;
  loss?: number;
  error?: string;
  createdAt: string;
}

export interface StoryTextOverlayConfig {
  enabled: boolean;
  mode: StoryTextOverlayMode;
  style: StoryTextOverlayStyle;
}
