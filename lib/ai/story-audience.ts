import type { AgeGroup, StoryBeatLengthLevel } from '@/lib/types/story';

export const DEFAULT_STORY_BEAT_LENGTH_LEVEL: StoryBeatLengthLevel = 3;
export const STORY_BEAT_LENGTH_DEFAULT_LEVEL_FLAG_KEY = 'story_beat_length_default_level';
export const STORY_BEAT_LENGTH_LEVELS: readonly StoryBeatLengthLevel[] = [1, 2, 3, 4, 5];

export const STORY_BEAT_LENGTH_LABELS: Record<StoryBeatLengthLevel, string> = {
  1: 'Brief',
  2: 'Light',
  3: 'Balanced',
  4: 'Detailed',
  5: 'Immersive',
};

export interface StoryAudienceProfile {
  value: AgeGroup;
  label: string;
  shortLabel: string;
  narrativeDirection: string;
  branchingDirection: string;
  visualDirection: string;
  narrationDirection: string;
  beatWordTargets: readonly [number, number, number, number, number];
  optionCount: 'exactly_3' | '3_or_4';
}

export interface ResolvedStoryBeatLength {
  level: StoryBeatLengthLevel;
  label: string;
  targetWords: number;
  targetMinWords: number;
  targetMaxWords: number;
  hardMinWords: number;
  hardMaxWords: number;
}

