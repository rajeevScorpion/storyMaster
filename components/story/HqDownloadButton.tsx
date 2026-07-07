'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { createHqDownloadUrl, getBeatHqDownloadState, type BeatHqDownloadState } from '@/app/actions/media-hq';

/**
 * High-quality original download control for a beat image. Renders nothing
 * when no server-pipeline original exists (legacy beats). The signed URL is
 * minted only at click time; entitlement/expiry are enforced server-side —
 * this component only mirrors those states for UI copy.
 */
export default function HqDownloadButton({
  storyId,
  nodeId,
  className,
}: {
  storyId: string;
  nodeId: string;
  className?: string;
}) {
  const [state, setState] = useState<BeatHqDownloadState | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setMessage(null);
    getBeatHqDownloadState(storyId, nodeId)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [storyId, nodeId]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setMessage(null);
    try {
      const result = await createHqDownloadUrl({ storyId, nodeId });
      if ('url' in result) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else if (result.error === 'expired') {
        setMessage('The high-resolution file has expired. Standard quality is still available.');
        setState((prev) => (prev ? { ...prev, available: false, reason: 'expired' } : prev));
      } else if (result.error === 'not_entitled') {
        setMessage('High-quality download is not included in your plan.');
      } else {
        setMessage('High-quality download is unavailable right now.');
      }
    } catch {
      setMessage('High-quality download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }, [storyId, nodeId]);

  // No original recorded (legacy beat / free buffer already cleaned): no control.
  if (!state || state.reason === 'none' || state.reason === 'not_signed_in') return null;

  const availableUntil = state.expiresAt
    ? new Date(state.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const title = state.available
    ? `Download high quality${availableUntil ? ` — available until ${availableUntil}` : ''}`
    : state.reason === 'expired'
    ? 'High quality expired — standard quality is still available'
    : 'High-quality download is available on Plus and Studio plans';

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={!state.available || downloading}
        title={title}
        aria-label={title}
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          state.available
            ? 'border-white/10 bg-neutral-950/65 text-neutral-200 hover:border-emerald-400/50 hover:text-emerald-300'
            : 'cursor-not-allowed border-white/5 bg-neutral-950/40 text-neutral-600'
        }`}
      >
        {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      </button>
      {message && (
        <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-amber-300">{message}</p>
      )}
    </div>
  );
}
