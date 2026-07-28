interface SourceWord {
  value: string;
  start: number;
  end: number;
}

function collectSourceWords(sourceText: string): SourceWord[] {
  return Array.from(sourceText.matchAll(/\S+/gu), (match) => ({
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function boundaryScore(
  sourceText: string,
  words: SourceWord[],
  boundaryWordIndex: number,
  targetWordIndex: number,
  idealWordsPerBeat: number
): number {
  const previousWord = words[boundaryWordIndex - 1];
  const nextWord = words[boundaryWordIndex];
  const separator = sourceText.slice(previousWord.end, nextWord.start);
  const distance = Math.abs(boundaryWordIndex - targetWordIndex);
  const paragraphBonus = /\r?\n\s*\r?\n/u.test(separator) ? idealWordsPerBeat * 0.7 : 0;
  const lineBonus = !paragraphBonus && /\r?\n/u.test(separator) ? idealWordsPerBeat * 0.35 : 0;
  const sentenceBonus = /[.!?…]["'’”)\]]*$/u.test(previousWord.value) ? idealWordsPerBeat * 0.45 : 0;

  return distance - paragraphBonus - lineBonus - sentenceBonus;
}

/**
 * Splits source material into exactly the requested number of contiguous beats.
 * The returned chunks retain every source word and punctuation mark in order;
 * only whitespace at the boundaries between beats is trimmed.
 */
export function splitStrictSeedSource(sourceText: string, beatCount: number): string[] {
  const source = sourceText.trim();
  const normalizedBeatCount = Math.round(beatCount);
  if (!source) {
    throw new Error('Add source text before previewing a Strictly Follow story.');
  }
  if (!Number.isFinite(normalizedBeatCount) || normalizedBeatCount < 1) {
    throw new Error('Strictly Follow requires a valid beat count.');
  }

  const words = collectSourceWords(source);
  if (words.length < normalizedBeatCount) {
    throw new Error(
      `Strictly Follow needs at least ${normalizedBeatCount} words to create ${normalizedBeatCount} non-empty beats.`
    );
  }

  const idealWordsPerBeat = words.length / normalizedBeatCount;
  const boundaryWordIndexes: number[] = [];
  let previousBoundary = 0;

  for (let beatIndex = 1; beatIndex < normalizedBeatCount; beatIndex += 1) {
    const remainingBoundaries = normalizedBeatCount - beatIndex;
    const minimumBoundary = previousBoundary + 1;
    const maximumBoundary = words.length - remainingBoundaries;
    const targetBoundary = Math.min(
      maximumBoundary,
      Math.max(minimumBoundary, Math.round((words.length * beatIndex) / normalizedBeatCount))
    );

    let bestBoundary = targetBoundary;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let candidate = minimumBoundary; candidate <= maximumBoundary; candidate += 1) {
      const score = boundaryScore(source, words, candidate, targetBoundary, idealWordsPerBeat);
      if (score < bestScore) {
        bestBoundary = candidate;
        bestScore = score;
      }
    }

    boundaryWordIndexes.push(bestBoundary);
    previousBoundary = bestBoundary;
  }

  const boundaryCharacters = boundaryWordIndexes.map((wordIndex) => words[wordIndex].start);
  const segments: string[] = [];
  let startCharacter = 0;
  for (const boundaryCharacter of boundaryCharacters) {
    segments.push(source.slice(startCharacter, boundaryCharacter).trim());
    startCharacter = boundaryCharacter;
  }
  segments.push(source.slice(startCharacter).trim());

  return segments;
}