const STORY_AUDIENCE_PROFILES: Record<AgeGroup, StoryAudienceProfile> = {
  all_ages: {
    value: 'all_ages',
    label: 'All Ages',
    shortLabel: 'All ages',
    narrativeDirection: 'Use family storytelling with child-clear action and adult-readable emotional subtext. Keep causality immediate, emotions truthful, and the prose vivid without becoming childish or densely literary.',
    branchingDirection: 'Offer three concrete choices that are immediately understandable while carrying distinct thematic or relational implications. Let each path differ in goal, method, relationship, information sought, risk accepted, or value protected.',
    visualDirection: 'Favor an immediately readable focal action and silhouette, with optional background detail and emotional subtext for a second look. Keep tension legible and non-graphic without flattening every scene into cheerfulness.',
    narrationDirection: 'Use clear, warm, broadly natural delivery at a moderate pace. Give emotional turns room without exaggerated character voices or theatrical overstatement.',
    beatWordTargets: [48, 66, 84, 102, 120],
    optionCount: 'exactly_3',
  },
  kids_3_5: {
    value: 'kids_3_5',
    label: 'Preschool (3–5)',
    shortLabel: 'Preschool 3–5',
    narrativeDirection: 'Use concrete cause and effect, familiar sensory details, gentle repetition, and one idea per short sentence. Build the beat from four short complete narrative units so every storyboard panel has a clear moment. Tension may include brief worry or uncertainty, but it must remain contained and reassuring rather than frightening.',
    branchingDirection: 'Offer exactly three short, immediate, safe actions a young child can picture. Make the paths visibly different, such as trying, asking for help, helping someone, or looking more closely. Avoid abstract dilemmas, double meanings, and choices distinguished only by wording.',
    visualDirection: 'Use one dominant subject, simple spatial geography, expressive readable faces and gestures, friendly shapes, and limited clutter. Preserve creative freedom in setting and composition, but frame uncertainty safely and avoid looming threat, grotesque detail, or visually ambiguous danger.',
    narrationDirection: 'Use a warm, steady, unhurried delivery with crisp articulation and generous pauses between the four short narrative units. Never use baby talk or exaggerated sing-song speech.',
    beatWordTargets: [28, 36, 44, 52, 60],
    optionCount: 'exactly_3',
  },
  kids_5_8: {
    value: 'kids_5_8',
    label: 'Early Readers (6–8)',
    shortLabel: 'Early readers 6–8',
    narrativeDirection: 'Use short paragraphs, active verbs, playful discovery, natural dialogue, and emotions explained through action. Allow gentle suspense and mistakes, then show consequence, empathy, or repair without announcing a moral.',
    branchingDirection: 'Offer exactly three concrete choices with genuinely different play: an active attempt, an empathetic or collaborative response, and a curiosity or problem-solving path when the scene supports them. Keep labels direct and easy to read.',
    visualDirection: 'Keep action and geography easy to follow while allowing playful secondary detail, expressive reactions, and small visual discoveries. Tension can feel exciting, but danger must stay readable, non-graphic, and recoverable.',
    narrationDirection: 'Use lively, expressive narration with clear diction and comfortable pauses. Keep momentum without rushing dialogue or important discoveries.',
    beatWordTargets: [40, 52, 64, 76, 88],
    optionCount: 'exactly_3',
  },
  kids_8_12: {
    value: 'kids_8_12',
    label: 'Middle Grade (9–12)',
    shortLabel: 'Middle grade 9–12',
    narrativeDirection: 'Give each scene a clear goal, complication, and meaningful discovery. Use confident vocabulary, mild peril, mystery, humor, and character motives without over-explaining what the reader can infer.',
    branchingDirection: 'Offer three choices that invite strategy, discovery, loyalty, courage, or a measured risk. Each option must promise a different kind of consequence, not merely a different route to the same event.',
    visualDirection: 'Allow dynamic framing, layered environments, readable clues, and stronger shifts in scale or viewpoint. Preserve clear staging and emotional readability even when the world becomes visually complex.',
    narrationDirection: 'Use energetic, natural storytelling with clear changes in pace for discovery, suspense, humor, and consequence. Avoid sounding instructional.',
    beatWordTargets: [56, 72, 88, 104, 120],
    optionCount: 'exactly_3',
  },
  teens: {
    value: 'teens',
    label: 'Teens (13–17)',
    shortLabel: 'Teens 13–17',
    narrativeDirection: 'Use subtext, conflicting motives, identity, belonging, consequence, and emotional contradiction. Trust the reader to infer meaning; avoid explaining every feeling or turning complexity into melodrama.',
    branchingDirection: 'Offer three or four playable choices involving competing values, loyalty, uncertainty, self-definition, disclosure, or delayed consequences. Include a reflective or relational path when it naturally fits, but express it as something the character does or says.',
    visualDirection: 'Use mood, social distance, visual metaphor, negative space, and expressive composition without infantilizing the characters. Keep symbolism grounded in the actual beat and allow the composer freedom to choose literal or suggestive treatment.',
    narrationDirection: 'Use conversational, emotionally credible delivery with natural restraint. Let subtext and silence carry weight; avoid overacting or moralizing.',
    beatWordTargets: [64, 86, 108, 130, 152],
    optionCount: '3_or_4',
  },
  adults: {
    value: 'adults',
    label: 'Adults (18+)',
    shortLabel: 'Adults 18+',
    narrativeDirection: 'Use implication, thematic motifs, precise sensory detail, compressed exposition, and mature emotional stakes such as responsibility, grief, work, intimacy, identity, or sacrifice while remaining non-graphic and within product safety limits.',
    branchingDirection: 'Offer three or four playable choices between legitimate competing values, incomplete information, sacrifice, trust, self-protection, responsibility, or long-tail consequences. Avoid false profundity and cosmetic moral ambiguity.',
    visualDirection: 'Allow environmental storytelling, restraint, symbolism, complex blocking, and quiet visual tension. Do not equate adulthood with darkness or photorealism; honor the selected art direction and the emotional truth of the beat.',
    narrationDirection: 'Use nuanced, content-led pacing with restrained emphasis and confident pauses. Let implication land without explaining it through performance.',
    beatWordTargets: [72, 98, 124, 150, 176],
    optionCount: '3_or_4',
  },
};

export const STORY_AUDIENCE_OPTIONS = Object.values(STORY_AUDIENCE_PROFILES).map((profile) => ({
  value: profile.value,
  label: profile.label,
}));

export function normalizeAgeGroup(value: unknown): AgeGroup {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STORY_AUDIENCE_PROFILES, value)
    ? value as AgeGroup
    : 'all_ages';
}

