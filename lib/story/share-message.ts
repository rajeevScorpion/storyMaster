import type { StoryBeat, StoryTextParts } from '@/lib/types/story';

const DEFAULT_SHARE_LINE_COUNT = 4;
const DEFAULT_READ_MORE_TEXT = 'read more...';

type ShareBeatText = Pick<StoryBeat, 'storyText' | 'storyTextParts'>;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function getFirstBeat(value: unknown): ShareBeatText | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const beat = value[0];
  if (!beat || typeof beat !== 'object') return null;
  return beat as ShareBeatText;
}

function readStoryTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as StoryTextParts)
    .map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part));
}

function splitSentences(text: string): string[] {
  return text
    .match(/[^.!?\u0964\u061f\u06d4\u3002]+[.!?\u0964\u061f\u06d4\u3002]*/gu)
    ?.map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part))
    ?? [];
}

function splitWordsIntoLines(text: string, lineCount: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  const wordsPerLine = Math.max(1, Math.ceil(words.length / lineCount));
  for (let index = 0; index < words.length && lines.length < lineCount; index += wordsPerLine) {
    lines.push(words.slice(index, index + wordsPerLine).join(' '));
  }
  return lines;
}

export function getFirstBeatShareExcerpt(
  beats: unknown,
  options: {
    lineCount?: number;
    readMoreText?: string;
  } = {}
): string | null {
  const lineCount = Math.max(1, Math.floor(options.lineCount ?? DEFAULT_SHARE_LINE_COUNT));
  const readMoreText = cleanText(options.readMoreText) ?? DEFAULT_READ_MORE_TEXT;
  const firstBeat = getFirstBeat(beats);
  if (!firstBeat) return null;

  const storyText = cleanText(firstBeat.storyText);
  const partLines = readStoryTextParts(firstBeat.storyTextParts);
  const sentenceLines = storyText ? splitSentences(storyText) : [];
  const textLines = storyText
    ? sentenceLines.length >= lineCount
      ? sentenceLines
      : splitWordsIntoLines(storyText, lineCount)
    : [];
  const lines = (partLines.length >= lineCount ? partLines : textLines)
    .slice(0, lineCount)
    .filter(Boolean);

  if (lines.length === 0) return null;
  return `${lines.join('\n')}\n${readMoreText}`;
}
