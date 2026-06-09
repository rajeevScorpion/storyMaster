'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export type PlaybackState = 'idle' | 'playing' | 'paused';

interface UseAudioPlayerReturn {
  playbackState: PlaybackState;
  togglePlayPause: () => void;
  play: () => void;
  stop: () => void;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  setVolume: (v: number) => void;
  isMuted: boolean;
  toggleMute: () => void;
}

interface UseAudioPlayerOptions {
  onEnded?: () => void;
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

  const handleEnded = useCallback(() => {
    setPlaybackState('idle');
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

    const audio = new Audio(audioUrl);
    audio.volume = volumeRef.current;
    audio.muted = isMutedRef.current;
    const syncMetadata = () => setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    const syncTime = () => setCurrentTimeMs(audio.currentTime * 1000);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', syncMetadata);
    audio.addEventListener('timeupdate', syncTime);
    audioRef.current = audio;

    return () => {
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

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTimeMs(0);
    setPlaybackState('idle');
  }, []);

  return { playbackState, togglePlayPause, play, stop, currentTimeMs, durationMs, volume, setVolume, isMuted, toggleMute };
}
