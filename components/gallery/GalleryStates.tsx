'use client';

import { AlertCircle, RotateCcw, SearchX } from 'lucide-react';

interface GalleryErrorStateProps {
  title?: string;
  message?: string;
  onRetry: () => void;
}

/**
 * Shown when a feed request fails. The gallery previously swallowed these
 * errors and rendered an empty result, which read as "no stories exist".
 */
export function GalleryErrorState({
  title = "Couldn't load stories",
  message = 'Something went wrong reaching the library. Check your connection and try again.',
  onRetry,
}: GalleryErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-2xl border border-white/5 bg-neutral-900/40 px-6 py-14 text-center"
    >
      <AlertCircle className="h-8 w-8 text-amber-400/80" />
      <div className="space-y-1">
        <p className="font-serif text-lg text-neutral-200">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-neutral-500">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}

export function GalleryEmptyState({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <SearchX className="h-8 w-8 text-neutral-600" />
      <div className="space-y-1">
        <p className="font-serif text-lg text-neutral-300">No stories match those filters</p>
        <p className="text-sm text-neutral-500">Try a broader search or clear the filters.</p>
      </div>
      {onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="rounded-2xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
