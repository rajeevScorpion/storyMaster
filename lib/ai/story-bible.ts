import type { Character, StoryBeat, StorySession } from '@/lib/types/story';
import { getPreludeText } from '@/lib/ai/story-config';

interface PromptCharacterAnchor {
  id: string;
  name: string;
  type: string;
  appearanceSummary: string;
  personalitySummary: string;
  introducedAtBeat: number;
  seenInBeats: number[];
  hasReferencePortrait: boolean;
}

interface StoryBibleBeatSummary {
  beatNumber: number;
  title: string;
  sceneSummary: string;
  storyTextExcerpt: string;
  nextBeatGoal: string;
  continuityNotes: string[];
  imagePromptExcerpt: string;
  endingForecast: string[];
  isEnding: boolean;
  isStoryboard: boolean;
}

interface StoryBible {
  currentBeat: number;
  maxBeats: number;
  status: string;
  selectedOptionLabel: string;
  authoredPrelude?: string;
  worldFacts: {
    language: string;
    ageGroup: string;
    settingCountry: string;
    world: string;
    timeOfDay: string;
    mood: string;
  };
  visualDirection: {
    summary: string;
    storyboardMode: boolean;
  };
  usedCharacterNames: string[];
  castRegistry: PromptCharacterAnchor[];
  choiceHistory: string[];
  openThreads: string[];
  recentBeats: StoryBibleBeatSummary[];
  currentBeatGoal: string;
  endingForecast: string[];
}

export function sanitizeCharactersForPrompt(characters: Character[] | undefined | null): Array<Record<string, unknown>> {
  return (characters || []).map((character) => ({
    id: character.id,
    name: character.name,
    type: character.type,
    appearanceSummary: character.appearanceSummary,
    personalitySummary: character.personalitySummary,
    hasReferencePortrait: Boolean(character.portraitBase64 || character.portraitUrl),
  }));
}

export function buildPromptCharacterAnchors(characters: Character[] | undefined | null): string {
  return JSON.stringify(sanitizeCharactersForPrompt(characters), null, 2);
}

export function formatStoryBible(
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string
): string {
  return JSON.stringify(buildStoryBible(sessionState, selectedOptionLabel), null, 2);
}

