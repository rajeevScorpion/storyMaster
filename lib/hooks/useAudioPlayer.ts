'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  const prevNodeIdRef = useRef<string | undefined>(nodeId);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const onEndedRef = useRef(options.onEnded);
  const onProgressRef = useRef(options.onProgress);
  const initialTimeMsRef = useRef(options.initialTimeMs ?? 0);
  const progressIntervalMsRef = useRef(options.progressIntervalMs ?? 5000);
  const lastProgressSavedAtRef = useRef(0);

  // Keep volumeRef and isMutedRef in sync
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
      setCurrentTimeMs(nextTimeMs);
    }
  }, [options.initialTimeMs]);

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
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting playback UI when the upstream node (external system) changes
      setPlaybackState('idle');
      setCurrentTimeMs(0);
      setDurationMs(0);
      lastProgressSavedAtRef.current = 0;
      prevNodeIdRef.current = nodeId;
    }
  }, [nodeId]);

  // Create/update Audio element when audioUrl changes
  useEffect(() => {
    if (!audioUrl) {
      audioRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting playback UI when the audio URL (external resource) is cleared
      setPlaybackState('idle');
      setCurrentTimeMs(0);
      setDurationMs(0);
      return;
    }

    const audio = new Audio(toMediaFetchUrl(audioUrl));
    audio.volume = volumeRef.current;
    audio.muted = isMutedRef.current;
    const syncMetadata = () => {
      const nextDurationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      setDurationMs(nextDurationMs);
      const initialTimeMs = Math.max(0, Math.min(initialTimeMsRef.current, nextDurationMs || initialTimeMsRef.current));
      if (initialTimeMs > 0) {
        audio.currentTime = initialTimeMs / 1000;
        setCurrentTimeMs(initialTimeMs);
        lastProgressSavedAtRef.current = initialTimeMs;
      }
    };
    const syncTime = () => {
      const nextTimeMs = audio.currentTime * 1000;
      setCurrentTimeMs(nextTimeMs);
      if (Math.abs(nextTimeMs - lastProgressSavedAtRef.current) >= progressIntervalMsRef.current) {
        lastProgressSavedAtRef.current = nextTimeMs;
        onProgressRef.current?.(nextTimeMs);
      }
    };
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', syncMetadata);
    audio.addEventListener('timeupdate', syncTime);
    audioRef.current = audio;

    return () => {
      if (audio.currentTime > 0) onProgressRef.current?.(audio.currentTime * 1000);
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', syncMetadata);
      audio.removeEventListener('timeupdate', syncTime);
    };
  }, [audioUrl, handleEnded]);

  useEffect(() => {
    if (playbackState !== 'playing') return;
    let frameId = 0;
    const syncFrame = () => {
      if (audioRef.current) setCurrentTimeMs(audioRef.current.currentTime * 1000);
      frameId = window.requestAnimationFrame(syncFrame);
    };
    frameId = window.requestAnimationFrame(syncFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [playbackState]);

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
    if (!audio || playbackState === 'playing') return;
    audio.play().then(() => setPlaybackState('playing')).catch(() => {});
  }, [playbackState]);

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
    setCurrentTimeMs(0);
    setPlaybackState('idle');
  }, []);

  const seekTo = useCallback((timeMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
    const nextTimeMs = Math.max(0, Math.min(timeMs, durationMs || timeMs));
    audio.currentTime = nextTimeMs / 1000;
    setCurrentTimeMs(nextTimeMs);
  }, []);

  return { playbackState, togglePlayPause, play, pause, stop, seekTo, currentTimeMs, durationMs, volume, setVolume, isMuted, toggleMute };
}
