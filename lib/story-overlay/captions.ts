import type { StoryTextParts } from '@/lib/types/story';
import {
  DEFAULT_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
} from '@/lib/types/storyboard-settings';
import type { StoryTextOverlayCaption, StoryTextOverlayMode, StoryTextOverlayWordTiming } from './types';

export {
  DEFAULT_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
};

export function normalizeStoryTextOverlayWordsPerLine(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? parseInt(value, 10)
      : NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_STORY_TEXT_OVERLAY_WORDS_PER_LINE;
  return Math.min(
    MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
    Math.max(MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE, Math.round(numeric))
  );
}

export function normalizeStoryTextOverlayMode(value: unknown): StoryTextOverlayMode {
  return value === 'line' ? 'line' : 'word';
}

export function normalizeStoryOverlayWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitWords(value: string): string[] {
  return normalizeStoryOverlayWhitespace(value).split(/\s+/).filter(Boolean);
}

export function groupStoryOverlayWords<T>(
  words: readonly T[],
  wordsPerLine: number
): T[][] {
  const size = normalizeStoryTextOverlayWordsPerLine(wordsPerLine);
  const groups: T[][] = [];
  for (let index = 0; index < words.length; index += size) {
    groups.push(words.slice(index, index + size) as T[]);
  }
  return groups;
}

export function getActiveStoryOverlayWordIndex(
  wordTimings: readonly StoryTextOverlayWordTiming[] | undefined,
  elapsedMs: number | null | undefined
): number | undefined {
  if (!wordTimings?.length || elapsedMs == null) return undefined;
  const index = wordTimings.findIndex((word) => elapsedMs >= word.startMs && elapsedMs < word.endMs);
  return index >= 0 ? index : undefined;
}

export function getActiveStoryOverlayLineIndex(
  wordTimings: readonly StoryTextOverlayWordTiming[] | undefined,
  elapsedMs: number | null | undefined,
  wordsPerLine: number
): number {
  const activeWordIndex = getActiveStoryOverlayWordIndex(wordTimings, elapsedMs);
  if (activeWordIndex === undefined) return 0;
  return Math.floor(activeWordIndex / normalizeStoryTextOverlayWordsPerLine(wordsPerLine));
}

export function buildStoryTextOverlayCaptions(input: {
  storyText: string;
  storyTextParts?: StoryTextParts;
}): StoryTextOverlayCaption[] {
  const parts = input.storyTextParts?.map(normalizeStoryOverlayWhitespace).filter(Boolean);
  const sourceParts = parts && parts.length === 4
    ? parts
    : splitTextIntoFourOverlayPanels(input.storyText);

  return Array.from({ length: 4 }, (_, panelIndex) => ({
    panelIndex,
    text: sourceParts[panelIndex] || sourceParts.find(Boolean) || normalizeStoryOverlayWhitespace(input.storyText),
  }));
}

function splitTextIntoFourOverlayPanels(value: string): string[] {
  const words = splitWords(value);
  if (words.length === 0) return ['', '', '', ''];
  return Array.from({ length: 4 }, (_, index) => {
    const start = Math.round((words.length * index) / 4);
    const end = Math.round((words.length * (index + 1)) / 4);
    return words.slice(start, Math.max(start + 1, end)).join(' ');
  });
}

export function getStoryOverlayCaptionWords(caption: StoryTextOverlayCaption): StoryTextOverlayWordTiming[] {
  if (caption.wordTimings?.length) return caption.wordTimings;
  return splitWords(caption.text).map((word) => ({ word, startMs: 0, endMs: 0 }));
}

export function normalizeStoryTextOverlayCaptions(value: unknown): StoryTextOverlayCaption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const captions = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const panelIndex = Number(raw.panelIndex ?? raw.panel_index);
      const text = typeof raw.text === 'string' ? normalizeStoryOverlayWhitespace(raw.text) : '';
      if (!Number.isFinite(panelIndex) || panelIndex < 0 || panelIndex > 3 || !text) return null;
      const rawWordTimings = raw.wordTimings ?? raw.word_timings;
      const wordTimings = Array.isArray(rawWordTimings)
        ? rawWordTimings.map((wordEntry) => {
            if (!wordEntry || typeof wordEntry !== 'object') return null;
            const wordRaw = wordEntry as Record<string, unknown>;
            const word = typeof wordRaw.word === 'string' ? wordRaw.word.trim() : '';
            const startMs = Number(wordRaw.startMs ?? wordRaw.start_ms);
            const endMs = Number(wordRaw.endMs ?? wordRaw.end_ms);
            if (!word || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
            return {
              word,
              startMs: Math.max(0, Math.round(startMs)),
              endMs: Math.max(0, Math.round(endMs)),
            };
          }).filter((item): item is StoryTextOverlayWordTiming => Boolean(item))
        : undefined;
      return {
        panelIndex: Math.round(panelIndex),
        text,
        ...(Number.isFinite(Number(raw.startMs ?? raw.start_ms)) ? { startMs: Math.max(0, Math.round(Number(raw.startMs ?? raw.start_ms))) } : {}),
        ...(Number.isFinite(Number(raw.endMs ?? raw.end_ms)) ? { endMs: Math.max(0, Math.round(Number(raw.endMs ?? raw.end_ms))) } : {}),
        ...(wordTimings?.length ? { wordTimings } : {}),
      };
    })
    .filter((entry): entry is StoryTextOverlayCaption => Boolean(entry))
    .sort((left, right) => left.panelIndex - right.panelIndex);

  return captions.length > 0 ? captions : undefined;
}
