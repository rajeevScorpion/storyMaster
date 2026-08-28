'use client';

import { useEffect, useState } from 'react';

import { getManagedPageContentForModalAction, type ManagedPageModalContent } from '@/app/actions/managed-pages';
import Modal from '@/components/ui/Modal';
import Sheet from '@/components/ui/Sheet';
import { useIsDesktopViewport } from '@/lib/hooks/useIsDesktopViewport';
import { formatManagedPageDate, renderManagedPageBlocksFromContent } from '@/lib/managed-pages/render.shared';

const FALLBACK_TITLES: Record<string, string> = {
  terms: 'Terms & End User Licence Agreement',
  privacy_policy: 'Privacy & Data Notice',
};

interface LegalDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** managed_pages.page_key — a stable concept ('terms', 'privacy_policy'), not whatever slug an admin has set. */
  pageKey: string;
  /** Present only when opened from the sign-up checkbox's document link — ticks the box and closes. */
  onAgree?: () => void;
}

/**
 * Sheet on mobile (full-height, sticky header), Modal on desktop (large,
 * capped height, internal scroll) — the same responsive pair the pack asks
 * for. Fetches through getManagedPageContentForModalAction, which resolves
 * {{SUPPORT_EMAIL}} server-side so the body can render here with the pure
 * render.shared.tsx parser (no `server-only` import reachable from a client
 * component). Opening this never ticks the sign-up checkbox on its own —
 * only an explicit Agree click does, via `onAgree`.
 */
export default function LegalDocumentModal({ isOpen, onClose, pageKey, onAgree }: LegalDocumentModalProps) {
  const isDesktop = useIsDesktopViewport();
  const [content, setContent] = useState<ManagedPageModalContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing loading UI to an external system (the server action fetch) starting
    setLoading(true);
    setError(null);

    getManagedPageContentForModalAction(pageKey)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError('This document is unavailable right now.');
        } else {
          setContent(result);
        }
      })
      .catch(() => {
        if (!cancelled) setError('This document is unavailable right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, pageKey]);

  const title = content?.title ?? FALLBACK_TITLES[pageKey] ?? 'Document';

  const body = (
    <div>
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-rose-300">{error}</p>
      ) : content ? (
        <>
          {content.docVersion || content.effectiveDate ? (
            <p className="text-xs text-neutral-500">
              {content.docVersion ? `Version ${content.docVersion}` : null}
              {content.docVersion && content.effectiveDate ? ' · ' : null}
              {content.effectiveDate ? `Effective ${formatManagedPageDate(content.effectiveDate)}` : null}
            </p>
          ) : null}
          <div className="mt-4 space-y-5">{renderManagedPageBlocksFromContent(content.content)}</div>
        </>
      ) : null}

      <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/5"
        >
          Close
        </button>
        {onAgree ? (
          <button
            type="button"
            onClick={onAgree}
            className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-neutral-950 shadow-[0_10px_40px_rgba(52,211,153,0.2)] transition-colors hover:bg-emerald-200"
          >
            Agree
          </button>
        ) : null}
      </div>
    </div>
  );

  // Bumped above Modal/Sheet's default 1100 -- this can open from inside
  // AuthDialog (the sign-up Terms/Privacy links), which is itself a Modal at
  // the default stacking order.
  const NESTED_Z_INDEX = 1150;

  if (isDesktop) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidthClassName="max-w-2xl" zIndex={NESTED_Z_INDEX}>
        {body}
      </Modal>
    );
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={title} zIndex={NESTED_Z_INDEX}>
      {body}
    </Sheet>
  );
}
