import { parseR2Reference, parseR2UrlLikeReference } from '@/lib/media/r2-reference';
import type { StoryMediaKind } from './types';

function cleanPath(value: string): string {
  return decodeURIComponent(value).replace(/^\/+/, '');
}

function parseSupabaseStorageUrl(url: URL): { bucket: string; objectKey: string } | null {
  const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], objectKey: cleanPath(match[2]) };
}

function parseR2ProxyUrl(url: URL): { bucket: string; objectKey: string } | null {
  if (url.pathname !== '/api/media/r2/object') return null;
  const bucket = url.searchParams.get('bucket');
  const objectKey = url.searchParams.get('key');
  return bucket && objectKey ? { bucket, objectKey: cleanPath(objectKey) } : null;
}

export function getStableMediaIdentity(remoteUrl: string, kind: StoryMediaKind): string {
  const directR2 = parseR2Reference(remoteUrl) ?? parseR2UrlLikeReference(remoteUrl);
  if (directR2) return `r2:${directR2.bucket}:${directR2.objectKey}:${kind}`;

  try {
    const url = new URL(remoteUrl, 'https://kissago.local');
    const proxyR2 = parseR2ProxyUrl(url);
    if (proxyR2) return `r2:${proxyR2.bucket}:${proxyR2.objectKey}:${kind}`;

    const supabase = parseSupabaseStorageUrl(url);
    if (supabase) return `supabase:${supabase.bucket}:${supabase.objectKey}:${kind}`;

    if (/^media(?:-stage)?\.kissago\.cc$/i.test(url.hostname)) {
      return `r2-public:${url.hostname}:${cleanPath(url.pathname)}:${kind}`;
    }

    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|signature|credential|expires|x-amz/i.test(key)) url.searchParams.delete(key);
    }
    return `url:${url.origin}${url.pathname}${url.search}:${kind}`;
  } catch {
    return `raw:${remoteUrl.split('?')[0]}:${kind}`;
  }
}

export function getMediaCacheKey(userId: string, assetId: string, version: string): string {
  const params = new URLSearchParams({ userId, assetId, version });
  return `https://kissago.local/__story_media_cache__?${params.toString()}`;
}
