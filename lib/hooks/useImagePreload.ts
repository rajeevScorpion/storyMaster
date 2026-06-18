'use client';

import { useEffect, useMemo, useState } from 'react';
import { toMediaFetchUrl } from '@/lib/media/client';

export type ImagePreloadStatus = 'idle' | 'loading' | 'ready' | 'skipped' | 'failed' | 'timeout';

const DEFAULT_IMAGE_PRELOAD_TIMEOUT_MS = 12000;

function isReadyStatus(status: ImagePreloadStatus): boolean {
  return status === 'ready' || status === 'skipped' || status === 'failed' || status === 'timeout';
}

async function decodeLoadedImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode !== 'function') return;
  try {
    await image.decode();
  } catch {
    // Some browsers reject decode for images that still painted successfully.
  }
}

export function preloadImageForDisplay(
  imageUrl?: string | null,
  timeoutMs = DEFAULT_IMAGE_PRELOAD_TIMEOUT_MS
): Promise<ImagePreloadStatus> {
  if (typeof window === 'undefined') return Promise.resolve('skipped');

  const trimmedUrl = imageUrl?.trim();
  if (!trimmedUrl) return Promise.resolve('skipped');

  const displayUrl = toMediaFetchUrl(trimmedUrl);

  return new Promise((resolve) => {
    const image = new window.Image();
    let settled = false;

    const finish = (status: ImagePreloadStatus) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(status);
    };

    const settleLoadedImage = () => {
      void decodeLoadedImage(image).then(() => {
        finish(image.naturalWidth > 0 ? 'ready' : 'failed');
      });
    };

    const timeoutId = window.setTimeout(() => finish('timeout'), timeoutMs);
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = settleLoadedImage;
    image.onerror = () => finish('failed');
    image.src = displayUrl;

    if (image.complete && image.naturalWidth > 0) {
      settleLoadedImage();
    }
  });
}

export function useImagePreload(
  imageUrl?: string | null,
  preloadKey?: string,
  timeoutMs = DEFAULT_IMAGE_PRELOAD_TIMEOUT_MS
) {
  const key = useMemo(
    () => preloadKey ?? imageUrl ?? 'no-image',
    [imageUrl, preloadKey]
  );
  const [state, setState] = useState<{ key: string; status: ImagePreloadStatus }>({
    key,
    status: imageUrl ? 'loading' : 'skipped',
  });

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(async () => {
      if (!active) return;
      setState({ key, status: imageUrl ? 'loading' : 'skipped' });

      const status = await preloadImageForDisplay(imageUrl, timeoutMs);
      if (active) setState({ key, status });
    });

    return () => { active = false; };
  }, [imageUrl, key, timeoutMs]);

  const status = state.key === key ? state.status : 'loading';
  return {
    status,
    isReady: isReadyStatus(status),
  };
}
