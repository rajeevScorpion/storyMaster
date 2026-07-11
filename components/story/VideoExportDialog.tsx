'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Coins, Loader2, Lock, X } from 'lucide-react';

import { getAvailableVideoExportPresets } from '@/app/actions/video-export';
import type { ResolvedExportPreset } from '@/lib/video-export/presets';

export default function VideoExportDialog({
  open,
  onClose,
  onSelect,
  coinCost,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (preset: ResolvedExportPreset) => void;
  coinCost?: number | null;
}) {
  const [presets, setPresets] = useState<ResolvedExportPreset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Refetch on every open so admin preset changes show up without a reload;
    // previously loaded presets stay visible while the refresh is in flight.
    getAvailableVideoExportPresets()
      .then((loaded) => {
        if (cancelled) return;
        setPresets(loaded);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load export options. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-950/80 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/95 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg text-neutral-100">Download Video</h2>
              <button
                onClick={onClose}
                className="rounded-full p-1.5 text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-300"
                aria-label="Close export options"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-400">Pick a quality for your MP4 export.</p>

            <div className="mt-4 space-y-2">
              {loadError ? (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {loadError}
                </p>
              ) : presets === null ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading options…
                </div>
              ) : (
                presets.map((preset) => {
                  const locked = preset.availability === 'locked';
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        if (locked) {
                          window.open('/wallet', '_blank');
                          return;
                        }
                        onSelect(preset);
                      }}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        locked
                          ? 'border-white/5 bg-white/[0.02] hover:bg-white/5'
                          : 'border-white/10 bg-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/10'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium ${locked ? 'text-neutral-500' : 'text-neutral-100'}`}>
                          {preset.label}
                          {preset.isExperimental && (
                            <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                              Beta
                            </span>
                          )}
                        </span>
                        {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-neutral-500" />}
                      </span>
                      <span className={`mt-0.5 block text-xs ${locked ? 'text-neutral-600' : 'text-neutral-400'}`}>
                        {preset.width}×{preset.height} · {preset.fps} fps
                      </span>
                      <span className={`mt-1 block text-xs ${locked ? 'text-neutral-600' : 'text-neutral-400'}`}>
                        {locked
                          ? preset.upgradePromptText || 'Available on Plus and above'
                          : preset.description}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {typeof coinCost === 'number' && coinCost > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
                <Coins className="h-3.5 w-3.5 text-amber-300" />
                Exporting costs {coinCost} {coinCost === 1 ? 'beat' : 'beats'}.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
