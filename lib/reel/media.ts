import { parseR2UrlLikeReference } from '@/lib/media/r2-reference';

export function toReelFetchUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  const r2Reference = parseR2UrlLikeReference(url);
  const proxyUrl = new URL('/api/media/r2/object', window.location.origin);
  if (r2Reference) {
    proxyUrl.searchParams.set('bucket', r2Reference.bucket);
    proxyUrl.searchParams.set('key', r2Reference.objectKey);
    return proxyUrl.toString();
  }

  try {
    const assetUrl = new URL(url);
    if (
      assetUrl.protocol === 'https:'
      && assetUrl.pathname.startsWith('/stories/')
      && /^media(?:-stage)?\.kissago\.cc$/i.test(assetUrl.hostname)
    ) {
      proxyUrl.searchParams.set('url', assetUrl.toString());
      return proxyUrl.toString();
    }
  } catch {
    // Preserve application-relative URLs and object URLs.
  }
  return url;
}
