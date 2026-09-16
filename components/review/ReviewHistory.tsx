'use client';

import Link from 'next/link';
import { ClipboardCheck, Info, PenLine, Share2 } from 'lucide-react';
import { DECISION_LABELS, DECISION_STYLES, FormattedDateTime, shortId } from '@/components/admin/agentic/run-presentation';
import type { ReviewHistoryEntry } from '@/lib/agentic/review-history';

// ── Agentic Creator System: Unit 9k — a reviewer's own decision history ──
//
// A client component, unlike its sibling report PersonaSpend, and deliberately so: it
// reuses run-presentation.tsx's decision badge tables, and that module is 'use client'.
// Importing a plain VALUE from a 'use client' module into server code hands back a
// client-reference stub rather than the value itself (CLAUDE.md; it has bitten this
// repo before) — so the choice is either to duplicate the tables or to sit on the same
// side of the boundary as them. Duplicating a label table is the worse of the two.
//
// Timestamps go through FormattedDateTime for the reproduced hydration reason
// documented in run-presentation.tsx — a locale string formatted by Node and by a
// browser can differ byte for byte for the same instant.
//
// Lives in components/review/ rather than components/admin/agentic/ for the same reason
// ReviewSidebar does: a reviewer is not staff, and there is nothing admin-shaped here
// for this to drift toward. It shows only this reviewer's own decisions and never
// touches the roster, so there is no `notes` field anywhere near it (245588e).

export default function ReviewHistory({ entries }: { entries: ReviewHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-neutral-300">
        <Info size={18} className="mt-0.5 shrink-0 text-neutral-500" />
        <p>
          You have not recorded a decision yet. Approving, rejecting, requesting a rewrite or
          publishing a draft from the{' '}
          <Link href="/review" className="font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200">
            review queue
          </Link>{' '}
          adds it here.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
      <ul className="divide-y divide-white/5">
        {entries.map((entry) => (
          <li key={entry.id} className="p-4 transition-colors hover:bg-white/[0.02]">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${DECISION_STYLES[entry.decision]}`}
              >
                {DECISION_LABELS[entry.decision]}
              </span>
              <span className="min-w-0 truncate text-sm text-neutral-200">
                {entry.storyTitle ?? <span className="text-neutral-500">Untitled story</span>}
              </span>
              <span className="ml-auto shrink-0 text-xs text-neutral-500">
                <FormattedDateTime value={entry.createdAt} />
              </span>
            </div>

            {entry.notes && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-400">{entry.notes}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span className="font-mono">run {shortId(entry.runId)}</span>
              {entry.storyId && (
                // Back into the same authoring screen the queue opens, carrying the same
                // marker so the way back out is offered there too.
                <Link
                  href={`/story/${entry.storyId}?from=review`}
                  className="inline-flex items-center gap-1.5 text-neutral-400 transition-colors hover:text-neutral-200"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Open in authoring
                </Link>
              )}
              {entry.storylineId && (
                <Link
                  href={`/storyline/${entry.storylineId}`}
                  className="inline-flex items-center gap-1.5 text-indigo-300 transition-colors hover:text-indigo-200"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  View the published storyline
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-2 border-t border-white/5 px-4 py-3 text-xs text-neutral-500">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
        {entries.length === 1 ? '1 decision' : `${entries.length} decisions`}, newest first. Approving and
        requesting a rewrite leave a draft in the queue; rejecting and publishing take it out.
      </p>
    </section>
  );
}
