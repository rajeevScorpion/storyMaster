'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Blend, Loader2, Pause, Play, RotateCcw, Save, Sparkles, X, Zap } from 'lucide-react';
import { useReducedMotion } from 'motion/react';

import { useAudioPlayer } from '@/lib/hooks/useAudioPlayer';
import { useStoryTransitionPlayback } from '@/lib/hooks/useStoryTransitionPlayback';
import { getStoryboardPanelBoundariesMs } from '@/lib/storyboard/narration-timing';
import {
  STORY_TRANSITION_DURATION_MAX_MS,
  STORY_TRANSITION_DURATION_MIN_MS,
  STORY_TRANSITION_REGISTRY,
  STORY_TRANSITION_TYPES,
  STORY_TRANSITION_DIRECTIONS,
  STORY_TRANSITION_EASINGS,
  normalizeStoryTransitionSettings,
  type StoryTransitionSettings,
  type StoryTransitionType,
} from '@/lib/story-transitions/settings';
import { getStoryTransitionFlashOpacity, getStoryTransitionLayerStyle } from '@/lib/story-transitions/render';
import type { StoryAspectRatio, StoryBeat } from '@/lib/types/story';

import InfoPopover from '@/components/ui/InfoPopover';
import StoryStoryboardPlayer from './StoryStoryboardPlayer';

interface StoryTransitionDialogProps {
  open: boolean;
  nodeId: string;
  beat: StoryBeat;
  nextBeat?: StoryBeat;
  aspectRatio: StoryAspectRatio;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  storyTextOverlayWordsPerLine: number;
  settings: StoryTransitionSettings;
  onClose: () => void;
  onSave: (settings: StoryTransitionSettings) => Promise<void>;
}

function transitionIcon(type: StoryTransitionType) {
  if (type === 'fast-cut') return Zap;
  if (type === 'soft-fade') return Sparkles;
  return Blend;
}

