import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, LifeBuoy } from 'lucide-react';

import ManagedFooter from '@/components/layout/ManagedFooter';
import KissagoLogo from '@/components/ui/KissagoLogo';
import { canViewManagedPage } from '@/lib/managed-pages/access';
import { getCachedManagedPageSummaries } from '@/lib/managed-pages/cache';
import { formatManagedPageDate } from '@/lib/managed-pages/render';
import { getCurrentManagedPageAccessContext } from '@/lib/managed-pages/service';
import type { ManagedPageSummary } from '@/lib/managed-pages/types';

export const metadata: Metadata = {
  title: 'Help & Legal - Kissago',
  description: 'Support, policies, rights and important information about using Kissago.',
};

// Display label for the Help & Legal card only — independent of the page's
// stored `title`. content_usage_policy's actual title/body still say "Content
// Usage Policy" until Phase 7 (seed content reconciliation) replaces it with
// the pack's Safety/Community/Grievance content; this override lets the
// destination read correctly in the meantime without a misleading interim H1.
const CARD_LABEL_OVERRIDES: Record<string, string> = {
  content_usage_policy: 'Safety, Community & Grievance',
};

const PRIMARY_CARD_ORDER = ['contact_support', 'terms', 'privacy_policy', 'ai_disclosure', 'content_usage_policy'];

// blog_news is deliberately excluded: the pack says News does not belong in
// the legal/footer area at all, and should move to an About/Updates surface
// if retained — no such surface exists yet, so /blog stays reachable only by
// direct URL until one is built (see docs/agent-context/PROJECT_STATE.md).
const SECONDARY_LINK_ORDER = ['copyright_licensing', 'refund_policy', 'account_deletion', 'faq', 'documentation'];

function cardLabel(page: ManagedPageSummary): string {
  return CARD_LABEL_OVERRIDES[page.pageKey] ?? page.title;
}

export default async function HelpAndLegalPage() {
  const [summaries, context] = await Promise.all([
    getCachedManagedPageSummaries(),
    getCurrentManagedPageAccessContext(),
  ]);

  const visibleByKey = new Map(
    summaries.filter((page) => canViewManagedPage(page, context)).map((page) => [page.pageKey, page])
  );

  const primaryCards = PRIMARY_CARD_ORDER.map((key) => visibleByKey.get(key)).filter(
    (page): page is ManagedPageSummary => Boolean(page)
  );
  const secondaryLinks = SECONDARY_LINK_ORDER.map((key) => visibleByKey.get(key)).filter(
    (page): page is ManagedPageSummary => Boolean(page)
  );

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <KissagoLogo fixed={false} />
        </header>

        <div className="py-14 sm:py-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-300">
            <LifeBuoy className="h-3.5 w-3.5" />
            Help &amp; Legal
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal text-white sm:text-5xl">Help &amp; Legal</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-300">
            Support, policies, rights and important information about using Kissago.
          </p>

          {primaryCards.length > 0 ? (
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {primaryCards.map((page) => (
                <Link
                  key={page.pageKey}
                  href={`/${page.slug}`}
                  className="group flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-emerald-400/30 hover:bg-white/[0.05]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-semibold text-white">{cardLabel(page)}</h2>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-neutral-500 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-300" />
                    </div>
                    {page.excerpt ? <p className="mt-2 text-sm leading-6 text-neutral-400">{page.excerpt}</p> : null}
                  </div>
                  <p className="mt-4 text-xs text-neutral-500">Last updated {formatManagedPageDate(page.updatedAt)}</p>
                </Link>
              ))}
            </div>
          ) : null}

          {secondaryLinks.length > 0 ? (
            <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">More</p>
              <nav aria-label="More policies and information" className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                {secondaryLinks.map((page) => (
                  <Link
                    key={page.pageKey}
                    href={`/${page.slug}`}
                    className="text-sm text-neutral-300 transition-colors hover:text-emerald-300"
                  >
                    {cardLabel(page)}
                  </Link>
                ))}
              </nav>
            </div>
          ) : null}
        </div>
      </div>
      <ManagedFooter />
    </main>
  );
}