export function validateGeneratedBeat(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null
): string[] {
  const issues: string[] = [];
  const maxBeats = sessionState?.storyConfig?.maxBeats || sessionState?.maxBeats || 6;
  const expectedBeatNumber = Math.max(1, (sessionState?.currentBeat || 0) + 1);
  const existingCharacters = new Map(
    buildCastRegistry(sessionState).map((character) => [character.id, character])
  );
  const seenNames = new Map<string, string>();
  const seenIds = new Set<string>();
  const newCharacterIds = Array.isArray(beat.newCharacterIds) ? beat.newCharacterIds : [];
  const changedCharacterIds = Array.isArray(beat.changedCharacterIds) ? beat.changedCharacterIds : [];

  if (!beat.title?.trim()) issues.push('title is missing');
  if (!beat.storyText?.trim()) issues.push('storyText is missing');
  if (!beat.sceneSummary?.trim()) issues.push('sceneSummary is missing');
  if (!beat.imagePrompt?.trim()) issues.push('imagePrompt is missing');
  if (!beat.nextBeatGoal?.trim()) issues.push('nextBeatGoal is missing');
  if (!Array.isArray(beat.newCharacterIds)) issues.push('newCharacterIds must be an array');
  if (!Array.isArray(beat.changedCharacterIds)) issues.push('changedCharacterIds must be an array');

  if (beat.beatNumber !== expectedBeatNumber) {
    issues.push(`beatNumber should be ${expectedBeatNumber} but was ${beat.beatNumber}`);
  }

  if (beat.beatNumber > maxBeats) {
    issues.push(`beatNumber exceeds configured maxBeats (${maxBeats})`);
  }

  if (!Array.isArray(beat.options)) {
    issues.push('options must be an array');
    return issues;
  }

  if (beat.isEnding) {
    if (beat.options.length !== 0) {
      issues.push('ending beats must return an empty options array');
    }
  } else if (beat.options.length < 3 || beat.options.length > 4) {
    issues.push('non-ending beats must return 3 or 4 options');
  }

  if (beat.characters.length === 0) {
    issues.push('characters array is empty');
  }

  const beatCharacterIds = new Set(beat.characters.map((character) => character.id));

  for (const character of beat.characters) {
    if (!character.id?.trim()) issues.push('character id is missing');
    if (!character.name?.trim()) issues.push(`character ${character.id || '(unknown)'} is missing a name`);
    if (!character.appearanceSummary?.trim()) issues.push(`character ${character.name || character.id} is missing appearanceSummary`);
    if (!character.personalitySummary?.trim()) issues.push(`character ${character.name || character.id} is missing personalitySummary`);

    if (seenIds.has(character.id)) {
      issues.push(`character id ${character.id} is duplicated in the beat`);
    }
    seenIds.add(character.id);

    const normalizedName = normalizeName(character.name);
    const priorOwner = seenNames.get(normalizedName);
    if (priorOwner && priorOwner !== character.id) {
      issues.push(`character name "${character.name}" is reused for multiple ids in the beat`);
    } else if (normalizedName) {
      seenNames.set(normalizedName, character.id);
    }

    const existingCharacter = existingCharacters.get(character.id);
    if (existingCharacter && normalizeName(existingCharacter.name) !== normalizedName) {
      issues.push(`character id ${character.id} was renamed from "${existingCharacter.name}" to "${character.name}"`);
    }

    if (!existingCharacter && normalizedName) {
      const conflictingExisting = Array.from(existingCharacters.values()).find(
        (candidate) => normalizeName(candidate.name) === normalizedName && candidate.id !== character.id
      );
      if (conflictingExisting) {
        issues.push(`new character "${character.name}" reuses an existing cast name`);
      }
    }
  }

  for (const characterId of newCharacterIds) {
    if (!beatCharacterIds.has(characterId)) {
      issues.push(`newCharacterIds references missing character id ${characterId}`);
    }
    if (existingCharacters.has(characterId)) {
      issues.push(`newCharacterIds includes existing character id ${characterId}`);
    }
  }

  for (const characterId of changedCharacterIds) {
    if (!beatCharacterIds.has(characterId)) {
      issues.push(`changedCharacterIds references missing character id ${characterId}`);
    }
  }

  if (!sessionState?.beats || sessionState.beats.length === 0) {
    const missingInitialFlags = beat.characters
      .filter((character) => character.name?.trim())
      .map((character) => character.id)
      .filter((characterId) => !newCharacterIds.includes(characterId));
    if (missingInitialFlags.length > 0) {
      issues.push(`beat 1 must flag all named characters in newCharacterIds: ${missingInitialFlags.join(', ')}`);
    }
  }

  return issues;
}

export function buildValidationRepairNote(issues: string[]): string {
  if (issues.length === 0) return '';
  return [
    'Repair the next response before sending it.',
    'The previous attempt had these issues:',
    ...issues.map((issue) => `- ${issue}`),
    'Return a corrected response that preserves the story intent while fixing every issue above.',
  ].join('\n');
}