export default function StoryTransitionDialog({
  open,
  nodeId,
  beat,
  nextBeat,
  aspectRatio,
  vignetteEnabled,
  vignetteAmountPercent,
  storyTextOverlayWordsPerLine,
  settings,
  onClose,
  onSave,
}: StoryTransitionDialogProps) {
  const [draft, setDraft] = useState(() => normalizeStoryTransitionSettings(settings));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [beatBoundaryProgress, setBeatBoundaryProgress] = useState<number | null>(null);
  const beatBoundaryFrameRef = useRef<number | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const previewSettings = shouldReduceMotion
    ? normalizeStoryTransitionSettings({ type: 'fast-cut', durationMs: 0 })
    : draft;
  const audio = useAudioPlayer(open ? beat.audioUrl : undefined, `story-transition:${nodeId}`);
  const stopAudio = audio.stop;
  const boundaries = useMemo(
    () => getStoryboardPanelBoundariesMs(audio.durationMs, beat.storyboardNarrationTiming),
    [audio.durationMs, beat.storyboardNarrationTiming]
  );
  const transitionPlayback = useStoryTransitionPlayback({
    enabled: open && Boolean(beat.audioUrl),
    narrationBoundariesMs: boundaries,
    settings: previewSettings,
    narrationTimeMs: audio.currentTimeMs,
    playbackState: audio.playbackState,
    pause: audio.pause,
    play: audio.play,
    seekNarration: audio.seekTo,
  });

  useEffect(() => {
    if (!open) {
      if (beatBoundaryFrameRef.current !== null) {
        window.cancelAnimationFrame(beatBoundaryFrameRef.current);
        beatBoundaryFrameRef.current = null;
      }
      setBeatBoundaryProgress(null);
      stopAudio();
      return;
    }
    setDraft(normalizeStoryTransitionSettings(settings));
    setError(null);
  }, [open, settings, stopAudio]);

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

  useEffect(() => () => {
    if (beatBoundaryFrameRef.current !== null) {
      window.cancelAnimationFrame(beatBoundaryFrameRef.current);
    }
  }, []);

  if (!open || typeof document === 'undefined' || !beat.imageUrl) return null;

  const selectType = (type: StoryTransitionType) => {
    setDraft(normalizeStoryTransitionSettings({
      type,
      durationMs: STORY_TRANSITION_REGISTRY[type].defaultDurationMs,
    }));
  };
  const resetBeatBoundaryPreview = () => {
    if (beatBoundaryFrameRef.current !== null) {
      window.cancelAnimationFrame(beatBoundaryFrameRef.current);
      beatBoundaryFrameRef.current = null;
    }
    setBeatBoundaryProgress(null);
  };
  const replayBeatBoundary = () => {
    if (!nextBeat?.imageUrl || previewSettings.durationMs <= 0) return;
    resetBeatBoundaryPreview();
    audio.pause();
    audio.seekTo(Math.max(0, audio.durationMs));
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / previewSettings.durationMs));
      setBeatBoundaryProgress(progress);
      if (progress < 1) beatBoundaryFrameRef.current = window.requestAnimationFrame(tick);
      else beatBoundaryFrameRef.current = null;
    };
    beatBoundaryFrameRef.current = window.requestAnimationFrame(tick);
  };
  const layerStyle = (incoming: boolean) => {
    if (beatBoundaryProgress === null) return undefined;
    return getStoryTransitionLayerStyle(previewSettings, beatBoundaryProgress, incoming ? 'to' : 'from');
  };
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft);
      stopAudio();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save story transitions.');
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-6">
      <div className="absolute inset-0" aria-hidden="true" />
      <section role="dialog" aria-modal="true" aria-labelledby="story-transition-title" className="relative z-10 flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl shadow-black/70">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <h2 id="story-transition-title" className="text-lg font-semibold text-white">Story Transitions</h2>
          <button type="button" onClick={onClose} disabled={isSaving} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
          <div className="sticky top-0 z-10 self-stretch border-b border-white/10 bg-neutral-950 p-5 lg:self-start lg:w-2/5 lg:max-w-md lg:border-b-0 lg:border-r lg:p-6">
            <div className={`relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[32vh] sm:max-h-[40vh] lg:max-h-[58dvh]' : 'aspect-video'}`}>
              <div className="absolute inset-0" style={layerStyle(false)}>
              <StoryStoryboardPlayer
                gridUrl={beat.imageUrl}
                audioUrl={beat.audioUrl}
                audioElapsedMs={audio.currentTimeMs}
                audioDurationMs={audio.durationMs}
                cycleOverride={false}
                cycleMs={2500}
                vignetteEnabled={vignetteEnabled}
                vignetteAmountPercent={vignetteAmountPercent}
                playbackState={audio.playbackState}
                narrationTiming={beat.storyboardNarrationTiming}
                storyTextOverlayCaptions={beat.storyTextOverlayCaptions}
                storyTextOverlayEnabled={beat.storyTextOverlayEnabled !== false}
                storyTextOverlayMode={beat.storyTextOverlayMode}
                storyTextOverlayStyle={beat.storyTextOverlayStyle}
                storyTextOverlayWordsPerLine={storyTextOverlayWordsPerLine}
                storyTextOverlayTextHighlightSupported={beat.storyTextOverlayAlignment?.textHighlightSupported !== false}
                storyTransitionSettings={previewSettings}
                activeStoryTransition={transitionPlayback.activeTransition}
                storyEffects={beat.storyEffects}
                effectSeed={nodeId}
              />
              </div>
              {beatBoundaryProgress !== null && nextBeat?.imageUrl && (
                <div className="absolute inset-0" style={layerStyle(true)}>
                  <StoryStoryboardPlayer
                    gridUrl={nextBeat.imageUrl}
                    audioUrl={nextBeat.audioUrl}
                    audioElapsedMs={0}
                    audioDurationMs={nextBeat.narrationMetadata?.durationMs ?? 0}
                    cycleOverride={false}
                    cycleMs={2500}
                    vignetteEnabled={vignetteEnabled}
                    vignetteAmountPercent={vignetteAmountPercent}
                    playbackState="paused"
                    narrationTiming={nextBeat.storyboardNarrationTiming}
                    storyTextOverlayCaptions={nextBeat.storyTextOverlayCaptions}
                    storyTextOverlayEnabled={nextBeat.storyTextOverlayEnabled !== false}
                    storyTextOverlayMode={nextBeat.storyTextOverlayMode}
                    storyTextOverlayStyle={nextBeat.storyTextOverlayStyle}
                    storyTextOverlayWordsPerLine={storyTextOverlayWordsPerLine}
                    storyTextOverlayTextHighlightSupported={nextBeat.storyTextOverlayAlignment?.textHighlightSupported !== false}
                    storyTransitionSettings={previewSettings}
                    storyEffects={nextBeat.storyEffects}
                    effectSeed={`${nodeId}:next`}
                  />
                </div>
              )}
              {beatBoundaryProgress !== null && getStoryTransitionFlashOpacity(previewSettings, beatBoundaryProgress) > 0 && (
                <div className="pointer-events-none absolute inset-0 z-30 bg-white" style={{ opacity: getStoryTransitionFlashOpacity(previewSettings, beatBoundaryProgress) }} />
              )}
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => {
                  if (beatBoundaryProgress !== null) {
                    resetBeatBoundaryPreview();
                    audio.stop();
                    audio.play();
                  } else {
                    audio.togglePlayPause();
                  }
                }} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-neutral-950 transition hover:bg-emerald-300" aria-label={audio.playbackState === 'playing' ? 'Pause' : 'Play'}>
                  {audio.playbackState === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                </button>
                <button type="button" onClick={() => { resetBeatBoundaryPreview(); audio.stop(); }} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-neutral-300 transition hover:bg-white/10" aria-label="Restart">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
              <div className={`mt-3 grid gap-2 ${nextBeat?.imageUrl ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button type="button" onClick={() => { resetBeatBoundaryPreview(); transitionPlayback.replayNearestTransition(); }} disabled={previewSettings.type === 'fast-cut'} className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-neutral-600">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" /> Replay transition
                </button>
                {nextBeat?.imageUrl && (
                  <button type="button" onClick={replayBeatBoundary} disabled={previewSettings.type === 'fast-cut'} className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-neutral-600">
                    <RotateCcw className="h-3.5 w-3.5 shrink-0" /> Replay beat boundary
                  </button>
                )}
              </div>
              <input type="range" min={0} max={Math.max(transitionPlayback.visualDurationMs, 1)} step={1} value={Math.min(transitionPlayback.visualTimeMs, transitionPlayback.visualDurationMs)} onChange={(event) => transitionPlayback.seekVisualTime(Number(event.target.value))} className="mt-4 h-2 w-full cursor-pointer accent-emerald-400" aria-label="Transition preview position" />
            </div>
          </div>

          <div className="space-y-4 p-5 sm:p-6 lg:flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white">Transition style</span>
              <InfoPopover title="Story transitions" ariaLabel="About story transitions">
                <p>Controls how this beat hands off to the next one at the panel boundary. Pick a style, then tune it below.</p>
                <p><strong>Duration</strong> sets how long the blend lasts; <strong>Direction</strong> and <strong>Easing</strong> shape wipes and pushes; <strong>Intensity</strong> strengthens blurs, flashes and reveals. Fast Cut has no options.</p>
              </InfoPopover>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {STORY_TRANSITION_TYPES.map((type) => {
                const Icon = transitionIcon(type);
                const selected = draft.type === type;
                return (
                  <button key={type} type="button" onClick={() => selectType(type)} className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-emerald-400/50 bg-emerald-400/12 text-white' : 'border-white/10 bg-white/[0.035] text-neutral-300 hover:bg-white/[0.07]'}`}>
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">{STORY_TRANSITION_REGISTRY[type].label}</span>
                  </button>
                );
              })}
            </div>

            {draft.type !== 'fast-cut' && (
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs font-medium text-neutral-400">
                <span className="shrink-0">Duration</span>
                <input type="range" min={STORY_TRANSITION_DURATION_MIN_MS} max={STORY_TRANSITION_DURATION_MAX_MS} step={50} value={draft.durationMs} onChange={(event) => setDraft(normalizeStoryTransitionSettings({ ...draft, durationMs: Number(event.target.value) }))} className="h-2 min-w-0 flex-1 cursor-pointer accent-emerald-400" />
                <span className="w-16 shrink-0 text-right font-mono text-neutral-500">{draft.durationMs} ms</span>
              </label>
            )}
            {draft.type !== 'fast-cut' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs font-medium text-neutral-400">Direction<select value={draft.direction || 'left'} onChange={(event) => setDraft(normalizeStoryTransitionSettings({ ...draft, direction: event.target.value }))} className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white">{STORY_TRANSITION_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction[0].toUpperCase() + direction.slice(1)}</option>)}</select></label>
                <label className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs font-medium text-neutral-400">Easing<select value={draft.easing || 'ease-in-out'} onChange={(event) => setDraft(normalizeStoryTransitionSettings({ ...draft, easing: event.target.value }))} className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white">{STORY_TRANSITION_EASINGS.map((easing) => <option key={easing} value={easing}>{easing}</option>)}</select></label>
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs font-medium text-neutral-400 sm:col-span-2"><span className="shrink-0">Intensity</span><input type="range" min={0} max={100} step={1} value={draft.intensity ?? 50} onChange={(event) => setDraft(normalizeStoryTransitionSettings({ ...draft, intensity: Number(event.target.value) }))} className="h-2 min-w-0 flex-1 accent-emerald-400" /><span className="w-10 shrink-0 text-right">{draft.intensity ?? 50}%</span></label>
              </div>
            )}
            {error && <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
          </div>
        </div>

        <footer className="flex flex-row items-center justify-end gap-2 border-t border-white/10 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 rounded-full px-5 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50 sm:flex-none">Cancel</button>
          <button type="button" onClick={handleSave} disabled={isSaving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-300 disabled:opacity-40 sm:flex-none">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
