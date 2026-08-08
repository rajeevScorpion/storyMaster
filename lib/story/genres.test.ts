import { describe, expect, it } from 'vitest';
import { DEFAULT_STORY_GENRE, STORY_GENRES, getStoryGenreLabel, normalizeStoredGenre } from './genres';

describe('normalizeStoredGenre', () => {
  it('accepts supported slugs regardless of case or padding', () => {
    expect(normalizeStoredGenre('adventure')).toBe('adventure');
    expect(normalizeStoredGenre('  Sci-Fi ')).toBe('sci-fi');
  });

  it('returns null for unsupported or malformed values', () => {
    expect(normalizeStoredGenre('western')).toBeNull();
    expect(normalizeStoredGenre('')).toBeNull();
    expect(normalizeStoredGenre(null)).toBeNull();
    expect(normalizeStoredGenre(7)).toBeNull();
  });

  it('exposes the default genre as a supported slug', () => {
    expect(STORY_GENRES.some((genre) => genre.value === DEFAULT_STORY_GENRE)).toBe(true);
  });
});

describe('getStoryGenreLabel', () => {
  it('maps a slug to its display label', () => {
    expect(getStoryGenreLabel('sci-fi')).toBe('Sci-Fi');
  });

  it('returns null when the genre is unknown', () => {
    expect(getStoryGenreLabel('western')).toBeNull();
    expect(getStoryGenreLabel(null)).toBeNull();
  });
});
