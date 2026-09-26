'use client';

import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Hourglass, Loader2, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { getWalletActivityPage } from '@/app/actions/pricing-runtime';
import { formatBillingDateShort } from '@/lib/billing/billing-dates.shared';
import type { PricingWalletActivityItem, WalletActivityCursor } from '@/lib/types/pricing';

const KIND_ICONS: Record<PricingWalletActivityItem['kind'], typeof Plus> = {
  grant: Plus,
  spend: Sparkles,
  refund: RotateCcw,
  expiry: Hourglass,
  plan: CalendarClock,
};

function formatActivityTime(value: string) {
  const date = new Date(value);
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatBillingDateShort(date) ?? '';
}

interface WalletActivityListProps {
  initialItems: PricingWalletActivityItem[];
  initialCursor: WalletActivityCursor | null;
  loading: boolean;
}

/**
 * Five rows a page. Pages already seen are kept, so "Newer" never refetches; a fresh wallet load
 * (a purchase, a refresh) starts again from page one.
 */
export default function WalletActivityList({ initialItems, initialCursor, loading }: WalletActivityListProps) {
  const [source, setSource] = useState(initialItems);
  const [pages, setPages] = useState<PricingWalletActivityItem[][]>([initialItems]);
  const [cursors, setCursors] = useState<(WalletActivityCursor | null)[]>([initialCursor]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  if (source !== initialItems) {
    setSource(initialItems);
    setPages([initialItems]);
    setCursors([initialCursor]);
    setPageIndex(0);
    setPageError(null);
  }

  const items = pages[pageIndex] ?? [];
  const hasOlder = pageIndex + 1 < pages.length || Boolean(cursors[pageIndex]);

  async function showOlder() {
    if (pageIndex + 1 < pages.length) {
      setPageIndex(pageIndex + 1);
      return;
    }
    const cursor = cursors[pageIndex];
    if (!cursor) return;

    setPageLoading(true);
    setPageError(null);
    try {
      const next = await getWalletActivityPage(cursor);
      setPages((current) => [...current, next.items]);
      setCursors((current) => [...current, next.nextCursor]);
      setPageIndex(pageIndex + 1);
    } catch {
      setPageError("Couldn't load older activity. Try again.");
    } finally {
      setPageLoading(false);
    }
  }

  if (loading && initialItems.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading wallet activity...
      </div>
    );
  }

  if (initialItems.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-neutral-500">
        No activity yet. Your refills, top-ups, story actions and plan changes will appear here.
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-3">
        {items.map((item) => {
          const Icon = KIND_ICONS[item.kind];
          const isPlanEvent = item.kind === 'plan';
          return (
            <li
              key={item.id}
              className={`rounded-2xl border px-4 py-3 ${
                isPlanEvent ? 'border-indigo-400/15 bg-indigo-500/5' : 'border-white/10 bg-neutral-900/60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 rounded-xl p-1.5 ${
                      isPlanEvent
                        ? 'bg-indigo-500/10 text-indigo-300'
                        : item.coinsDelta !== null && item.coinsDelta >= 0
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-white/5 text-neutral-400'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-100">{item.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">{item.subtitle}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {item.coinsDelta !== null && (
                    <p className={`text-sm font-medium ${item.coinsDelta >= 0 ? 'text-emerald-300' : 'text-neutral-200'}`}>
                      {item.coinsDelta >= 0 ? '+' : ''}{item.coinsDelta.toLocaleString()} coins
                    </p>
                  )}
                  <p className={`text-xs text-neutral-500 ${item.coinsDelta !== null ? 'mt-1' : ''}`}>
                    {formatActivityTime(item.occurredAt)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {(pageIndex > 0 || hasOlder) && (
        <nav aria-label="Activity pages" className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">Page {pageIndex + 1}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex(pageIndex - 1)}
              disabled={pageIndex === 0 || pageLoading}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Newer
            </button>
            <button
              type="button"
              onClick={() => void showOlder()}
              disabled={!hasOlder || pageLoading}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Older
              {pageLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </nav>
      )}
      {pageError && <p className="mt-2 text-right text-xs text-rose-300">{pageError}</p>}
    </div>
  );
}
