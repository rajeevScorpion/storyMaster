'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export type PlaybackState = 'idle' | 'playing' | 'paused';

interface UseAudioPlayerReturn {
  playbackState: PlaybackState;
  togglePlayPause: () => void;
  stop: () => void;
}

export function useAudioPlayer(audioUrl?: string, nodeId?: string): UseAudioPlayerReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevNodeIdRef = useRef<string | undefined>(nodeId);

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
    audio.addEventListener('ended', () => setPlaybackState('idle'));
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('ended', () => setPlaybackState('idle'));
    };
  }, [audioUrl]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playbackState === 'playing') {
      audio.pause();
      setPlaybackState('paused');
    } else {
      audio.play().then(() => setPlaybackState('playing')).catch(console.error);
    }
  }, [playbackState]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setPlaybackState('idle');
  }, []);

  return { playbackState, togglePlayPause, stop };
}