function buildStoryBible(
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string
): StoryBible {
  const beats = (sessionState?.beats || []).map((beat) => sanitizeBeatForBible(beat));
  const currentBeat = beats[beats.length - 1];
  const castRegistry = buildCastRegistry(sessionState);
  const openThreads = buildOpenThreads(sessionState, beats);

  return {
    currentBeat: sessionState?.currentBeat || 0,
    maxBeats: sessionState?.storyConfig?.maxBeats || sessionState?.maxBeats || 6,
    status: sessionState?.status || 'active',
    selectedOptionLabel: selectedOptionLabel || 'None yet - first beat',
    ...(getPreludeText(sessionState?.storyConfig) ? { authoredPrelude: getPreludeText(sessionState?.storyConfig) } : {}),
    worldFacts: {
      language: sessionState?.storyConfig?.language || 'english',
      ageGroup: sessionState?.storyConfig?.ageGroup || sessionState?.targetAge || 'all_ages',
      settingCountry: sessionState?.storyConfig?.settingCountry || 'generic',
      world: sessionState?.setting?.world || 'unknown',
      timeOfDay: sessionState?.setting?.timeOfDay || 'unknown',
      mood: sessionState?.setting?.mood || 'unknown',
    },
    visualDirection: {
      summary: sessionState?.visualStyle || '',
      storyboardMode: Boolean(currentBeat?.isStoryboard),
    },
    usedCharacterNames: castRegistry.map((character) => character.name),
    castRegistry,
    choiceHistory: sessionState?.choiceHistory || [],
    openThreads,
    recentBeats: beats.slice(-4),
    currentBeatGoal: currentBeat?.nextBeatGoal || '',
    endingForecast: currentBeat?.endingForecast || [],
  };
}

function buildCastRegistry(sessionState: Partial<StorySession> | null): PromptCharacterAnchor[] {
  const registry = new Map<string, PromptCharacterAnchor>();

  for (const beat of sessionState?.beats || []) {
    for (const character of beat.characters || []) {
      const existing = registry.get(character.id);
      const nextSeenInBeats = uniqueNumbers([...(existing?.seenInBeats || []), beat.beatNumber]);
      registry.set(character.id, {
        id: character.id,
        name: character.name,
        type: character.type,
        appearanceSummary: character.appearanceSummary,
        personalitySummary: character.personalitySummary,
        introducedAtBeat: existing?.introducedAtBeat || beat.beatNumber || 1,
        seenInBeats: nextSeenInBeats,
        hasReferencePortrait: Boolean(
          character.portraitBase64 ||
          character.portraitUrl ||
          existing?.hasReferencePortrait
        ),
      });
    }
  }

  for (const character of sessionState?.characters || []) {
    if (!registry.has(character.id)) {
      registry.set(character.id, {
        id: character.id,
        name: character.name,
        type: character.type,
        appearanceSummary: character.appearanceSummary,
        personalitySummary: character.personalitySummary,
        introducedAtBeat: sessionState?.currentBeat || 1,
        seenInBeats: uniqueNumbers([sessionState?.currentBeat || 1]),
        hasReferencePortrait: Boolean(character.portraitBase64 || character.portraitUrl),
      });
    }
  }

  return Array.from(registry.values()).sort((left, right) => left.introducedAtBeat - right.introducedAtBeat);
}

function sanitizeBeatForBible(beat: StoryBeat): StoryBibleBeatSummary {
  return {
    beatNumber: beat.beatNumber,
    title: beat.title,
    sceneSummary: beat.sceneSummary,
    storyTextExcerpt: truncateText(beat.storyText, 220),
    nextBeatGoal: beat.nextBeatGoal,
    continuityNotes: (beat.continuityNotes || []).slice(0, 3),
    imagePromptExcerpt: truncateText(beat.imagePrompt, 220),
    endingForecast: (beat.endingForecast || []).slice(0, 4),
    isEnding: beat.isEnding,
    isStoryboard: Boolean(beat.isStoryboard),
  };
}

function buildOpenThreads(
  sessionState: Partial<StorySession> | null,
  beats: StoryBibleBeatSummary[]
): string[] {
  const explicitThreads = (sessionState?.openThreads || []).filter(Boolean);
  if (explicitThreads.length > 0) {
    return explicitThreads.slice(0, 6);
  }

  const derived = beats
    .filter((beat) => !beat.isEnding)
    .flatMap((beat) => [beat.nextBeatGoal, ...beat.continuityNotes])
    .map((entry) => entry.trim())
    .filter(Boolean);

  return uniqueStrings(derived).slice(-6);
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}
