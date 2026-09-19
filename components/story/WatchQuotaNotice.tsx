'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { Clapperboard, Sparkles } from 'lucide-react';
import type { WatchQuotaView } from '@/lib/pricing/watch-quota.shared';

/**
 * Payments Phase 3, Unit D (docs/payments/phase-3-plan.md §6): the two things a reader sees when
 * the daily watch quota is in play.
 *
 * `WatchQuotaExhausted` replaces the one-line placeholder Unit B left behind. The plan calls this
 * the one moment a Free watcher is most likely to convert, so it names the plan that actually
 * lifts the limit -- resolved from the catalogue by the server action, never written here as
 * "Audience", so it cannot advertise a tier that is unpublished in this market or one whose
 * capability an admin has since turned off.
 *
 * `WatchQuotaLastSlotConfirm` is the one confirmation decision 2 asks for, and only that one: it
 * appears before the last slot goes, never on a replay (decision 3), and never at all for a reader
 * with slots to spare.
 */

function slotsLeftLabel(view: WatchQuotaView): string {
  const left = Math.max(0, view.limit - view.used);
  return `${left} of ${view.limit} left today`;
}

export function WatchQuotaExhausted({ view }: { view: WatchQuotaView }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-900/70 p-8 text-center shadow-2xl backdrop-blur"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10">
          <Clapperboard className="h-6 w-6 text-emerald-300" aria-hidden />
        </div>

        <h1 className="mt-5 font-serif text-2xl text-neutral-50">
          That is today&apos;s {view.limit} stories
        </h1>

        <p className="mt-3 text-sm leading-6 text-neutral-400">
          Your next {view.limit} open tomorrow morning. Anything you have already started today you can
          still pick back up &mdash; returning to a story you have watched today never counts again.
        </p>

        {view.upsell ? (
          <>
            <Link
              href="/wallet"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Watch without a daily limit with {view.upsell.name}
            </Link>
            <p className="mt-3 text-xs text-neutral-500">
              Or come back tomorrow &mdash; the limit resets every morning.
            </p>
          </>
        ) : (
          <p className="mt-6 text-xs text-neutral-500">Come back tomorrow &mdash; the limit resets every morning.</p>
        )}

        <Link
          href="/"
          className="mt-6 inline-block text-sm text-neutral-400 underline-offset-4 transition hover:text-neutral-200 hover:underline"
        >
          Back to the gallery
        </Link>
      </motion.div>
    </div>
  );
}

export function WatchQuotaLastSlotConfirm({
  view,
  title,
  onConfirm,
}: {
  view: WatchQuotaView;
  title: string;
  onConfirm: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-900/70 p-8 text-center shadow-2xl backdrop-blur"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">{slotsLeftLabel(view)}</p>

        <h1 className="mt-4 font-serif text-2xl text-neutral-50">Use your last story on this one?</h1>

        <p className="mt-3 text-sm leading-6 text-neutral-400">
          Opening <span className="text-neutral-200">{title}</span> uses the last of today&apos;s
          {' '}{view.limit}. You can come back to it as often as you like today at no further cost.
        </p>

        <button
          type="button"
          onClick={onConfirm}
          className="mt-6 w-full rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
        >
          Watch it
        </button>

        <Link
          href="/"
          className="mt-4 inline-block text-sm text-neutral-400 underline-offset-4 transition hover:text-neutral-200 hover:underline"
        >
          Save it for tomorrow
        </Link>

        {view.upsell && (
          <p className="mt-6 text-xs text-neutral-500">
            <Link href="/wallet" className="text-emerald-300/90 underline-offset-4 hover:underline">
              {view.upsell.name}
            </Link>{' '}
            removes the daily limit.
          </p>
        )}
      </motion.div>
    </div>
  );
}
