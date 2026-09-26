'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import HistoryPager from '@/components/ui/HistoryPager';
import { documentTypeLabel, type BillingDocumentOverview } from '@/lib/billing/billing-account.shared';
import { formatBillingDateLong, formatBillingDateRange } from '@/lib/billing/billing-dates.shared';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';

const PAGE_SIZE = 5;

/** Every document is already loaded (a customer has a handful), so paging happens here. */
export default function BillingDocumentsList({ documents }: { documents: BillingDocumentOverview[] }) {
  const [source, setSource] = useState(documents);
  const [pageIndex, setPageIndex] = useState(0);

  if (source !== documents) {
    setSource(documents);
    setPageIndex(0);
  }

  if (documents.length === 0) {
    return <p className="mt-3 text-sm text-neutral-400">Tax invoices will appear here.</p>;
  }

  const pageCount = Math.ceil(documents.length / PAGE_SIZE);
  const items = documents.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);

  return (
    <>
      <div className="mt-4 space-y-2">
        {items.map((doc) => (
          <div key={doc.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-400">
                {documentTypeLabel(doc.documentType)}
              </span>
              <span className="text-neutral-200">{doc.documentNumber}</span>
              <span className="text-neutral-500">{formatBillingDateLong(doc.issuedAt) ?? '—'}</span>
              <span className="text-neutral-200">{formatCurrencyMinor(doc.currencyCode, doc.totalMinor)}</span>
            </div>
            <a
              href={`/api/billing/documents/${doc.id}/pdf`}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </div>
        ))}
      </div>
      <HistoryPager
        label="Invoice pages"
        range={formatBillingDateRange(items[items.length - 1].issuedAt, items[0].issuedAt)}
        canNewer={pageIndex > 0}
        canOlder={pageIndex + 1 < pageCount}
        onNewer={() => setPageIndex(pageIndex - 1)}
        onOlder={() => setPageIndex(pageIndex + 1)}
      />
    </>
  );
}
