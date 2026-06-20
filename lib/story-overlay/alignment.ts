import type {
  StoryTextOverlayAlignment,
  StoryTextOverlayCaption,
  StoryTextOverlayTimestampSource,
  StoryTextOverlayWordTiming,
} from './types';

interface ForcedAlignmentWord {
  text?: string;
  start?: number;
  end?: number;
  loss?: number;
}

export interface ElevenLabsForcedAlignmentResponse {
  words?: ForcedAlignmentWord[];
  loss?: number;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeAlignmentWords(words: ForcedAlignmentWord[] | undefined): StoryTextOverlayWordTiming[] {
  if (!Array.isArray(words)) return [];
  return words
    .map((word) => {
      const text = typeof word.text === 'string' ? word.text.trim() : '';
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return {
        word: text,
        startMs: Math.max(0, Math.round(start * 1000)),
        endMs: Math.max(0, Math.round(end * 1000)),
      };
    })
    .filter((entry): entry is StoryTextOverlayWordTiming => Boolean(entry));
}

export function applyForcedAlignmentToStoryCaptions(
  captions: StoryTextOverlayCaption[],
  response: ElevenLabsForcedAlignmentResponse | null | undefined
): {
  captions: StoryTextOverlayCaption[];
  alignment: StoryTextOverlayAlignment;
} {
  const alignedWords = normalizeAlignmentWords(response?.words);
  let cursor = 0;
  const timedCaptions = captions.map((caption, index) => {
    const remainingCaptions = captions.length - index;
    const remainingWords = alignedWords.length - cursor;
    const preferredCount = countWords(caption.text);
    const sliceCount = index === captions.length - 1
      ? remainingWords
      : Math.max(0, Math.min(remainingWords - Math.max(0, remainingCaptions - 1), preferredCount));
    const words = alignedWords.slice(cursor, cursor + sliceCount);
    cursor += sliceCount;
    if (words.length === 0) return caption;
    return {
      ...caption,
      startMs: words[0].startMs,
      endMs: words[words.length - 1].endMs,
      wordTimings: words,
    };
  });

  const textHighlightSupported = timedCaptions.some((caption) => caption.wordTimings?.length);
  return {
    captions: timedCaptions,
    alignment: buildStoryTextOverlayAlignment({
      source: textHighlightSupported ? 'elevenlabs_forced_alignment' : 'none',
      textHighlightSupported,
      alignedWordCount: alignedWords.length,
      loss: response?.loss,
    }),
  };
}

export function buildStoryTextOverlayAlignment(input: {
  source: StoryTextOverlayTimestampSource;
  textHighlightSupported: boolean;
  alignedWordCount: number;
  loss?: number;
  error?: string;
}): StoryTextOverlayAlignment {
  return {
    version: 1,
    provider: 'elevenlabs',
    source: input.source,
    textHighlightSupported: input.textHighlightSupported,
    alignedWordCount: Math.max(0, Math.round(input.alignedWordCount)),
    ...(Number.isFinite(input.loss) ? { loss: input.loss } : {}),
    ...(input.error ? { error: input.error.slice(0, 240) } : {}),
    createdAt: new Date().toISOString(),
  };
}
