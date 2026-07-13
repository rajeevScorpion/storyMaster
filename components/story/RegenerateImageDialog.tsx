'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronUp, ImageIcon, Loader2, X } from 'lucide-react';
import { useStoryStore } from '@/lib/store/story-store';
import {
  PANEL_LABELS,
  STORYBOARD_PANEL_KEYS,
  type ImageRegenerationMode,
  type StoryboardPanelKey,
} from '@/lib/ai/image-regeneration.shared';

const MAX_OVERALL_SUGGESTION_CHARS = 500;
const MAX_PANEL_SUGGESTION_CHARS = 300;

export interface RegenerateImageDialogProps {
  open: boolean;
  nodeId: string;
  isStoryboard: boolean;
  onClose: () => void;
}

/**
 * Pack 1 image regeneration dialog: refine/reimagine mode, an optional overall
 * visual suggestion, and (for storyboard beats, flag-gated) per-panel
 * instructions. Regeneration never changes story text, narration, options, or
 * later beats, and the previous image stays available in version history.
 */
export default function RegenerateImageDialog({ open, nodeId, isStoryboard, onClose }: RegenerateImageDialogProps) {
  const regenerateImageForNode = useStoryStore((state) => state.regenerateImageForNode);
  const isRegeneratingImage = useStoryStore((state) => state.isRegeneratingImage);
  const activeImageJobNodeIds = useStoryStore((state) => state.activeImageJobNodeIds);
  const panelSuggestionsEnabled = useStoryStore((state) => state.beatControlSettings.panelSuggestionsEnabled);

  const [mode, setMode] = useState<ImageRegenerationMode>('refine');
  const [overallSuggestion, setOverallSuggestion] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [panelSuggestions, setPanelSuggestions] = useState<Partial<Record<StoryboardPanelKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('refine');
      setOverallSuggestion('');
      setPanelSuggestions({});
      setAdvancedOpen(false);
      setSubmitting(false);
    }
  }, [open, nodeId]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, submitting, onClose]);

  const busy = submitting || isRegeneratingImage || activeImageJobNodeIds.includes(nodeId);
  const showAdvanced = isStoryboard && panelSuggestionsEnabled;

  const submit = async () => {
    if (busy) return;
    setSubmitting(true);
    try {
      await regenerateImageForNode(nodeId, {
        mode,
        overallSuggestion: overallSuggestion.trim() || undefined,
        panelSuggestions: showAdvanced ? panelSuggestions : undefined,
      });
      onClose();
    } finally {
      setSubmitting(false);
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
            if (event.target === event.currentTarget && !submitting) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="regenerate-image-title"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex max-h-[min(90vh,44rem)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-amber-500/20 bg-neutral-900/95 shadow-2xl backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 pb-4 pt-6">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.28em] text-amber-200">
                  <ImageIcon className="h-3.5 w-3.5" /> Regenerate Image
                </p>
                <h3 id="regenerate-image-title" className="mt-2 text-2xl font-serif text-neutral-100">
                  What would you like to change visually?
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                  The story, narration, and choices stay exactly the same. Your current image remains safe in version
                  history.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-full bg-white/5 p-2 text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <fieldset className="space-y-2">
                <legend className="text-xs font-sans uppercase tracking-wider text-neutral-500">Mode</legend>
                {(
                  [
                    {
                      value: 'refine' as const,
                      title: 'Refine',
                      description: 'Keep the scene close to the current image — improve quality, clarity, and composition.',
                    },
                    {
                      value: 'reimagine' as const,
                      title: 'Reimagine',
                      description: 'Allow a stronger visual reinterpretation while preserving the story moment.',
                    },
                  ]
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors ${
                      mode === option.value
                        ? 'border-amber-400/40 bg-amber-500/10'
                        : 'border-white/10 bg-neutral-950/50 hover:border-white/20'
                    }`}
                  >
                    <input
                      type="radio"
                      name="regeneration-mode"
                      value={option.value}
                      checked={mode === option.value}
                      onChange={() => setMode(option.value)}
                      disabled={busy}
                      className="mt-1 accent-amber-400"
                    />
                    <span>
                      <span className="block text-sm font-medium text-neutral-100">{option.title}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-neutral-400">{option.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div>
                <label htmlFor="overall-suggestion" className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                  Visual suggestion <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  id="overall-suggestion"
                  value={overallSuggestion}
                  onChange={(event) => setOverallSuggestion(event.target.value.slice(0, MAX_OVERALL_SUGGESTION_CHARS))}
                  rows={3}
                  disabled={busy}
                  placeholder="e.g. Make the lighting warmer. Add more forest detail. Keep the characters the same."
                  className="mt-2 w-full resize-y rounded-2xl border border-white/10 bg-neutral-950/70 p-3.5 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400/40 focus:outline-none focus:ring-1 focus:ring-amber-400/40 disabled:opacity-60"
                />
              </div>

              {showAdvanced && (
                <div className="rounded-2xl border border-white/10 bg-neutral-950/50">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((value) => !value)}
                    aria-expanded={advancedOpen}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-neutral-200 transition-colors hover:text-white"
                  >
                    Advanced panel controls
                    {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {advancedOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 px-4 pb-4">
                          <p className="text-xs leading-snug text-neutral-500">
                            Each instruction changes only its own panel; the storyboard keeps all four panels.
                          </p>
                          {STORYBOARD_PANEL_KEYS.map((key) => (
                            <div key={key}>
                              <label htmlFor={`panel-${key}`} className="text-xs font-sans text-neutral-400">
                                {PANEL_LABELS[key]}
                              </label>
                              <textarea
                                id={`panel-${key}`}
                                value={panelSuggestions[key] ?? ''}
                                onChange={(event) =>
                                  setPanelSuggestions((prev) => ({
                                    ...prev,
                                    [key]: event.target.value.slice(0, MAX_PANEL_SUGGESTION_CHARS),
                                  }))
                                }
                                rows={2}
                                disabled={busy}
                                className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-neutral-950/70 p-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400/40 focus:outline-none focus:ring-1 focus:ring-amber-400/40 disabled:opacity-60"
                              />
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/5 px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-full px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? 'Generating…' : 'Regenerate image'}
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
