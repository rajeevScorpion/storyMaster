export const REEL_PANEL_COUNT = 4;

const SENTENCE_END_PATTERN = /[.!?।॥۔؟…]+(?:["'”’)\]}]+)?/gu;
const COMPLETE_SENTENCE_END_PATTERN = /[.!?।॥۔؟…]+(?:["'”’)\]}]+)?$/u;
const INDIC_SCRIPT_PATTERN = /[\u0900-\u097F\u0980-\u09FF\u0A80-\u0AFF]/u;
const ARABIC_SCRIPT_PATTERN = /[\u0600-\u06FF]/u;

export function normalizeCaptionWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hasCompleteCaptionEnding(value: string): boolean {
  return COMPLETE_SENTENCE_END_PATTERN.test(normalizeCaptionWhitespace(value));
}

function inferSentenceTerminator(value: string): string {
  if (ARABIC_SCRIPT_PATTERN.test(value)) return '۔';
  if (INDIC_SCRIPT_PATTERN.test(value)) return '।';
  return '.';
}

export function ensureCompleteCaptionSentence(value: string): string {
  const trimmed = normalizeCaptionWhitespace(value);
  if (!trimmed) return '';
  if (hasCompleteCaptionEnding(trimmed)) return trimmed;
  return `${trimmed}${inferSentenceTerminator(trimmed)}`;
}

export function splitCompleteCaptionSentences(value: string): string[] {
  const text = normalizeCaptionWhitespace(value);
  if (!text) return [];

  const sentences: string[] = [];
  let startIndex = 0;

  for (const match of text.matchAll(SENTENCE_END_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const endIndex = matchIndex + match[0].length;
    const sentence = text.slice(startIndex, endIndex).trim();
    if (sentence) sentences.push(ensureCompleteCaptionSentence(sentence));
    startIndex = endIndex;
    while (startIndex < text.length && /\s/u.test(text[startIndex])) startIndex += 1;
  }

  const tail = text.slice(startIndex).trim();
  if (tail) sentences.push(ensureCompleteCaptionSentence(tail));

  return sentences;
}

function groupSentencesIntoPanels(sentences: string[], count: number): string[] {
  if (sentences.length <= count) {
    return [
      ...sentences.map(ensureCompleteCaptionSentence),
      ...Array.from({ length: count - sentences.length }, () => ''),
    ];
  }

  const panels: string[] = [];
  let sentenceIndex = 0;

  for (let panelIndex = 0; panelIndex < count; panelIndex += 1) {
    const remainingPanels = count - panelIndex;
    const remainingSentences = sentences.length - sentenceIndex;

    if (remainingPanels === 1 || remainingSentences <= 1) {
      panels.push(sentences.slice(sentenceIndex).join(' '));
      sentenceIndex = sentences.length;
      break;
    }

    const remainingTextLength = sentences
      .slice(sentenceIndex)
      .reduce((sum, sentence) => sum + sentence.length, 0);
    const targetLength = remainingTextLength / remainingPanels;
    const group: string[] = [];

    while (sentenceIndex < sentences.length) {
      const nextSentence = sentences[sentenceIndex];
      const sentencesLeftAfterNext = sentences.length - sentenceIndex - 1;
      const panelsLeftAfterCurrent = remainingPanels - 1;
      group.push(nextSentence);
      sentenceIndex += 1;

      const groupLength = group.reduce((sum, sentence) => sum + sentence.length, 0);
      if (groupLength >= targetLength && sentencesLeftAfterNext >= panelsLeftAfterCurrent) {
        break;
      }
      if (sentencesLeftAfterNext <= panelsLeftAfterCurrent) {
        break;
      }
    }

    panels.push(group.join(' '));
  }

  return [
    ...panels.map(ensureCompleteCaptionSentence),
    ...Array.from({ length: Math.max(0, count - panels.length) }, () => ''),
  ].slice(0, count);
}

export function splitTextIntoCompleteCaptionPanels(value: string, count = REEL_PANEL_COUNT): string[] {
  const normalizedCount = Math.max(1, Math.round(count));
  const sentences = splitCompleteCaptionSentences(value);
  if (sentences.length === 0) {
    return Array.from({ length: normalizedCount }, () => '');
  }
  return groupSentencesIntoPanels(sentences, normalizedCount);
}
