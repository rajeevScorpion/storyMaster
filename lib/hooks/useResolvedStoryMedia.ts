'use client';

import { useEffect, useState } from 'react';
import { toMediaFetchUrl } from '@/lib/media/client';
import { getStoryPersistence, type StoryMediaAsset } from '@/lib/persistence';
import { isClientStoryPersistenceEnabled } from '@/lib/persistence/runtime';

export interface ResolvedStoryMediaState {
  url: string | undefined;
  isResolving: boolean;
  source: 'remote' | 'cache-storage' | 'capacitor-filesystem' | undefined;
}

export function useResolvedStoryMediaState(asset?: StoryMediaAsset): ResolvedStoryMediaState {
  const assetKey = asset
    ? `${asset.userId}:${asset.assetId}:${asset.version}`
    : undefined;
  const [resolvedMedia, setResolvedMedia] = useState<{
    assetKey: string;
    url: string;
    source: ResolvedStoryMediaState['source'];
  }>();

  useEffect(() => {
    let active = true;
    let localUrl: string | undefined;
    if (!asset) return;
    const currentAssetKey = `${asset.userId}:${asset.assetId}:${asset.version}`;

    const persistence = getStoryPersistence();
    void isClientStoryPersistenceEnabled()
      .then((enabled) => enabled
        ? persistence.resolveMedia(asset)
        : { assetId: asset.assetId, source: 'remote' as const, url: asset.remoteUrl, cacheHit: false, resolvedAt: new Date().toISOString() }
      )
      .catch(() => ({ assetId: asset.assetId, source: 'remote' as const, url: asset.remoteUrl, cacheHit: false, resolvedAt: new Date().toISOString() }))
      .then((resolved) => {
        if (!active) {
          if (resolved.source === 'cache-storage') persistence.releaseMedia(resolved.url);
          return;
        }
        localUrl = resolved.source === 'cache-storage' ? resolved.url : undefined;
        setResolvedMedia({ assetKey: currentAssetKey, url: resolved.url, source: resolved.source });
      });

    return () => {
      active = false;
      if (localUrl) persistence.releaseMedia(localUrl);
    };
  }, [asset, assetKey]);

  const currentResolution = resolvedMedia?.assetKey === assetKey ? resolvedMedia : undefined;
  const remoteFallbackUrl = asset ? toMediaFetchUrl(asset.remoteUrl) : undefined;
  return {
    url: currentResolution?.url ?? remoteFallbackUrl,
    isResolving: Boolean(asset && !currentResolution),
    source: currentResolution?.source ?? (remoteFallbackUrl ? 'remote' : undefined),
  };
}

export function useResolvedStoryMedia(asset?: StoryMediaAsset): string | undefined {
  return useResolvedStoryMediaState(asset).url;
}
