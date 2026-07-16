import type { Character, StoryBeat, StorySession } from '@/lib/types/story';
import { getPreludeText } from '@/lib/ai/story-config';
import { buildWorldAnchorSummaries } from '@/lib/references/reference-routing';

interface PromptCharacterAnchor {
  id: string;
  name: string;
  type: string;
  appearanceSummary: string;
  personalitySummary: string;
  introducedAtBeat: number;
  seenInBeats: number[];
  hasReferencePortrait: boolean;
  // Reference Personalization: an unnamed uploaded reference carries a
  // placeholder name the LLM may replace with a real one (keeping the id). The
  // validator skips the rename lock while this is true; prompts read it as an
  // explicit instruction to name the character.
  nameIsPlaceholder?: boolean;
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
  // Pack 2 episodic continuity: series canon and memory carried from earlier
  // episodes of the same branch.
  episodeNumber?: number;
  seriesBible?: string;
  seriesJournal?: string;
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
  };
  // Reference Personalization: adopted world references (visual canon). Present
  // only when the story uses world references; absent otherwise.
  worldReferences?: { label: string; anchor: string }[];
  usedCharacterNames: string[];
  castRegistry: PromptCharacterAnchor[];
  choiceHistory: string[];
  openThreads: string[];
  recentBeats: StoryBibleBeatSummary[];
  currentBeatGoal: string;
  endingForecast: string[];
}

const CHOICE_HISTORY_LIMIT = 4;
const OPEN_THREADS_LIMIT = 4;
const RECENT_BEATS_LIMIT = 3;
const SERIES_BIBLE_MAX_LENGTH = 2000;
const SERIES_JOURNAL_MAX_LENGTH = 1200;
const CHARACTER_APPEARANCE_MAX_LENGTH = 120;
const CHARACTER_PERSONALITY_MAX_LENGTH = 100;
const STORY_TEXT_EXCERPT_MAX_LENGTH = 160;
const IMAGE_PROMPT_EXCERPT_MAX_LENGTH = 140;
const SCENE_SUMMARY_MAX_LENGTH = 140;
const NEXT_BEAT_GOAL_MAX_LENGTH = 120;
const CONTINUITY_NOTE_MAX_LENGTH = 100;
const ENDING_FORECAST_MAX_LENGTH = 60;
const VISUAL_DIRECTION_MAX_LENGTH = 120;
const WORLD_ANCHOR_MAX_LENGTH = 220;

export function sanitizeCharactersForPrompt(characters: Character[] | undefined | null): Array<Record<string, unknown>> {
  return (characters || []).map((character) => ({
    id: character.id,
    name: character.name,
    type: character.type,
    appearanceSummary: truncateText(character.appearanceSummary || '', CHARACTER_APPEARANCE_MAX_LENGTH),
    personalitySummary: truncateText(character.personalitySummary || '', CHARACTER_PERSONALITY_MAX_LENGTH),
    hasReferencePortrait: Boolean(
      character.portraitBase64 ||
      character.portraitUrl ||
      character.referenceSheetUrl
    ),
  }));
}

export function buildPromptCharacterAnchors(characters: Character[] | undefined | null): string {
  return stringifyCompact(sanitizeCharactersForPrompt(characters));
}

