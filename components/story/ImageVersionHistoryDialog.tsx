'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { listBeatImageVersions, type BeatImageVersionView } from '@/app/actions/beat-control';
import { useStoryStore } from '@/lib/store/story-store';

export interface ImageVersionHistoryDialogProps {
  open: boolean;
  nodeId: string;
  onClose: () => void;
}

const MODE_LABELS: Record<string, string> = {
  initial: 'Original',
  refine: 'Refined',
  reimagine: 'Reimagined',
  restore: 'Restored',
  upload: 'Uploaded',
};

/**
 * Pack 1 image version history: every regeneration is kept as a version;
 * restoring only switches which version is active (no regeneration, no
 * deletion).
 */
export default function ImageVersionHistoryDialog({ open, nodeId, onClose }: ImageVersionHistoryDialogProps) {
  const session = useStoryStore((state) => state.session);
  const restoreImageVersionForNode = useStoryStore((state) => state.restoreImageVersionForNode);
  const storyId = session?.savedStoryId;

  const [versions, setVersions] = useState<BeatImageVersionView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!storyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listBeatImageVersions({ storyId, nodeId });
      setVersions(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load image versions.');
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [storyId, nodeId]);

  useEffect(() => {
    if (open) {
      setVersions(null);
      void refresh();
    }
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !restoringKey) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, restoringKey, onClose]);

  const handleRestore = async (storageKey: string) => {
    setRestoringKey(storageKey);
    setError(null);
    try {
      const result = await restoreImageVersionForNode(nodeId, storageKey);
      if (result.status === 'failed') {
        setError(result.error);
        return;
      }
      await refresh();
    } finally {
      setRestoringKey(null);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !restoringKey) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-versions-title"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex max-h-[min(90vh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-900/95 shadow-2xl backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 pb-4 pt-6">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.28em] text-sky-200">
                  <History className="h-3.5 w-3.5" /> Image Versions
                </p>
                <h3 id="image-versions-title" className="mt-2 text-2xl font-serif text-neutral-100">
                  Version history
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                  Restoring a version only switches the active image — nothing is regenerated or deleted.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={Boolean(restoringKey)}
                className="rounded-full bg-white/5 p-2 text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loading && (
                <p className="flex items-center gap-2 text-sm text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
                </p>
              )}
              {!loading && versions && versions.length === 0 && (
                <p className="text-sm text-neutral-400">
                  No versions yet. Regenerate the image to start building version history.
                </p>
              )}
              {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}
              {!loading && versions && versions.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {versions.map((version) => {
                    const modeLabel = MODE_LABELS[version.mode ?? ''] ?? 'Image';
                    const suggestionSummary = version.overallSuggestion
                      ? version.overallSuggestion
                      : version.panelSuggestions
                      ? 'Panel-specific suggestions'
                      : null;
                    return (
                      <div
                        key={`${version.storageKey}-${version.versionNumber ?? version.uploadedAt}`}
                        className={`overflow-hidden rounded-2xl border transition-colors ${
                          version.isActive ? 'border-emerald-400/40 bg-emerald-500/5' : 'border-white/10 bg-neutral-950/50'
                        }`}
                      >
                        <div className="relative aspect-video bg-neutral-950">
                          <img
                            src={version.displayUrl}
                            alt={`Image version ${version.versionNumber ?? ''}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          {version.isActive && (
                            <span className="absolute left-2 top-2 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider text-emerald-200 backdrop-blur-sm">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="space-y-1.5 p-3.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-neutral-100">
                              {version.versionNumber ? `Version ${version.versionNumber}` : 'Version'}
                              <span className="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider text-neutral-400">
                                {modeLabel}
                              </span>
                            </p>
                          </div>
                          <p className="text-xs text-neutral-500">
                            {new Date(version.uploadedAt).toLocaleString()}
                          </p>
                          {suggestionSummary && (
                            <p className="line-clamp-2 text-xs leading-snug text-neutral-400" title={suggestionSummary}>
                              “{suggestionSummary}”
                            </p>
                          )}
                          {!version.isActive && (
                            <button
                              type="button"
                              onClick={() => void handleRestore(version.storageKey)}
                              disabled={Boolean(restoringKey)}
                              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {restoringKey === version.storageKey ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              Restore this version
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
