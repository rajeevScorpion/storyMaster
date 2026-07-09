'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, PenLine, X } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useStoryStore } from '@/lib/store/story-store';
import type { TimelineImpact } from '@/app/actions/beat-control';

export interface EditBeatTextDialogProps {
  open: boolean;
  nodeId: string;
  initialText: string;
  onClose: () => void;
}

/**
 * Pack 1 beat text editor. Editing the latest beat saves directly; editing a
 * beat with later beats raises the destructive timeline-rewrite confirmation
 * before anything changes. Cancel always leaves the story untouched.
 */
export default function EditBeatTextDialog({ open, nodeId, initialText, onClose }: EditBeatTextDialogProps) {
  const editBeatTextForNode = useStoryStore((state) => state.editBeatTextForNode);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [pendingRewrite, setPendingRewrite] = useState<{ impact: TimelineImpact; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setText(initialText);
      setError(null);
      setSavedNotice(false);
      setPendingRewrite(null);
    }
  }, [open, initialText, nodeId]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !pendingRewrite) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, saving, pendingRewrite, onClose]);

  const submit = async (confirmTimelineRewrite: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const result = await editBeatTextForNode(nodeId, text, confirmTimelineRewrite);
      if (result.status === 'requires_confirmation') {
        setPendingRewrite({ impact: result.impact, message: result.message });
        return;
      }
      if (result.status === 'failed') {
        setPendingRewrite(null);
        setError(result.error);
        return;
      }
      setPendingRewrite(null);
      setSavedNotice(true);
      window.setTimeout(() => {
        setSavedNotice(false);
        onClose();
      }, 1600);
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const impact = pendingRewrite?.impact;
  const trimmed = text.trim();
  const unchanged = trimmed === initialText.trim();

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) onClose();
            }}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-beat-text-title"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex max-h-[min(90vh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-900/95 shadow-2xl backdrop-blur-md"
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 pb-4 pt-6">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.28em] text-emerald-200">
                    <PenLine className="h-3.5 w-3.5" /> Edit Beat
                  </p>
                  <h3 id="edit-beat-text-title" className="mt-2 text-2xl font-serif text-neutral-100">
                    Edit story text
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                    Changing the text of a past beat rewrites the story from that point onward — you&apos;ll be asked
                    to confirm before anything later is removed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-full bg-white/5 p-2 text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={10}
                  disabled={saving}
                  aria-label="Beat story text"
                  className="w-full resize-y rounded-2xl border border-white/10 bg-neutral-950/70 p-4 font-serif text-base leading-relaxed text-neutral-100 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                />
                {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
                <AnimatePresence>
                  {savedNotice && (
                    <motion.p
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-3 text-sm text-emerald-300"
                    >
                      Saved. You can regenerate narration, image, or options from the beat menu.
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/5 px-6 py-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-full px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submit(false)}
                  disabled={saving || !trimmed || unchanged}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && !pendingRewrite && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save text
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(pendingRewrite)}
        title="Rewrite the story from this beat?"
        message={
          <span>
            {pendingRewrite?.message.split('\n\n')[1] ??
              'All later beats, generated images, narration, and options after this beat will be removed. You can then continue the story again from the updated version.'}
            {impact && (
              <span className="mt-2 block text-xs text-neutral-500">
                This will remove {impact.affectedBeatCount} later beat{impact.affectedBeatCount === 1 ? '' : 's'}
                {impact.affectedAssets.images > 0 && `, ${impact.affectedAssets.images} image${impact.affectedAssets.images === 1 ? '' : 's'}`}
                {impact.affectedAssets.narration > 0 && `, ${impact.affectedAssets.narration} narration track${impact.affectedAssets.narration === 1 ? '' : 's'}`}
                {impact.affectsPublishedStorylines && ' — a published storyline includes these beats and will be unpublished'}
                .
              </span>
            )}
          </span>
        }
        confirmLabel="Rewrite from this beat"
        cancelLabel="Cancel"
        tone="danger"
        busy={saving}
        onConfirm={() => void submit(true)}
        onCancel={() => {
          if (!saving) setPendingRewrite(null);
        }}
      />
    </>,
    document.body
  );
}