export function formatStoryBible(
  sessionState: Partial<StorySession> | null,
  selectedOptionLabel?: string
): string {
  return stringifyCompact(buildStoryBible(sessionState, selectedOptionLabel));
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
  const storyTextParts = Array.isArray(beat.storyTextParts) ? beat.storyTextParts : [];

  if (!beat.title?.trim()) issues.push('title is missing');
  if (!beat.storyText?.trim()) issues.push('storyText is missing');
  if (storyTextParts.length !== 4) {
    issues.push('storyTextParts must contain exactly 4 hidden narration chunks');
  } else if (storyTextParts.some((part) => typeof part !== 'string' || !part.trim())) {
    issues.push('storyTextParts must contain 4 non-empty strings');
  }
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
    // A placeholder-named uploaded reference ("Character N") is expected to be
    // named by the LLM on beat 1 — allow that first naming (id preserved). The
    // flag is cleared once a real name lands, so the rename lock re-engages on
    // every later beat.
    if (
      existingCharacter &&
      !existingCharacter.nameIsPlaceholder &&
      normalizeName(existingCharacter.name) !== normalizedName
    ) {
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
    // Pack 2: a pre-seeded roster (episode carry / library mixing) populates
    // existingCharacters before beat 1 — those characters are not "new" and
    // must not be flagged (the check above already rejects that), so exempt
    // them here instead of demanding contradictory flags.
    const missingInitialFlags = beat.characters
      .filter((character) => character.name?.trim())
      .map((character) => character.id)
      .filter((characterId) => !newCharacterIds.includes(characterId))
      .filter((characterId) => !existingCharacters.has(characterId));
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
  const worldReferences = buildWorldAnchorSummaries(sessionState?.storyConfig?.references?.worlds).map(
    (entry) => ({ label: entry.label, anchor: truncateText(entry.anchor, WORLD_ANCHOR_MAX_LENGTH) })
  );

  const episodeContext = sessionState?.episodeContext;

  return {
    currentBeat: sessionState?.currentBeat || 0,
    maxBeats: sessionState?.storyConfig?.maxBeats || sessionState?.maxBeats || 6,
    status: sessionState?.status || 'active',
    selectedOptionLabel: selectedOptionLabel || 'None yet - first beat',
    ...(getPreludeText(sessionState?.storyConfig) ? { authoredPrelude: getPreludeText(sessionState?.storyConfig) } : {}),
    ...(episodeContext ? { episodeNumber: episodeContext.episodeNumber } : {}),
    ...(episodeContext?.bibleText
      ? { seriesBible: truncateText(episodeContext.bibleText, SERIES_BIBLE_MAX_LENGTH) }
      : {}),
    ...(episodeContext?.journalSummary
      ? { seriesJournal: truncateText(episodeContext.journalSummary, SERIES_JOURNAL_MAX_LENGTH) }
      : {}),
    worldFacts: {
      language: sessionState?.storyConfig?.language || 'english',
      ageGroup: sessionState?.storyConfig?.ageGroup || sessionState?.targetAge || 'all_ages',
      settingCountry: sessionState?.storyConfig?.settingCountry || 'generic',
      world: sessionState?.setting?.world || 'unknown',
      timeOfDay: sessionState?.setting?.timeOfDay || 'unknown',
      mood: sessionState?.setting?.mood || 'unknown',
    },
    visualDirection: {
      summary: truncateText(sessionState?.visualStyle || '', VISUAL_DIRECTION_MAX_LENGTH),
    },
    ...(worldReferences.length > 0 ? { worldReferences } : {}),
    usedCharacterNames: castRegistry.map((character) => character.name),
    castRegistry,
    choiceHistory: (sessionState?.choiceHistory || [])
      .filter(Boolean)
      .map((entry) => truncateText(entry, NEXT_BEAT_GOAL_MAX_LENGTH))
      .slice(-CHOICE_HISTORY_LIMIT),
    openThreads,
    recentBeats: beats.slice(-RECENT_BEATS_LIMIT),
    currentBeatGoal: truncateText(currentBeat?.nextBeatGoal || '', NEXT_BEAT_GOAL_MAX_LENGTH),
    endingForecast: (currentBeat?.endingForecast || [])
      .slice(0, 3)
      .map((entry) => truncateText(entry, ENDING_FORECAST_MAX_LENGTH)),
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
        appearanceSummary: truncateText(character.appearanceSummary || '', CHARACTER_APPEARANCE_MAX_LENGTH),
        personalitySummary: truncateText(character.personalitySummary || '', CHARACTER_PERSONALITY_MAX_LENGTH),
        introducedAtBeat: existing?.introducedAtBeat || beat.beatNumber || 1,
        seenInBeats: nextSeenInBeats,
        hasReferencePortrait: Boolean(
          character.portraitBase64 ||
          character.portraitUrl ||
          character.referenceSheetUrl ||
          existing?.hasReferencePortrait
        ),
        ...(character.nameIsPlaceholder ? { nameIsPlaceholder: true } : {}),
      });
    }
  }

  for (const character of sessionState?.characters || []) {
    if (!registry.has(character.id)) {
      registry.set(character.id, {
        id: character.id,
        name: character.name,
        type: character.type,
        appearanceSummary: truncateText(character.appearanceSummary || '', CHARACTER_APPEARANCE_MAX_LENGTH),
        personalitySummary: truncateText(character.personalitySummary || '', CHARACTER_PERSONALITY_MAX_LENGTH),
        introducedAtBeat: sessionState?.currentBeat || 1,
        seenInBeats: uniqueNumbers([sessionState?.currentBeat || 1]),
        hasReferencePortrait: Boolean(
          character.portraitBase64 ||
          character.portraitUrl ||
          character.referenceSheetUrl
        ),
        ...(character.nameIsPlaceholder ? { nameIsPlaceholder: true } : {}),
      });
    }
  }

  return Array.from(registry.values()).sort((left, right) => left.introducedAtBeat - right.introducedAtBeat);
}

function sanitizeBeatForBible(beat: StoryBeat): StoryBibleBeatSummary {
  return {
    beatNumber: beat.beatNumber,
    title: truncateText(beat.title, 80),
    sceneSummary: truncateText(beat.sceneSummary, SCENE_SUMMARY_MAX_LENGTH),
    storyTextExcerpt: truncateText(beat.storyText, STORY_TEXT_EXCERPT_MAX_LENGTH),
    nextBeatGoal: truncateText(beat.nextBeatGoal, NEXT_BEAT_GOAL_MAX_LENGTH),
    continuityNotes: (beat.continuityNotes || [])
      .slice(0, 2)
      .map((note) => truncateText(note, CONTINUITY_NOTE_MAX_LENGTH)),
    imagePromptExcerpt: truncateText(beat.imagePrompt, IMAGE_PROMPT_EXCERPT_MAX_LENGTH),
    endingForecast: (beat.endingForecast || [])
      .slice(0, 3)
      .map((entry) => truncateText(entry, ENDING_FORECAST_MAX_LENGTH)),
    isEnding: beat.isEnding,
    isStoryboard: Boolean(beat.isStoryboard),
  };
}

function buildOpenThreads(
  sessionState: Partial<StorySession> | null,
  beats: StoryBibleBeatSummary[]
): string[] {
  const explicitThreads = (sessionState?.openThreads || [])
    .filter(Boolean)
    .map((entry) => truncateText(entry, CONTINUITY_NOTE_MAX_LENGTH));
  if (explicitThreads.length > 0) {
    return explicitThreads.slice(-OPEN_THREADS_LIMIT);
  }

  const derived = beats
    .filter((beat) => !beat.isEnding)
    .flatMap((beat) => [beat.nextBeatGoal, ...beat.continuityNotes])
    .map((entry) => entry.trim())
    .filter(Boolean);

  return uniqueStrings(derived).slice(-OPEN_THREADS_LIMIT);
}

function stringifyCompact(value: unknown): string {
  return JSON.stringify(value);
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
