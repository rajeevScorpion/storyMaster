'use client';

import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';

/**
 * Client-side net for the "older/newer deployment" server-action skew error.
 *
 * When a tab loaded from an earlier build POSTs a server action whose ID no
 * longer exists on the current deployment, Next.js rejects with "Failed to find
 * Server Action …". Vercel Skew Protection normally routes those requests back
 * to their origin deployment, but that isn't available on every plan — so we
 * listen for the uncaught error globally and prompt a reload instead of leaving
 * the user with a silently broken button. We don't auto-reload, to avoid
 * clobbering in-progress input (e.g. a half-typed story prompt).
 */
const SKEW_SIGNATURES = [
  'Failed to find Server Action',
  'This request might be from an older or newer deployment',
];

function messageOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.message} ${value.stack ?? ''}`;
  try {
    return String((value as { message?: unknown }).message ?? value);
  } catch {
    return '';
  }
}

function isSkewError(text: string): boolean {
  return SKEW_SIGNATURES.some((sig) => text.includes(sig));
}

export default function DeploymentSkewGuard() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const flag = () => setStale(true);

    const onRejection = (event: PromiseRejectionEvent) => {
      if (isSkewError(messageOf(event.reason))) flag();
    };
    const onError = (event: ErrorEvent) => {
      if (isSkewError(messageOf(event.error) || event.message)) flag();
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-0 z-[9999] flex justify-center px-4 pb-4"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-emerald-500/30 bg-neutral-900/90 px-4 py-3 shadow-2xl backdrop-blur-xl">
        <RefreshCcw className="h-5 w-5 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-100">
            A new version of Kissago is available
          </p>
          <p className="text-xs text-neutral-400">Reload to keep everything working.</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-emerald-400"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
