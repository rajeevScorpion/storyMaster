'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface HistoryPagerProps {
  /** Names the nav for screen readers, e.g. "Payment history pages". */
  label: string;
  /** The dates the visible page covers ("25 Sep – 26 Sep 2026"). */
  range: string | null;
  canNewer: boolean;
  canOlder: boolean;
  loading?: boolean;
  onNewer: () => void;
  onOlder: () => void;
}

const BUTTON_CLASS =
  'inline-flex cursor-pointer items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

/** Newer/Older paging for newest-first history lists, with the visible page's date range beside it. */
export default function HistoryPager({ label, range, canNewer, canOlder, loading = false, onNewer, onOlder }: HistoryPagerProps) {
  if (!canNewer && !canOlder) return null;

  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {range && (
        <p aria-live="polite" className="mr-auto text-xs text-neutral-500 sm:mr-0">
          {range}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onNewer} disabled={!canNewer || loading} className={BUTTON_CLASS}>
          <ChevronLeft className="h-3.5 w-3.5" />
          Newer
        </button>
        <button type="button" onClick={onOlder} disabled={!canOlder || loading} className={BUTTON_CLASS}>
          Older
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>
    </nav>
  );
}
