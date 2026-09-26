'use client';

import { useEffect, useRef, useState } from 'react';
import HistoryPager from '@/components/ui/HistoryPager';
import { getMyPaymentHistory } from '@/app/actions/billing-account';
import type { BillingPaymentOverview } from '@/lib/billing/billing-account.shared';
import { formatBillingDateLong, formatBillingDateRange } from '@/lib/billing/billing-dates.shared';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';

interface PaymentHistoryListProps {
  /** The overview's first page. A new array (the page reloaded its overview) starts again from it. */
  initialItems: BillingPaymentOverview[];
  initialHasMore: boolean;
}

/** Five payments a page, newest first; pages already seen are kept so "Newer" never refetches. */
export default function PaymentHistoryList({ initialItems, initialHasMore }: PaymentHistoryListProps) {
  const [source, setSource] = useState(initialItems);
  const [pages, setPages] = useState<BillingPaymentOverview[][]>([initialItems]);
  const [hasMoreAfter, setHasMoreAfter] = useState<boolean[]>([initialHasMore]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards an "Older" response against an overview reload that landed while it was in flight.
  const committedSourceRef = useRef(initialItems);

  if (source !== initialItems) {
    setSource(initialItems);
    setPages([initialItems]);
    setHasMoreAfter([initialHasMore]);
    setPageIndex(0);
    setError(null);
  }

  useEffect(() => {
    committedSourceRef.current = source;
  }, [source]);

  const items = pages[pageIndex] ?? [];
  const canOlder = pageIndex + 1 < pages.length || Boolean(hasMoreAfter[pageIndex]);

  async function showOlder() {
    if (pageIndex + 1 < pages.length) {
      setPageIndex(pageIndex + 1);
      return;
    }
    const sourceAtRequest = source;
    setLoading(true);
    setError(null);
    const result = await getMyPaymentHistory({ page: pageIndex + 1 });
    setLoading(false);
    if (committedSourceRef.current !== sourceAtRequest) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPages((current) => [...current.slice(0, pageIndex + 1), result.items]);
    setHasMoreAfter((current) => [...current.slice(0, pageIndex + 1), result.hasMore]);
    setPageIndex(pageIndex + 1);
  }

  if (initialItems.length === 0) {
    return <p className="mt-3 text-sm text-neutral-400">No payments yet.</p>;
  }

  return (
    <>
      <div className="mt-4 divide-y divide-white/5">
        {items.map((payment) => (
          <div key={payment.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-200">{payment.description}</p>
                <p className="text-xs text-neutral-500">
                  {formatBillingDateLong(payment.date) ?? '—'} · {payment.methodLabel}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-neutral-200">{formatCurrencyMinor(payment.currencyCode, payment.grossMinor)}</p>
                {payment.taxLines.length > 0 && (
                  <p className="text-[11px] text-neutral-500">
                    {payment.taxLines.map((line) => `${line.label} ${formatCurrencyMinor(payment.currencyCode, line.amountMinor)}`).join(' + ')}
                  </p>
                )}
              </div>
            </div>
            {payment.refund && (
              <p className="mt-1 pl-3 text-xs text-neutral-500">
                {payment.refund.processed
                  ? `Refunded ${formatCurrencyMinor(payment.currencyCode, payment.refund.amountMinor)} on ${formatBillingDateLong(payment.refund.date) ?? '—'}`
                  : 'Refund processing'}
              </p>
            )}
          </div>
        ))}
      </div>
      <HistoryPager
        label="Payment history pages"
        range={items.length > 0 ? formatBillingDateRange(items[items.length - 1].date, items[0].date) : null}
        canNewer={pageIndex > 0}
        canOlder={canOlder}
        loading={loading}
        onNewer={() => setPageIndex(pageIndex - 1)}
        onOlder={() => void showOlder()}
      />
      {error && <p className="mt-2 text-right text-xs text-rose-300">{error}</p>}
    </>
  );
}
