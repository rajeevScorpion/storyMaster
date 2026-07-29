'use client';

import type { StoryBeat } from '@/lib/types/story';
import { preloadImageForDisplay } from '@/lib/hooks/useImagePreload';
import { preloadAudioForPlayback } from '@/lib/media/audio-preload';

export interface StorylineMediaUrls {
  imageUrls: string[];
  audioUrls: string[];
}

function addUrl(urls: Set<string>, url?: string | null) {
  const normalized = url?.trim();
  if (normalized) urls.add(normalized);
}

export function getStorylineMediaUrls(beats: readonly StoryBeat[]): StorylineMediaUrls {
  const imageUrls = new Set<string>();
  const audioUrls = new Set<string>();

  beats.forEach((beat) => {
    // A portrait can be the displayed visual for a regular beat, while the
    // storyboard grid still uses imageUrl. Preload both when both exist.
    addUrl(imageUrls, beat.portraitImageUrl);
    addUrl(imageUrls, beat.imageUrl);
    addUrl(imageUrls, beat.persistedImageUrl);
    addUrl(audioUrls, beat.audioUrl);
  });

  return {
    imageUrls: [...imageUrls],
    audioUrls: [...audioUrls],
  };
}

export async function preloadStorylineMedia(beats: readonly StoryBeat[]): Promise<void> {
  const { imageUrls, audioUrls } = getStorylineMediaUrls(beats);

  await Promise.all([
    ...imageUrls.map((url) => preloadImageForDisplay(url)),
    ...audioUrls.map((url) => preloadAudioForPlayback(url)),
  ]);
}
