import type {
  Character,
  CharacterNameSource,
  StoryBeat,
  StorySession,
} from '@/lib/types/story';

export type { CharacterNameSource } from '@/lib/types/story';

export const CHARACTER_NAME_HISTORY_LIMIT = 75;
export const CHARACTER_VISUAL_HISTORY_LIMIT = 10;

export interface RecentCharacterNoveltyEntry {
  displayName: string;
  normalizedName: string;
  appearanceSignature?: string;
}

export interface CharacterNoveltyContext {
  recentCharacters: RecentCharacterNoveltyEntry[];
}

export const EMPTY_CHARACTER_NOVELTY_CONTEXT: CharacterNoveltyContext = {
  recentCharacters: [],
};

// Guidance-only defaults. Account history is the hard constraint; this short
// list nudges the model away from its most obvious generic storybook fallbacks.
const GENERIC_STORYBOOK_NAME_GUIDANCE = [
  'Milo',
  'Luna',
  'Leo',
  'Pip',
  'Finn',
  'Aria',
  'Nova',
  'Max',
];

const NAME_TITLES = new Set([
  'captain', 'doctor', 'dr', 'king', 'lady', 'lord', 'miss', 'mister', 'mr',
  'mrs', 'prince', 'princess', 'professor', 'queen', 'sir',
]);

const APPEARANCE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'character', 'has', 'in', 'is', 'of',
  'the', 'their', 'they', 'to', 'wearing', 'with',
]);

export function normalizeCharacterName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coreName(value: string): string {
  const tokens = normalizeCharacterName(value).split(' ').filter(Boolean);
  while (tokens.length > 1 && NAME_TITLES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length];
}

export function findSimilarRecentName(
  candidate: string,
  recentCharacters: RecentCharacterNoveltyEntry[]
): RecentCharacterNoveltyEntry | undefined {
  const normalizedCandidate = coreName(candidate);
  if (!normalizedCandidate) return undefined;

  return recentCharacters.find((entry) => {
    const normalizedPrior = coreName(entry.normalizedName || entry.displayName);
    if (!normalizedPrior) return false;
    if (normalizedCandidate === normalizedPrior) return true;

    const candidateTokens = normalizedCandidate.split(' ');
    const priorTokens = normalizedPrior.split(' ');
    if (
      (candidateTokens.length === 1
        && candidateTokens[0].length >= 4
        && priorTokens.includes(candidateTokens[0]))
      || (priorTokens.length === 1
        && priorTokens[0].length >= 4
        && candidateTokens.includes(priorTokens[0]))
    ) {
      return true;
    }

    return normalizedCandidate.length >= 4
      && normalizedPrior.length >= 4
      && normalizedCandidate[0] === normalizedPrior[0]
      && boundedEditDistance(normalizedCandidate, normalizedPrior, 1) <= 1;
  });
}

function appearanceTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !APPEARANCE_STOP_WORDS.has(token))
  );
}

export function appearanceSimilarity(left: string, right: string): number {
  const leftTokens = appearanceTokens(left);
  const rightTokens = appearanceTokens(right);
  if (leftTokens.size < 5 || rightTokens.size < 5) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

export function findSimilarRecentAppearance(
  candidate: string,
  recentCharacters: RecentCharacterNoveltyEntry[]
): RecentCharacterNoveltyEntry | undefined {
  const normalizedCandidate = candidate.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalizedCandidate) return undefined;

  return recentCharacters
    .filter((entry) => Boolean(entry.appearanceSignature?.trim()))
    .slice(0, CHARACTER_VISUAL_HISTORY_LIMIT)
    .find((entry) => {
      const prior = entry.appearanceSignature?.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!prior) return false;
      return normalizedCandidate === prior || appearanceSimilarity(normalizedCandidate, prior) >= 0.78;
    });
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildCharacterNoveltyInstructions(
  context: CharacterNoveltyContext,
  protectedCharacters: Character[]
): string {
  const protectedNames = Array.from(new Set(
    protectedCharacters
      .filter((character) => !character.nameIsPlaceholder)
      .map((character) => character.name?.trim())
      .filter(Boolean)
  ));
  const recentNames = Array.from(new Set(
    context.recentCharacters.map((entry) => entry.displayName.trim()).filter(Boolean)
  )).slice(0, CHARACTER_NAME_HISTORY_LIMIT);
  const recentAppearances = context.recentCharacters
    .map((entry) => entry.appearanceSignature?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, CHARACTER_VISUAL_HISTORY_LIMIT)
    .map((entry) => compact(entry, 140));

  return [
    'Character novelty policy:',
    '- This policy applies only to newly invented named characters. Existing, imported, episodic, library, source-authored, and explicitly user-requested names are protected and must be preserved.',
    `- Protected current names: ${protectedNames.length > 0 ? protectedNames.join(' | ') : '(none)'}.`,
    `- Do not invent a name that matches or closely imitates these recently used account names: ${recentNames.length > 0 ? recentNames.join(' | ') : '(no recent names)'}.`,
    `- Also avoid generic storybook defaults unless the user explicitly requested one: ${GENERIC_STORYBOOK_NAME_GUIDANCE.join(' | ')}.`,
    '- Invent culturally and linguistically appropriate names; vary initials, syllable patterns, and name lengths across the cast.',
    '- Give every newly invented character a visually distinctive persona. Vary at least three relevant axes such as silhouette/body form, age/species, coloring/hair/fur, clothing, signature accessory, posture, or movement style.',
    ...(recentAppearances.length > 0
      ? [
          'Recent visual personas to avoid closely repeating:',
          ...recentAppearances.map((appearance) => `- ${appearance}`),
        ]
      : []),
  ].join('\n');
}

