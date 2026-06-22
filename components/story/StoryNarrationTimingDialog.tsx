'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Pause, Play, RotateCcw, TimerReset, X } from 'lucide-react';

import InfoPopover from '@/components/ui/InfoPopover';
import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import {
  buildEqualStoryboardNarrationTiming,
  formatStoryboardTimestamp,
  getStoryboardPanelBoundariesMs,
  normalizeStoryboardNarrationTiming,
  parseStoryboardTimestamp,
} from '@/lib/storyboard/narration-timing';
import type { StoryAspectRatio, StoryBeat, StoryboardNarrationTiming } from '@/lib/types/story';

import StoryStoryboardPlayer from './StoryStoryboardPlayer';

interface StoryNarrationTimingDialogProps {
  open: boolean;
  nodeId: string;
  beat: StoryBeat;
  aspectRatio: StoryAspectRatio;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  storyTextOverlayWordsPerLine: number;
  onClose: () => void;
  onSave: (timing: StoryboardNarrationTiming | null) => Promise<void>;
}

export default function StoryNarrationTimingDialog({
  open,
  nodeId,
  beat,
  aspectRatio,
  vignetteEnabled,
  vignetteAmountPercent,
  storyTextOverlayWordsPerLine,
  onClose,
  onSave,
}: StoryNarrationTimingDialogProps) {
  const {
    playbackState,
    togglePlayPause,
    stop,
    seekTo,
    currentTimeMs,
    durationMs,
  } = useAudioPlayer(open ? beat.audioUrl : undefined, `story-timing:${nodeId}`);
  const [fields, setFields] = useState<[string, string, string]>(['', '', '']);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedForRef = useRef<string | null>(null);
  const openedNodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      openedNodeRef.current = null;
      return;
    }
    if (openedNodeRef.current === null) {
      openedNodeRef.current = nodeId;
    } else if (openedNodeRef.current !== nodeId) {
      stop();
      onClose();
    }
  }, [nodeId, onClose, open, stop]);

  useEffect(() => {
    if (!open) {
      initializedForRef.current = null;
      stop();
      return;
    }
    if (durationMs <= 0) return;
    const key = `${nodeId}:${beat.audioUrl}:${Math.round(durationMs)}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;
    const initial = normalizeStoryboardNarrationTiming(beat.storyboardNarrationTiming, durationMs)
      ?? buildEqualStoryboardNarrationTiming(durationMs);
    setFields(initial
      ? initial.panelEndTimesMs.map(formatStoryboardTimestamp) as [string, string, string]
      : ['', '', '']);
    setError(initial ? null : 'Narration must be at least 400 ms to time four panels.');
  }, [beat.audioUrl, beat.storyboardNarrationTiming, durationMs, nodeId, open, stop]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSaving) return;
      // Let an open help popover swallow Escape before closing the dialog.
      if (document.querySelector('[data-info-popover-open]')) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, onClose, open]);

  const parsedDraft = useMemo<StoryboardNarrationTiming | null>(() => {
    const values = fields.map(parseStoryboardTimestamp);
    if (durationMs <= 0 || values.some((value) => value === null)) return null;
    return {
      version: 1,
      panelEndTimesMs: values as [number, number, number],
      audioDurationMs: Math.round(durationMs),
    };
  }, [durationMs, fields]);
  const validatedDraft = useMemo(
    () => normalizeStoryboardNarrationTiming(parsedDraft, durationMs),
    [durationMs, parsedDraft]
  );
  const boundaries = getStoryboardPanelBoundariesMs(durationMs, validatedDraft);

  if (!open || typeof document === 'undefined' || !beat.audioUrl || !beat.imageUrl) return null;

  const setBoundary = (index: number, valueMs: number | null, displayValue?: string) => {
    const nextFields = [...fields] as [string, string, string];
    nextFields[index] = displayValue ?? (valueMs === null ? '' : formatStoryboardTimestamp(valueMs));
    setFields(nextFields);
    if (valueMs === null || durationMs <= 0) {
      setError('Use the MM:SS.mmm format, for example 00:12.450.');
      return;
    }
    const nextValues = nextFields.map(parseStoryboardTimestamp);
    if (nextValues.some((value) => value === null)) {
      setError('Use the MM:SS.mmm format, for example 00:12.450.');
      return;
    }
    const nextDraft: StoryboardNarrationTiming = {
      version: 1,
      panelEndTimesMs: nextValues as [number, number, number],
      audioDurationMs: Math.round(durationMs),
    };
    setError(normalizeStoryboardNarrationTiming(nextDraft, durationMs)
      ? null
      : 'Panel ends must increase in order and leave at least 100 ms for every panel.');
  };

  const handleSave = async (timing: StoryboardNarrationTiming | null) => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(timing);
      stop();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save timing.');
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-6">
      <div className="absolute inset-0" aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-narration-timing-title"
        className="relative z-10 flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl shadow-black/70"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="story-narration-timing-title" className="text-lg font-semibold text-white">
                Story Narration Timing
              </h2>
              <InfoPopover title="When to use narration timing" ariaLabel="How to use story narration timing">
                <p>Use this when the spoken narration and storyboard panels do not change at the right moments.</p>
                <p>Play the narration, pause at the end of panels 1, 2, and 3, then press the matching Mark end button. Panel 4 always ends with the narration.</p>
                <p>You can also copy the live clock and paste a value into any panel end field.</p>
              </InfoPopover>
            </div>
            <p className="mt-1 text-sm text-neutral-400">Set when each panel changes for this beat.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
          <div className="sticky top-0 z-10 self-stretch border-b border-white/10 bg-neutral-950 p-5 lg:self-start lg:w-2/5 lg:max-w-md lg:border-b-0 lg:border-r lg:p-6">
            <div className={`relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[32vh] sm:max-h-[40vh] lg:max-h-[58dvh]' : 'aspect-video'}`}>
              <StoryStoryboardPlayer
                gridUrl={beat.imageUrl}
                audioUrl={beat.audioUrl}
                audioElapsedMs={currentTimeMs}
                audioDurationMs={durationMs}
                cycleOverride={false}
                cycleMs={2500}
                vignetteEnabled={vignetteEnabled}
                vignetteAmountPercent={vignetteAmountPercent}
                playbackState={playbackState}
                narrationTiming={validatedDraft ?? undefined}
                textOverlayEnabled={false}
                storyTextOverlayCaptions={beat.storyTextOverlayCaptions}
                storyTextOverlayEnabled={beat.storyTextOverlayEnabled !== false}
                storyTextOverlayMode={beat.storyTextOverlayMode}
                storyTextOverlayStyle={beat.storyTextOverlayStyle}
                storyTextOverlayWordsPerLine={storyTextOverlayWordsPerLine}
                storyTextOverlayTextHighlightSupported={beat.storyTextOverlayAlignment?.textHighlightSupported !== false}
                storyEffects={beat.storyEffects}
                effectSeed={nodeId}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={togglePlayPause} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-neutral-950 transition hover:bg-emerald-300" aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}>
                    {playbackState === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                  </button>
                  <button type="button" onClick={stop} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-neutral-300 transition hover:bg-white/10" aria-label="Restart">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base tabular-nums text-white">{formatStoryboardTimestamp(currentTimeMs)}</span>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(formatStoryboardTimestamp(currentTimeMs))} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-neutral-400 transition hover:border-emerald-400/40 hover:text-emerald-300" aria-label="Copy clock">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(durationMs, 1)}
                step={1}
                value={Math.min(currentTimeMs, durationMs || 0)}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="mt-4 h-2 w-full cursor-pointer accent-emerald-400"
                aria-label="Narration position"
              />
              <div className="mt-2 flex justify-between font-mono text-[11px] text-neutral-500">
                <span>00:00.000</span>
                <span>{formatStoryboardTimestamp(durationMs)}</span>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 lg:flex-1">
            <div className="space-y-3">
              {[0, 1, 2, 3].map((panelIndex) => (
                <div key={panelIndex} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">Panel {panelIndex + 1}</p>
                    {panelIndex < 3 && (
                      <button
                        type="button"
                        onClick={() => setBoundary(panelIndex, currentTimeMs)}
                        className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-400/15"
                      >
                        Mark end
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs text-neutral-500">
                      Start
                      <input value={formatStoryboardTimestamp(boundaries[panelIndex])} readOnly className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-neutral-400 outline-none" />
                    </label>
                    <label className="text-xs text-neutral-500">
                      End
                      {panelIndex < 3 ? (
                        <input
                          value={fields[panelIndex]}
                          onChange={(event) => setBoundary(panelIndex, parseStoryboardTimestamp(event.target.value), event.target.value)}
                          onBlur={() => {
                            const value = parseStoryboardTimestamp(fields[panelIndex]);
                            if (value !== null) setBoundary(panelIndex, value);
                          }}
                          placeholder="00:00.000"
                          className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/10"
                        />
                      ) : (
                        <input value={formatStoryboardTimestamp(durationMs)} readOnly className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-neutral-400 outline-none" />
                      )}
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {error && <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button
            type="button"
            onClick={() => handleSave(null)}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
          >
            <TimerReset className="h-4 w-4" />
            <span className="sm:hidden">Automatic Timing</span>
            <span className="hidden sm:inline">Use Automatic Timing</span>
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 rounded-full px-5 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50 sm:flex-none">Cancel</button>
            <button type="button" onClick={() => validatedDraft && handleSave(validatedDraft)} disabled={!validatedDraft || isSaving} className="flex-1 rounded-full bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">
              {isSaving ? 'Saving...' : 'Save Timing'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
