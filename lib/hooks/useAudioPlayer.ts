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
  const wantsPlaybackRef = useRef(false);
  const playAttemptIdRef = useRef(0);
  const playAttemptAudioRef = useRef<HTMLAudioElement | null>(null);
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
    wantsPlaybackRef.current = false;
    playAttemptIdRef.current += 1;
    playAttemptAudioRef.current = null;
    setPlaybackState('idle');
    if (audioRef.current) onProgressRef.current?.(audioRef.current.duration * 1000);
    onEndedRef.current?.();
  }, []);

  // Stop and reset when node changes
  useEffect(() => {
    if (prevNodeIdRef.current !== nodeId) {
      wantsPlaybackRef.current = false;
      playAttemptIdRef.current += 1;
      playAttemptAudioRef.current = null;
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

  const attemptPlayback = useCallback((audio: HTMLAudioElement) => {
    if (
      audioRef.current !== audio
      || !wantsPlaybackRef.current
      || playAttemptAudioRef.current === audio
    ) {
      return;
    }

    const attemptId = ++playAttemptIdRef.current;
    playAttemptAudioRef.current = audio;
    // Reflect the user's first click immediately. A rejected browser play
    // request rolls this back below, while a media URL swap preserves intent.
    setPlaybackState('playing');

    void audio.play().then(() => {
      if (
        audioRef.current !== audio
        || playAttemptIdRef.current !== attemptId
        || !wantsPlaybackRef.current
      ) {
        audio.pause();
        return;
      }
      setPlaybackState('playing');
    }).catch(() => {
      if (audioRef.current !== audio || playAttemptIdRef.current !== attemptId) return;
      wantsPlaybackRef.current = false;
      setPlaybackState(audio.currentTime > 0 ? 'paused' : 'idle');
    }).finally(() => {
      if (playAttemptAudioRef.current === audio) {
        playAttemptAudioRef.current = null;
      }
    });
  }, []);

  // Create/update Audio element when audioUrl changes
  useEffect(() => {
    if (!audioUrl) {
      wantsPlaybackRef.current = false;
      playAttemptIdRef.current += 1;
      playAttemptAudioRef.current = null;
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
    if (shouldResumeAfterSwap) {
      wantsPlaybackRef.current = true;
    }

    const applyInitialTime = (durationMs: number) => {
      const initialTimeMs = Math.max(0, Math.min(initialPlaybackTimeMs, durationMs || initialPlaybackTimeMs));
      if (initialTimeMs > 0) {
        audio.currentTime = initialTimeMs / 1000;
        updateCurrentTimeMs(initialTimeMs, { force: true });
        lastProgressSavedAtRef.current = initialTimeMs;
      }
    };

    const resumePlayback = () => {
      if (
        (!shouldResumeAfterSwap && !wantsPlaybackRef.current)
        || resumeAttempted
        || audioRef.current !== audio
      ) {
        return;
      }
      resumeAttempted = true;
      attemptPlayback(audio);
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
          // Preserve an in-flight first-click/AUTO request as well as playback
          // that has already started. Cached-media resolution can otherwise
          // replace the URL between play() and its promise resolving.
          resume: wantsPlaybackRef.current && !audio.ended,
        };
      }
      if (playAttemptAudioRef.current === audio) {
        playAttemptAudioRef.current = null;
      }
      if (audio.currentTime > 0) onProgressRef.current?.(audio.currentTime * 1000);
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', syncMetadata);
      audio.removeEventListener('loadeddata', handleReadyToPlay);
      audio.removeEventListener('canplay', handleReadyToPlay);
      audio.removeEventListener('timeupdate', syncTime);
    };
  }, [attemptPlayback, audioUrl, handleEnded, updateCurrentTimeMs]);

  useEffect(() => {
    if (playbackState !== 'playing') return;
    let frameId = 0;
    const syncFrame = () => {
      const audio = audioRef.current;
      if (!audio || audio.ended || !wantsPlaybackRef.current) {
        return;
      }
      if (!audio.paused) {
        updateCurrentTimeMs(audio.currentTime * 1000);
      }
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
    const shouldPause = wantsPlaybackRef.current || Boolean(audio && !audio.paused && !audio.ended);
    if (shouldPause) {
      wantsPlaybackRef.current = false;
      playAttemptIdRef.current += 1;
      playAttemptAudioRef.current = null;
      if (!audio) {
        setPlaybackState('paused');
        return;
      }
      audio.pause();
      onProgressRef.current?.(audio.currentTime * 1000);
      setPlaybackState('paused');
    } else {
      wantsPlaybackRef.current = true;
      if (audio) attemptPlayback(audio);
    }
  }, [attemptPlayback]);

  const play = useCallback(() => {
    wantsPlaybackRef.current = true;
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused && !audio.ended) {
      setPlaybackState('playing');
      return;
    }
    attemptPlayback(audio);
  }, [attemptPlayback]);

  const pause = useCallback(() => {
    wantsPlaybackRef.current = false;
    playAttemptIdRef.current += 1;
    playAttemptAudioRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      onProgressRef.current?.(audio.currentTime * 1000);
    }
    setPlaybackState('paused');
  }, []);

  const stop = useCallback(() => {
    wantsPlaybackRef.current = false;
    playAttemptIdRef.current += 1;
    playAttemptAudioRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      onProgressRef.current?.(audio.currentTime * 1000);
      audio.currentTime = 0;
    }
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
