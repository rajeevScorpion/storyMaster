'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { takePreloadedAudio } from '@/lib/media/audio-preload';
import { toMediaFetchUrl } from '@/lib/media/client';

export type PlaybackState = 'idle' | 'playing' | 'paused';

interface UseAudioPlayerReturn {
  playbackState: PlaybackState;
  togglePlayPause: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekTo: (timeMs: number) => void;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  setVolume: (v: number) => void;
  isMuted: boolean;
  toggleMute: () => void;
}

interface UseAudioPlayerOptions {
  onEnded?: () => void;
  initialTimeMs?: number;
  onProgress?: (timeMs: number) => void;
  progressIntervalMs?: number;
}

export function useAudioPlayer(audioUrl?: string, nodeId?: string, options: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentTimeMsRef = useRef(0);
  const prevNodeIdRef = useRef<string | undefined>(nodeId);
  const playbackStateRef = useRef(playbackState);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const onEndedRef = useRef(options.onEnded);
  const onProgressRef = useRef(options.onProgress);
  const initialTimeMsRef = useRef(options.initialTimeMs ?? 0);
  const progressIntervalMsRef = useRef(options.progressIntervalMs ?? 5000);
  const lastProgressSavedAtRef = useRef(0);
  const lastAudioSwapRef = useRef<{ timeMs: number; resume: boolean } | null>(null);

  const updateCurrentTimeMs = useCallback((nextTimeMs: number, options: { force?: boolean } = {}) => {
    const normalizedTimeMs = Number.isFinite(nextTimeMs) ? Math.max(0, nextTimeMs) : 0;
    if (!options.force && Math.abs(normalizedTimeMs - currentTimeMsRef.current) < 50) {
      return;
    }
    currentTimeMsRef.current = normalizedTimeMs;
    setCurrentTimeMs(normalizedTimeMs);
  }, []);

  // Keep volumeRef and isMutedRef in sync
  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    onEndedRef.current = options.onEnded;
  }, [options.onEnded]);

  useEffect(() => {
    onProgressRef.current = options.onProgress;
  }, [options.onProgress]);

  useEffect(() => {
    initialTimeMsRef.current = options.initialTimeMs ?? 0;
    const audio = audioRef.current;
    if (audio && initialTimeMsRef.current > 0) {
      const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      const nextTimeMs = Math.max(0, Math.min(initialTimeMsRef.current, durationMs || initialTimeMsRef.current));
      audio.currentTime = nextTimeMs / 1000;
      updateCurrentTimeMs(nextTimeMs, { force: true });
    }
  }, [options.initialTimeMs, updateCurrentTimeMs]);

  useEffect(() => {
    progressIntervalMsRef.current = options.progressIntervalMs ?? 5000;
  }, [options.progressIntervalMs]);

  useEffect(() => {
    const flushProgress = () => {
      if (document.hidden && audioRef.current?.currentTime) {
        onProgressRef.current?.(audioRef.current.currentTime * 1000);
      }
    };
    document.addEventListener('visibilitychange', flushProgress);
    return () => document.removeEventListener('visibilitychange', flushProgress);
  }, []);

  const handleEnded = useCallback(() => {
    setPlaybackState('idle');
    if (audioRef.current) onProgressRef.current?.(audioRef.current.duration * 1000);
    onEndedRef.current?.();
  }, []);

  // Stop and reset when node changes
  useEffect(() => {
    if (prevNodeIdRef.current !== nodeId) {
      lastAudioSwapRef.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting playback UI when the upstream node (external system) changes
      setPlaybackState('idle');
      updateCurrentTimeMs(0, { force: true });
      setDurationMs(0);
      lastProgressSavedAtRef.current = 0;
      prevNodeIdRef.current = nodeId;
    }
  }, [nodeId, updateCurrentTimeMs]);

  // Create/update Audio element when audioUrl changes
  useEffect(() => {
    if (!audioUrl) {
      lastAudioSwapRef.current = null;
      audioRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting playback UI when the audio URL (external resource) is cleared
      setPlaybackState('idle');
      updateCurrentTimeMs(0, { force: true });
      setDurationMs(0);
      return;
    }

    const sourceUrl = toMediaFetchUrl(audioUrl);
    const swapSnapshot = lastAudioSwapRef.current;
    lastAudioSwapRef.current = null;
    const preloadedAudio = takePreloadedAudio(audioUrl);
    const audio = preloadedAudio ?? new Audio();
    audio.preload = 'auto';
    if (!preloadedAudio) {
      audio.src = sourceUrl;
    }
    audio.volume = volumeRef.current;
    audio.muted = isMutedRef.current;
    const initialPlaybackTimeMs = swapSnapshot?.timeMs ?? initialTimeMsRef.current;
    const shouldResumeAfterSwap = swapSnapshot?.resume === true;
    let resumeAttempted = false;

    const applyInitialTime = (durationMs: number) => {
      const initialTimeMs = Math.max(0, Math.min(initialPlaybackTimeMs, durationMs || initialPlaybackTimeMs));
      if (initialTimeMs > 0) {
        audio.currentTime = initialTimeMs / 1000;
        updateCurrentTimeMs(initialTimeMs, { force: true });
        lastProgressSavedAtRef.current = initialTimeMs;
      }
    };

    const resumePlayback = () => {
      if (!shouldResumeAfterSwap || resumeAttempted || audioRef.current !== audio) return;
      resumeAttempted = true;
      audio.play().then(() => setPlaybackState('playing')).catch(() => {});
    };

    const syncMetadata = () => {
      const nextDurationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      setDurationMs(nextDurationMs);
      applyInitialTime(nextDurationMs);
      resumePlayback();
    };
    const syncTime = () => {
      const nextTimeMs = audio.currentTime * 1000;
      updateCurrentTimeMs(nextTimeMs);
      if (Math.abs(nextTimeMs - lastProgressSavedAtRef.current) >= progressIntervalMsRef.current) {
        lastProgressSavedAtRef.current = nextTimeMs;
        onProgressRef.current?.(nextTimeMs);
      }
    };
    const handleReadyToPlay = () => {
      resumePlayback();
    };
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', syncMetadata);
    audio.addEventListener('loadeddata', handleReadyToPlay);
    audio.addEventListener('canplay', handleReadyToPlay);
    audio.addEventListener('timeupdate', syncTime);
    audioRef.current = audio;
    if (audio.readyState >= 1) syncMetadata();
    if (audio.readyState >= 2) handleReadyToPlay();
    if (!preloadedAudio) audio.load();

    return () => {
      if (audioRef.current === audio) {
        lastAudioSwapRef.current = {
          timeMs: audio.currentTime * 1000,
          resume: playbackStateRef.current === 'playing' && !audio.paused && !audio.ended,
        };
      }
      if (audio.currentTime > 0) onProgressRef.current?.(audio.currentTime * 1000);
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', syncMetadata);
      audio.removeEventListener('loadeddata', handleReadyToPlay);
      audio.removeEventListener('canplay', handleReadyToPlay);
      audio.removeEventListener('timeupdate', syncTime);
    };
  }, [audioUrl, handleEnded, updateCurrentTimeMs]);

  useEffect(() => {
    if (playbackState !== 'playing') return;
    let frameId = 0;
    const syncFrame = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended || playbackStateRef.current !== 'playing') {
        return;
      }
      updateCurrentTimeMs(audio.currentTime * 1000);
      frameId = window.requestAnimationFrame(syncFrame);
    };
    frameId = window.requestAnimationFrame(syncFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [playbackState, updateCurrentTimeMs]);

  // Sync volume to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Sync muted to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playbackState === 'playing') {
      audio.pause();
      onProgressRef.current?.(audio.currentTime * 1000);
      setPlaybackState('paused');
    } else {
      audio.play().then(() => setPlaybackState('playing')).catch(() => {});
    }
  }, [playbackState]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.paused) return;
    audio.play().then(() => setPlaybackState('playing')).catch(() => {});
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    onProgressRef.current?.(audio.currentTime * 1000);
    setPlaybackState('paused');
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    onProgressRef.current?.(audio.currentTime * 1000);
    audio.currentTime = 0;
    updateCurrentTimeMs(0, { force: true });
    setPlaybackState('idle');
  }, [updateCurrentTimeMs]);

  const seekTo = useCallback((timeMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
    const nextTimeMs = Math.max(0, Math.min(timeMs, durationMs || timeMs));
    audio.currentTime = nextTimeMs / 1000;
    updateCurrentTimeMs(nextTimeMs, { force: true });
  }, [updateCurrentTimeMs]);

  return { playbackState, togglePlayPause, play, pause, stop, seekTo, currentTimeMs, durationMs, volume, setVolume, isMuted, toggleMute };
}
