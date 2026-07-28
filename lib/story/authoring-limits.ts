export const DEFAULT_STORY_AUTHORING_WORD_CAP = 500;
export const SEED_SOURCE_WORD_CAP = 500;
export const SEED_GUIDANCE_WORD_CAP = 150;

export function countAuthoringWords(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}
