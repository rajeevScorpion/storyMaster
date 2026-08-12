import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GALLERY_FILTERS,
  filterKey,
  filtersFromParams,
  hasActiveRefinement,
  isBrowseAll,
  isSearchOpen,
  paramsFromFilters,
  searchUrl,
} from './search-params';

describe('isSearchOpen', () => {
  it('is closed with no q param', () => {
    expect(isSearchOpen(new URLSearchParams(''))).toBe(false);
  });

  it('is open on an empty q — that is the browse-everything state', () => {
    expect(isSearchOpen(new URLSearchParams('q='))).toBe(true);
  });

  it('is open with a query', () => {
    expect(isSearchOpen(new URLSearchParams('q=dragons'))).toBe(true);
  });

  it('stays closed when only filters are present, so a stray param cannot hide the feed', () => {
    expect(isSearchOpen(new URLSearchParams('genre=fantasy'))).toBe(false);
  });
});

describe('filtersFromParams', () => {
  it('falls back to the defaults for anything absent', () => {
    expect(filtersFromParams(new URLSearchParams('q='))).toEqual(DEFAULT_GALLERY_FILTERS);
  });

  it('reads every filter', () => {
    const filters = filtersFromParams(
      new URLSearchParams('q=dragon&type=vertical&genre=fantasy&age=kids_3_5&from=India&lang=hindi')
    );
    expect(filters).toEqual({
      search: 'dragon',
      type: 'vertical',
      genre: 'fantasy',
      ageGroup: 'kids_3_5',
      country: 'India',
      language: 'hindi',
    });
  });

  it('trims the query so " " is not treated as a search', () => {
    expect(filtersFromParams(new URLSearchParams('q=%20%20')).search).toBe('');
  });

  it('treats an unknown lane as storylines rather than passing it to the query', () => {
    expect(filtersFromParams(new URLSearchParams('q=&type=nonsense')).type).toBe('storylines');
  });

  it('treats a blank filter value as all', () => {
    expect(filtersFromParams(new URLSearchParams('q=&genre=')).genre).toBe('all');
  });
});

describe('paramsFromFilters', () => {
  it('keeps q even when empty, because its presence is what opens search', () => {
    expect(paramsFromFilters(DEFAULT_GALLERY_FILTERS).toString()).toBe('q=');
  });

  it('omits defaults', () => {
    const params = paramsFromFilters({ ...DEFAULT_GALLERY_FILTERS, search: 'moon' });
    expect(params.toString()).toBe('q=moon');
  });

  it('emits only the filters that differ from the default', () => {
    const params = paramsFromFilters({
      ...DEFAULT_GALLERY_FILTERS,
      search: 'moon',
      genre: 'fantasy',
      language: 'hindi',
    });
    expect(params.get('genre')).toBe('fantasy');
    expect(params.get('lang')).toBe('hindi');
    expect(params.has('age')).toBe(false);
    expect(params.has('from')).toBe(false);
    expect(params.has('type')).toBe(false);
  });

  it('round-trips', () => {
    const filters = {
      search: 'sea monster',
      type: 'vertical' as const,
      genre: 'adventure',
      ageGroup: 'teen',
      country: 'Japan',
      language: 'english',
    };
    expect(filtersFromParams(paramsFromFilters(filters))).toEqual(filters);
  });
});

describe('searchUrl', () => {
  // The gallery is the root route, so this is the pathname the hook actually
  // passes in — a shared search link is `/?q=…`, not `/gallery?q=…`.
  it('builds a shareable url', () => {
    expect(searchUrl('/', { ...DEFAULT_GALLERY_FILTERS, search: 'moon' })).toBe(
      '/?q=moon'
    );
  });

  it('keeps the kids pathname', () => {
    expect(searchUrl('/gallery/kids', { ...DEFAULT_GALLERY_FILTERS, genre: 'fantasy' })).toBe(
      '/gallery/kids?q=&genre=fantasy'
    );
  });
});

describe('filterKey', () => {
  it('is case- and whitespace-insensitive on the query', () => {
    expect(filterKey({ ...DEFAULT_GALLERY_FILTERS, search: '  Moon ' })).toBe(
      filterKey({ ...DEFAULT_GALLERY_FILTERS, search: 'moon' })
    );
  });

  it('separates two different refinements of the same query', () => {
    expect(filterKey({ ...DEFAULT_GALLERY_FILTERS, search: 'moon', genre: 'fantasy' })).not.toBe(
      filterKey({ ...DEFAULT_GALLERY_FILTERS, search: 'moon', genre: 'horror' })
    );
  });
});

describe('browse-all detection', () => {
  it('is browse-all with no query and no refinement', () => {
    expect(isBrowseAll(DEFAULT_GALLERY_FILTERS)).toBe(true);
    expect(hasActiveRefinement(DEFAULT_GALLERY_FILTERS)).toBe(false);
  });

  it('is not browse-all once a genre is chosen', () => {
    const filters = { ...DEFAULT_GALLERY_FILTERS, genre: 'fantasy' };
    expect(isBrowseAll(filters)).toBe(false);
    expect(hasActiveRefinement(filters)).toBe(true);
  });

  it('counts the vertical lane as a refinement', () => {
    expect(hasActiveRefinement({ ...DEFAULT_GALLERY_FILTERS, type: 'vertical' })).toBe(true);
  });

  it('is not browse-all once there is a query', () => {
    expect(isBrowseAll({ ...DEFAULT_GALLERY_FILTERS, search: 'moon' })).toBe(false);
  });
});
