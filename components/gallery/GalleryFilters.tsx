'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Sheet from '@/components/ui/Sheet';
import type { GalleryFilters as Filters, GalleryLane } from '@/lib/types/database';
import { STORY_AUDIENCE_OPTIONS } from '@/lib/ai/story-audience';
import { STORY_GENRES } from '@/lib/story/genres';

const LANGUAGE_OPTIONS = [
  { value: 'all', label: 'All Languages' },
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi (हिन्दी)' },
];

const TYPE_OPTIONS: { value: GalleryLane; label: string }[] = [
  { value: 'storylines', label: 'Storylines' },
  { value: 'vertical', label: 'Vertical' },
];

const GENRE_OPTIONS = [
  { value: 'all', label: 'All Genres' },
  ...STORY_GENRES.map((genre) => ({ value: genre.value as string, label: genre.label })),
];

const AGE_OPTIONS = [
  { value: 'all', label: 'All Ages' },
  ...STORY_AUDIENCE_OPTIONS.map((option) => ({
    ...option,
    label: option.value === 'all_ages' ? 'All Ages stories' : option.label,
  })),
];

const COUNTRY_OPTIONS = [
  { value: 'all', label: 'All Demograph' },
  { value: 'India', label: 'India' },
  { value: 'Japan', label: 'Japan' },
  { value: 'USA', label: 'USA' },
  { value: 'Medieval Europe', label: 'Medieval Europe' },
  { value: 'Fantasy Land', label: 'Fantasy Land' },
  { value: 'Space', label: 'Space' },
  { value: 'Underwater', label: 'Underwater' },
];

/** Dropdown filters, in the order they appear in both layouts. */
const DROPDOWNS = [
  { key: 'genre', label: 'Genre', options: GENRE_OPTIONS },
  { key: 'ageGroup', label: 'Audience', options: AGE_OPTIONS },
  { key: 'country', label: 'Storyverse', options: COUNTRY_OPTIONS },
  { key: 'language', label: 'Language', options: LANGUAGE_OPTIONS },
] as const;

type DropdownKey = (typeof DROPDOWNS)[number]['key'];

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function optionLabel(key: DropdownKey, value: string): string {
  const dropdown = DROPDOWNS.find((entry) => entry.key === key);
  return dropdown?.options.find((option) => option.value === value)?.label ?? value;
}

interface GalleryFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function GalleryFilters({ filters, onFiltersChange }: GalleryFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFiltersRef = useRef(filters);
  const latestOnFiltersChangeRef = useRef(onFiltersChange);

  useEffect(() => {
    latestFiltersRef.current = filters;
    latestOnFiltersChangeRef.current = onFiltersChange;
  }, [filters, onFiltersChange]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmedSearch = searchInput.trim();
      const normalizedInput = normalizeSearch(trimmedSearch);
      const normalizedFilter = normalizeSearch(filters.search);

      if (normalizedInput !== normalizedFilter) {
        latestOnFiltersChangeRef.current({
          ...latestFiltersRef.current,
          search: trimmedSearch,
        });
        if (trimmedSearch !== searchInput) {
          setSearchInput(trimmedSearch);
        }
      } else if (trimmedSearch !== searchInput) {
        setSearchInput(filters.search);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput, filters.search]);

  const update = (partial: Partial<Filters>) => {
    const nextFilters = { ...filters, ...partial };
    const isSameSearch = normalizeSearch(nextFilters.search) === normalizeSearch(filters.search);
    const isSameFilters =
      nextFilters.type === filters.type &&
      nextFilters.genre === filters.genre &&
      nextFilters.ageGroup === filters.ageGroup &&
      nextFilters.country === filters.country &&
      nextFilters.language === filters.language &&
      isSameSearch;

    if (isSameFilters) return;

    onFiltersChange(nextFilters);
  };

  const activeChips = useMemo(
    () =>
      DROPDOWNS
        .filter((dropdown) => filters[dropdown.key] !== 'all')
        .map((dropdown) => ({
          key: dropdown.key,
          label: optionLabel(dropdown.key, filters[dropdown.key]),
        })),
    [filters]
  );

  const searchField = (
    <div className="relative min-w-[200px] flex-1 md:max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search stories..."
        aria-label="Search stories"
        className="min-h-11 w-full rounded-xl border border-white/10 bg-neutral-800/80 py-2 pl-10 pr-11 text-sm text-neutral-200 placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
      />
      {searchInput && (
        <button
          type="button"
          onClick={() => {
            if (!searchInput && !filters.search) return;
            setSearchInput('');
            update({ search: '' });
          }}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-neutral-500 transition-colors hover:text-neutral-300"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const laneSwitch = (
    <SegmentedControl
      options={TYPE_OPTIONS}
      value={filters.type}
      onChange={(value) => update({ type: value })}
      ariaLabel="Story format"
    />
  );

  return (
    <div className="space-y-3">
      {/* Desktop: everything inline. */}
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        {searchField}
        {laneSwitch}
        {DROPDOWNS.map((dropdown) => (
          <FilterDropdown
            key={dropdown.key}
            value={filters[dropdown.key]}
            options={dropdown.options}
            onChange={(value) => update({ [dropdown.key]: value } as Partial<Filters>)}
            ariaLabel={dropdown.label}
          />
        ))}
      </div>

      {/* Mobile: search plus a filter sheet, so the bar never wraps to four rows. */}
      <div className="flex items-center gap-3 md:hidden">
        {searchField}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-neutral-800/80 px-4 text-sm text-neutral-200 transition-colors hover:border-white/20"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeChips.length > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              {activeChips.length}
            </span>
          )}
        </button>
      </div>

      {activeChips.length > 0 && (
        <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 md:hidden">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => update({ [chip.key]: 'all' } as Partial<Filters>)}
              aria-label={`Clear ${chip.label} filter`}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 py-2 pl-3 pr-2.5 text-xs text-emerald-200"
            >
              {chip.label}
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              update({ genre: 'all', ageGroup: 'all', country: 'all', language: 'all' })
            }
            className="shrink-0 rounded-full px-3 py-2 text-xs text-neutral-400 underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <Sheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters">
        <div className="space-y-4 pb-2">
          {laneSwitch}
          {DROPDOWNS.map((dropdown) => (
            <FilterDropdown
              key={dropdown.key}
              value={filters[dropdown.key]}
              options={dropdown.options}
              onChange={(value) => update({ [dropdown.key]: value } as Partial<Filters>)}
              fullWidth
              size="form"
              mode="inline"
              ariaLabel={dropdown.label}
              contextLabel={dropdown.label}
            />
          ))}
        </div>
      </Sheet>
    </div>
  );
}
