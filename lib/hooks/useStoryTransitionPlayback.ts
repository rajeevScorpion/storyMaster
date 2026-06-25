'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaybackState } from '@/lib/hooks/useAudioPlayer';
import { normalizeStoryTransitionSettings } from '@/lib/story-transitions/settings';
import {
  buildStoryTransitionTimeline,
  getStoryTransitionClockState,
  narrationTimeToStoryVisualTime,
  type StoryTransitionWindow,
} from '@/lib/story-transitions/timeline';

export interface ActiveStoryTransition extends StoryTransitionWindow {
  progress: number;
}

interface UseStoryTransitionPlaybackInput {
  enabled: boolean;
  narrationBoundariesMs: readonly number[];
  settings: unknown;
  narrationTimeMs: number;
  playbackState: PlaybackState;
  /** When false, panel transitions animate over the live narration clock. */
  pauseNarrationDuringTransition?: boolean;
  pause: () => void;
  play: () => void;
  seekNarration: (timeMs: number) => void;
}

export function useStoryTransitionPlayback(input: UseStoryTransitionPlaybackInput) {
  const settings = useMemo(
    () => normalizeStoryTransitionSettings(input.settings),
    [input.settings]
  );
  const boundaryKey = input.narrationBoundariesMs.join(':');
  const timeline = useMemo(
    () => buildStoryTransitionTimeline(input.narrationBoundariesMs, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundaryKey represents the numeric boundary sequence.
    [boundaryKey, settings]
  );
  const [activeTransition, setActiveTransition] = useState<ActiveStoryTransition | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastNarrationTimeRef = useRef(input.narrationTimeMs);
  const transitionActiveRef = useRef(false);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    transitionActiveRef.current = false;
  }, []);

  const startTransition = useCallback((
    transitionWindow: StoryTransitionWindow,
    initialProgress: number,
    resumeAfter: boolean,
    interruptNarration = true
  ) => {
    cancelFrame();
    if (interruptNarration) {
      input.pause();
      input.seekNarration(transitionWindow.narrationTimeMs);
    }
    lastNarrationTimeRef.current = transitionWindow.narrationTimeMs;
    const durationMs = Math.max(1, transitionWindow.endMs - transitionWindow.startMs);
    const startedAt = performance.now() - Math.max(0, Math.min(1, initialProgress)) * durationMs;
    transitionActiveRef.current = true;

    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
      setActiveTransition({ ...transitionWindow, progress });
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      frameRef.current = null;
      transitionActiveRef.current = false;
      setActiveTransition(null);
      if (resumeAfter && interruptNarration) input.play();
    };
    frameRef.current = window.requestAnimationFrame(tick);
  }, [cancelFrame, input]);

  useEffect(() => () => cancelFrame(), [cancelFrame]);

  useEffect(() => {
    if (!input.enabled || settings.durationMs <= 0) {
      cancelFrame();
      setActiveTransition(null);
      lastNarrationTimeRef.current = input.narrationTimeMs;
      return;
    }
    if (input.playbackState !== 'playing' || transitionActiveRef.current) {
      if (!transitionActiveRef.current) lastNarrationTimeRef.current = input.narrationTimeMs;
      return;
    }

    const previousTime = lastNarrationTimeRef.current;
    if (input.narrationTimeMs < previousTime - 50) {
      lastNarrationTimeRef.current = input.narrationTimeMs;
      return;
    }
    const crossed = timeline.transitions.find((transition) => (
      previousTime < transition.narrationTimeMs
      && input.narrationTimeMs >= transition.narrationTimeMs
    ));
    lastNarrationTimeRef.current = input.narrationTimeMs;
    if (crossed) {
      startTransition(
        crossed,
        0,
        true,
        input.pauseNarrationDuringTransition !== false
      );
    }
  }, [cancelFrame, input.enabled, input.narrationTimeMs, input.pauseNarrationDuringTransition, input.playbackState, settings.durationMs, startTransition, timeline.transitions]);

  const visualTimeMs = activeTransition
    ? activeTransition.startMs + activeTransition.progress * (activeTransition.endMs - activeTransition.startMs)
    : narrationTimeToStoryVisualTime(timeline, input.narrationTimeMs);

  const seekVisualTime = useCallback((timeMs: number) => {
    cancelFrame();
    const state = getStoryTransitionClockState(timeline, timeMs);
    input.pause();
    input.seekNarration(state.narrationTimeMs);
    lastNarrationTimeRef.current = state.narrationTimeMs;
    setActiveTransition(state.transition);
  }, [cancelFrame, input, timeline]);

  const replayNearestTransition = useCallback(() => {
    if (timeline.transitions.length === 0) return;
    const nearest = [...timeline.transitions].sort((left, right) => (
      Math.abs(left.narrationTimeMs - input.narrationTimeMs)
      - Math.abs(right.narrationTimeMs - input.narrationTimeMs)
    ))[0];
    startTransition(nearest, 0, input.playbackState === 'playing');
  }, [input.narrationTimeMs, input.playbackState, startTransition, timeline.transitions]);

  return {
    timeline,
    settings,
    activeTransition,
    visualTimeMs,
    visualDurationMs: timeline.totalDurationMs,
    seekVisualTime,
    replayNearestTransition,
  };
}