function textExplicitlyContainsName(text: string, name: string): boolean {
  const normalizedText = normalizeCharacterName(text);
  const normalizedName = normalizeCharacterName(name);
  if (!normalizedText || !normalizedName) return false;
  return ` ${normalizedText} `.includes(` ${normalizedName} `);
}

function existingCharacters(sessionState: Partial<StorySession> | null): Character[] {
  const byId = new Map<string, Character>();
  for (const character of sessionState?.characters || []) byId.set(character.id, character);
  for (const beat of sessionState?.beats || []) {
    for (const character of beat.characters || []) byId.set(character.id, character);
  }
  return Array.from(byId.values());
}

export function validateCharacterNovelty(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null,
  userPrompt: string,
  context: CharacterNoveltyContext
): string[] {
  if (!Array.isArray(beat.characters)) return [];

  const issues: string[] = [];
  const priorCharacters = existingCharacters(sessionState);
  const lockedPriorCharacters = priorCharacters.filter((character) => !character.nameIsPlaceholder);
  const existingIds = new Set(lockedPriorCharacters.map((character) => character.id));
  const existingNames = new Set(
    lockedPriorCharacters.map((character) => normalizeCharacterName(character.name))
  );
  const authoredContext = [
    userPrompt,
    sessionState?.userPrompt || '',
    JSON.stringify(sessionState?.storyConfig?.authoring || {}),
  ].join('\n');
  const protectedNameEntries: RecentCharacterNoveltyEntry[] = lockedPriorCharacters.map((character) => ({
    displayName: character.name,
    normalizedName: normalizeCharacterName(character.name),
  }));
  const inventionsThisBeat: RecentCharacterNoveltyEntry[] = [];

  for (const character of beat.characters) {
    const normalizedName = normalizeCharacterName(character.name || '');
    const isExisting = existingIds.has(character.id) || existingNames.has(normalizedName);
    const explicitlyRequested = textExplicitlyContainsName(authoredContext, character.name || '');
    if (isExisting || explicitlyRequested) {
      protectedNameEntries.push({
        displayName: character.name,
        normalizedName,
      });
      continue;
    }

    const similarCastName = findSimilarRecentName(
      character.name || '',
      [...protectedNameEntries, ...inventionsThisBeat]
    );
    if (similarCastName) {
      issues.push(
        `newly invented character name "${character.name}" is too similar to current cast name "${similarCastName.displayName}"; choose a clearly distinct name and update it consistently everywhere`
      );
    }

    const similarName = findSimilarRecentName(character.name || '', context.recentCharacters);
    if (similarName) {
      issues.push(
        `newly invented character name "${character.name}" conflicts with recently used name "${similarName.displayName}"; rename this character consistently everywhere without changing the story`
      );
    }

    const similarAppearance = findSimilarRecentAppearance(character.appearanceSummary || '', context.recentCharacters);
    if (similarAppearance) {
      issues.push(
        `newly invented character "${character.name}" repeats the recent visual persona of "${similarAppearance.displayName}"; redesign at least three visual traits while preserving the character's story role and personality`
      );
    }

    inventionsThisBeat.push({
      displayName: character.name,
      normalizedName,
      appearanceSignature: character.appearanceSummary,
    });
  }

  return issues;
}

export function applyCharacterNameProvenance(
  beat: StoryBeat,
  sessionState: Partial<StorySession> | null,
  authoredText: string
): StoryBeat {
  const priorCharacters = existingCharacters(sessionState);
  const existingById = new Map(priorCharacters.map((character) => [character.id, character]));
  const existingByName = new Map(
    priorCharacters.map((character) => [normalizeCharacterName(character.name), character])
  );

  return {
    ...beat,
    characters: beat.characters.map((character) => {
      const existing = existingById.get(character.id)
        || existingByName.get(normalizeCharacterName(character.name));
      if (existing) {
        return {
          ...character,
          nameSource: existing.nameSource || resolveCharacterNameSource(existing),
        };
      }
      return {
        ...character,
        nameSource: textExplicitlyContainsName(authoredText, character.name)
          ? 'user_provided'
          : 'ai_generated',
      };
    }),
  };
}

export function resolveCharacterNameSource(character: Character): CharacterNameSource {
  if (character.nameSource) return character.nameSource;
  if (character.masterId) return 'character_library';
  if (character.sourceStoryId) return 'episode_carry';
  return 'ai_generated';
}
