'use client';

import { toMediaFetchUrl } from '@/lib/media/client';

const DEFAULT_AUDIO_PRELOAD_TIMEOUT_MS = 12000;
const MAX_PRELOADED_AUDIO = 12;

type AudioPreloadEntry = {
  audio: HTMLAudioElement;
  promise: Promise<void>;
  lastUsedAt: number;
  settled: boolean;
  cleanup: () => void;
  finish: (ready: boolean) => void;
};

const audioPreloadEntries = new Map<string, AudioPreloadEntry>();

function resolveAudioSrc(audioUrl: string): string {
  return toMediaFetchUrl(audioUrl.trim());
}

function evictOldAudioPreloads() {
  if (audioPreloadEntries.size <= MAX_PRELOADED_AUDIO) return;

  const candidates = [...audioPreloadEntries.entries()]
    .filter(([, entry]) => entry.settled)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  const removeCount = audioPreloadEntries.size - MAX_PRELOADED_AUDIO;

  for (const [src, entry] of candidates.slice(0, removeCount)) {
    entry.cleanup();
    entry.audio.pause();
    entry.audio.removeAttribute('src');
    entry.audio.load();
    audioPreloadEntries.delete(src);
  }
}

export function preloadAudioForPlayback(
  audioUrl?: string | null,
  timeoutMs = DEFAULT_AUDIO_PRELOAD_TIMEOUT_MS
): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const sourceUrl = audioUrl?.trim();
  if (!sourceUrl) return Promise.resolve();

  const src = resolveAudioSrc(sourceUrl);
  const existing = audioPreloadEntries.get(src);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.promise;
  }

  const audio = new Audio();
  audio.preload = 'auto';

  let settle: (ready: boolean) => void = () => {};
  let cleanup: () => void = () => {};
  const entry: AudioPreloadEntry = {
    audio,
    promise: Promise.resolve(),
    lastUsedAt: Date.now(),
    settled: false,
    cleanup: () => cleanup(),
    finish: () => {},
  };

  entry.promise = new Promise<void>((resolve) => {
    let settled = false;
    let timer: number | null = null;

    cleanup = () => {
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    settle = (ready: boolean) => {
      if (settled) return;
      settled = true;
      entry.settled = true;
      cleanup();
      if (!ready) audioPreloadEntries.delete(src);
      resolve();
    };
    entry.finish = settle;

    const onReady = () => settle(true);
    const onError = () => settle(false);

    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('error', onError);

    timer = window.setTimeout(() => {
      // Keep a partially buffered element only if it can already begin
      // playback; otherwise let the player create a fresh request.
      settle(audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    }, Math.max(1000, timeoutMs));

    audio.src = src;
    audio.load();
    if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      settle(true);
    }
  });

  audioPreloadEntries.set(src, entry);
  evictOldAudioPreloads();
  return entry.promise;
}

export function takePreloadedAudio(audioUrl?: string | null): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  const sourceUrl = audioUrl?.trim();
  if (!sourceUrl) return null;

  const src = resolveAudioSrc(sourceUrl);
  const entry = audioPreloadEntries.get(src);
  if (!entry) return null;

  entry.lastUsedAt = Date.now();
  audioPreloadEntries.delete(src);
  if (!entry.settled) entry.finish(true);
  return entry.audio;
}
