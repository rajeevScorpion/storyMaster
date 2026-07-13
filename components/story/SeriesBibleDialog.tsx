'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { BookMarked, Loader2, Save, X } from 'lucide-react';
import { updateSeriesBible } from '@/app/actions/episodes';
import type { SeriesBible } from '@/lib/types/episodes';

export interface SeriesBibleDialogProps {
  open: boolean;
  bible: SeriesBible | null;
  onClose: () => void;
  onSaved: (bible: SeriesBible) => void;
}

/**
 * Pack 2 series bible viewer/editor. The bible is LLM-generated canon carried
 * across episodes; the author may reshape it before starting the next episode.
 */
export default function SeriesBibleDialog({ open, bible, onClose, onSaved }: SeriesBibleDialogProps) {
  const [title, setTitle] = useState('');
  const [bibleText, setBibleText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bible) return;
    setTitle(bible.title);
    setBibleText(bible.bibleText);
    setError(null);
  }, [open, bible]);

  if (typeof document === 'undefined') return null;

  const isDirty = Boolean(bible && (title !== bible.title || bibleText !== bible.bibleText));

  const handleSave = async () => {
    if (!bible || saving || !isDirty) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateSeriesBible(bible.branchId, { title, bibleText });
      onSaved(saved);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the series bible.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && bible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-label="Series bible"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 border-b border-white/5 p-5">
              <BookMarked className="h-5 w-5 shrink-0 text-indigo-300" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-serif text-neutral-100">Series bible</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  The canon every future episode follows. Edit anything before continuing the series.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-50"
                aria-label="Close series bible"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">Series title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={saving}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-400/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/40 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs font-sans uppercase tracking-wider text-neutral-500">Canon</span>
                <textarea
                  value={bibleText}
                  onChange={(event) => setBibleText(event.target.value)}
                  rows={16}
                  disabled={saving}
                  className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 font-mono text-xs leading-relaxed text-neutral-200 focus:border-indigo-400/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/40 disabled:opacity-60"
                />
              </label>
              {error && <p className="text-xs leading-snug text-rose-300">{error}</p>}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/5 p-5">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !isDirty}
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-400 px-5 py-2 text-xs font-semibold text-neutral-950 transition-colors hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save bible
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
