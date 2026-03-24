'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, ChevronDown, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { GalleryFilters as Filters } from '@/lib/types/database';

const LANGUAGE_OPTIONS = [
  { value: 'all', label: 'All Languages' },
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi (हिन्दी)' },
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'trees', label: 'Story Trees' },
  { value: 'storylines', label: 'Storylines' },
] as const;

const GENRE_OPTIONS = [
  { value: 'all', label: 'All Genres' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'mystery', label: 'Mystery' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'drama', label: 'Drama' },
  { value: 'horror', label: 'Horror' },
  { value: 'romance', label: 'Romance' },
  { value: 'sci-fi', label: 'Sci-Fi' },
];

const AGE_OPTIONS = [
  { value: 'all', label: 'All Ages' },
  { value: 'all_ages', label: 'General' },
  { value: 'kids_3_5', label: 'Kids 3-5' },
  { value: 'kids_5_8', label: 'Kids 5-8' },
  { value: 'kids_8_12', label: 'Kids 8-12' },
  { value: 'teens', label: 'Teens' },
  { value: 'adults', label: 'Adults' },
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

function FilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 bg-neutral-800/80 border px-3 py-2 text-sm cursor-pointer transition-all duration-200 ${
          isOpen
            ? 'border-emerald-500/40 rounded-xl rounded-b-none text-emerald-300'
            : 'border-white/10 rounded-xl text-neutral-200 hover:border-white/20'
        }`}
      >
        {selected?.label || options[0]?.label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-emerald-400' : 'text-neutral-500'
          }`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full -mt-px left-0 z-50 w-max min-w-full overflow-hidden"
          >
            <div className="bg-neutral-900/95 backdrop-blur-xl border border-emerald-500/40 rounded-xl rounded-t-none shadow-2xl pt-1 pb-1">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    opt.value === value
                      ? 'text-emerald-400'
                      : 'text-neutral-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                  }`}
                >
                  <Check
                    className={`w-3 h-3 shrink-0 ${
                      opt.value === value ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface GalleryFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function GalleryFilters({ filters, onFiltersChange }: GalleryFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchInput !== filters.search) {
        onFiltersChange({ ...filters, search: searchInput });
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const update = (partial: Partial<Filters>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search stories..."
          className="w-full pl-10 pr-9 py-2 bg-neutral-800/80 border border-white/10 rounded-xl text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-emerald-500/50 transition-colors"
        />
        {searchInput && (
          <button
            onClick={() => { setSearchInput(''); update({ search: '' }); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Type toggle pills */}
      <div className="flex rounded-xl border border-white/10 overflow-hidden">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => update({ type: opt.value })}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              filters.type === opt.value
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-neutral-800/80 text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Genre */}
      <FilterDropdown
        value={filters.genre}
        options={GENRE_OPTIONS}
        onChange={(v) => update({ genre: v })}
      />

      {/* Age Group */}
      <FilterDropdown
        value={filters.ageGroup}
        options={AGE_OPTIONS}
        onChange={(v) => update({ ageGroup: v })}
      />

      {/* Country */}
      <FilterDropdown
        value={filters.country}
        options={COUNTRY_OPTIONS}
        onChange={(v) => update({ country: v })}
      />

      {/* Language */}
      <FilterDropdown
        value={filters.language}
        options={LANGUAGE_OPTIONS}
        onChange={(v) => update({ language: v })}
      />
    </div>
  );
}