export function normalizeStoryBeatLengthLevel(value: unknown): StoryBeatLengthLevel {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_STORY_BEAT_LENGTH_LEVEL;
  return Math.max(1, Math.min(5, Math.round(numeric))) as StoryBeatLengthLevel;
}

export function getStoryAudienceProfile(ageGroup: unknown): StoryAudienceProfile {
  return STORY_AUDIENCE_PROFILES[normalizeAgeGroup(ageGroup)];
}

export function resolveStoryBeatLength(ageGroup: unknown, levelValue: unknown): ResolvedStoryBeatLength {
  const profile = getStoryAudienceProfile(ageGroup);
  const level = normalizeStoryBeatLengthLevel(levelValue);
  const targetWords = profile.beatWordTargets[level - 1];
  const hardMinWords = profile.beatWordTargets[0];
  const hardMaxWords = profile.beatWordTargets[profile.beatWordTargets.length - 1];
  const tolerance = Math.max(4, Math.round(targetWords * 0.12));

  return {
    level,
    label: STORY_BEAT_LENGTH_LABELS[level],
    targetWords,
    targetMinWords: Math.max(hardMinWords, targetWords - tolerance),
    targetMaxWords: Math.min(hardMaxWords, targetWords + tolerance),
    hardMinWords,
    hardMaxWords,
  };
}

export function countStoryWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  // Keep length controls meaningful for scripts that do not put spaces between words.
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return Array.from(segmenter.segment(trimmed))
      .filter((segment) => segment.isWordLike)
      .length;
  }

  return trimmed.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function formatAudienceNarrativeContract(ageGroup: unknown, levelValue: unknown): string {
  const profile = getStoryAudienceProfile(ageGroup);
  const length = resolveStoryBeatLength(ageGroup, levelValue);
  return [
    'Audience and beat-length contract:',
    `- Audience: ${profile.label}.`,
    `- Narrative grammar: ${profile.narrativeDirection}`,
    `- Branching grammar: ${profile.branchingDirection}`,
    `- Beat length: ${length.label}; target ${length.targetMinWords}-${length.targetMaxWords} words (about ${length.targetWords}), with an absolute audience range of ${length.hardMinWords}-${length.hardMaxWords} words.`,
    '- Preserve one coherent beat with four visualizable narrative movements. More words add meaningful sensory detail, dialogue, subtext, or emotional consequence; they must not add unrelated plot turns, filler, or extra characters.',
    '- On a strictly-follow canonical seeded beat, verbatim source text overrides the beat-length target. Never shorten, expand, or rewrite that source text.',
  ].join('\n');
}

export function formatAudienceVisualContract(ageGroup: unknown): string {
  const profile = getStoryAudienceProfile(ageGroup);
  return [
    'Audience-aware visual direction:',
    `- Audience: ${profile.label}.`,
    `- ${profile.visualDirection}`,
    '- This direction governs readability, emotional framing, compositional density, and threat presentation. It must not dictate a fixed palette, genre, rendering style, camera shot, or literal interpretation.',
    '- Keep all four panels as distinct sequential moments in the single storyboard image. Quiet, relational, or contemplative beats may progress through gesture, attention, distance, expression, environment, or visual metaphor rather than forced physical action.',
  ].join('\n');
}

export function formatAudienceNarrationDirection(ageGroup: unknown): string {
  const profile = getStoryAudienceProfile(ageGroup);
  return `Audience delivery (${profile.label}): ${profile.narrationDirection}`;
}

export function formatAudienceBranchingContract(ageGroup: unknown): string {
  const profile = getStoryAudienceProfile(ageGroup);
  return [
    `Audience branching profile (${profile.label}):`,
    `- ${profile.branchingDirection}`,
    '- Every option must differ meaningfully in goal, method, relationship, information sought, risk accepted, or value protected.',
    '- Do not return cosmetic rewrites, false choices, or several labels that all lead to the same immediate action.',
    '- A reflective option must still be playable: phrase it as something a character says, asks, reveals, withholds, observes, or decides.',
  ].join('\n');
}
