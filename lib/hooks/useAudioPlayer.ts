'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export type PlaybackState = 'idle' | 'playing' | 'paused';

interface UseAudioPlayerReturn {
  playbackState: PlaybackState;
  togglePlayPause: () => void;
  play: () => void;
  stop: () => void;
  volume: number;
  setVolume: (v: number) => void;
}

export function useAudioPlayer(audioUrl?: string, nodeId?: string): UseAudioPlayerReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [volume, setVolumeState] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevNodeIdRef = useRef<string | undefined>(nodeId);
  const volumeRef = useRef(volume);

  // Keep volumeRef in sync
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Stop and reset when node changes
  useEffect(() => {
    if (prevNodeIdRef.current !== nodeId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      setPlaybackState('idle');
      prevNodeIdRef.current = nodeId;
    }
  }, [nodeId]);

  // Create/update Audio element when audioUrl changes
  useEffect(() => {
    if (!audioUrl) {
      audioRef.current = null;
      setPlaybackState('idle');
      return;
    }

    const audio = new Audio(audioUrl);
    audio.volume = volumeRef.current;
    audio.addEventListener('ended', () => setPlaybackState('idle'));
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('ended', () => setPlaybackState('idle'));
    };
  }, [audioUrl]);

  // Sync volume to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
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
    setPlaybackState('idle');
  }, []);

  return { playbackState, togglePlayPause, play, stop, volume, setVolume };
}
