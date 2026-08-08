/**
 * Genres a story can be filed under. Single source of truth for the creation
 * dropdown, the gallery filter, and the discovery-metadata classifier.
 */
export const STORY_GENRES = [
  { value: 'adventure', label: 'Adventure' },
  { value: 'mystery', label: 'Mystery' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'drama', label: 'Drama' },
  { value: 'horror', label: 'Horror' },
  { value: 'romance', label: 'Romance' },
  { value: 'sci-fi', label: 'Sci-Fi' },
] as const;

export type StoryGenre = (typeof STORY_GENRES)[number]['value'];

export const DEFAULT_STORY_GENRE: StoryGenre = 'adventure';

const GENRE_VALUES = STORY_GENRES.map((genre) => genre.value) as readonly string[];

export function isStoryGenre(value: unknown): value is StoryGenre {
  return typeof value === 'string' && GENRE_VALUES.includes(value.trim().toLowerCase());
}

/** Coerce to a supported slug, or null when the value is unrecognised. */
export function normalizeStoredGenre(value: unknown): StoryGenre | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return GENRE_VALUES.includes(slug) ? (slug as StoryGenre) : null;
}

export function getStoryGenreLabel(value: unknown): string | null {
  const slug = normalizeStoredGenre(value);
  return slug ? STORY_GENRES.find((genre) => genre.value === slug)!.label : null;
}
